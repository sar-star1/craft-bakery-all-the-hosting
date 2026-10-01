import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifyAdmin, sendTelegramMessage, sendTypingAction, startPayloadToClientId } from "@/lib/telegram";
import type { ClientSource, PipelineStage } from "@/lib/types";
import { AGENT_MODEL, getAnthropic, isAnthropicConfigured } from "./anthropic";
import { decideOrderFlowReply, type TurnFlags } from "./policy";
import { buildSystemPrompt } from "./prompt";
import { AGENT_TOOLS, runTool, type ToolContext } from "./tools";

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
}
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

type Db = ReturnType<typeof createSupabaseServerClient>;
interface ClientRow {
  id: string;
  business_name: string;
  contact_name: string | null;
  telegram_chat_id: string | null;
  status: string;
  pipeline_stage: PipelineStage;
  standing_order_notes: string | null;
}

const CLIENT_COLUMNS =
  "id, business_name, contact_name, telegram_chat_id, status, pipeline_stage, standing_order_notes";
const MAX_TOOL_ITERATIONS = 8;
const HISTORY_LIMIT = 30;

const dashboardLink = (path: string) => {
  const base = process.env.SITE_URL?.replace(/\/$/, "");
  return base ? `\n${base}${path}` : "";
};

export async function processTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const msg = update.message;
  // Only 1:1 chats with clients. The admin group and channels are ignored.
  if (!msg || msg.chat.type !== "private" || msg.from?.is_bot) return;

  try {
    const text = msg.text?.trim();
    if (!text) {
      await sendTelegramMessage(String(msg.chat.id), "Наразі я можу читати лише текстові повідомлення. Напишіть, будь ласка, текстом.");
      return;
    }
    if (text.startsWith("/start")) {
      await handleStart(msg, text.split(/\s+/)[1] ?? "");
    } else {
      await handleMessage(msg, text);
    }
  } catch (err) {
    console.error("processTelegramUpdate failed", err);
    await notifyAdmin(`Помилка обробки повідомлення в боті: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function displayName(msg: TelegramMessage) {
  const name = [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(" ");
  return { name, fallback: name || (msg.from?.username ? `@${msg.from.username}` : "Новий клієнт") };
}

async function createLead(db: Db, msg: TelegramMessage, source: ClientSource | null): Promise<ClientRow> {
  const { name, fallback } = displayName(msg);
  const { data, error } = await db
    .from("clients")
    .insert({
      business_name: fallback,
      contact_name: name || null,
      telegram_chat_id: String(msg.chat.id),
      status: "engaged",
      pipeline_stage: "new_lead",
      source,
      last_contact_at: new Date().toISOString(),
    })
    .select(CLIENT_COLUMNS)
    .single();
  if (error || !data) throw new Error(`Could not create client: ${error?.message}`);
  await notifyAdmin(`Новий лід у Telegram: ${fallback}${dashboardLink(`/clients/${data.id}`)}`);
  return data as ClientRow;
}

async function logOutgoing(db: Db, clientId: string, conversationId: string | null, text: string, messageId?: number) {
  await db.from("messages").insert({
    client_id: clientId,
    conversation_id: conversationId,
    direction: "out",
    text,
    telegram_message_id: messageId ?? null,
  });
}

// Fixed-template acknowledgement of a /start — no AI, sent directly (the
// approval gate covers the agent's own replies, not this greeting).
async function handleStart(msg: TelegramMessage, payload: string) {
  const db = createSupabaseServerClient();
  const chatId = String(msg.chat.id);

  let client: ClientRow | null = null;
  let isNew = false;

  const migrationId = startPayloadToClientId(payload);
  if (migrationId) {
    const { data } = await db.from("clients").select(CLIENT_COLUMNS).eq("id", migrationId).maybeSingle();
    if (data) {
      if (!data.telegram_chat_id) {
        await db
          .from("clients")
          .update({ telegram_chat_id: chatId, last_contact_at: new Date().toISOString() })
          .eq("id", data.id);
        await notifyAdmin(`Клієнт підключився до бота: ${data.business_name}${dashboardLink(`/clients/${data.id}`)}`);
        client = { ...(data as ClientRow), telegram_chat_id: chatId };
      } else if (data.telegram_chat_id === chatId) {
        client = data as ClientRow;
      } else {
        // The personal link was opened from a different Telegram account.
        await notifyAdmin(
          `Персональне посилання клієнта ${data.business_name} відкрили з іншого акаунта Telegram (${displayName(msg).fallback}). Прив'язку не змінено.`
        );
      }
    }
  }

  if (!client) {
    const { data: existing } = await db.from("clients").select(CLIENT_COLUMNS).eq("telegram_chat_id", chatId).maybeSingle();
    if (existing) {
      client = existing as ClientRow;
    } else {
      const source: ClientSource | null = payload === "ig" ? "instagram" : payload === "web" ? "website_form" : null;
      client = await createLead(db, msg, source);
      isNew = true;
    }
  }

  const who = client.contact_name ? `, ${client.contact_name}` : "";
  const greeting = isNew
    ? `Вітаю${who}! Це асистент Craft Bakery by Dubova. Розкажіть, будь ласка, про ваш заклад: як він називається і що плануєте замовляти?`
    : `Вітаю${who}! Це асистент Craft Bakery by Dubova. Пишіть сюди щодо замовлень — допоможу з меню, цінами та доставкою.`;
  const sent = await sendTelegramMessage(chatId, greeting);
  if (sent.ok) await logOutgoing(db, client.id, null, greeting, sent.messageId);
}

