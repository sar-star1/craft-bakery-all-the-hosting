import { NextResponse } from "next/server";
import { runWeeklyReminders } from "@/lib/jobs";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

// Vercel Cron sends "Authorization: Bearer $CRON_SECRET" when that env var is set.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json(await runWeeklyReminders());
}
