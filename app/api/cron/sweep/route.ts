import { NextResponse } from "next/server";
import { sweepPendingOrders } from "@/lib/chatOrders";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Places the orders whose summary the client never answered (after `auto_confirm_minutes`) and
// nudges unanswered team questions. Cheap and safe to call often — unlike /api/cron/reminders,
// which also drafts reminder messages and must run once a day. Vercel's free plan only allows
// daily crons, so for a prompt timer point a free external pinger (e.g. cron-job.org, every
// 10–15 min) at this URL with the header  Authorization: Bearer <CRON_SECRET>.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const placed = await sweepPendingOrders(createSupabaseServerClient()).catch(() => 0);
  return NextResponse.json({ ok: true, pendingOrdersPlaced: placed });
}
