import "server-only";
import { revalidatePath } from "next/cache";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { logAgentEvent } from "@/lib/chatOrders";
import { recordExample } from "@/lib/agent/memory";
import { deleteSentMessage, editSentMessage, notifyAdmin, sendTelegramMessage, type InlineButton } from "@/lib/telegram";

type Db = ReturnType<typeof createSupabaseServerClient>;
export type TakeoverResult = { ok: true } | { ok: false; error: string };

const siteBase = () => process.env.SITE_URL?.replace(/\/$/, "");

function refresh(clientId?: string) {
  try {
    revalidatePath("/clients");
    if (clientId) revalidatePath(`/clients/${clientId}`);
  } catch {
    // outside a request scope — pages are dynamic anyway
  }
}

// Takes the conversation over from the agent (or hands it back). While paused the agent
// still logs what the client writes, but never answers; every message is passed to the group.
export async function setAgentPaused(db: Db, clientId: string, paused: boolean, by = "дашборд"): Promise<TakeoverResult> {
  const { data, error } = await db
    .from("clients")
    .update({ agent_paused: paused, agent_paused_at: paused ? new Date().toISOString() : null })
    .eq("id", clientId)
    .select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Client not found." };
  await logAgentEvent(db, clientId, paused ? "takeover" : "handback", { by });
  refresh(clientId);
  return { ok: true };
}

// The last thing the client wrote — what a human reply is a reply to (for learning the house style).
async function lastClientMessage(db: Db, clientId: string): Promise<string | null> {
  const { data } = await db
    .from("messages")
    .select("text")
    .eq("client_id", clientId)
    .eq("direction", "in")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.text as string | undefined) ?? null;
}

