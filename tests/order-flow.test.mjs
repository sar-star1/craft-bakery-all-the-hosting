import "./harness/register.mjs";
import { createClient } from "@supabase/supabase-js";
import { start, tables } from "./harness/fake-postgrest.mjs";
import { makeChecker } from "./harness/check.mjs";

const srv = await start(54777);
const { check, done } = makeChecker();
const C = { croissant: "c1", eclair: "c2", cake: "c3" };
tables.menu_categories = [
  { id: C.croissant, name_uk: "Круасани", min_order: 5, sort_order: 1 },
  { id: C.eclair, name_uk: "Еклери", min_order: 6, sort_order: 2 },
  { id: C.cake, name_uk: "Торти", min_order: 1, sort_order: 3 },
];
tables.menu_items = [
  { id: "i-croissant", category_id: C.croissant, name_uk: "Шоколадний круасан", price: 125, is_active: true, sort_order: 1 },
  { id: "i-eclair", category_id: C.eclair, name_uk: "Еклер ванільний", price: 79, is_active: true, sort_order: 1 },
  { id: "i-cake", category_id: C.cake, name_uk: "Наполеон", price: 1250, is_active: true, sort_order: 1 },
  { id: "i-hidden", category_id: C.cake, name_uk: "Знятий з меню", price: 500, is_active: false, sort_order: 2 },
  { id: "i-solo", category_id: C.eclair, name_uk: "Трубочки", price: 60, min_order_override: 10, is_active: true, sort_order: 2 },
];
tables.clients = [{ id: "cl-1", business_name: "Serhii R", pipeline_stage: "in_conversation", status: "engaged" }];
tables.conversations = [{ id: "conv-1", client_id: "cl-1", captured_fields: { note: "keep me" } }];
tables.orders = [];
tables.site_content = [{ key: "ordering_rules", content_json: { min_order_total: 1000, free_delivery_from: 2000, delivery_fee: 250, auto_confirm_minutes: 30 } }];

const db = createClient("http://localhost:54777", "fake-key", { auth: { persistSession: false } });
const { runOrderTool } = await import("../lib/agent/orderTools.ts");
const flags = { humanReviewReasons: [], massOrderFlagged: false, confirmationProposed: false, menuLinkSent: false };
const ctx = { supabase: db, client: { id: "cl-1", business_name: "Serhii R", pipeline_stage: "in_conversation" }, conversationId: "conv-1", flags, inboundCount: 1 };
const run = (n, a = {}, c = ctx) => runOrderTool(n, a, c);

let r = await run("get_menu");
check("get_menu lists active items only", r.includes("i-cake") && !r.includes("i-hidden"));
r = await run("update_order_draft", { items: [{ item_id: "i-hidden", qty: 3 }] });
check("inactive item rejected", r.startsWith("Not saved"), r);
r = await run("update_order_draft", { items: [{ item_id: "made-up", qty: 3 }] });
check("unknown id rejected", r.startsWith("Not saved"), r);

await run("update_order_draft", { items: [{ item_id: "i-croissant", qty: 5 }] });
r = await run("review_order");
check("below the minimum total is reported as a problem", r.includes("problems") && /1\s000/.test(r), r);
await run("update_order_draft", { items: [{ item_id: "i-croissant", qty: 3 }, { item_id: "i-eclair", qty: 6 }] });
r = await run("review_order");
check("category minimum (croissants 5) reported", r.includes("Круасани") && r.includes("мінімум 5"), r);
await run("update_order_draft", { items: [{ item_id: "i-croissant", qty: 8 }, { item_id: "i-eclair", qty: 6 }, { item_id: "i-solo", qty: 4 }] });
r = await run("review_order");
check("an item's own minimum (10) is reported", r.includes("Трубочки") && r.includes("мінімум 10"), r);
await run("update_order_draft", { items: [{ item_id: "i-solo", qty: 0 }, { item_id: "i-cake", qty: 1 }] });

r = await run("review_order");
const rev = JSON.parse(r);
check("priced from the live menu: 8×125 + 6×79 + 1×1250 = 2724, delivery free", rev.goods_total_uah === 2724 && rev.delivery_fee_uah === 0 && rev.grand_total_uah === 2724, r);
check("venue, ФОП, address and payment are required; phone is not", ["venue name (назва кав'ярні)", "ФОП", "delivery address", "payment method (cash / cashless)"].every((m) => rev.missing.includes(m)) && !rev.missing.some((m) => /phone/.test(m)), r);
r = await run("place_order", { client_confirmed: true });
check("cannot place with details missing, and told not to claim it", r.startsWith("Not placed: still missing") && /Do NOT tell/.test(r), r);