async function getOrCreateConversation(db: Db, clientId: string): Promise<{ id: string; captured_fields: Record<string, unknown> }> {
  const { data: latest } = await db
    .from("conversations")
    .select("id, status, captured_fields, last_message_at")
    .eq("client_id", clientId)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const recent =
    latest &&
    (latest.status === "gathering" || latest.status === "confirming") &&
    Date.now() - new Date(latest.last_message_at as string).getTime() < 30 * 24 * 3600 * 1000;
  if (recent) return { id: latest.id as string, captured_fields: (latest.captured_fields as Record<string, unknown>) ?? {} };

  const { data, error } = await db.from("conversations").insert({ client_id: clientId }).select("id, captured_fields").single();
  if (error || !data) throw new Error(`Could not create conversation: ${error?.message}`);
  return { id: data.id as string, captured_fields: (data.captured_fields as Record<string, unknown>) ?? {} };
}

async function handleMessage(msg: TelegramMessage, text: string) {
  const db = createSupabaseServerClient();
  const chatId = String(msg.chat.id);

  let { data: client } = await db.from("clients").select(CLIENT_COLUMNS).eq("telegram_chat_id", chatId).maybeSingle();
  if (!client) client = await createLead(db, msg, null);
  const clientRow = client as ClientRow;

  const conversation = await getOrCreateConversation(db, clientRow.id);

  const { error: dupError } = await db.from("messages").insert({
    client_id: clientRow.id,
    conversation_id: conversation.id,
    direction: "in",
    text,
    telegram_message_id: msg.message_id,
  });
  // Unique-violation = Telegram redelivered an update we've already handled.
  if (dupError?.code === "23505") return;
  if (dupError) throw new Error(dupError.message);

  const now = new Date().toISOString();
  await Promise.all([
    db.from("conversations").update({ last_message_at: now }).eq("id", conversation.id),
    db
      .from("clients")
      .update({ last_contact_at: now, ...(clientRow.status === "dormant" ? { status: "engaged" } : {}) })
      .eq("id", clientRow.id),
  ]);

  if (!isAnthropicConfigured()) {
    await notifyAdmin(
      `Повідомлення від ${clientRow.business_name}: «${text.slice(0, 300)}»\n(AI-агент не налаштовано — ANTHROPIC_API_KEY відсутній, відповідь не надіслано.)${dashboardLink(`/clients/${clientRow.id}`)}`
    );
    return;
  }

  await sendTypingAction(chatId);

  const flags: TurnFlags = {
    humanReviewReasons: [],
    massOrderFlagged: false,
    confirmationProposed: false,
    menuLinkSent: false,
  };
  const ctx: ToolContext = {
    supabase: db,
    client: { id: clientRow.id, business_name: clientRow.business_name, pipeline_stage: clientRow.pipeline_stage },
    conversationId: conversation.id,
    flags,
  };

  const reply = await runAgent(db, ctx, clientRow, conversation.captured_fields);

  if (!reply) {
    await notifyAdmin(
      `Агент не підготував відповідь для ${clientRow.business_name} (${flags.humanReviewReasons.join("; ") || "порожня відповідь"}). Останнє повідомлення: «${text.slice(0, 300)}»${dashboardLink(`/clients/${clientRow.id}`)}`
    );
    return;
  }

  const { count: openFlags } = await db
    .from("mass_order_flags")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientRow.id)
    .eq("resolved", false);

  const decision = decideOrderFlowReply({
    flags,
    hasOpenMassOrderFlag: (openFlags ?? 0) > 0,
    pipelineStage: ctx.client.pipeline_stage,
  });

  if (decision.mode === "gate") {
    await db.from("pending_replies").insert({
      client_id: clientRow.id,
      conversation_id: conversation.id,
      draft_text: reply,
      reply_type: "order_flow",
    });
    await notifyAdmin(
      `Чернетка відповіді для ${clientRow.business_name} (${decision.reason}):\n«${reply.slice(0, 500)}»${dashboardLink("/pending-replies")}`
    );
    return;
  }

  const sent = await sendTelegramMessage(chatId, reply);
  if (sent.ok) {
    await logOutgoing(db, clientRow.id, conversation.id, reply, sent.messageId);
  } else {
    await notifyAdmin(`Не вдалося надіслати відповідь ${clientRow.business_name}: ${sent.error}`);
  }
}

async function runAgent(
  db: Db,
  ctx: ToolContext,
  client: ClientRow,
  capturedFields: Record<string, unknown>
): Promise<string | null> {
  const { data: rows } = await db
    .from("messages")
    .select("direction, text")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);

  const messages: Anthropic.MessageParam[] = (rows ?? [])
    .reverse()
    .map((m) => ({ role: m.direction === "in" ? ("user" as const) : ("assistant" as const), content: m.text as string }));
  while (messages.length > 0 && messages[0].role !== "user") messages.shift();

  const system = buildSystemPrompt({ client, capturedFields });
  const anthropic = getAnthropic();

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const response = await anthropic.messages.create({
      model: AGENT_MODEL,
      max_tokens: 8000,
      system,
      tools: AGENT_TOOLS,
      messages,
    });

    if (response.stop_reason === "refusal") {
      ctx.flags.humanReviewReasons.push("model declined to answer");
      return null;
    }
    if (response.stop_reason === "max_tokens") {
      ctx.flags.humanReviewReasons.push("reply was cut off");
      return null;
    }

    if (response.stop_reason !== "tool_use") {
      const text = response.content
        .flatMap((b) => (b.type === "text" ? [b.text] : []))
        .join("\n")
        .trim();
      return text || null;
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      try {
        results.push({ type: "tool_result", tool_use_id: block.id, content: await runTool(block.name, block.input, ctx) });
      } catch (err) {
        results.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: results });
  }

  ctx.flags.humanReviewReasons.push("agent exceeded its tool-use limit");
  return null;
}
