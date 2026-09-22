import "server-only";

export function isTelegramConfigured() {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

export async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured. Add it to .env.local." };
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const json = await res.json();
  if (!json.ok) {
    return { ok: false, error: json.description ?? "Telegram API error" };
  }
  return { ok: true };
}

// Admin notifications (new orders, mass-order flags, new drafts) go to this
// separate group, distinct from any individual client chat.
export async function notifyAdmin(text: string): Promise<{ ok: boolean; error?: string }> {
  const groupId = process.env.TELEGRAM_ADMIN_GROUP_ID;
  if (!groupId) {
    return { ok: false, error: "TELEGRAM_ADMIN_GROUP_ID is not configured." };
  }
  return sendTelegramMessage(groupId, text);
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
