import "./harness/register.mjs";
import { createClient } from "@supabase/supabase-js";
import { start, stubTelegram, tables } from "./harness/fake-postgrest.mjs";
import { makeChecker } from "./harness/check.mjs";

process.env.SUPABASE_URL = "http://localhost:54798";
process.env.SUPABASE_SERVICE_ROLE_KEY = "fake";
process.env.TELEGRAM_BOT_TOKEN = "000:fake";
process.env.TELEGRAM_ADMIN_GROUP_ID = "-1001";
process.env.SITE_URL = "https://example.com";
process.env.ANTHROPIC_API_KEY = "test-key";
delete process.env.AGENT_MODEL_ROUTING;
stubTelegram();
const srv = await start(54798);
setTimeout(() => { console.log("TIMEOUT — test hung"); process.exit(2); }, 60000).unref();
const { check, done } = makeChecker();
const db = createClient("http://localhost:54798", "fake", { auth: { persistSession: false } });

const FAST = "claude-haiku-5-5";
const STRONG = "claude-sonnet-5-5";

// ---- pure routing helpers
const { hardReasons, trailingClientText, unsourcedAmounts, systemBlocks } = await import("../lib/agent/routing.ts");
check("an ordinary order message is not hard", hardReasons("Добрий день! Хочу замовити 20 круасанів на завтра").length === 0);
check("«є безглютенові?» is hard (allergens)", hardReasons("Є безглютенові еклери?").length > 0);
check("a complaint is hard", hardReasons("У мене скарга: торт був черствий").length > 0);
check("asking for a discount is hard", hardReasons("Чи можлива знижка при замовленні на тиждень?").length > 0);
check("a wedding / big volume is hard", hardReasons("Потрібно 300 шт на весілля").length >= 2);
check("a long message is hard", hardReasons("а".repeat(800)).includes("довге повідомлення"));
check("a burst is read as a whole (the hard word is in the first text)", hardReasons(trailingClientText([
  { role: "assistant", content: "Привіт" }, { role: "user", content: "є скарга" }, { role: "user", content: "ну от" },
])).length > 0);
check("only what came after the agent's last reply counts", hardReasons(trailingClientText([
  { role: "user", content: "є скарга" }, { role: "assistant", content: "Розкажіть" }, { role: "user", content: "ок, дякую" },
])).length === 0);
check("an amount nobody gave is caught", unsourcedAmounts("Наполеон — 999 грн", "ціна 120 грн").join() === "999");
check("amounts from the sources pass (also with thousands spaces)", unsourcedAmounts("Разом 1 250 ₴ і 250 грн", "всього 1250, доставка 250").length === 0);
const longSystem = "а".repeat(5000) + "\nПОТОЧНА СИТУАЦІЯ\nСьогодні: вівторок";
const blocks = systemBlocks(longSystem);
check("a long system prompt is split: stable part cached, current situation not", Array.isArray(blocks) && blocks.length === 2 && blocks[0].cache_control?.type === "ephemeral" && !blocks[1].cache_control && blocks[1].text.startsWith("\nПОТОЧНА СИТУАЦІЯ"));
check("a short system prompt stays a plain string", systemBlocks("system") === "system");

// ---- the loop, with a scripted model that records which model it was asked
const { runAgentLoop } = await import("../lib/agent/run.ts");
let script = [];
const asked = [];
const priorFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).includes("api.anthropic.com")) {
    const body = JSON.parse(init.body);
    asked.push(body);
    const next = script.shift();
    if (next?.fail) return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "boom" } }), { status: 400, headers: { "Content-Type": "application/json" } });
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7 }, stop_sequence: null, ...next }), { headers: { "Content-Type": "application/json" } });
  }
  return priorFetch(url, init);
};
const say = (text) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
const tool = (name, input, id = "t1") => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] });
const CL = "11111111-1111-4111-8111-111111111111";
const run = async (clientText, replies, extra = {}) => {
  script = replies;
  asked.length = 0;
  tables.agent_events = [];
  const flags = { humanReviewReasons: [], massOrderFlagged: false, confirmationProposed: false, menuLinkSent: false };
  const ctx = { supabase: db, client: { id: CL, business_name: "Кав'ярня", pipeline_stage: "in_conversation" }, conversationId: "conv-1", flags, inboundCount: 1, ...extra };
  const text = await runAgentLoop("system", [{ role: "user", content: clientText }], ctx);
  return { text, flags, models: asked.map((b) => b.model) };
};

