import "./harness/register.mjs";
import { start, stubTelegram, tables } from "./harness/fake-postgrest.mjs";
import { makeChecker } from "./harness/check.mjs";

process.env.SUPABASE_URL = "http://localhost:54795";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
process.env.TELEGRAM_BOT_TOKEN = "000:fake";
process.env.TELEGRAM_ADMIN_GROUP_ID = "-1001";
process.env.SITE_URL = "https://example.com";
process.env.ANTHROPIC_API_KEY = "test-key";
const tg = stubTelegram();
const srv = await start(54795);
setTimeout(() => { console.log("TIMEOUT — test hung"); process.exit(2); }, 90000).unref();
const { check, done } = makeChecker();

// ---- a scripted model: tells the approval classifier apart from the agent by its system prompt
const modelCalls = [];
let classifierAnswer = "ACK";
let classifierDown = false;
let agentReply = "Дякуємо! Замовлення прийнято, менеджер підтвердить деталі та дату.";
const priorFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.anthropic.com")) {
    const body = JSON.parse(init.body);
    const isClassifier = String(body.system).startsWith("Клієнт пекарні отримав підсумок");
    modelCalls.push({ kind: isClassifier ? "classifier" : "agent", body });
    if (isClassifier && classifierDown) return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "down" } }), { status: 400, headers: { "Content-Type": "application/json" } });
    const text = isClassifier ? classifierAnswer : agentReply;
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", usage: { input_tokens: 1, output_tokens: 1 }, stop_sequence: null, stop_reason: "end_turn", content: [{ type: "text", text }] }), { headers: { "Content-Type": "application/json" } });
  }
  return priorFetch(url, init);
};

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
tables.menu_categories = [{ id: "c1", name_uk: "Торти", min_order: 1 }, { id: "c2", name_uk: "Еклери", min_order: 1 }];
tables.menu_items = [
  { id: "i-cake", category_id: "c1", name_uk: "Наполеон", price: 1250, is_active: true },
  { id: "i-eclair", category_id: "c2", name_uk: "Еклер", price: 79, is_active: true },
];
tables.site_content = [{ key: "ordering_rules", content_json: { min_order_total: 1000, free_delivery_from: 2000, delivery_fee: 250 } }]; // auto_confirm_minutes left to the default
const draft = (extra = {}) => ({
  lines: [{ item_id: "i-cake", name: "Наполеон", qty: 1 }, { item_id: "i-eclair", name: "Еклер", qty: 10 }],
  venue_name: "Фенікс", fop: "ФОП Корж", address: "вул. Тестова 1", payment_method: "cash",
  updated_at: minutesAgo(5), summary_at_inbound: 1, summary_message_id: 555, summary_sent_at: minutesAgo(3), ...extra,
});
const reset = (id, fields) => {
  tables.clients = [{ id, business_name: "Фенікс", telegram_chat_id: "111", pipeline_stage: "in_conversation", status: "engaged", agent_paused: false }];
  tables.conversations = [{ id: "conv-1", client_id: id, last_message_at: minutesAgo(2), status: "gathering", captured_fields: fields }];
  tables.messages = [
    { id: "m1", client_id: id, direction: "in", text: "Хочу наполеон і еклери", telegram_message_id: 1, created_at: minutesAgo(10) },
    { id: "m2", client_id: id, direction: "out", text: "Підсумок: Наполеон ×1, Еклер ×10. Усе вірно?", telegram_message_id: 555, created_at: minutesAgo(3) },
  ];
  tables.orders = [];
  tables.agent_events = [];
  tables.pending_replies = [];
  tables.mass_order_flags = [];
  tg.length = 0;
  modelCalls.length = 0;
};
let update = 100;
const say = async (text, messageId = 50 + update) => {
  const { processTelegramUpdate } = await import("../lib/agent/run.ts");
  await processTelegramUpdate({ update_id: ++update, message: { message_id: messageId, text, chat: { id: 111, type: "private" }, from: { id: 111, first_name: "Максим" } } });
};
const sentToClient = () => tg.filter((c) => c.method === "sendMessage" && c.body.chat_id === "111").map((c) => c.body.text);

