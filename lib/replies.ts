import "server-only";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { recordExample } from "@/lib/agent/memory";
import { notifyAdmin, sendTelegramFile, sendTelegramMessage, setMessageReaction } from "@/lib/telegram";
import type { Attachment } from "@/lib/types";

export type ReplyResult =
  | { ok: true; clientName: string }
  | { ok: false; error: string; alreadyHandled?: boolean };

function refresh() {
  try {
    revalidatePath("/clients");
    revalidatePath("/pending-replies");
  } catch {
    // Not inside a request scope — the pages are force-dynamic anyway.
  }
}

// Sends a drafted reply to the client now. Used by both the dashboard and the
// admin Telegram group. The draft is claimed first (awaiting → approved_sent,
// only if still awaiting) so two admins pressing at once can't double-send;
// if Telegram then refuses the send, the claim is released.
// `text` replaces the draft — that's the "reply with your own wording" path.
export async function sendPendingReply(id: string, opts?: { text?: string }): Promise<ReplyResult> {
  const db = createSupabaseServerClient();

  const { data: reply } = await db
    .from("pending_replies")
    .select("id, draft_text, client_id, conversation_id, status, edited, reply_type, attachments, reaction, reaction_message_id")
    .eq("id", id)
    .maybeSingle();
  if (!reply) return { ok: false, error: "Draft not found." };
  if (reply.status !== "awaiting_approval") return { ok: false, error: "Already handled.", alreadyHandled: true };

  const { data: client } = await db
    .from("clients")
    .select("business_name, telegram_chat_id")
    .eq("id", reply.client_id)
    .maybeSingle();
  if (!client?.telegram_chat_id) return { ok: false, error: "This client has no linked Telegram chat yet." };

  const text = opts?.text?.trim() || (reply.draft_text as string);

  const { data: claimed } = await db
    .from("pending_replies")
    .update({ status: "approved_sent", draft_text: text })
    .eq("id", id)
    .eq("status", "awaiting_approval")
    .select("id");
  if (!claimed?.length) return { ok: false, error: "Already handled.", alreadyHandled: true };

  // A reaction the agent chose goes out together with the reply it belongs to.
  if (reply.reaction && reply.reaction_message_id) {
    await setMessageReaction(client.telegram_chat_id as string, Number(reply.reaction_message_id), String(reply.reaction));
  }
  const sent = await sendTelegramMessage(client.telegram_chat_id as string, text);
  if (!sent.ok) {
    await db
      .from("pending_replies")
      .update({ status: "awaiting_approval", draft_text: reply.draft_text })
      .eq("id", id);
    return { ok: false, error: sent.error ?? "Telegram refused the message." };
  }

  await db.from("messages").insert({
    client_id: reply.client_id,
    conversation_id: reply.conversation_id,
    direction: "out",
    text,
    telegram_message_id: sent.messageId ?? null,
  });

  // Files that go with the message (campaign offers, price lists…).
  for (const file of ((reply.attachments as Attachment[] | null) ?? [])) {
    const sentFile = await sendTelegramFile(client.telegram_chat_id as string, file);
    if (sentFile.ok) {
      await db.from("messages").insert({
        client_id: reply.client_id,
        conversation_id: reply.conversation_id,
        direction: "out",
        text: `📎 ${file.name}`,
        telegram_message_id: sentFile.messageId ?? null,
      });
    } else {
      await notifyAdmin(`Не вдалося надіслати файл «${file.name}» клієнту ${client.business_name}: ${sentFile.error}`).catch(() => {});
    }
  }

  // Learn from it: what the team sent (or fixed) becomes a worked example.
  if (reply.reply_type === "order_flow") {
    const { data: last } = await db
      .from("messages")
      .select("text")
      .eq("client_id", reply.client_id)
      .eq("direction", "in")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (last?.text) {
      await recordExample(db, {
        clientMessage: String(last.text),
        reply: text,
        quality: opts?.text ? "written" : reply.edited ? "edited" : "approved",
      }).catch(() => {});
    }
  }

  refresh();
  return { ok: true, clientName: client.business_name as string };
}

export async function rejectPendingReply(id: string): Promise<ReplyResult> {
  const db = createSupabaseServerClient();
  const { data } = await db
    .from("pending_replies")
    .update({ status: "rejected" })
    .eq("id", id)
    .eq("status", "awaiting_approval")
    .select("client_id");
  if (!data?.length) return { ok: false, error: "Already handled.", alreadyHandled: true };

  const { data: client } = await db.from("clients").select("business_name").eq("id", data[0].client_id).maybeSingle();
  refresh();
  return { ok: true, clientName: (client?.business_name as string) ?? "" };
}
