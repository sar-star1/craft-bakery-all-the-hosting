"use server";

import { revalidatePath } from "next/cache";
import { AGENT_MODEL, getAnthropic, isAnthropicConfigured } from "@/lib/agent/anthropic";
import { addGuideline } from "@/lib/agent/guidelines";
import { addKnowledge } from "@/lib/agent/memory";
import { teachFromText } from "@/lib/agent/teach";
import { getOrderingRules } from "@/lib/orders";
import type { OrderingRules } from "@/lib/orderRules";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clearRoutingCache, notifyAdmin, sendTelegramMessage, telegramApi } from "@/lib/telegram";

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
    allowed_updates: ["message", "callback_query", "message_reaction"],
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
export async function addAgentRule(text: string, expiresAt: string | null = null): Promise<SetupActionResult> {
  await requireAdmin();
  const id = await addGuideline(createSupabaseServerClient(), text, "manual", expiresAt || null);
  revalidatePath("/setup");
  return id ? { ok: true, message: "Правило додано." } : { ok: false, message: "Введіть текст правила." };
}

export async function deleteAgentRule(id: string): Promise<SetupActionResult> {
  await requireAdmin();
  const { error } = await createSupabaseServerClient().from("agent_guidelines").delete().eq("id", id);
  revalidatePath("/setup");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Правило видалено." };
}

// Business facts the agent may quote (served through its get_business_info tool).
export async function addAgentFact(text: string, expiresAt: string | null = null): Promise<SetupActionResult> {
  await requireAdmin();
  const id = await addKnowledge(createSupabaseServerClient(), text, "manual", expiresAt || null);
  revalidatePath("/setup");
  return id ? { ok: true, message: "Факт додано." } : { ok: false, message: "Введіть текст." };
}

export async function deleteAgentFact(id: string): Promise<SetupActionResult> {
  await requireAdmin();
  const { error } = await createSupabaseServerClient().from("agent_knowledge").delete().eq("id", id);
  revalidatePath("/setup");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Факт видалено." };
}

export async function deleteAgentExample(id: string): Promise<SetupActionResult> {
  await requireAdmin();
  const { error } = await createSupabaseServerClient().from("agent_examples").delete().eq("id", id);
  revalidatePath("/setup");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Приклад видалено." };
}