// ---- 1. any approving message places the order BEFORE the agent answers
for (const word of ["Ок , дякую", "Так супер 👍 \nДякую", "Без проблем )", "👍", "Чудово, чекаю"]) {
  reset("11111111-1111-4111-8111-111111111111", { draft_order: draft() });
  await say(word);
  const placed = tables.orders[0];
  check(`«${word.replace(/\n/g, " ")}» approves: the order is in the system`, placed?.source === "telegram" && placed.status === "new" && placed.total_amount === 2040 && placed.item_details_uk?.approval === "text", JSON.stringify(placed));
  check("   …no model call was needed to recognise it", !modelCalls.some((c) => c.kind === "classifier"));
  check("   …the draft is gone and the client is now first_order", !tables.conversations[0].captured_fields.draft_order && tables.clients[0].pipeline_stage === "first_order");
}

// ---- 2. what the agent is told after that
reset("11111111-1111-4111-8111-111111111111", { draft_order: draft() });
await say("Ок , дякую");
const agentCall = modelCalls.find((c) => c.kind === "agent");
const sys = String(agentCall.body.system);
check("the agent is told the order was JUST placed and not to ask again", sys.includes("ЩОЙНО ОФОРМЛЕНО СИСТЕМОЮ") && sys.includes("НІЧОГО не перепитуй"), sys.slice(-900));
check("the closed order's history is cut: the agent sees only the message it must answer", agentCall.body.messages.length === 1 && agentCall.body.messages[0].content === "Ок , дякую", JSON.stringify(agentCall.body.messages));
check("the confirmation reaches the client straight away (not held for approval)", sentToClient().some((t) => /Замовлення прийнято/.test(t)) && tables.pending_replies.length === 0, JSON.stringify({ sent: sentToClient(), held: tables.pending_replies.length }));
check("the staff group got the new order, with how it was approved", tg.some((c) => c.body.chat_id === "-1001" && /клієнт підтвердив текстом/.test(c.body.text ?? "")));

// ---- 3. the NEXT message after a confirmed order: a new order, order state says so; amend is allowed
tables.messages.push({ id: "m9", client_id: "11111111-1111-4111-8111-111111111111", direction: "out", text: "Дякуємо! Замовлення прийнято", telegram_message_id: 600, created_at: minutesAgo(0.5) });
modelCalls.length = 0;
tg.length = 0;
await say("А що порадите до кави?", 301);
const next = modelCalls.find((c) => c.kind === "agent");
const sys2 = String(next.body.system);
check("no summary is waiting, so nothing is classified or placed", !modelCalls.some((c) => c.kind === "classifier") && tables.orders.length === 1);
check("state: last order is CLOSED, can still be amended, next message starts a new order", sys2.includes("ЗАКРИТЕ") && sys2.includes("amend_last_order") && sys2.includes("початок НОВОГО замовлення"), sys2.slice(-1200));
check("the old summary and confirmation are not in the history any more", next.body.messages.every((m) => !String(m.content).includes("Усе вірно?")) && next.body.messages.at(-1).content === "А що порадите до кави?", JSON.stringify(next.body.messages));

// ---- 4. a message that CHANGES the summary does not place anything
reset("11111111-1111-4111-8111-111111111111", { draft_order: draft() });
classifierAnswer = "CHANGE";
agentReply = "Звісно, додамо еклери. Скільки?";
await say("А можна ще 5 еклерів?", 80);
check("a change request is classified by the model and nothing is placed", modelCalls.some((c) => c.kind === "classifier") && tables.orders.length === 0 && Boolean(tables.conversations[0].captured_fields.draft_order));
check("the agent is told the client is CHANGING the summary (not approving)", String(modelCalls.find((c) => c.kind === "agent").body.system).includes("ЗМІНЮЄ"));

// ---- 5. approval + something new in one message
reset("11111111-1111-4111-8111-111111111111", { draft_order: draft() });
classifierAnswer = "MORE";
agentReply = "Замовлення прийнято. На п'ятницю підкажемо!";
await say("Дякую! А що в вас є на пʼятницю?", 90);
check("approval + new question: the pending order is placed ('continued')", tables.orders[0]?.item_details_uk?.approval === "continued");
check("the agent is told to confirm in one sentence, then deal with the rest", String(modelCalls.find((c) => c.kind === "agent").body.system).includes("Спершу одним теплим реченням"));

