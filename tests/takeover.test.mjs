import "./harness/register.mjs";
import { createClient } from "@supabase/supabase-js";
import { start, stubTelegram, tables } from "./harness/fake-postgrest.mjs";
import { makeChecker } from "./harness/check.mjs";

process.env.SUPABASE_URL = "http://localhost:54790";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
process.env.TELEGRAM_BOT_TOKEN = "000:fake";
process.env.TELEGRAM_ADMIN_GROUP_ID = "-1001";
process.env.SITE_URL = "https://example.com";
delete process.env.ANTHROPIC_API_KEY;
const tg = stubTelegram();
const srv = await start(54790);
setTimeout(() => { console.log("TIMEOUT — test hung"); process.exit(2); }, 60000).unref();
const { check, done } = makeChecker();
const db = createClient("http://localhost:54790", "fake", { auth: { persistSession: false } });

// ---- promises to "clarify" must be backed by a real question to the team
const { promisesFollowUp, replyProblem } = await import("../lib/agent/postprocess.ts");
for (const t of ["Гарне питання, уточню в команди і повернуся до вас", "Перевірю й дам відповідь", "Передам питання менеджеру", "З'ясуємо це найближчим часом", "Зв'яжусь із вами"])
  check(`promise detected: «${t}»`, promisesFollowUp(t));
for (const t of ["У нас є безглютенові еклери, 79 ₴", "Замовлення прийнято, менеджер підтвердить деталі", "Вітаю! Що плануєте замовляти?"])
  check(`no false alarm: «${t}»`, !promisesFollowUp(t));
const base = { humanReviewReasons: [] };
check("a promise without request_human_review is sent back to the model", /request_human_review/.test(replyProblem("Уточню в команди", base) ?? ""));
check("…but not when the team was actually asked", replyProblem("Уточню в команди", { humanReviewReasons: ["unsure"] }) === null);

// ---- free delivery: the shortfall must be named, especially after the client added something
check("shortfall not mentioned → corrected", /339/.test(replyProblem("Ось підсумок: 1661 ₴ + доставка 250", { ...base, summaryShown: true, freeDeliveryShortfall: 339 }) ?? ""));
check("shortfall mentioned (with a space/₴) → fine", replyProblem("До безкоштовної доставки ще бракує 339 ₴", { ...base, summaryShown: true, freeDeliveryShortfall: 339 }) === null);
check("1 339 written with a thin space also counts", replyProblem("бракує 1 339 ₴", { ...base, summaryShown: true, freeDeliveryShortfall: 1339 }) === null);
check("still-short-after-adding gets its own instruction", /ще не дотягує/.test(replyProblem("Підсумок…", { ...base, summaryShown: true, freeDeliveryShortfall: 339, stillShortAfterAdding: true }) ?? ""));
check("no correction when the summary isn't being shown yet", replyProblem("Яка адреса?", { ...base, summaryShown: false, freeDeliveryShortfall: 339 }) === null);

tables.menu_categories = [{ id: "c1", name_uk: "Торти", min_order: 1, sort_order: 1 }];
tables.menu_items = [
  { id: "i-cake", category_id: "c1", name_uk: "Наполеон", price: 1250, is_active: true, sort_order: 1 },
  { id: "i-tart", category_id: "c1", name_uk: "Тарт", price: 411, is_active: true, sort_order: 2 },
];
tables.site_content = [{ key: "ordering_rules", content_json: { min_order_total: 1000, free_delivery_from: 2000, delivery_fee: 250, auto_confirm_minutes: 30 } }];
tables.clients = [{ id: "11111111-1111-4111-8111-111111111111", business_name: "Кав'ярня", telegram_chat_id: "777", pipeline_stage: "in_conversation", status: "engaged", agent_paused: false }];
tables.conversations = [{ id: "conv-1", client_id: "11111111-1111-4111-8111-111111111111", captured_fields: {}, last_message_at: new Date().toISOString() }];
tables.messages = [];
tables.agent_events = [];
tables.agent_examples = [];
tables.relayed_messages = [];
tables.pending_replies = [];

const { runOrderTool } = await import("../lib/agent/orderTools.ts");
const flags = { humanReviewReasons: [], massOrderFlagged: false, confirmationProposed: false, menuLinkSent: false };
const ctx = { supabase: db, client: { id: "11111111-1111-4111-8111-111111111111", business_name: "Кав'ярня", pipeline_stage: "in_conversation" }, conversationId: "conv-1", flags, inboundCount: 1 };
await runOrderTool("update_order_draft", { items: [{ item_id: "i-cake", qty: 1 }], venue_name: "К", fop: "Ф", address: "А", payment_method: "cash" }, ctx);
let rev = JSON.parse(await runOrderTool("review_order", {}, ctx));
check("first summary: shortfall 750, not 'still short'", rev.add_for_free_delivery_uah === 750 && !rev.still_short_after_adding && flags.freeDeliveryShortfall === 750);
ctx.inboundCount = 2;
await runOrderTool("update_order_draft", { items: [{ item_id: "i-tart", qty: 1 }], edit_pending: true }, ctx);
rev = JSON.parse(await runOrderTool("review_order", {}, ctx));
check("client added a tart (411) after being told: 339 still missing, flagged as 'still short'", rev.add_for_free_delivery_uah === 339 && rev.still_short_after_adding === true && flags.stillShortAfterAdding === true, JSON.stringify(rev));

