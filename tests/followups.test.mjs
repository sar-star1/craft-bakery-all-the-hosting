import "./harness/register.mjs";
import { createClient } from "@supabase/supabase-js";
import { start, stubTelegram, tables } from "./harness/fake-postgrest.mjs";
import { makeChecker } from "./harness/check.mjs";

process.env.SUPABASE_URL = "http://localhost:54797";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
process.env.TELEGRAM_BOT_TOKEN = "000:fake";
process.env.TELEGRAM_ADMIN_GROUP_ID = "-1001";
process.env.SITE_URL = "https://example.com";
process.env.ANTHROPIC_API_KEY = "test-key";
const tg = stubTelegram();
const srv = await start(54797);
setTimeout(() => { console.log("TIMEOUT — test hung"); process.exit(2); }, 90000).unref();
const { check, done } = makeChecker();
const db = createClient("http://localhost:54797", "fake", { auth: { persistSession: false } });

// scripted model: tells the agent apart from the "write a message from the team's instruction" call
const calls = [];
let agentReply = "Вітаємо! Зараз все підкажемо.";
const priorFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.anthropic.com")) {
    const body = JSON.parse(init.body);
    const sys = String(body.system);
    const kind = sys.startsWith("Ти асистент пекарні Peremoga Bakery і пишеш клієнтові") ? "compose" : sys.startsWith("Клієнт пекарні") ? "classifier" : "agent";
    calls.push({ kind, body });
    const text = kind === "compose" ? "Добрий день! Безглютенову випічку робимо під замовлення за добу." : kind === "classifier" ? "ACK" : agentReply;
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", usage: { input_tokens: 1, output_tokens: 1 }, stop_sequence: null, stop_reason: "end_turn", content: [{ type: "text", text }] }), { headers: { "Content-Type": "application/json" } });
  }
  return priorFetch(url, init);
};

const CL = "22222222-2222-4222-8222-222222222222";
const reset = () => {
  tables.clients = [{ id: CL, business_name: "Кав'ярня Ліра", telegram_chat_id: "888", pipeline_stage: "recurring", status: "active", agent_paused: false, fop: "ФОП Лис Т. М.", delivery_address: "вул. Садова 5", payment_method: "cashless", phone: "+380501110000" }];
  tables.conversations = [{ id: "conv-9", client_id: CL, last_message_at: new Date().toISOString(), status: "gathering", captured_fields: {} }];
  tables.messages = [];
  tables.orders = [];
  tables.pending_replies = [];
  tables.agent_events = [];
  tables.relayed_messages = [];
  tables.site_content = [{ key: "ordering_rules", content_json: { min_order_total: 1000, free_delivery_from: 2000, delivery_fee: 250 } }];
  tables.menu_categories = [{ id: "c1", name_uk: "Торти", min_order: 1 }];
  tables.menu_items = [{ id: "i-cake", category_id: "c1", name_uk: "Наполеон", price: 1250, is_active: true }];
  tg.length = 0;
  calls.length = 0;
};
const say = async (text, id) => {
  const { processTelegramUpdate } = await import("../lib/agent/run.ts");
  await processTelegramUpdate({ update_id: id, message: { message_id: id, text, chat: { id: 888, type: "private" }, from: { id: 888, first_name: "Тетяна" } } });
};
const toClient = () => tg.filter((c) => c.method === "sendMessage" && c.body.chat_id === "888").map((c) => c.body.text);

// ---- 1. a burst of texts gets ONE answer, after the client has been quiet for a moment
reset();
process.env.AGENT_REPLY_DELAY_SECONDS = "1";
process.env.AGENT_APPROVE_ALL = "false";
const t0 = Date.now();
await Promise.all([
  say("Добрий день", 301),
  (async () => { await new Promise((r) => setTimeout(r, 250)); await say("хочу замовити торти", 302); })(),
  (async () => { await new Promise((r) => setTimeout(r, 500)); await say("на завтра", 303); })(),
]);
const agentCalls = calls.filter((c) => c.kind === "agent");
check("three texts in a burst → the agent ran once", agentCalls.length === 1, String(agentCalls.length));
check("…and answered once", toClient().length === 1, JSON.stringify(toClient()));
const sentMsgs = agentCalls[0].body.messages.map((m) => m.content).join(" | ");
check("…seeing all three texts", ["Добрий день", "хочу замовити торти", "на завтра"].every((t) => sentMsgs.includes(t)), sentMsgs);
check("…and it waited for the quiet period (≥ 1.2 s after the first text)", Date.now() - t0 >= 1200, String(Date.now() - t0));
reset();
await say("Одне повідомлення", 311);
check("a single text is answered too", toClient().length === 1);
process.env.AGENT_REPLY_DELAY_SECONDS = "0";

// ---- 2. returning clients are not asked for their details again
reset();
const { runOrderTool } = await import("../lib/agent/orderTools.ts");
const flags = { humanReviewReasons: [], massOrderFlagged: false, confirmationProposed: false, menuLinkSent: false };
const ctx = { supabase: db, client: { id: CL, business_name: "Кав'ярня Ліра", pipeline_stage: "recurring" }, conversationId: "conv-9", flags, inboundCount: 1 };
const r = JSON.parse(await runOrderTool("update_order_draft", { items: [{ item_id: "i-cake", qty: 2 }] }, ctx));
check("only items given: ФОП, адреса, оплата come from memory — nothing is missing except what we never knew", r.details.fop === "ФОП Лис Т. М." && r.details.address === "вул. Садова 5" && r.details.payment_method === "Безготівка" && r.missing.join() === "venue name (назва кав'ярні)" || r.missing.length === 0, JSON.stringify(r));
check("the venue name of a client who has ordered before is remembered too", r.details.venue_name === "Кав'ярня Ліра" && r.missing.length === 0, JSON.stringify(r));
reset();
tables.clients[0] = { id: CL, business_name: "Тетяна", telegram_chat_id: "888", pipeline_stage: "in_conversation", status: "engaged" }; // never ordered: business_name is just their Telegram name
const r2 = JSON.parse(await runOrderTool("update_order_draft", { items: [{ item_id: "i-cake", qty: 2 }] }, ctx));
check("a new client's Telegram name is NOT used as the venue name; everything is asked", r2.missing.length === 4 && !r2.details.venue_name, JSON.stringify(r2));
reset();
const r3 = JSON.parse(await runOrderTool("update_order_draft", { items: [{ item_id: "i-cake", qty: 2 }], address: "вул. Нова 1" }, ctx));
check("a new value the client gives replaces the remembered one", r3.details.address === "вул. Нова 1" && r3.details.fop === "ФОП Лис Т. М.", JSON.stringify(r3));

