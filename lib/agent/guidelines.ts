import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

import { todayKyiv } from "./validity";

type Db = ReturnType<typeof createSupabaseServerClient>;

// Standing rules from the team ("answer only what's asked", ...). They're
// appended to every prompt the agent runs on, so a correction made once in the
// admin group applies to all future conversations.
export async function getActiveGuidelines(db: Db): Promise<string[]> {
  const { data } = await db
    .from("agent_guidelines")
    .select("text")
    .eq("active", true)
    .or(`expires_at.is.null,expires_at.gte.${todayKyiv()}`)
    .order("created_at", { ascending: true })
    .limit(40);
  return (data ?? []).map((r) => String(r.text));
}

export async function addGuideline(
  db: Db,
  text: string,
  source: "manual" | "admin_feedback" | "teach" | "history_import",
  expiresAt: string | null = null
): Promise<string | null> {
  const clean = text.trim().slice(0, 400);
  if (!clean) return null;
  const { data } = await db
    .from("agent_guidelines")
    .insert({ text: clean, source, expires_at: expiresAt })
    .select("id")
    .single();
  return (data?.id as string | undefined) ?? null;
}

export function guidelinesBlock(guidelines: string[]): string {
  if (guidelines.length === 0) return "";
  return `\nПРАВИЛА ВІД КОМАНДИ (обов'язкові, мають пріоритет над загальним стилем)\n${guidelines.map((g) => `- ${g}`).join("\n")}\n`;
}
