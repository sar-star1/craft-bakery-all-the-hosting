import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifyAdmin } from "@/lib/telegram";

type Db = ReturnType<typeof createSupabaseServerClient>;

export const QUESTION_NUDGE_MINUTES = 15;

// A question the agent put to the team is a client waiting for an answer. If it is still
// unanswered after a while, the group gets one nudge (never more) — the client shouldn't be
// left hanging because everyone assumed someone else saw it. Runs wherever the order sweep runs.
export async function nudgeUnansweredQuestions(db: Db): Promise<number> {
  const cutoff = new Date(Date.now() - QUESTION_NUDGE_MINUTES * 60 * 1000).toISOString();
  const { data } = await db
    .from("pending_replies")
    .select("id, client_id, team_question, admin_message_id")
    .eq("status", "awaiting_approval")
    .is("reminded_at", null)
    .not("team_question", "is", null)
    .lt("created_at", cutoff)
    .limit(10);
  let nudged = 0;
  for (const q of data ?? []) {
    // claim first so two overlapping sweeps can't both nudge
    const { data: claimed } = await db
      .from("pending_replies")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", q.id)
      .is("reminded_at", null)
      .select("id");
    if (!claimed?.length) continue;
    const { data: client } = await db.from("clients").select("business_name").eq("id", q.client_id).maybeSingle();
    const base = process.env.SITE_URL?.replace(/\/$/, "");
    await notifyAdmin(
      `⏰ ${client?.business_name ?? "Клієнт"} чекає на відповідь команди вже понад ${QUESTION_NUDGE_MINUTES} хв.\n❓ ${String(q.team_question).slice(0, 400)}${base ? `\n${base}/clients/${q.client_id}` : ""}`,
      { replyTo: (q.admin_message_id as number | null) ?? undefined, kind: "message" }
    ).catch(() => {});
    nudged++;
  }
  return nudged;
}
