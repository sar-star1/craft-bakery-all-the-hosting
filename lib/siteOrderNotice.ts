import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { sendTelegramMessage } from "@/lib/telegram";

type Db = ReturnType<typeof createSupabaseServerClient>;

// A website order is confirmed in Telegram: right away when the client is already in the bot, or
// the moment they tap the bot link on the site afterwards. Fixed text, no AI.
const RECENT_MS = 3 * 86_400_000;

export function siteOrderConfirmation(o: { summary: string; total: number; deliveryFee: number; address?: string }): string {
  const delivery = o.deliveryFee > 0 ? `, з доставкою ${o.deliveryFee} ₴` : ", доставка безкоштовна";
  return `Отримали ваше замовлення з сайту ✅\n\n${o.summary}\nРазом: ${o.total} ₴${delivery}${o.address ? `\nАдреса: ${o.address}` : ""}\n\nЯкщо потрібно щось змінити чи додати — просто напишіть сюди.`;
}

type OrderRow = { id: string; item_summary_uk: string; total_amount: number | string | null; item_details_uk: Record<string, unknown> | null; created_at: string };

async function send(db: Db, clientId: string, chatId: string, order: OrderRow): Promise<boolean> {
  const d = order.item_details_uk ?? {};
  const text = siteOrderConfirmation({
    summary: String(order.item_summary_uk ?? ""),
    total: Number(order.total_amount ?? 0),
    deliveryFee: Number(d.delivery_fee ?? 0),
    address: typeof d.address === "string" ? d.address : undefined,
  });
  const sent = await sendTelegramMessage(chatId, text);
  if (!sent.ok) return false;
  await db.from("messages").insert({ client_id: clientId, conversation_id: null, direction: "out", text, telegram_message_id: sent.messageId ?? null, sent_by: "agent" });
  await db.from("orders").update({ item_details_uk: { ...d, telegram_confirmed_at: new Date().toISOString() } }).eq("id", order.id);
  return true;
}

// Confirms the client's newest website order in their Telegram chat, once. Returns whether it was sent.
export async function confirmSiteOrderInTelegram(db: Db, clientId: string): Promise<boolean> {
  const { data: client } = await db.from("clients").select("telegram_chat_id").eq("id", clientId).maybeSingle();
  if (!client?.telegram_chat_id) return false;
  const { data } = await db
    .from("orders")
    .select("id, item_summary_uk, total_amount, item_details_uk, created_at")
    .eq("client_id", clientId)
    .eq("source", "website_form")
    .gte("created_at", new Date(Date.now() - RECENT_MS).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const order = data as OrderRow | null;
  if (!order || order.item_details_uk?.telegram_confirmed_at) return false;
  return send(db, clientId, client.telegram_chat_id as string, order);
}
