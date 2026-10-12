import "./harness/register.mjs";
import { start, tables } from "./harness/fake-postgrest.mjs";
import { makeChecker } from "./harness/check.mjs";

process.env.SUPABASE_URL = "http://localhost:54780";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
process.env.TELEGRAM_BOT_TOKEN = "000:fake";
process.env.TELEGRAM_ADMIN_GROUP_ID = "-1001";

// Telegram stub that can be told to reject a topic (as if it had been deleted).
const calls = [];
let deadTopic = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("https://api.telegram.org/")) {
    const body = JSON.parse(init.body);
    calls.push({ method: String(url).split("/").pop(), body });
    if (deadTopic && body.message_thread_id === deadTopic) {
      return new Response(JSON.stringify({ ok: false, description: "Bad Request: message thread not found" }), { headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1000 + calls.length } }), { headers: { "Content-Type": "application/json" } });
  }
  return realFetch(url, init);
};
const srv = await start(54780);
const { check, done } = makeChecker();
const tgm = await import("../lib/telegram.ts");
const setRouting = (value) => {
  tables.site_content = [{ key: "telegram_routing", content_json: value }];
  tgm.clearRoutingCache();
};
const last = () => calls.at(-1);

setRouting({});
await tgm.notifyAdmin("plain");
check("with no routing everything goes to the group, no topic", last().body.chat_id === "-1001" && last().body.message_thread_id === undefined, JSON.stringify(last().body));

setRouting({ orders_thread_id: 11, messages_thread_id: 22 });
await tgm.notifyAdmin("order", { kind: "order" });
check("an order alert goes to the 📦 topic", last().body.chat_id === "-1001" && last().body.message_thread_id === 11);
await tgm.notifyAdmin("draft alert");
check("everything else goes to the 💬 topic", last().body.message_thread_id === 22);
await tgm.notifyAdmin("reply to a command", { threadId: 33, replyTo: 5 });
check("a reply stays in the topic the admin wrote in", last().body.message_thread_id === 33 && last().body.reply_parameters.message_id === 5);

deadTopic = 11;
calls.length = 0;
const res = await tgm.notifyAdmin("order while topic is gone", { kind: "order" });
check("a deleted topic does not lose the alert: it falls back to the group", res.ok === true && calls.length === 2 && calls[1].body.message_thread_id === undefined && calls[1].body.chat_id === "-1001", JSON.stringify(calls.map((c) => c.body.message_thread_id)));
deadTopic = null;

setRouting({ orders_chat_id: "-2002" });
await tgm.notifyAdmin("order", { kind: "order" });
check("with a separate orders chat, orders go there (no topic)", last().body.chat_id === "-2002" && last().body.message_thread_id === undefined);
await tgm.notifyAdmin("draft");
check("…and everything else stays in the main group", last().body.chat_id === "-1001");
check("the separate orders chat counts as a staff chat (buttons work there)", (await tgm.isStaffChat(-2002)) === true && (await tgm.isStaffChat(-1001)) === true && (await tgm.isStaffChat(-9)) === false);

const ok = done();
srv.close();
process.exit(ok ? 0 : 1);
