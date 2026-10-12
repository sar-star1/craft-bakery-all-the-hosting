import "./harness/register.mjs";
import { createClient } from "@supabase/supabase-js";
import { start, stubTelegram, tables } from "./harness/fake-postgrest.mjs";
import { makeChecker } from "./harness/check.mjs";

process.env.SUPABASE_URL = "http://localhost:54779";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
process.env.TELEGRAM_BOT_TOKEN = "000:fake";
process.env.TELEGRAM_ADMIN_GROUP_ID = "-1001";
process.env.SITE_URL = "https://example.com";
const tg = stubTelegram();
const srv = await start(54779);
const { check, done } = makeChecker();

const minutesAgo = (m) => new Date(Date.now() - m * 60000).toISOString();
tables.menu_categories = [{ id: "c1", name_uk: "Торти", min_order: 1 }, { id: "c2", name_uk: "Еклери", min_order: 1 }];
tables.menu_items = [
  { id: "i-cake", category_id: "c1", name_uk: "Наполеон", price: 1250, is_active: true },
  { id: "i-eclair", category_id: "c2", name_uk: "Еклер", price: 79, is_active: true },
];
tables.site_content = [{ key: "ordering_rules", content_json: { min_order_total: 1000, free_delivery_from: 2000, delivery_fee: 250, auto_confirm_minutes: 30 } }];
tables.clients = [
  { id: "cl-1", business_name: "Фенікс", telegram_chat_id: "111", pipeline_stage: "in_conversation" },
  { id: "cl-2", business_name: "Кава Два", telegram_chat_id: "222", pipeline_stage: "in_conversation" },
  { id: "cl-3", business_name: "Кава Три", telegram_chat_id: "333", pipeline_stage: "in_conversation" },
];
const draft = (extra = {}) => ({
  lines: [{ item_id: "i-cake", name: "Наполеон", qty: 1 }, { item_id: "i-eclair", name: "Еклер", qty: 10 }],
  venue_name: "Фенікс", fop: "ФОП Корж", address: "вул. Тестова 1", payment_method: "cash",
  updated_at: minutesAgo(5), summary_at_inbound: 3, ...extra,
});
tables.conversations = [
  { id: "conv-1", client_id: "cl-1", last_message_at: minutesAgo(1), captured_fields: { draft_order: draft({ summary_message_id: 555, summary_sent_at: minutesAgo(2) }) } },
  { id: "conv-2", client_id: "cl-2", last_message_at: minutesAgo(40), captured_fields: { draft_order: draft({ summary_message_id: 556, summary_sent_at: minutesAgo(40) }) } },
  { id: "conv-3", client_id: "cl-3", last_message_at: minutesAgo(40), captured_fields: { draft_order: draft({ summary_message_id: 557, summary_sent_at: minutesAgo(40) }) } },
];
tables.messages = [{ id: "m-3", client_id: "cl-3", direction: "in", text: "а ще є щось?", created_at: minutesAgo(20) }]; // cl-3 wrote AFTER the summary
tables.orders = [];

const db = createClient("http://localhost:54779", "fake", { auth: { persistSession: false } });
const co = await import("../lib/chatOrders.ts");

// ---- approval by reaction
let r = await co.handleReactionApproval(db, { chatId: "111", messageId: 999, emojis: ["👍"] });
check("a reaction on some OTHER message approves nothing", r === false && tables.orders.length === 0);
r = await co.handleReactionApproval(db, { chatId: "111", messageId: 555, emojis: ["👎"] });
check("a negative reaction on the summary approves nothing", r === false && tables.orders.length === 0);
tg.length = 0;
r = await co.handleReactionApproval(db, { chatId: "111", messageId: 555, emojis: ["👍"] });
const o1 = tables.orders[0];
check("👍 on the summary puts the order into the system", r === true && o1?.client_id === "cl-1" && o1.status === "new" && o1.source === "telegram" && o1.total_amount === 2040, JSON.stringify(o1));
check("order records how it was approved, with ФОП and delivery", o1?.item_details_uk?.approval === "reaction" && o1.item_details_uk.fop === "ФОП Корж" && o1.item_details_uk.delivery_fee === 0, JSON.stringify(o1?.item_details_uk));
check("client is acknowledged in chat; staff alert says it was a reaction", tg.some((c) => c.method === "sendMessage" && c.body.chat_id === "111" && /Прийнято/.test(c.body.text)) && tg.some((c) => c.body.chat_id === "-1001" && /реакцію на підсумок/.test(c.body.text) && /ФОП: ФОП Корж/.test(c.body.text)), JSON.stringify(tg.map((c) => c.body.text?.slice(0, 60))));
check("client moved to first_order and the draft is gone", tables.clients[0].pipeline_stage === "first_order" && !tables.conversations[0].captured_fields.draft_order, JSON.stringify(tables.clients[0]));
r = await co.handleReactionApproval(db, { chatId: "111", messageId: 555, emojis: ["👍"] });
check("the same reaction again places nothing (draft already consumed)", r === false && tables.orders.length === 1);