// ---- request_human_review carries the question
const { runTool } = await import("../lib/agent/tools.ts");
const f2 = { humanReviewReasons: [], massOrderFlagged: false, confirmationProposed: false, menuLinkSent: false };
await runTool("request_human_review", { reason: "no data", question: "Чи робимо безглютенову випічку?" }, { ...ctx, flags: f2 });
check("the question is kept for the group alert", f2.teamQuestion === "Чи робимо безглютенову випічку?" && f2.humanReviewReasons.length === 1);

// ---- the alert shows the question and offers a takeover button
const { buildDraftAlert } = await import("../lib/adminAlerts.ts");
const alert = buildDraftAlert({ id: "p1", clientId: "11111111-1111-4111-8111-111111111111", clientName: "Кав'ярня", replyType: "order_flow", text: "Уточнюємо!", question: "Чи робимо безглютенову випічку?" });
check("alert has ❓ question and 🙋 takeover button", alert.text.includes("❓ Питання до команди: Чи робимо") && alert.buttons.flat().some((b) => b.callback_data === "tk:11111111-1111-4111-8111-111111111111"));

// ---- unanswered question gets exactly one nudge
const { nudgeUnansweredQuestions } = await import("../lib/teamQuestions.ts");
tables.pending_replies = [
  { id: "q-old", client_id: "11111111-1111-4111-8111-111111111111", status: "awaiting_approval", team_question: "Чи є безглютенові?", reminded_at: null, created_at: new Date(Date.now() - 30 * 60000).toISOString(), admin_message_id: 55 },
  { id: "q-new", client_id: "11111111-1111-4111-8111-111111111111", status: "awaiting_approval", team_question: "Свіже питання", reminded_at: null, created_at: new Date().toISOString() },
  { id: "q-plain", client_id: "11111111-1111-4111-8111-111111111111", status: "awaiting_approval", team_question: null, reminded_at: null, created_at: new Date(Date.now() - 60 * 60000).toISOString() },
];
tg.length = 0;
let n = await nudgeUnansweredQuestions(db);
check("only the old unanswered question is nudged, in the group, as a reply to its alert", n === 1 && tg.length === 1 && tg[0].body.text.includes("Чи є безглютенові?") && tg[0].body.reply_parameters?.message_id === 55, JSON.stringify(tg));
n = await nudgeUnansweredQuestions(db);
check("never nudged twice", n === 0);

// ---- team writes to the client: sent, logged as team, agent paused, learned as a style example
const { sendAsTeam, editMessage, deleteMessage, setAgentPaused, relayToTeam } = await import("../lib/takeover.ts");
tables.messages = [{ id: "m-in", client_id: "11111111-1111-4111-8111-111111111111", direction: "in", text: "Є безглютенові?", created_at: new Date(Date.now() - 60000).toISOString() }];
tg.length = 0;
let r = await sendAsTeam(db, "11111111-1111-4111-8111-111111111111", "  Так, є — по передзамовленню  ", "Оля");
check("sent to the client's chat, trimmed", r.ok && tg[0].method === "sendMessage" && tg[0].body.chat_id === "777" && tg[0].body.text === "Так, є — по передзамовленню", JSON.stringify(tg));
const out = tables.messages.find((m) => m.direction === "out");
check("logged as a team message with its Telegram id", out?.sent_by === "team" && out.telegram_message_id === 901, JSON.stringify(out));
check("agent is now paused for this client", tables.clients[0].agent_paused === true && tables.agent_events.some((e) => e.kind === "takeover"));
check("the human reply is kept as a style example", tables.agent_examples.some((e) => e.client_message === "Є безглютенові?" && e.quality === "written"));

// ---- edit what was already sent
tg.length = 0;
r = await editMessage(db, out.id, "Так, є безглютенові — по передзамовленню за добу");
check("Telegram message is edited in place", r.ok && tg[0].method === "editMessageText" && tg[0].body.message_id === 901 && tg[0].body.chat_id === "777", JSON.stringify(tg));
check("history now holds the corrected text, marked edited, and it's recorded as an 'edited' example", out.text.includes("за добу") && out.edited_at && tables.agent_examples.some((e) => e.quality === "edited" && e.reply.includes("за добу")));
r = await editMessage(db, "m-in", "x");
check("a client's own message can't be edited", !r.ok);
tables.messages.push({ id: "m-old", client_id: "11111111-1111-4111-8111-111111111111", direction: "out", text: "стара", telegram_message_id: null, created_at: new Date().toISOString() });
r = await editMessage(db, "m-old", "нова");
check("a message Telegram never gave us an id for is refused, not faked", !r.ok && tables.messages.find((m) => m.id === "m-old").text === "стара");

