"use server";

import { revalidatePath } from "next/cache";
import { AGENT_MODEL, getAnthropic, isAnthropicConfigured } from "@/lib/agent/anthropic";
import { addGuideline } from "@/lib/agent/guidelines";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifyAdmin, telegramApi } from "@/lib/telegram";

export interface SetupActionResult {
  ok: boolean;
  message: string;
}

// The webhook URL is always derived from SITE_URL and the secret from the
// environment, so this can't be pointed anywhere else — and the bot token
// never leaves the server.
export async function registerTelegramWebhook(): Promise<SetupActionResult> {
  await requireAdmin();
  const base = process.env.SITE_URL?.replace(/\/$/, "");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!base || !base.startsWith("https://")) return { ok: false, message: "SITE_URL має бути https://… адресою сайту." };
  if (!secret) return { ok: false, message: "TELEGRAM_WEBHOOK_SECRET не задано." };

  const url = `${base}/api/telegram/webhook`;
  const res = await telegramApi("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  });
  revalidatePath("/setup");
  return res.ok ? { ok: true, message: `Вебхук зареєстровано: ${url}` } : { ok: false, message: res.error };
}

export async function sendAdminTestMessage(): Promise<SetupActionResult> {
  await requireAdmin();
  const res = await notifyAdmin("✅ Тестове повідомлення від бота Peremoga Bakery. Якщо ви це бачите — адмін-група підключена.");
  return res.ok
    ? { ok: true, message: "Надіслано в адмін-групу." }
    : { ok: false, message: res.error ?? "Не вдалося надіслати (бот у групі? правильний ID?)." };
}

export async function testAnthropic(): Promise<SetupActionResult> {
  await requireAdmin();
  if (!isAnthropicConfigured()) return { ok: false, message: "ANTHROPIC_API_KEY не задано." };
  try {
    const response = await getAnthropic().messages.create({
      model: AGENT_MODEL,
      max_tokens: 20,
      messages: [{ role: "user", content: "Reply with the single word OK." }],
    });
    const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
    return { ok: true, message: `Модель ${AGENT_MODEL} відповідає: «${text}»` };
  } catch (err) {
    return { ok: false, message: `Модель ${AGENT_MODEL}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Standing rules the agent follows in every reply (see lib/agent/guidelines.ts).
export async function addAgentRule(text: string): Promise<SetupActionResult> {
  await requireAdmin();
  const id = await addGuideline(createSupabaseServerClient(), text, "manual");
  revalidatePath("/setup");
  return id ? { ok: true, message: "Правило додано." } : { ok: false, message: "Введіть текст правила." };
}

export async function deleteAgentRule(id: string): Promise<SetupActionResult> {
  await requireAdmin();
  const { error } = await createSupabaseServerClient().from("agent_guidelines").delete().eq("id", id);
  revalidatePath("/setup");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Правило видалено." };
}
