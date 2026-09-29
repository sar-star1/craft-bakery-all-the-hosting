import { after, NextResponse } from "next/server";
import { processTelegramUpdate, type TelegramUpdate } from "@/lib/agent/run";

// The agent can take a while (tool calls + model); after() lets us answer
// Telegram immediately — so it never retries — and keep working.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "TELEGRAM_WEBHOOK_SECRET is not configured" }, { status: 503 });
  }
  // Telegram echoes the secret set via setWebhook in this header.
  if (request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  after(() => processTelegramUpdate(update));
  return NextResponse.json({ ok: true });
}
