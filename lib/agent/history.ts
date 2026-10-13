// Builds the conversation the model sees for ONE incoming message.
//
// The message being answered is always last. The stored order can't be trusted
// for that: when a client writes twice in quick succession, the reply to the
// first message is saved AFTER the second message, so sorting by time would end
// the conversation with the agent's own message — which the API rejects (and which
// would also answer the wrong thing). Newer client messages are left out; they
// get their own turn.

export interface HistoryRow {
  direction: string;
  text: string;
  created_at: string;
  telegram_message_id: number | null;
}
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function buildHistory(rows: HistoryRow[], current: { telegramMessageId: number; text: string }): ChatMessage[] {
  const mine = rows.find((r) => r.direction === "in" && r.telegram_message_id === current.telegramMessageId);
  const cutoff = mine ? Date.parse(mine.created_at) : Infinity;

  const earlier = rows
    .filter((r) => r !== mine && !(r.direction === "in" && Date.parse(r.created_at) > cutoff))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    .map((r): ChatMessage => ({ role: r.direction === "in" ? "user" : "assistant", content: r.text }));

  while (earlier.length > 0 && earlier[0].role !== "user") earlier.shift();
  return [...earlier, { role: "user", content: current.text }];
}
