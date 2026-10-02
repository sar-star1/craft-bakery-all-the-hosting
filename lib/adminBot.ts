import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { answerCallbackQuery, editTelegramMessage, notifyAdmin } from "@/lib/telegram";
import { nextStatus, type OrderStatus } from "@/lib/types";
import { rejectPendingReply, sendPendingReply } from "@/lib/replies";
import type { TelegramUpdate } from "@/lib/agent/run";

const STATUS_LABEL: Record<OrderStatus, string> = {
  pending_review: "На перевірці",
  new: "Нове",
  confirmed: "Підтверджено",
  in_progress: "У роботі",
  ready: "Готово",
  completed: "Виконано",
};

const isAdminChat = (chatId: number | string) => String(chatId) === process.env.TELEGRAM_ADMIN_GROUP_ID;

// The "reply to send your own text" hint is moot once a draft is handled.
const stripHint = (text: string) => text.replace(/\n*✏️ Щоб надіслати власний текст[^\n]*/, "");

function actorName(from?: { first_name?: string; last_name?: string; username?: string }) {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ");
  return name || (from?.username ? `@${from.username}` : "адмін");
}

// Everything that happens inside the admin group: button presses on alerts and
// replies to a draft alert. Returns true when the update belonged to the group
// (so it never reaches the client-facing agent).
export async function handleAdminUpdate(update: TelegramUpdate): Promise<boolean> {
  const cq = update.callback_query;
  if (cq) {
    const msg = cq.message;
    if (!msg || !isAdminChat(msg.chat.id)) {
      await answerCallbackQuery(cq.id, "Недоступно");
      return true;
    }
    await handleButton(cq.id, cq.data ?? "", msg.chat.id, msg.message_id, msg.text ?? "", actorName(cq.from));
    return true;
  }

  const msg = update.message;
  if (msg && isAdminChat(msg.chat.id)) {
    if (msg.reply_to_message && msg.text && !msg.from?.is_bot) await handleReplyToDraft(msg);
    return true;
  }
  return false;
}

async function handleButton(
  queryId: string,
  data: string,
  chatId: number,
  messageId: number,
  original: string,
  actor: string
) {
  const chat = String(chatId);

  const reply = data.match(/^(ap|rj):([0-9a-f-]{36})$/);
  if (reply) {
    const result = reply[1] === "ap" ? await sendPendingReply(reply[2]) : await rejectPendingReply(reply[2]);
    if (result.ok) {
      await answerCallbackQuery(queryId, reply[1] === "ap" ? "Надіслано" : "Відхилено");
      await editTelegramMessage(
        chat,
        messageId,
        `${stripHint(original)}\n\n${reply[1] === "ap" ? "✅ Надіслано клієнту" : "🚫 Відхилено"} · ${actor}`
      );
    } else {
      // "Already handled" means another admin got there first; their edit
      // already updated the message, so leave it alone.
      await answerCallbackQuery(queryId, result.alreadyHandled ? "Вже оброблено" : result.error);
    }
    return;
  }

  const order = data.match(/^os:([0-9a-f-]{36}):(pending_review|new)$/);
  if (order) {
    const from = order[2] as OrderStatus;
    const to = nextStatus(from);
    const db = createSupabaseServerClient();
    const { data: updated } = await db.from("orders").update({ status: to }).eq("id", order[1]).eq("status", from).select("id");
    if (updated?.length) {
      await answerCallbackQuery(queryId, STATUS_LABEL[to]);
      await editTelegramMessage(chat, messageId, `${original}\n\n✅ ${STATUS_LABEL[to]} · ${actor}`);
    } else {
      await answerCallbackQuery(queryId, "Статус уже змінено");
    }
    return;
  }

  await answerCallbackQuery(queryId);
}

// An admin replying to a draft alert with their own text sends that text to
// the client instead of the draft.
async function handleReplyToDraft(msg: NonNullable<TelegramUpdate["message"]>) {
  const db = createSupabaseServerClient();
  const target = msg.reply_to_message!;
  const { data: draft } = await db
    .from("pending_replies")
    .select("id")
    .eq("admin_message_id", target.message_id)
    .eq("status", "awaiting_approval")
    .maybeSingle();
  if (!draft) return;

  const result = await sendPendingReply(draft.id as string, { text: msg.text });
  const chat = String(msg.chat.id);
  if (result.ok) {
    if (target.text) {
      await editTelegramMessage(chat, target.message_id, `${stripHint(target.text)}\n\n✏️ Надіслано власний текст · ${actorName(msg.from)}`);
    }
  } else if (!result.alreadyHandled) {
    await notifyAdmin(`Не вдалося надіслати: ${result.error}`);
  }
}
