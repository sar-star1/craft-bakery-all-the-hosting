import "server-only";
import { draftOutbound, type OutboundKind } from "@/lib/agent/draft";
import { isAnthropicConfigured } from "@/lib/agent/anthropic";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { announceDrafts } from "@/lib/adminAlerts";
import { getActiveGuidelines } from "@/lib/agent/guidelines";

type Db = ReturnType<typeof createSupabaseServerClient>;

const DAY_MS = 24 * 3600 * 1000;

interface JobClient {
  id: string;
  business_name: string;
  contact_name: string | null;
  standing_order_notes: string | null;
  pipeline_stage: string;
  blocker_note: string | null;
  status: string;
  last_contact_at: string | null;
  last_order_at: string | null;
}
const JOB_COLUMNS =
  "id, business_name, contact_name, standing_order_notes, pipeline_stage, blocker_note, status, last_contact_at, last_order_at";

async function getRuleNumber(db: Db, ruleType: string, fallback: number): Promise<number> {
  const { data } = await db.from("capacity_rules").select("value").eq("rule_type", ruleType).maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function recentOrderSummaries(db: Db, clientId: string, limit = 5): Promise<string[]> {
  const { data } = await db
    .from("orders")
    .select("item_summary_uk, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((o) => `${String(o.created_at).slice(0, 10)}: ${o.item_summary_uk}`);
}

async function queueDraft(db: Db, client: JobClient, kind: OutboundKind, offerText?: string): Promise<string | null> {
  const text = await draftOutbound({
    kind,
    clientId: client.id,
    businessName: client.business_name,
    contactName: client.contact_name,
    standingOrderNotes: client.standing_order_notes,
    leadStage: client.pipeline_stage,
    blockerNote: client.blocker_note,
    guidelines: await getActiveGuidelines(db),
    recentOrders: await recentOrderSummaries(db, client.id),
    offerText,
  });
  if (!text) return null;
  const { data } = await db
    .from("pending_replies")
    .insert({ client_id: client.id, draft_text: text, reply_type: kind })
    .select("id")
    .single();
  return (data?.id as string | undefined) ?? null;
}

async function alreadyDrafted(db: Db, clientId: string, kind: OutboundKind, withinDays: number): Promise<boolean> {
  const since = new Date(Date.now() - withinDays * DAY_MS).toISOString();
  const { count } = await db
    .from("pending_replies")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("reply_type", kind)
    .gte("created_at", since);
  return (count ?? 0) > 0;
}

export interface JobResult {
  ok: boolean;
  created?: number;
  skipped?: string;
}

// Clients who've gone quiet after ordering are marked dormant, so the funnel
// and the re-engagement job reflect reality.
export async function updateDormancy(db: Db): Promise<number> {
  const days = await getRuleNumber(db, "dormant_threshold_days", 45);
  const cutoff = new Date(Date.now() - days * DAY_MS).toISOString();
  const { data } = await db
    .from("clients")
    .update({ status: "dormant", pipeline_stage: "dormant" })
    .in("pipeline_stage", ["first_order", "recurring"])
    .lt("last_order_at", cutoff)
    .select("id");
  return data?.length ?? 0;
}

// "Overdue" = the client's own rhythm: the average gap between their past
// orders (needs at least two), plus a day of grace. No free-text parsing.
export async function runWeeklyReminders(): Promise<JobResult> {
  if (!isAnthropicConfigured()) return { ok: false, skipped: "ANTHROPIC_API_KEY not set" };
  const db = createSupabaseServerClient();

  const { data: clients } = await db
    .from("clients")
    .select(JOB_COLUMNS)
    .not("telegram_chat_id", "is", null)
    .in("pipeline_stage", ["first_order", "recurring"]);

  const draftIds: string[] = [];
  for (const client of (clients ?? []) as JobClient[]) {
    const { data: orders } = await db
      .from("orders")
      .select("created_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: true })
      .limit(60);
    const times = (orders ?? []).map((o) => new Date(o.created_at as string).getTime());
    if (times.length < 2) continue;

    const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY_MS);
    const avgGap = Math.min(60, Math.max(3, gaps.reduce((a, b) => a + b, 0) / gaps.length));
    const daysSince = (Date.now() - times[times.length - 1]) / DAY_MS;
    if (daysSince <= avgGap + 1) continue;
    if (await alreadyDrafted(db, client.id, "weekly_reminder", Math.max(5, Math.round(avgGap)))) continue;

    const id = await queueDraft(db, client, "weekly_reminder");
    if (id) draftIds.push(id);
  }

  await announceDrafts(db, draftIds, "Нагадування регулярним клієнтам");
  return { ok: true, created: draftIds.length };
}

// Re-engagement: leads who looked but never ordered, and clients gone dormant.
export async function runRemarketing(): Promise<JobResult> {
  if (!isAnthropicConfigured()) return { ok: false, skipped: "ANTHROPIC_API_KEY not set" };
  const db = createSupabaseServerClient();

  const dormantCount = await updateDormancy(db);
  const thresholdDays = await getRuleNumber(db, "remarketing_threshold_days", 14);
  const cutoff = new Date(Date.now() - thresholdDays * DAY_MS).toISOString();

  const { data: clients } = await db
    .from("clients")
    .select(JOB_COLUMNS)
    .not("telegram_chat_id", "is", null)
    .or(`and(pipeline_stage.in.(cold,warm,menu_sent),last_contact_at.lt.${cutoff}),pipeline_stage.eq.dormant`);

  const draftIds: string[] = [];
  for (const client of (clients ?? []) as JobClient[]) {
    if (await alreadyDrafted(db, client.id, "remarketing", 30)) continue;
    const id = await queueDraft(db, client, "remarketing");
    if (id) draftIds.push(id);
  }

  await announceDrafts(db, draftIds, "Повторне залучення клієнтів");
  return { ok: true, created: draftIds.length, skipped: dormantCount ? `${dormantCount} clients marked dormant` : undefined };
}

export type OfferSegment = "all" | "active" | "dormant";

// Manually triggered from the dashboard when there's a real seasonal offer.
export async function createSeasonalOfferDrafts(offerText: string, segment: OfferSegment): Promise<JobResult> {
  if (!isAnthropicConfigured()) return { ok: false, skipped: "ANTHROPIC_API_KEY not set" };
  const db = createSupabaseServerClient();

  let query = db.from("clients").select(JOB_COLUMNS).not("telegram_chat_id", "is", null);
  if (segment === "active") query = query.in("pipeline_stage", ["first_order", "recurring"]);
  if (segment === "dormant") query = query.eq("pipeline_stage", "dormant");
  const { data: clients } = await query;

  const list = (clients ?? []) as JobClient[];
  const draftIds: string[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const results = await Promise.all(list.slice(i, i + CONCURRENCY).map((c) => queueDraft(db, c, "seasonal_offer", offerText)));
    for (const id of results) if (id) draftIds.push(id);
  }

  await announceDrafts(db, draftIds, "Сезонна пропозиція");
  return { ok: true, created: draftIds.length };
}
