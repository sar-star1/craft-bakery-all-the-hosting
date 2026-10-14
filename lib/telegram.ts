import "server-only";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";

export function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  opts?: { buttons?: InlineButton[][]; replyTo?: number; threadId?: number }
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured. Add it to .env.local." };
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Telegram caps a message at 4096 characters.
    body: JSON.stringify({
      chat_id: chatId,
      text: text.slice(0, 4096),
      ...(opts?.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {}),
      ...(opts?.threadId ? { message_thread_id: opts.threadId } : {}),
      ...(opts?.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
    }),
  });
  const json = await res.json();
  if (!json.ok) {
    return { ok: false, error: json.description ?? "Telegram API error" };
  }
  return { ok: true, messageId: json.result?.message_id };
}

async function telegramCall(method: string, body: Record<string, unknown>): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
}

// Acknowledges a button press (the small toast the admin sees).
export function answerCallbackQuery(callbackQueryId: string, text?: string) {
  return telegramCall("answerCallbackQuery", { callback_query_id: callbackQueryId, text, show_alert: false });
}

// Rewrites an alert in place and removes its buttons.
export function editTelegramMessage(chatId: string, messageId: number, text: string, buttons: InlineButton[][] = []) {
  return telegramCall("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: text.slice(0, 4096),
    reply_markup: { inline_keyboard: buttons },
  });
}

// Rewrites a message the bot sent earlier (in a client's chat). Unlike editTelegramMessage
// this reports whether Telegram accepted it. Telegram answers "message is not modified"
// when the text is identical — that is fine, the chat already shows it.
export async function editSentMessage(chatId: string, messageId: number, text: string): Promise<{ ok: boolean; error?: string }> {
  const r = await telegramApi("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, 4096) });
  if (r.ok) return { ok: true };
  return /not modified/i.test(r.error) ? { ok: true } : { ok: false, error: r.error };
}

// Removes a message the bot sent from the client's chat.
export async function deleteSentMessage(chatId: string, messageId: number): Promise<{ ok: boolean; error?: string }> {
  const r = await telegramApi("deleteMessage", { chat_id: chatId, message_id: messageId });
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

// Reactions a bot may use (a safe subset of Telegram's free emoji set).
export const ALLOWED_REACTIONS = ["👍", "❤", "🙏", "🔥", "👌"] as const;

// Puts an emoji reaction on a message (best effort — a failed reaction must
// never block the reply it accompanies).
export async function setMessageReaction(
  chatId: string,
  messageId: number,
  emoji: string
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "no bot token" };
  if (!(ALLOWED_REACTIONS as readonly string[]).includes(emoji)) return { ok: false, error: `emoji ${emoji} not allowed` };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/setMessageReaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji }] }),
    });
    const json = await res.json();
    return json.ok ? { ok: true } : { ok: false, error: json.description ?? "Telegram refused the reaction" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Sends a stored file to a chat: photos as photos, everything else as documents.
export async function sendTelegramFile(
  chatId: string,
  file: { url: string; name: string; type: string }
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured." };
  const asPhoto = /^image\/(jpeg|png|webp)$/.test(file.type);
  const res = await fetch(`https://api.telegram.org/bot${token}/${asPhoto ? "sendPhoto" : "sendDocument"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, [asPhoto ? "photo" : "document"]: file.url }),
  });
  const json = await res.json();
  return json.ok ? { ok: true, messageId: json.result?.message_id } : { ok: false, error: json.description ?? "Telegram API error" };
}

// Best-effort "typing…" indicator while the agent thinks.
export async function sendTypingAction(chatId: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, action: "typing" }),
  }).catch(() => {});
}

// Where staff alerts go. By default everything lands in the admin group. So that
// orders can't be buried under chatter, the team can split them (Settings):
//  - into two Topics of the group (📦 orders / 💬 messages), or
//  - orders into a separate chat.
export interface Routing {
  orders_thread_id?: number;
  messages_thread_id?: number;
  orders_chat_id?: string;
}

let routingCache: { at: number; value: Routing } | null = null;

export function clearRoutingCache() {
  routingCache = null;
}

export async function getRouting(): Promise<Routing> {
  if (routingCache && Date.now() - routingCache.at < 20_000) return routingCache.value;
  let value: Routing = {};
  if (isSupabaseConfigured()) {
    try {
      const { data } = await createSupabaseServerClient().from("site_content").select("content_json").eq("key", "telegram_routing").maybeSingle();
      value = (data?.content_json ?? {}) as Routing;
    } catch {
      value = {};
    }
  }
  routingCache = { at: Date.now(), value };
  return value;
}

// Is this one of the chats where staff work (the admin group, or the separate orders chat)?
export async function isStaffChat(chatId: number | string): Promise<boolean> {
  const id = String(chatId);
  if (id === process.env.TELEGRAM_ADMIN_GROUP_ID) return true;
  return (await getRouting()).orders_chat_id === id;
}

// Admin notifications (new orders, mass-order flags, new drafts) go to the staff
// group, distinct from any individual client chat. `kind: "order"` marks order
// alerts so they can be routed to their own topic/chat; a `threadId` keeps a
// reply inside the topic the admin wrote in.
export async function notifyAdmin(
  text: string,
  opts?: { buttons?: InlineButton[][]; replyTo?: number; threadId?: number; kind?: "order" | "message" }
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  const groupId = process.env.TELEGRAM_ADMIN_GROUP_ID;
  if (!groupId) {
    return { ok: false, error: "TELEGRAM_ADMIN_GROUP_ID is not configured." };
  }
  const routing = await getRouting();
  let chat = groupId;
  let threadId = opts?.threadId;
  if (opts?.kind === "order" && routing.orders_chat_id) {
    chat = routing.orders_chat_id;
    threadId = undefined;
  } else if (threadId === undefined) {
    threadId = opts?.kind === "order" ? routing.orders_thread_id : routing.messages_thread_id;
  }
  const res = await sendTelegramMessage(chat, text, { buttons: opts?.buttons, replyTo: opts?.replyTo, threadId });
  // A deleted topic or an unreachable chat must not lose the alert: fall back to the group itself.
  if (!res.ok && (chat !== groupId || threadId !== undefined) && /thread|chat not found|not enough rights|TOPIC/i.test(res.error ?? "")) {
    return sendTelegramMessage(groupId, text, { buttons: opts?.buttons });
  }
  return res;
}

// Raw Bot API call for the setup page; returns Telegram's `result` or an error.
export async function telegramApi<T = unknown>(
  method: string,
  body?: Record<string, unknown>
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not set." };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
    const json = await res.json();
    return json.ok ? { ok: true, result: json.result as T } : { ok: false, error: json.description ?? "Telegram API error" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Migration deep links (t.me/<bot>?start=<payload>). Telegram's start
// payload only allows [A-Za-z0-9_-], so we strip the client UUID's dashes
// rather than add a separate token column.
export function clientIdToStartPayload(clientId: string): string {
  return `m_${clientId.replace(/-/g, "")}`;
}

export function startPayloadToClientId(payload: string): string | null {
  const match = payload.match(/^m_([0-9a-f]{32})$/i);
  if (!match) return null;
  const hex = match[1];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getBotDeepLink(clientId: string): string | null {
  const username = process.env.TELEGRAM_BOT_USERNAME;
  if (!username) return null;
  return `https://t.me/${username}?start=${clientIdToStartPayload(clientId)}`;
}