// "Just tell the agent": plain words in, the right kind of memory out.
export async function teachAgentAction(text: string): Promise<SetupActionResult> {
  await requireAdmin();
  if (!isAnthropicConfigured()) return { ok: false, message: "ANTHROPIC_API_KEY не задано." };
  try {
    const res = await teachFromText(createSupabaseServerClient(), text, "teach");
    revalidatePath("/setup");
    return { ok: res.ok, message: res.message };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveOrderingRules(rules: OrderingRules): Promise<SetupActionResult> {
  await requireAdmin();
  const clean = (v: number) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const next = {
    min_order_total: clean(rules.min_order_total),
    free_delivery_from: clean(rules.free_delivery_from),
    delivery_fee: clean(rules.delivery_fee),
    auto_confirm_minutes: clean(rules.auto_confirm_minutes),
  };
  if (Object.values(next).some((v) => v === null)) return { ok: false, message: "Введіть невід'ємні числа." };
  const db = createSupabaseServerClient();
  await getOrderingRules(db); // validates the table is reachable
  const { error } = await db.from("site_content").upsert({ key: "ordering_rules", content_json: next }, { onConflict: "key" });
  revalidatePath("/setup");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Збережено. Діє і в чаті, і на сайті." };
}

// ---- edit what the agent has been taught ------------------------------------

export async function updateAgentRule(id: string, text: string, expiresAt: string | null): Promise<SetupActionResult> {
  await requireAdmin();
  const clean = text.trim().slice(0, 400);
  if (!clean) return { ok: false, message: "Текст правила не може бути порожнім." };
  const { error } = await createSupabaseServerClient()
    .from("agent_guidelines")
    .update({ text: clean, expires_at: expiresAt || null })
    .eq("id", id);
  revalidatePath("/setup");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Правило оновлено." };
}

export async function updateAgentFact(id: string, text: string, expiresAt: string | null): Promise<SetupActionResult> {
  await requireAdmin();
  const clean = text.trim().slice(0, 600);
  if (!clean) return { ok: false, message: "Текст факту не може бути порожнім." };
  const { error } = await createSupabaseServerClient()
    .from("agent_knowledge")
    .update({ text: clean, expires_at: expiresAt || null })
    .eq("id", id);
  revalidatePath("/setup");
  return error ? { ok: false, message: error.message } : { ok: true, message: "Факт оновлено." };
}

// ---- sorting the staff group's alerts ----------------------------------------

async function saveRouting(value: Record<string, unknown>) {
  const { error } = await createSupabaseServerClient()
    .from("site_content")
    .upsert({ key: "telegram_routing", content_json: value }, { onConflict: "key" });
  clearRoutingCache();
  revalidatePath("/setup");
  return error;
}

// Creates two topics in the staff group — one for orders, one for everything
// else — so an order alert can't be buried under draft replies. The group must
// have Topics turned on and the bot must be an admin allowed to manage topics.
export async function setupGroupTopics(): Promise<SetupActionResult> {
  await requireAdmin();
  const group = process.env.TELEGRAM_ADMIN_GROUP_ID;
  if (!group) return { ok: false, message: "TELEGRAM_ADMIN_GROUP_ID не задано." };

  const chat = await telegramApi<{ is_forum?: boolean }>("getChat", { chat_id: group });
  if (!chat.ok) return { ok: false, message: `Не вдалося прочитати групу: ${chat.error}` };
  if (!chat.result.is_forum) {
    return { ok: false, message: "У групі не ввімкнено «Теми». Відкрийте групу → ⋯ → Керування групою → Теми → увімкніть. Бот має бути адміністратором з правом керувати темами." };
  }

  const orders = await telegramApi<{ message_thread_id: number }>("createForumTopic", { chat_id: group, name: "📦 Замовлення" });
  if (!orders.ok) return { ok: false, message: `Не вдалося створити тему: ${orders.error}. Зробіть бота адміністратором з правом «Керувати темами».` };
  const messages = await telegramApi<{ message_thread_id: number }>("createForumTopic", { chat_id: group, name: "💬 Повідомлення" });
  if (!messages.ok) return { ok: false, message: `Тему замовлень створено, а повідомлень — ні: ${messages.error}` };

  const error = await saveRouting({
    orders_thread_id: orders.result.message_thread_id,
    messages_thread_id: messages.result.message_thread_id,
  });
  if (error) return { ok: false, message: error.message };
  await sendTelegramMessage(group, "📦 Тут з'являтимуться нові замовлення — з кнопкою підтвердження.", { threadId: orders.result.message_thread_id });
  await sendTelegramMessage(group, "💬 Тут — чернетки відповідей, нові клієнти й решта сповіщень. Відповідайте на чернетки саме тут.", { threadId: messages.result.message_thread_id });
  return { ok: true, message: "Готово: замовлення йдуть у тему «📦 Замовлення», решта — у «💬 Повідомлення»." };
}

// Orders into a separate chat instead of a topic (add the bot to it, then paste its id from /chatid).
export async function saveOrdersChat(chatId: string): Promise<SetupActionResult> {
  await requireAdmin();
  const id = chatId.trim();
  if (!/^-?\d{5,}$/.test(id)) return { ok: false, message: "Введіть числовий ID чату (його показує команда /chatid)." };
  const test = await sendTelegramMessage(id, "📦 Сюди надходитимуть нові замовлення — з кнопкою підтвердження.");
  if (!test.ok) return { ok: false, message: `Бот не може писати в цей чат: ${test.error}. Додайте бота в чат і повторіть.` };
  const error = await saveRouting({ orders_chat_id: id });
  return error ? { ok: false, message: error.message } : { ok: true, message: "Замовлення тепер надходять в окремий чат." };
}

export async function clearGroupRouting(): Promise<SetupActionResult> {
  await requireAdmin();
  const error = await saveRouting({});
  return error ? { ok: false, message: error.message } : { ok: true, message: "Розділення вимкнено: усе знову в одній групі." };
}