await run("update_order_draft", { venue_name: "Кав'ярня Тест", fop: "ФОП Іваненко І. І.", address: "Київ, вул. Тестова 1", payment_method: "cashless", phone: "+380501234567", requested_date: "2099-01-05", notes: "до 10:00" });
r = await run("place_order", { client_confirmed: true });
check("cannot place before the summary was shown", r.includes("first show the client"), r);
await run("review_order");
r = await run("place_order", { client_confirmed: true });
check("cannot place in the SAME turn the summary was shown", r.includes("LATER message"), r);
r = await run("place_order", { client_confirmed: false }, { ...ctx, inboundCount: 2 });
check("cannot place without approval", r.startsWith("Not placed: the client has not approved"), r);

ctx.inboundCount = 3;
r = await run("place_order", { client_confirmed: true });
const order = tables.orders[0];
check("places after the summary and a later approval", r.startsWith("Order placed"), r);
check("order row is correct", order?.client_id === "cl-1" && order.source === "telegram" && order.total_amount === 2724 && order.status === "new" && order.due_date === "2099-01-05" && order.customer_name === "Кав'ярня Тест" && order.item_details_uk.approval === "text", JSON.stringify(order));
check("order details carry ФОП, payment, venue, delivery", order?.item_details_uk?.fop === "ФОП Іваненко І. І." && order.item_details_uk.payment_method === "cashless" && order.item_details_uk.delivery_fee === 0 && order.item_details_uk.goods_total === 2724);
check("details are remembered on the client", tables.clients[0].fop === "ФОП Іваненко І. І." && tables.clients[0].delivery_address === "Київ, вул. Тестова 1" && tables.clients[0].payment_method === "cashless" && tables.clients[0].business_name === "Кав'ярня Тест");
check("client moved to first_order and marked active", tables.clients[0].pipeline_stage === "first_order" && tables.clients[0].status === "active");
check("draft cleared, other captured fields kept", !tables.conversations[0].captured_fields.draft_order && tables.conversations[0].captured_fields.note === "keep me");

// duplicate guard: same cart approved twice in a row
await run("update_order_draft", { repeat_last_order: true, use_saved_profile: true });
await run("review_order");
ctx.inboundCount = 4;
r = await run("place_order", { client_confirmed: true });
check("an identical order within 15 minutes is not duplicated", /already in the system/.test(r) && tables.orders.length === 1, r);

// ---- a returning client: saved details, same-as-last-time, delivery fee
tables.orders.length = 0;
tables.orders.push({ id: "prev", client_id: "cl-1", created_at: new Date(Date.now() - 86400000 * 3).toISOString(), item_details_uk: { items: [{ item_id: "i-cake", name: "Наполеон", qty: 1 }, { name: "Еклер ванільний", qty: 6 }] } });
const rctx = { ...ctx, inboundCount: 1 };
r = await run("update_order_draft", { use_saved_profile: true, repeat_last_order: true }, rctx);
const saved = JSON.parse(r);
check("use_saved_profile fills venue/ФОП/address/payment automatically", saved.missing.length === 0 && saved.details.fop === "ФОП Іваненко І. І." && saved.details.payment_method === "Безготівка", r);
r = await run("review_order", {}, rctx);
const rv = JSON.parse(r);
check("repeat_last_order rebuilt the cart (cake by id, eclairs matched by name)", rv.lines.length === 2 && rv.goods_total_uah === 1250 + 6 * 79, r);
check("1724 UAH < 2000 → delivery 250 and 276 more for free delivery", rv.delivery_fee_uah === 250 && rv.grand_total_uah === 1974 && rv.add_for_free_delivery_uah === 276, r);

// ---- practice mode never writes
const pctx = { ...ctx, dryRun: true, conversationId: "fake", inboundCount: 1, practiceState: { profile: { venue_name: "P", fop: "ФОП P", delivery_address: "x", payment_method: "cash" } } };
await run("update_order_draft", { items: [{ item_id: "i-cake", qty: 2 }], use_saved_profile: true }, pctx);
await run("review_order", {}, pctx);
pctx.inboundCount = 2;
const before = tables.orders.length;
r = await run("place_order", { client_confirmed: true }, pctx);
check("practice mode: 'places' without writing anything", r.startsWith("Practice mode") && tables.orders.length === before && !pctx.practiceState.draft_order, r);

const ok = done();
srv.close();
process.exit(ok ? 0 : 1);