let r = await run("Добрий день! Хочу замовити круасани", [say("Вітаємо! Що саме плануєте замовити?")]);
check("an ordinary message is answered by the cheap model, in one call", r.models.join() === FAST && r.text?.startsWith("Вітаємо"), r.models.join());
check("…recorded as a cheap-only turn", r.flags.route.start === "fast" && !r.flags.route.escalatedBecause);
const ev = tables.agent_events.find((e) => e.kind === "model_route");
check("…and logged for the Settings page (calls and tokens, cached reads counted)", ev?.detail.calls.fast === 1 && ev.detail.calls.strong === 0 && ev.detail.tokens.fast.in === 10 && ev.detail.tokens.fast.cached === 7, JSON.stringify(ev));

r = await run("У мене скарга: учорашній торт був черствий", [say("Нам дуже шкода, що так сталося.")]);
check("a hard message goes straight to the strong model", r.models.join() === STRONG && r.flags.route.start === "strong" && r.flags.route.hard.length > 0, r.models.join());

r = await run("Добрий день", [say("Привіт!")], { dryRun: true });
check("practice chat (dry run) writes no log", tables.agent_events.length === 0 && r.models[0] === FAST);

// the cheap model's reply breaks a rule → the fix is done by the strong model, nothing is repeated
r = await run("Скажіть, ви працюєте у неділю?", [
  say("Гарне питання, уточню в команди і повернуся до вас"),
  tool("request_human_review", { reason: "немає даних", question: "Чи працюємо в неділю?" }),
  say("Дякуємо! Уточнюємо це в команди й одразу повернемося до вас."),
]);
check("cheap model broke a rule → the correction and everything after run on the strong model", r.models.join() === [FAST, STRONG, STRONG].join(), r.models.join());
check("…the team was asked exactly once", r.flags.humanReviewReasons.length === 1);
check("…and the reason is recorded", r.flags.route.escalatedBecause === "відповідь порушила правило", String(r.flags.route.escalatedBecause));

// an invented price is caught
r = await run("Скільки коштує наполеон?", [say("Наполеон — 999 грн за штуку."), say("Уточню ціну в меню й напишу вам.")]);
check("an amount the cheap model made up → strong model rewrites it", r.models.join() === [FAST, STRONG].join() && /Уточню/.test(r.text ?? ""), r.models.join());
check("…with a reason naming the amount check", /суми/.test(r.flags.route.escalatedBecause ?? ""), String(r.flags.route.escalatedBecause));
check("the correction message names the invented amount", JSON.stringify(asked[1].messages.at(-1)).includes("999"));
r = await run("Мій бюджет до 500 грн, що порадите?", [say("За 500 грн підберемо щось смачне — що любите?")]);
check("an amount the client gave is fine (no escalation)", r.models.join() === FAST);

// the cheap model fails or struggles
r = await run("Привіт", [{ fail: true }, say("Вітаємо!")]);
check("cheap model errors → the strong model answers instead", r.models.join() === [FAST, STRONG].join() && r.text === "Вітаємо!", r.models.join());
r = await run("Привіт", [say(""), say("Вітаємо!")]);
check("cheap model returns nothing → the strong model answers", r.models.join() === [FAST, STRONG].join() && r.text === "Вітаємо!", r.models.join());
r = await run("Привіт", [
  ...[1, 2, 3, 4, 5].map((n) => tool("request_human_review", { reason: "r" + n }, "t" + n)),
  say("Вітаємо!"),
]);
check("five tool rounds on the cheap model → the sixth call is the strong one", r.models.join() === [FAST, FAST, FAST, FAST, FAST, STRONG].join(), r.models.join());

// the switch can be turned off
process.env.AGENT_MODEL_ROUTING = "off";
r = await run("Добрий день", [say("Вітаємо!")]);
check("AGENT_MODEL_ROUTING=off → everything on the strong model, as before", r.models.join() === STRONG, r.models.join());
delete process.env.AGENT_MODEL_ROUTING;

// the cached system prompt reaches the API as blocks
script = [say("Вітаємо!")];
asked.length = 0;
await runAgentLoop(longSystem, [{ role: "user", content: "Привіт" }], { supabase: db, client: { id: CL, business_name: "К", pipeline_stage: "in_conversation" }, conversationId: "c", flags: { humanReviewReasons: [], massOrderFlagged: false, confirmationProposed: false, menuLinkSent: false }, inboundCount: 1, dryRun: true });
check("the API gets the system prompt as two blocks, the first marked for caching", Array.isArray(asked[0].system) && asked[0].system[0].cache_control?.type === "ephemeral" && asked[0].system.length === 2);

// ---- the small jobs use the cheap model too
const { classifySummaryReply } = await import("../lib/orderApproval.ts");
script = [say("MORE")];
asked.length = 0;
const v = await classifySummaryReply("а можна на годину пізніше і ще один торт додати на наступний четвер, будь ласка", "Круасан ×10 = 500 ₴");
check("the approval classifier runs on the cheap model", asked[0]?.model === FAST, String(asked[0]?.model));

const ok = done();
srv.close();
process.exit(ok ? 0 : 1);