// ---- 3. "tell the client this and that" — a button, a reply, no takeover
reset();
tables.pending_replies = [{ id: "a1111111-1111-4111-8111-111111111111", client_id: CL, conversation_id: "conv-9", draft_text: "Зараз уточнимо й повернемося.", reply_type: "order_flow", status: "awaiting_approval", edited: false, attachments: [], admin_message_id: 70, team_question: "Чи є безглютенові?" }];
const { processTelegramUpdate } = await import("../lib/agent/run.ts");
const alertCb = (data) => ({ update_id: 400, callback_query: { id: "cb", from: { id: 5, first_name: "Оля" }, message: { message_id: 70, text: "чернетка", chat: { id: -1001, type: "supergroup" } }, data } });

await processTelegramUpdate(alertCb("ap:a1111111-1111-4111-8111-111111111111"));
const edited = tg.find((c) => c.method === "editMessageText" && String(c.body.chat_id) === "-1001");
check("after the 'we'll check' message is sent, the alert STILL has a 📨 Передати клієнту button", edited?.body.reply_markup?.inline_keyboard?.flat().some((b) => b.callback_data === `tl:${CL}`), JSON.stringify(edited?.body.reply_markup));

tg.length = 0;
await processTelegramUpdate(alertCb(`tl:${CL}`));
const prompt = tg.find((c) => c.method === "sendMessage" && c.body.chat_id === "-1001");
check("pressing it asks what to pass on, in the group", /Що передати клієнту/.test(prompt?.body.text ?? ""), JSON.stringify(tg));
check("the prompt is registered so the reply is read as an instruction", tables.relayed_messages.length === 1 && tables.relayed_messages[0].kind === "tell");

tg.length = 0;
process.env.AGENT_APPROVE_ALL = "true";
await processTelegramUpdate({ update_id: 401, message: { message_id: 90, text: "скажи, що безглютенову випічку робимо за добу під замовлення", chat: { id: -1001, type: "supergroup" }, from: { id: 5, first_name: "Оля" }, reply_to_message: { message_id: tables.relayed_messages[0].admin_message_id, text: "…" } } });
check("the agent composed the message from the instruction", calls.some((c) => c.kind === "compose" && String(c.body.messages[0].content).includes("безглютенову випічку")));
check("strict mode: it is a draft with ✅ for the team — nothing reached the client yet", toClient().length === 0 && tables.pending_replies.filter((p) => p.status === "awaiting_approval").length === 1);
check("the group got the draft, noting the instruction", tg.some((c) => c.body.chat_id === "-1001" && /Вказівка/.test(c.body.text ?? "") && c.body.reply_markup?.inline_keyboard?.flat().some((b) => b.callback_data?.startsWith("ap:"))));
check("the agent was NOT put on pause (no takeover)", tables.clients[0].agent_paused === false);

// approve-all off → the instruction itself is the decision, sent right away
tg.length = 0;
process.env.AGENT_APPROVE_ALL = "false";
const { tellClientViaAgent } = await import("../lib/tellClient.ts");
const res = await tellClientViaAgent(db, { clientId: CL, instruction: "скажи, що безглютенову випічку робимо за добу", by: "Оля" });
check("with strict mode off the composed message is sent straight away", res.ok && res.sent && toClient().some((t) => /Безглютенову випічку робимо/.test(t)), JSON.stringify({ res, sent: toClient() }));

// "!" on an alert that is already handled = a new verbatim message, agent stays on
tg.length = 0;
tables.pending_replies.push({ id: "b2222222-2222-4222-8222-222222222222", client_id: CL, conversation_id: "conv-9", draft_text: "старе", reply_type: "order_flow", status: "approved_sent", admin_message_id: 71 });
await processTelegramUpdate({ update_id: 402, message: { message_id: 91, text: "!Оновлення: безглютенові є, 450 грн за набір", chat: { id: -1001, type: "supergroup" }, from: { id: 5, first_name: "Оля" }, reply_to_message: { message_id: 71, text: "…" } } });
check("«!текст» on an already-handled alert sends that text as a new message", toClient().includes("Оновлення: безглютенові є, 450 грн за набір"));
check("…without pausing the agent", tables.clients[0].agent_paused === false);

// "/tell" on a draft alert
tg.length = 0;
process.env.AGENT_APPROVE_ALL = "true";
await processTelegramUpdate({ update_id: 403, message: { message_id: 92, text: "/tell скажи, що безглютенові робимо за добу", chat: { id: -1001, type: "supergroup" }, from: { id: 5, first_name: "Оля" }, reply_to_message: { message_id: 71, text: "…" } } });
check("«/tell …» on any alert also makes the agent write a message to that client", calls.filter((c) => c.kind === "compose").length >= 3);

const ok = done();
srv.close();
process.exit(ok ? 0 : 1);
