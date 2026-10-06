import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { buildDraftAlert } from "@/lib/adminAlerts";
import { addGuideline, getActiveGuidelines } from "@/lib/agent/guidelines";
import { isAnthropicConfigured } from "@/lib/agent/anthropic";
import { reviseDraft } from "@/lib/agent/revise";
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

  const rule = data.match(/^gd:([0-9a-f-]{36})$/);
  if (rule) {
    const db = createSupabaseServerClient();
    await db.from("agent_guidelines").delete().eq("id", rule[1]);
    await answerCallbackQuery(queryId, "Правило видалено");
    await editTelegramMessage(chat, messageId, `${original}\n\n🗑 Правило видалено · ${actor}`);
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

// An admin replying to a draft alert. Two meanings, kept explicit so a remark
// is never sent to a client by accident:
//   "! text"  → send exactly that text to the client instead of the draft;
//   anything else → feedback for the agent: it rewrites the draft (if still
//                   pending) and, when the remark is a general one, saves it as
//                   a standing rule that applies to all future replies.
async function handleReplyToDraft(msg: NonNullable<TelegramUpdate["message"]>) {
  const db = createSupabaseServerClient();
  const target = msg.reply_to_message!;
  const chat = String(msg.chat.id);
  const actor = actorName(msg.from);
  const text = (msg.text ?? "").trim();
  if (!text) return;

  const { data: draft } = await db
    .from("pending_replies")
    .select("id, client_id, draft_text, status, reply_type")
    .eq("admin_message_id", target.message_id)
    .maybeSingle();
  if (!draft) return;
  const pending = draft.status === "awaiting_approval";

  if (text.startsWith("!")) {
    const own = text.replace(/^!+\s*/, "");
    if (!own) return;
    if (!pending) {
      await notifyAdmin("Ця чернетка вже оброблена — власний текст не надіслано.", { replyTo: msg.message_id });
      return;
    }
    const result = await sendPendingReply(draft.id as string, { text: own });
    if (result.ok) {
      if (target.text) {
        await editTelegramMessage(chat, target.message_id, `${stripHint(target.text)}\n\n✏️ Надіслано власний текст · ${actor}`);
      }
    } else if (!result.alreadyHandled) {
      await notifyAdmin(`Не вдалося надіслати: ${result.error}`, { replyTo: msg.message_id });
    }
    return;
  }

  if (!isAnthropicConfigured()) {
    await notifyAdmin("AI не налаштовано (ANTHROPIC_API_KEY) — не можу опрацювати зауваження.", { replyTo: msg.message_id });
    return;
  }

  const [{ data: client }, { data: rows }, guidelines] = await Promise.all([
    db.from("clients").select("business_name").eq("id", draft.client_id).maybeSingle(),
    db.from("messages").select("direction, text").eq("client_id", draft.client_id).order("created_at", { ascending: false }).limit(10),
    getActiveGuidelines(db),
  ]);
  const history = (rows ?? []).reverse().map((m) => ({ direction: String(m.direction), text: String(m.text) }));
  const clientMessage = [...history].reverse().find((m) => m.direction === "in")?.text;

  let revision;
  try {
    revision = await reviseDraft({
      draft: draft.draft_text as string,
      feedback: text,
      clientMessage,
      history,
      guidelines,
      rewrite: pending,
    });
  } catch (err) {
    await notifyAdmin(`Не вдалося опрацювати зауваження: ${err instanceof Error ? err.message : String(err)}`, {
      replyTo: msg.message_id,
    });
    return;
  }

  if (pending && revision.text) {
    await db.from("pending_replies").update({ draft_text: revision.text }).eq("id", draft.id);
    const alert = buildDraftAlert({
      id: draft.id as string,
      clientId: draft.client_id as string,
      clientName: (client?.business_name as string) ?? "—",
      replyType: draft.reply_type as string,
      text: revision.text,
      clientMessage,
      note: `✏️ Переписано за зауваженням · ${actor}`,
    });
    await editTelegramMessage(chat, target.message_id, alert.text, alert.buttons);
  }

  if (revision.rule) {
    const ruleId = await addGuideline(db, revision.rule, "admin_feedback");
    await notifyAdmin(`📌 Запам'ятав правило для всіх наступних відповідей:\n«${revision.rule}»`, {
      replyTo: msg.message_id,
      buttons: ruleId ? [[{ text: "🗑 Видалити правило", callback_data: `gd:${ruleId}` }]] : undefined,
    });
  } else {
    await notifyAdmin(
      pending
        ? "Переписав чернетку. Зауваження схоже на разове, тому як правило не зберіг."
        : "Зауваження схоже на разове (стосується лише цього випадку), тому як правило не зберіг.",
      { replyTo: msg.message_id }
    );
  }
}