// A message written by a person (dashboard composer, or a reply in the staff group).
// Sending one puts the agent on pause for this client: a person is now in the conversation.
export async function sendAsTeam(db: Db, clientId: string, rawText: string, by = "дашборд"): Promise<TakeoverResult> {
  const text = rawText.trim();
  if (!text) return { ok: false, error: "Empty message." };
  const { data: client } = await db.from("clients").select("id, telegram_chat_id, agent_paused").eq("id", clientId).maybeSingle();
  if (!client) return { ok: false, error: "Client not found." };
  if (!client.telegram_chat_id) return { ok: false, error: "This client has no linked Telegram chat yet." };

  const sent = await sendTelegramMessage(client.telegram_chat_id as string, text);
  if (!sent.ok) return { ok: false, error: sent.error ?? "Telegram refused the message." };

  const { data: conv } = await db
    .from("conversations")
    .select("id")
    .eq("client_id", clientId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prior = await lastClientMessage(db, clientId);
  await db.from("messages").insert({
    client_id: clientId,
    conversation_id: (conv?.id as string | undefined) ?? null,
    direction: "out",
    text,
    telegram_message_id: sent.messageId ?? null,
    sent_by: "team",
  });
  await db.from("clients").update({ last_contact_at: new Date().toISOString() }).eq("id", clientId);
  if (!client.agent_paused) await setAgentPaused(db, clientId, true, by);
  if (prior) await recordExample(db, { clientMessage: prior, reply: text, quality: "written" }).catch(() => {});
  refresh(clientId);
  return { ok: true };
}

// Fixes a message already delivered to the client. The corrected wording replaces the old
// one in the history the agent reads, and is kept as a worked example of how we want it said.
export async function editMessage(db: Db, messageId: string, rawText: string): Promise<TakeoverResult> {
  const text = rawText.trim();
  if (!text) return { ok: false, error: "Empty message." };
  const { data: msg } = await db
    .from("messages")
    .select("id, client_id, direction, text, telegram_message_id, deleted_at, created_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg || msg.direction !== "out") return { ok: false, error: "Message not found." };
  if (msg.deleted_at) return { ok: false, error: "This message was deleted." };
  if (!msg.telegram_message_id) return { ok: false, error: "Telegram has no record of this message, so it can't be edited." };
  const { data: client } = await db.from("clients").select("telegram_chat_id").eq("id", msg.client_id).maybeSingle();
  if (!client?.telegram_chat_id) return { ok: false, error: "This client has no linked Telegram chat." };

  const r = await editSentMessage(client.telegram_chat_id as string, Number(msg.telegram_message_id), text);
  if (!r.ok) return { ok: false, error: r.error ?? "Telegram refused the edit." };

  await db.from("messages").update({ text, edited_at: new Date().toISOString() }).eq("id", messageId);
  await logAgentEvent(db, msg.client_id as string, "message_edited", { before: String(msg.text).slice(0, 300), after: text.slice(0, 300) });

  // What the client had asked, so the corrected reply becomes a style example.
  const { data: before } = await db
    .from("messages")
    .select("text, created_at")
    .eq("client_id", msg.client_id)
    .eq("direction", "in")
    .lte("created_at", msg.created_at as string)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (before?.text) await recordExample(db, { clientMessage: String(before.text), reply: text, quality: "edited" }).catch(() => {});
  refresh(msg.client_id as string);
  return { ok: true };
}

// Removes a message from the client's chat (Telegram allows this for 48 hours after sending).
export async function deleteMessage(db: Db, messageId: string): Promise<TakeoverResult> {
  const { data: msg } = await db
    .from("messages")
    .select("id, client_id, direction, text, telegram_message_id, deleted_at")
    .eq("id", messageId)
    .maybeSingle();
  if (!msg || msg.direction !== "out") return { ok: false, error: "Message not found." };
  if (msg.deleted_at) return { ok: true };
  if (!msg.telegram_message_id) return { ok: false, error: "Telegram has no record of this message, so it can't be deleted." };
  const { data: client } = await db.from("clients").select("telegram_chat_id").eq("id", msg.client_id).maybeSingle();
  if (!client?.telegram_chat_id) return { ok: false, error: "This client has no linked Telegram chat." };

  const r = await deleteSentMessage(client.telegram_chat_id as string, Number(msg.telegram_message_id));
  if (!r.ok) return { ok: false, error: r.error ?? "Telegram refused to delete it." };

  await db.from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", messageId);
  await logAgentEvent(db, msg.client_id as string, "message_deleted", { text: String(msg.text).slice(0, 300) });
  refresh(msg.client_id as string);
  return { ok: true };
}

export const handBackButton = (clientId: string): InlineButton => ({ text: "🤖 Повернути агенту", callback_data: `ra:${clientId}` });

// Passes a client's message to the staff group while the team is in charge of the conversation.
// Replying to the relayed message in the group sends the reply to the client.
export async function relayToTeam(db: Db, input: { clientId: string; clientName: string; text: string }): Promise<void> {
  const base = siteBase();
  const buttons: InlineButton[][] = [[handBackButton(input.clientId)]];
  if (base) buttons.push([{ text: "Відкрити розмову", url: `${base}/clients/${input.clientId}` }]);
  const res = await notifyAdmin(
    `💬 ${input.clientName} (розмову веде команда, агент мовчить):\n«${input.text.slice(0, 1500)}»\n\n↩️ Відповідь на це повідомлення піде клієнту як є.`,
    { kind: "message", buttons }
  );
  if (res.ok && res.messageId) {
    await db.from("relayed_messages").insert({ admin_message_id: res.messageId, client_id: input.clientId });
  }
}

// Group-side entry point of "Перебрати розмову": pauses the agent and posts a message
// the team can reply to.
export async function announceTakeover(db: Db, clientId: string, by: string): Promise<void> {
  const { data: client } = await db.from("clients").select("business_name").eq("id", clientId).maybeSingle();
  const res = await setAgentPaused(db, clientId, true, by);
  if (!res.ok) return;
  const base = siteBase();
  const buttons: InlineButton[][] = [[handBackButton(clientId)]];
  if (base) buttons.push([{ text: "Відкрити розмову", url: `${base}/clients/${clientId}` }]);
  const sent = await notifyAdmin(
    `🙋 ${by} веде розмову з ${client?.business_name ?? "клієнтом"}. Агент мовчить.\n↩️ Відповідь на це повідомлення піде клієнту як є; нові повідомлення клієнта з'являтимуться тут.`,
    { kind: "message", buttons }
  );
  if (sent.ok && sent.messageId) await db.from("relayed_messages").insert({ admin_message_id: sent.messageId, client_id: clientId });
}
