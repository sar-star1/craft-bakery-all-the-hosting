import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Db = ReturnType<typeof createSupabaseServerClient>;

export type ExampleQuality = "approved" | "edited" | "written";
export interface Example {
  client_message: string;
  reply: string;
}

// Business facts the team has taught ("we don't do custom cakes", payment
// details, who to contact...). Served to the agent through a tool, so — like
// prices — anything it says from here is data it was given, not memory.
export async function getKnowledge(db: Db): Promise<string[]> {
  const { data } = await db
    .from("agent_knowledge")
    .select("text")
    .order("created_at", { ascending: true })
    .limit(60);
  return (data ?? []).map((r) => String(r.text));
}

export async function addKnowledge(db: Db, text: string, source: "manual" | "admin_group"): Promise<string | null> {
  const clean = text.trim().slice(0, 600);
  if (!clean) return null;
  const { data } = await db.from("agent_knowledge").insert({ text: clean, source }).select("id").single();
  return (data?.id as string | undefined) ?? null;
}

// Every reply the team sends or corrects becomes a worked example of how the
// bakery talks. Replies a person wrote or edited are the strongest signal;
// plain approvals are weaker but still show the house style.
export async function recordExample(db: Db, input: { clientMessage: string; reply: string; quality: ExampleQuality }) {
  const clientMessage = input.clientMessage.trim().slice(0, 500);
  const reply = input.reply.trim().slice(0, 1000);
  if (!clientMessage || !reply) return;
  await db.from("agent_examples").insert({ client_message: clientMessage, reply, quality: input.quality });
}

const EXAMPLES_SHOWN = 8;

export async function getExamples(db: Db): Promise<Example[]> {
  const { data } = await db
    .from("agent_examples")
    .select("client_message, reply, quality, created_at")
    .order("created_at", { ascending: false })
    .limit(60);
  const rows = data ?? [];
  const strong = rows.filter((r) => r.quality !== "approved").slice(0, 6);
  const weak = rows.filter((r) => r.quality === "approved").slice(0, EXAMPLES_SHOWN - strong.length);
  return [...strong, ...weak].map((r) => ({ client_message: String(r.client_message), reply: String(r.reply) }));
}

export function examplesBlock(examples: Example[]): string {
  if (examples.length === 0) return "";
  const body = examples
    .map((e) => `Клієнт: ${e.client_message.slice(0, 300)}\nМи: ${e.reply.slice(0, 500)}`)
    .join("\n\n");
  return `\nЯК МИ ЗВИКЛИ ВІДПОВІДАТИ (реальні відповіді команди — переймай тон, манеру і довжину, але не копіюй факти й цифри звідси):\n${body}\n`;
}
