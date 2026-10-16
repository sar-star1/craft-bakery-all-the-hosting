import "./harness/register.mjs";
import { createClient } from "@supabase/supabase-js";
import { start, tables } from "./harness/fake-postgrest.mjs";
import { makeChecker } from "./harness/check.mjs";

const srv = await start(54796);
setTimeout(() => { console.log("TIMEOUT — test hung"); process.exit(2); }, 60000).unref();
const { check, done } = makeChecker();
const db = createClient("http://localhost:54796", "fake", { auth: { persistSession: false } });

// The real incident: 51 active rules, but only the oldest 40 reached the agent, so every rule
// taught after Oct 12 ("half cakes aren't sold", "never offer cakes by the slice") was ignored.
const day = (i) => new Date(Date.UTC(2026, 9, 1) + i * 3600_000).toISOString();
tables.agent_guidelines = Array.from({ length: 120 }, (_, i) => ({ id: `g${i}`, text: `Правило №${i + 1}`, active: true, expires_at: null, created_at: day(i) }));
tables.agent_guidelines.push({ id: "off", text: "Вимкнене", active: false, expires_at: null, created_at: day(200) });
tables.agent_guidelines.push({ id: "old", text: "Прострочене", active: true, expires_at: "2020-01-01", created_at: day(201) });
tables.agent_knowledge = Array.from({ length: 90 }, (_, i) => ({ id: `k${i}`, text: `Факт №${i + 1}`, expires_at: null, created_at: day(i) }));

const { getActiveGuidelines } = await import("../lib/agent/guidelines.ts");
const { getKnowledge } = await import("../lib/agent/memory.ts");
const { buildSystemPrompt } = await import("../lib/agent/prompt.ts");

const rules = await getActiveGuidelines(db);
check("all 120 active rules are returned, not just the first 40", rules.length === 120, String(rules.length));
check("the NEWEST rule is included", rules.includes("Правило №120"));
check("switched-off and expired rules are not", !rules.includes("Вимкнене") && !rules.includes("Прострочене"));
const facts = await getKnowledge(db);
check("all 90 facts are returned, not just 60", facts.length === 90 && facts.includes("Факт №90"), String(facts.length));
const prompt = buildSystemPrompt({ client: { business_name: "К", contact_name: null, pipeline_stage: "in_conversation", standing_order_notes: null, blocker_note: null, lead_temperature: null }, capturedFields: {}, guidelines: rules });
check("the newest rule is in the agent's prompt, after the older ones", prompt.includes("Правило №120") && prompt.indexOf("Правило №1\n") < prompt.indexOf("Правило №120"));

const ok = done();
srv.close();
process.exit(ok ? 0 : 1);
