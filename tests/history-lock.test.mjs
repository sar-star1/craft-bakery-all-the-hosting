import "./harness/register.mjs";
import { createClient } from "@supabase/supabase-js";
import { start, tables } from "./harness/fake-postgrest.mjs";
import { makeChecker } from "./harness/check.mjs";

const srv = await start(54781);
const { check, done } = makeChecker();
const { buildHistory } = await import("../lib/agent/history.ts");
const { withClientLock } = await import("../lib/agent/lock.ts");

const t = (s) => `2026-10-13T13:25:${s}.000Z`;
const row = (direction, text, s, id = null) => ({ direction, text, created_at: t(s), telegram_message_id: id });

// The real incident: two messages 5s apart; the reply to the FIRST was saved after the SECOND.
const rows = [
  row("in", "Давайте на завтра", "00", 1),
  row("out", "Підсумок: ...", "05"),
  row("in", "Так , давайте", "16", 2),
  row("in", "Що порекомендуєте ?", "21", 3),
  row("out", "Що додаємо до замовлення?", "22"), // the answer to message 2, stored after message 3
];
const roles = (m) => m.map((x) => x.role).join(",");

let h = buildHistory(rows, { telegramMessageId: 3, text: "Що порекомендуєте ?" });
check("the message being answered is last (the API requires it)", h.at(-1).role === "user" && h.at(-1).content === "Що порекомендуєте ?", roles(h));
check("the earlier reply is in its right place: …, 'Так, давайте', reply, question", h.map((x) => x.content).join("|") === "Давайте на завтра|Підсумок: ...|Так , давайте|Що додаємо до замовлення?|Що порекомендуєте ?", h.map((x) => x.content).join("|"));

h = buildHistory(rows, { telegramMessageId: 2, text: "Так , давайте" });
check("answering the earlier message ignores the newer client message (it gets its own turn)", h.at(-1).content === "Так , давайте" && !h.some((x) => x.content === "Що порекомендуєте ?"), h.map((x) => x.content).join("|"));

h = buildHistory([row("out", "Привіт!", "00"), row("in", "Добрий день", "05", 9)], { telegramMessageId: 9, text: "Добрий день" });
check("history never starts with an assistant message", h[0].role === "user" && h.length === 1, roles(h));
h = buildHistory([], { telegramMessageId: 1, text: "Привіт" });
check("works for a brand-new conversation", h.length === 1 && h[0].role === "user");
h = buildHistory([row("in", "a", "00", 1), row("in", "b", "01", 2)], { telegramMessageId: 2, text: "b" });
check("two unanswered messages in a row are fine", roles(h) === "user,user");

// ---- one run per client at a time
tables.clients = [{ id: "cl-1", agent_lock_until: null }, { id: "cl-2", agent_lock_until: null }];
const db = createClient("http://localhost:54781", "fake", { auth: { persistSession: false } });
const log = [];
const job = (name, ms) => () => withClientLock(db, "cl-1", async () => { log.push(`${name}:start`); await new Promise((r) => setTimeout(r, ms)); log.push(`${name}:end`); });
await Promise.all([job("A", 400)(), (async () => { await new Promise((r) => setTimeout(r, 50)); await job("B", 50)(); })()]);
check("a second run for the same client waits for the first to finish", log.join(",") === "A:start,A:end,B:start,B:end", log.join(","));
check("the lock is released afterwards", tables.clients[0].agent_lock_until === null, JSON.stringify(tables.clients[0]));

const log2 = [];
await Promise.all([
  withClientLock(db, "cl-1", async () => { log2.push("1:start"); await new Promise((r) => setTimeout(r, 300)); log2.push("1:end"); }),
  withClientLock(db, "cl-2", async () => { log2.push("2:start"); await new Promise((r) => setTimeout(r, 50)); log2.push("2:end"); }),
]);
check("different clients don't wait for each other", log2.indexOf("2:end") < log2.indexOf("1:end"), log2.join(","));

tables.clients[1].agent_lock_until = new Date(Date.now() - 1000).toISOString(); // a crashed run's expired lock
let ran = false;
await withClientLock(db, "cl-2", async () => { ran = true; });
check("an expired lock left by a crashed run doesn't block anyone", ran === true);

let threw = false;
try { await withClientLock(db, "cl-1", async () => { throw new Error("boom"); }); } catch { threw = true; }
check("the lock is released even when the run fails", threw && tables.clients[0].agent_lock_until === null, JSON.stringify(tables.clients[0]));

const ok = done();
srv.close();
process.exit(ok ? 0 : 1);