// ---- approval by silence
tg.length = 0;
let n = await co.sweepPendingOrders(db, { excludeClientId: "cl-2" });
check("sweep skips the client who is writing right now", tables.orders.every((o) => o.client_id !== "cl-2"));
check("sweep skips a summary the client has answered since", tables.orders.every((o) => o.client_id !== "cl-3"), JSON.stringify(tables.orders.map((o) => o.client_id)));
n = await co.sweepPendingOrders(db);
const o2 = tables.orders.find((o) => o.client_id === "cl-2");
check("a summary left unanswered 30+ minutes is placed (implicit approval)", n === 1 && o2?.item_details_uk?.approval === "implicit", `n=${n} ${JSON.stringify(o2)}`);
check("…and the client is told in plain words", tg.some((c) => c.body.chat_id === "222" && /Оформили ваше замовлення/.test(c.body.text)), "");
tables.conversations[0].captured_fields.draft_order = draft({ summary_message_id: 600, summary_sent_at: minutesAgo(10) });
n = await co.sweepPendingOrders(db);
check("a summary only 10 minutes old is left alone", n === 0 && tables.orders.length === 2, `n=${n}`);

// ---- stale draft + tool guards
const { runOrderTool } = await import("../lib/agent/orderTools.ts");
const flags = { humanReviewReasons: [], massOrderFlagged: false, confirmationProposed: false, menuLinkSent: false };
const mk = (convId, clientId, inbound) => ({ supabase: db, client: { id: clientId, business_name: "X", pipeline_stage: "first_order" }, conversationId: convId, flags, inboundCount: inbound });

tables.conversations.push({ id: "conv-old", client_id: "cl-1", last_message_at: minutesAgo(5000), captured_fields: { draft_order: draft({ updated_at: new Date(Date.now() - 13 * 3600 * 1000).toISOString(), summary_at_inbound: undefined }) } });
r = await runOrderTool("review_order", {}, mk("conv-old", "cl-1", 9));
check("a 13-hour-old draft is treated as empty (no zombie orders)", JSON.parse(r).empty === true && !tables.conversations.at(-1).captured_fields.draft_order, r);

tables.conversations.push({ id: "conv-g", client_id: "cl-1", last_message_at: minutesAgo(1), captured_fields: { draft_order: draft({ summary_message_id: 700, summary_sent_at: minutesAgo(1) }) } });
r = await runOrderTool("update_order_draft", { items: [{ item_id: "i-eclair", qty: 5 }] }, mk("conv-g", "cl-1", 5));
check("adding items to a summary waiting for approval is refused until the agent decides", r.startsWith("Not changed") && /edit_pending/.test(r) && /continued/.test(r), r);
r = await runOrderTool("update_order_draft", { items: [{ item_id: "i-eclair", qty: 12 }], edit_pending: true }, mk("conv-g", "cl-1", 5));
const cur = tables.conversations.at(-1).captured_fields.draft_order;
check("edit_pending changes it and resets the summary (shown and approved again)", r.includes("saved") && cur.summary_at_inbound === undefined && cur.summary_message_id === undefined, r);

await runOrderTool("review_order", {}, mk("conv-g", "cl-1", 5));
r = await runOrderTool("place_order", { client_confirmed: true, approval: "text" }, mk("conv-g", "cl-1", 5));
check("cannot place in the same turn the summary was shown; reply says NOT to claim acceptance", r.startsWith("Not placed") && /Do NOT tell the client/.test(r), r);
const before = tables.orders.length;
r = await runOrderTool("place_order", { client_confirmed: true, approval: "continued" }, mk("conv-g", "cl-1", 6));
check("approval 'continued' (client moved on) places it with that label", r.startsWith("Order placed") && tables.orders.length === before + 1 && tables.orders.at(-1).item_details_uk.approval === "continued" && /NEW order/.test(r), r);

// ---- amend the last order
const orderCount = tables.orders.length;
const lastBefore = tables.orders.at(-1);
const g2 = mk("conv-g", "cl-1", 8);
r = await runOrderTool("amend_last_order", { items: [{ item_id: "i-eclair", qty: 3 }] }, g2);
const amended = tables.orders.at(-1);
const eclairs = amended.item_details_uk.items.find((l) => l.name === "Еклер")?.qty;
check("amend_last_order adds to the previous order, not a new one", tables.orders.length === orderCount && eclairs === 15 && amended.id === lastBefore.id, `${eclairs} ${tables.orders.length}/${orderCount}`);
check("amended order is repriced (1250 + 15×79 = 2435, free delivery)", amended.total_amount === 2435 && amended.item_details_uk.delivery_fee === 0 && JSON.parse(r).grand_total_uah === 2435, JSON.stringify([amended.total_amount, r.slice(0, 80)]));
check("staff are told it was changed", tg.some((c) => /ЗАМОВЛЕННЯ ЗМІНЕНО/.test(c.body.text ?? "")), "");
r = await runOrderTool("amend_last_order", { items: [{ item_id: "i-cake", qty: 1, mode: "set" }, { item_id: "i-eclair", qty: 0, mode: "set" }] }, g2);
check("'set' replaces quantities (cake only = 1250 + 250 delivery)", tables.orders.at(-1).total_amount === 1500, JSON.stringify(tables.orders.at(-1).total_amount));
tables.orders.at(-1).status = "confirmed";
r = await runOrderTool("amend_last_order", { items: [{ item_id: "i-eclair", qty: 1 }] }, g2);
check("an order the team already confirmed cannot be changed by the agent", r.startsWith("Not changed") && /request_human_review/.test(r), r);

const ok = done();
srv.close();
process.exit(ok ? 0 : 1);