// ---- 6. a summary the client never saw (held for approval) can't be approved by their message
reset("11111111-1111-4111-8111-111111111111", { draft_order: draft({ summary_sent_at: undefined, summary_message_id: undefined }) });
classifierAnswer = "ACK";
agentReply = "Добре, дякуємо!";
await say("Ок", 95);
check("no order when the summary was never delivered to the client", tables.orders.length === 0);

// ---- 7. classifier unavailable: conservative text check instead of silence
reset("11111111-1111-4111-8111-111111111111", { draft_order: draft() });
classifierDown = true;
agentReply = "Добре, дякуємо!";
await say("Гаразд, тоді в четвер привезіть", 97);
check("model classifier down: message with no change signs still counts as approval", tables.orders.length === 1 && tables.orders[0].item_details_uk.approval === "continued", JSON.stringify(tables.orders));
classifierDown = false;

// ---- 8. a positive reaction on a LATER message of ours also approves
reset("11111111-1111-4111-8111-111111111111", { draft_order: draft() });
tables.messages.push({ id: "m5", client_id: "11111111-1111-4111-8111-111111111111", direction: "out", text: "Усе вірно?", telegram_message_id: 560, created_at: minutesAgo(1) });
const co = await import("../lib/chatOrders.ts");
const { createClient } = await import("@supabase/supabase-js");
const db = createClient("http://localhost:54795", "fake", { auth: { persistSession: false } });
let r = await co.handleReactionApproval(db, { chatId: "111", messageId: 560, emojis: ["❤"] });
check("❤ on 'Усе вірно?' (sent after the summary) approves it", r === true && tables.orders[0]?.item_details_uk?.approval === "reaction");
reset("11111111-1111-4111-8111-111111111111", { draft_order: draft() });
tables.messages.push({ id: "m6", client_id: "11111111-1111-4111-8111-111111111111", direction: "out", text: "старе", telegram_message_id: 40, created_at: minutesAgo(30) });
r = await co.handleReactionApproval(db, { chatId: "111", messageId: 40, emojis: ["👍"] });
check("a reaction on something we said BEFORE the summary approves nothing", r === false && tables.orders.length === 0);

// ---- 9. silence: a couple of hours by default
reset("11111111-1111-4111-8111-111111111111", { draft_order: draft({ summary_sent_at: minutesAgo(90) }) });
tables.messages = tables.messages.map((m) => ({ ...m, created_at: minutesAgo(200) })); // the client has been silent since before the summary
let n = await co.sweepPendingOrders(db);
check("after 90 min of silence nothing happens yet (default is 2 hours)", n === 0 && tables.orders.length === 0);
tables.conversations[0].captured_fields = { draft_order: draft({ summary_sent_at: minutesAgo(130) }) };
n = await co.sweepPendingOrders(db);
check("after 130 min of silence the order is placed automatically", n === 1 && tables.orders[0]?.item_details_uk?.approval === "implicit");

// ---- 10. the agent can't claim it changed an order it did not change
const { replyProblem, claimsOrderChanged } = await import("../lib/agent/postprocess.ts");
check("«Додали до вашого замовлення…» without amend_last_order is sent back", /amend_last_order/.test(replyProblem("Додали ще 10 круасанів до вашого замовлення", { humanReviewReasons: [] }) ?? ""));
check("…but fine when amend_last_order ran", replyProblem("Додали ще 10 круасанів до вашого замовлення", { humanReviewReasons: [], orderAmended: true }) === null);
check("…and when it is a new draft being built", replyProblem("Додали круасани в замовлення", { humanReviewReasons: [], toolsUsed: ["update_order_draft"] }) === null);
check("ordinary text isn't flagged", !claimsOrderChanged("Яка адреса доставки?"));

const ok = done();
srv.close();
process.exit(ok ? 0 : 1);
