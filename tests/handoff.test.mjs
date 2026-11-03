import "./harness/register.mjs";
import { start, stubTelegram, tables } from "./harness/fake-postgrest.mjs";
import { makeChecker } from "./harness/check.mjs";

process.env.SUPABASE_URL = "http://localhost:54799";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
process.env.TELEGRAM_BOT_TOKEN = "000:fake";
process.env.TELEGRAM_ADMIN_GROUP_ID = "-1001";
process.env.SITE_URL = "https://example.com";
delete process.env.ANTHROPIC_API_KEY;
const tg = stubTelegram();
const srv = await start(54799);
setTimeout(() => { console.log("TIMEOUT — test hung"); process.exit(2); }, 60000).unref();
const { check, done } = makeChecker();

const CL = "33333333-3333-4333-8333-333333333333";
const token = CL.replace(/-/g, "");
const reset = (chat = null) => {
  tables.clients = [{ id: CL, business_name: "Кав'ярня Ліра", telegram_chat_id: chat, pipeline_stage: "recurring", status: "active", agent_paused: false }];
  tables.conversations = [];
  tables.messages = [];
  tables.orders = [];
  tables.agent_events = [];
  tables.pending_replies = [];
  tables.relayed_messages = [];
  tables.site_content = [{ key: "ordering_rules", content_json: { min_order_total: 1000, free_delivery_from: 2000, delivery_fee: 250 } }];
  tables.menu_categories = [{ id: "c1", name_uk: "Торти", min_order: 1 }];
  tables.menu_items = [{ id: "11111111-1111-4111-8111-111111111111", category_id: "c1", name_uk: "Наполеон", price: 1250, is_active: true }];
  tg.length = 0;
};
const toChat = (chat) => tg.filter((c) => c.method === "sendMessage" && String(c.body.chat_id) === chat).map((c) => c.body.text);
const order = (ref) => ({
  ref, customer_name: "Кав'ярня Ліра", fop: "ФОП Лис Т. М.", payment_method: "cashless", phone: "+380501110000", address: "вул. Садова 5",
  lines: [{ item_id: "11111111-1111-4111-8111-111111111111", qty: 1 }],
});

// ---- the links
const { getBotLink } = await import("../lib/telegram.ts");
process.env.TELEGRAM_BOT_USERNAME = "@PeremogaBot";
check("a known client not yet in the bot gets their personal link", getBotLink(CL, false) === `https://t.me/PeremogaBot?start=m_${token}`, String(getBotLink(CL, false)));
check("a client already in the bot just opens the chat", getBotLink(CL, true) === "https://t.me/PeremogaBot");
check("a visitor nobody knows starts a new lead", getBotLink(null, false) === "https://t.me/PeremogaBot?start=web");
delete process.env.TELEGRAM_BOT_USERNAME;
check("no bot username set → no link (the buttons stay hidden)", getBotLink(CL, false) === null);

const { submitWebsiteOrder } = await import("../lib/../app/order-actions.ts");
const { processTelegramUpdate } = await import("../lib/agent/run.ts");

// ---- a client already in the bot orders on the site: confirmed in Telegram at once
reset("777");
let res = await submitWebsiteOrder(order(token));
check("the website order is accepted", res.ok === true, JSON.stringify(res));
const sent = toChat("777");
check("the client already in the bot gets the order confirmed in Telegram", sent.length === 1 && /Отримали ваше замовлення з сайту/.test(sent[0]) && /Наполеон ×1/.test(sent[0]) && /1500 ₴/.test(sent[0]), JSON.stringify(sent));
check("…it is stored in their chat history, so the agent knows it was said", tables.messages.some((m) => m.direction === "out" && /Отримали ваше замовлення/.test(m.text)));
check("…and marked, so it is never sent twice", Boolean(tables.orders[0].item_details_uk.telegram_confirmed_at));

// ---- a client not in the bot orders, then taps the button on the thank-you screen
reset(null);
res = await submitWebsiteOrder(order(token));
check("not in the bot yet → nothing is sent after the order", res.ok === true && tg.filter((c) => c.method === "sendMessage" && String(c.body.chat_id) !== "-1001").length === 0);
tg.length = 0;
const startUpdate = (id) => ({ update_id: id, message: { message_id: id, text: `/start m_${token}`, chat: { id: 555, type: "private" }, from: { id: 555, first_name: "Тетяна" } } });
await processTelegramUpdate(startUpdate(1));
const after = toChat("555");
check("the first tap links the chat to the client record", tables.clients[0].telegram_chat_id === "555");
check("…they get the greeting AND the confirmation of the order they just placed", after.length === 2 && /Отримали ваше замовлення з сайту/.test(after[1]), JSON.stringify(after));
tg.length = 0;
await processTelegramUpdate(startUpdate(2));
check("tapping again does not repeat the confirmation", toChat("555").length === 1 && !toChat("555").some((t) => /Отримали ваше замовлення/.test(t)), JSON.stringify(toChat("555")));

// ---- an old site order is not announced out of the blue
reset(null);
await submitWebsiteOrder(order(token));
tables.orders[0].created_at = new Date(Date.now() - 5 * 86_400_000).toISOString();
tg.length = 0;
await processTelegramUpdate(startUpdate(3));
check("an order from five days ago is not confirmed on a later /start", toChat("555").length === 1 && !toChat("555").some((t) => /Отримали ваше замовлення/.test(t)));

// ---- an order from a visitor without a personal link
reset("777");
res = await submitWebsiteOrder(order(undefined));
check("an order without a personal link sends nothing to any client", res.ok === true && toChat("777").length === 0);

const ok = done();
srv.close();
process.exit(ok ? 0 : 1);