// ---- delete
tg.length = 0;
r = await deleteMessage(db, out.id);
check("message removed from the client's chat and marked deleted", r.ok && tg[0].method === "deleteMessage" && tg[0].body.message_id === 901 && out.deleted_at);

// ---- while the team is in charge the agent stays silent and the group gets the message
const { processTelegramUpdate } = await import("../lib/agent/run.ts");
tg.length = 0;
tables.messages = [];
await processTelegramUpdate({ update_id: 1, message: { message_id: 10, text: "А до п'ятниці встигнете?", chat: { id: 777, type: "private" }, from: { id: 777, first_name: "Оля" } } });
const relay = tg.find((c) => c.method === "sendMessage" && String(c.body.chat_id) === "-1001");
check("client's message is relayed to the group, nothing goes to the client", relay?.body.text.includes("А до п'ятниці") && !tg.some((c) => String(c.body.chat_id) === "777" && c.method === "sendMessage"), JSON.stringify(tg));
check("it is stored, and the relay is registered for replies", tables.messages.some((m) => m.direction === "in") && tables.relayed_messages.length === 1);
check("relay has a hand-back button", relay.body.reply_markup.inline_keyboard.flat().some((b) => b.callback_data === "ra:11111111-1111-4111-8111-111111111111"));

// ---- replying to the relayed message in the group answers the client
const relayId = tables.relayed_messages[0].admin_message_id;
tg.length = 0;
await processTelegramUpdate({ update_id: 2, message: { message_id: 60, text: "Так, встигнемо!", chat: { id: -1001, type: "supergroup" }, from: { id: 5, first_name: "Оля" }, reply_to_message: { message_id: relayId, text: "…" } } });
check("the reply reaches the client verbatim", tg.some((c) => c.method === "sendMessage" && c.body.chat_id === "777" && c.body.text === "Так, встигнемо!"), JSON.stringify(tg));

// ---- hand back
tg.length = 0;
await processTelegramUpdate({ update_id: 3, callback_query: { id: "cb", from: { id: 5, first_name: "Оля" }, message: { message_id: relayId, text: "…", chat: { id: -1001, type: "supergroup" } }, data: "ra:11111111-1111-4111-8111-111111111111" } });
check("the 🤖 button hands the conversation back to the agent", tables.clients[0].agent_paused === false && tables.agent_events.some((e) => e.kind === "handback"));

// ---- takeover from the group button
tg.length = 0;
await processTelegramUpdate({ update_id: 4, callback_query: { id: "cb2", from: { id: 5, first_name: "Оля" }, message: { message_id: 70, text: "чернетка", chat: { id: -1001, type: "supergroup" } }, data: "tk:11111111-1111-4111-8111-111111111111" } });
check("🙋 on a draft alert pauses the agent and posts a message to reply to", tables.clients[0].agent_paused === true && tables.relayed_messages.length === 2);

// ---- the whole loop: a bare promise is sent back once, the model then really asks the team
process.env.ANTHROPIC_API_KEY = "test-key";
const scripted = [
  { stop_reason: "end_turn", content: [{ type: "text", text: "Гарне питання, уточню в команди і повернуся до вас" }] },
  { stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "request_human_review", input: { reason: "немає даних", question: "Чи робимо безглютенову випічку?" } }] },
  { stop_reason: "end_turn", content: [{ type: "text", text: "Дякуємо за питання! Уточнюємо це в команди й одразу повернемося до вас." }] },
];
const seen = [];
const priorFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.anthropic.com")) {
    seen.push(JSON.parse(init.body));
    const next = scripted.shift();
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "x", usage: { input_tokens: 1, output_tokens: 1 }, stop_sequence: null, ...next }), { headers: { "Content-Type": "application/json" } });
  }
  return priorFetch(url, init);
};
const { runAgentLoop } = await import("../lib/agent/run.ts");
const f3 = { humanReviewReasons: [], massOrderFlagged: false, confirmationProposed: false, menuLinkSent: false };
const finalText = await runAgentLoop("system", [{ role: "user", content: "Є безглютенові?" }], { ...ctx, flags: f3 });
check("the loop corrected the empty promise: team really asked, with the question", f3.humanReviewReasons.length === 1 && f3.teamQuestion === "Чи робимо безглютенову випічку?", JSON.stringify(f3));
check("the final reply is the one written after asking", finalText?.startsWith("Дякуємо за питання"), String(finalText));
check("the model saw the correction as a user message", JSON.stringify(seen[1]?.messages?.at(-1)).includes("request_human_review"), JSON.stringify(seen[1]?.messages?.at(-1)));
check("it is corrected only once (3 calls total)", seen.length === 3);

const ok = done();
srv.close();
process.exit(ok ? 0 : 1);
