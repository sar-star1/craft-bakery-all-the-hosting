import "server-only";

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
  opts?: { buttons?: InlineButton[][]; replyTo?: number }
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

// Admin notifications (new orders, mass-order flags, new drafts) go to this
// separate group, distinct from any individual client chat.
export async function notifyAdmin(
  text: string,
  opts?: { buttons?: InlineButton[][]; replyTo?: number }
): Promise<{ ok: boolean; error?: string; messageId?: number }> {
  const groupId = process.env.TELEGRAM_ADMIN_GROUP_ID;
  if (!groupId) {
    return { ok: false, error: "TELEGRAM_ADMIN_GROUP_ID is not configured." };
  }
  return sendTelegramMessage(groupId, text, opts);
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
