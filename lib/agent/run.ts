import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { announceDraft } from "@/lib/adminAlerts";
import { handleAdminUpdate } from "@/lib/adminBot";
import {
  handleReactionApproval,
  isStale,
  isSummarized,
  loadDraftFor,
  logAgentEvent,
  markSummarySent,
  noteSummaryShown,
  missingFields,
  placeChatOrder,
  saveDraftFor,
  sweepPendingOrders,
} from "@/lib/chatOrders";
import { relayToTeam } from "@/lib/takeover";
import { approveSummaryByMessage } from "@/lib/orderApproval";
import { buildOrderState, lastChatOrderAt, type OrderStateInput } from "./orderState";
import { notifyAdmin, sendTelegramMessage, sendTypingAction, setMessageReaction, startPayloadToClientId } from "@/lib/telegram";
import type { ClientSource, PipelineStage } from "@/lib/types";
import { AGENT_MODEL, getAnthropic, isAnthropicConfigured } from "./anthropic";
import { getOrderingRules } from "@/lib/orders";
import { buildHistory, type HistoryRow } from "./history";
import { withClientLock } from "./lock";
import { getActiveGuidelines } from "./guidelines";
import { PAYMENT_LABEL } from "@/lib/orderRules";
import { getExamples } from "./memory";
import { claimsOrderAccepted, claimsOrderChanged, fallbackReaction, promisesFollowUp, replyProblem, sanitizeReply } from "./postprocess";
import { decideOrderFlowReply, type TurnFlags } from "./policy";
import { buildSystemPrompt } from "./prompt";
import { AGENT_TOOLS, runTool, type ToolContext } from "./tools";

export interface TelegramMessage {
  message_id: number;
  text?: string;
  chat: { id: number; type: string };
  from?: { id: number; is_bot?: boolean; first_name?: string; last_name?: string; username?: string };
  reply_to_message?: { message_id: number; text?: string };
  // Set when the message was written inside a forum topic of the staff group.
  message_thread_id?: number;
}
export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  // A client put (or removed) a reaction on a message. Needs "message_reaction" in allowed_updates.
  message_reaction?: {
    chat: { id: number; type: string };
    message_id: number;
    new_reaction?: { type: string; emoji?: string }[];
  };
  callback_query?: {
    id: string;
    from?: TelegramMessage["from"];
    message?: TelegramMessage;
    data?: string;
  };
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
  blocker_note: string | null;
  lead_temperature: "cold" | "warm" | null;
  fop: string | null;
  delivery_address: string | null;
  payment_method: "cash" | "cashless" | null;
  agent_paused: boolean | null;
}

const CLIENT_COLUMNS =
  "id, business_name, contact_name, telegram_chat_id, status, pipeline_stage, standing_order_notes, blocker_note, lead_temperature, fop, delivery_address, payment_method, agent_paused";
const MAX_TOOL_ITERATIONS = 8;
const HISTORY_LIMIT = 30;

const dashboardLink = (path: string) => {
  const base = process.env.SITE_URL?.replace(/\/$/, "");
  return base ? `\n${base}${path}` : "";
};

export async function processTelegramUpdate(update: TelegramUpdate): Promise<void> {
  // The admin group (button presses, replies to drafts) is handled separately.
  if (await handleAdminUpdate(update).catch((err) => {
    console.error("handleAdminUpdate failed", err);
    return true;
  })) {
    return;
  }

  // A reaction on one of our messages: a positive one on an order summary approves the order.
  const reaction = update.message_reaction;
  if (reaction && reaction.chat.type === "private") {
    try {
      const db = createSupabaseServerClient();
      await handleReactionApproval(db, {
        chatId: String(reaction.chat.id),
        messageId: reaction.message_id,
        emojis: (reaction.new_reaction ?? []).flatMap((r) => (r.type === "emoji" && r.emoji ? [r.emoji] : [])),
      });
      await sweepPendingOrders(db);
    } catch (err) {
      console.error("reaction handling failed", err);
    }
    return;
  }

  const msg = update.message;
  // /chatid in any group replies with that group's id — how the admin group's
  // TELEGRAM_ADMIN_GROUP_ID is found without touching the Bot API by hand.
  if (msg && msg.chat.type !== "private" && /^\/chatid(@\w+)?(\s|$)/.test(msg.text ?? "")) {
    await sendTelegramMessage(String(msg.chat.id), `ID цього чату: ${msg.chat.id}`);
    return;
  }

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

async function createLead(
  db: Db,
  msg: TelegramMessage,
  source: ClientSource | null,
  stage: "new_lead" | "in_conversation" = "new_lead"
): Promise<ClientRow> {
  const { name, fallback } = displayName(msg);
  const { data, error } = await db
    .from("clients")
    .insert({
      business_name: fallback,
      contact_name: name || null,
      telegram_chat_id: String(msg.chat.id),
      status: "engaged",
      pipeline_stage: stage,
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
    sent_by: "agent",
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
    ? `Вітаю${who}! Це асистент Peremoga Bakery — дуже приємно познайомитися. Розкажіть, будь ласка, про ваш заклад: як він називається і що плануєте замовляти? З радістю допоможемо з меню, цінами та доставкою.`
    : `Вітаю${who}! Це асистент Peremoga Bakery, раді вас бачити. Пишіть сюди щодо замовлень — допоможемо з меню, цінами та доставкою.`;
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
  if (!client) client = await createLead(db, msg, null, "in_conversation");
  const clientRow = client as ClientRow;

  const conversation = await getOrCreateConversation(db, clientRow.id);

  // Housekeeping before the agent looks at anything: other clients' summaries that were
  // never answered are placed now, and a leftover draft from an earlier day is dropped
  // (it would otherwise be mixed into whatever this client asks for next).
  await sweepPendingOrders(db, { excludeClientId: clientRow.id }).catch((err) => console.error("sweep failed", err));
  const leftover = (conversation.captured_fields as { draft_order?: Parameters<typeof isStale>[0] }).draft_order;
  if (leftover && isStale(leftover)) {
    await saveDraftFor(db, conversation.id, null);
    delete (conversation.captured_fields as Record<string, unknown>).draft_order;
  }

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
      .update({
        last_contact_at: now,
        ...(clientRow.status === "dormant" ? { status: "engaged" } : {}),
        // Writing after /start (or after going quiet) means a conversation is under way.
        ...(clientRow.pipeline_stage === "new_lead" || clientRow.pipeline_stage === "dormant" ? { pipeline_stage: "in_conversation" } : {}),
      })
      .eq("id", clientRow.id),
  ]);

  // Clients often send two or three short texts in a row. Wait until they have been quiet for
  // reply_delay_seconds; only the LAST message's run goes on and answers all of them at once.
  if (!clientRow.agent_paused) {
    const envDelay = process.env.AGENT_REPLY_DELAY_SECONDS;
    const delay = envDelay !== undefined ? Number(envDelay) : (await getOrderingRules(db)).reply_delay_seconds;
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay * 1000));
      const { count: newer } = await db
        .from("messages")
        .select("id", { count: "exact", head: true })
        .eq("client_id", clientRow.id)
        .eq("direction", "in")
        .gt("telegram_message_id", msg.message_id);
      if ((newer ?? 0) > 0) return;
    }
  }

  // One run per client at a time: a second quick message waits for the first reply.
  await withClientLock(db, clientRow.id, () => respondToMessage(db, msg, text, chatId, clientRow.id));
}

// The part of handling a message that talks to the AI. Runs under the client's lock,
// so the client record and conversation are re-read here: the run that held the lock
// before us may have placed an order or changed the draft.
async function respondToMessage(db: Db, msg: TelegramMessage, text: string, chatId: string, clientId: string) {
  const { data: freshClient } = await db.from("clients").select(CLIENT_COLUMNS).eq("id", clientId).single();
  const clientRow = freshClient as ClientRow;
  const conversation = await getOrCreateConversation(db, clientRow.id);

  // The team has taken over this client: nothing is answered here, the message is passed to the group.
  if (clientRow.agent_paused) {
    await relayToTeam(db, { clientId: clientRow.id, clientName: clientRow.business_name, text });
    await logAgentEvent(db, clientRow.id, "paused_skip", { text: text.slice(0, 200) });
    return;
  }

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
  const { count: inboundCount } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientRow.id)
    .eq("direction", "in");
  const ctx: ToolContext = {
    supabase: db,
    client: { id: clientRow.id, business_name: clientRow.business_name, pipeline_stage: clientRow.pipeline_stage },
    conversationId: conversation.id,
    flags,
    inboundCount: inboundCount ?? 1,
  };

  // A complete summary is waiting for the client's answer. Whatever this message is — thanks, "ok",
  // a thumbs-up, "good", or simply moving on to something else — it approves the order, and the
  // order is placed here, BEFORE the agent answers. Only a message that changes the summary or
  // objects to it is left to the agent.
  let justPlaced: OrderStateInput["justPlaced"] = null;
  let changing = false;
  // Everything the client wrote since our last message (a burst of texts is judged as a whole).
  const { data: lastOut } = await db
    .from("messages")
    .select("created_at")
    .eq("client_id", clientRow.id)
    .eq("direction", "out")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: unanswered } = await (lastOut?.created_at
    ? db.from("messages").select("text").eq("client_id", clientRow.id).eq("direction", "in").gt("created_at", lastOut.created_at as string).order("created_at", { ascending: true }).limit(10)
    : db.from("messages").select("text").eq("client_id", clientRow.id).eq("direction", "in").order("created_at", { ascending: true }).limit(10));
  const unansweredText = (unanswered ?? []).map((m) => String(m.text)).join("\n").trim() || text;
  try {
    const approval = await approveSummaryByMessage(db, {
      client: { id: clientRow.id, business_name: clientRow.business_name },
      conversationId: conversation.id,
      text: unansweredText,
      inboundCount: ctx.inboundCount,
    });
    if (approval?.verdict === "change") changing = true;
    if (approval?.placed) {
      flags.orderPlaced = true;
      flags.placedBySystem = true;
      const { data: placedOrder } = await db
        .from("orders")
        .select("item_summary_uk, total_amount")
        .eq("client_id", clientRow.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      justPlaced = {
        summary: String(placedOrder?.item_summary_uk ?? ""),
        total: placedOrder?.total_amount ? Number(placedOrder.total_amount) : undefined,
        mode: approval.verdict === "ack" ? "ack" : "more",
      };
    }
  } catch (err) {
    // never let the approval step block the reply: the agent and the safety net still run
    console.error("approval step failed", err);
  }

  const rawReply = await runAgent(db, ctx, clientRow, conversation.captured_fields, { telegramMessageId: msg.message_id, text }, { justPlaced, changing });

  if (!rawReply) {
    await notifyAdmin(
      `Агент не підготував відповідь для ${clientRow.business_name} (${flags.humanReviewReasons.join("; ") || "порожня відповідь"}). Останнє повідомлення: «${text.slice(0, 300)}»${dashboardLink(`/clients/${clientRow.id}`)}`
    );
    return;
  }

  // Fix what the model got wrong before anyone sees it.
  const clean = sanitizeReply(rawReply);
  const reply = clean.text || rawReply;
  if (clean.reaction && !flags.reaction) flags.reaction = clean.reaction;
  if (!flags.reaction) {
    const fallback = fallbackReaction(text);
    if (fallback) flags.reaction = fallback;
  }

  // "Прийнято ✅" must mean the order really is in the system. If the agent says it but
  // never placed one, place it now when the client has in fact approved a complete
  // summary — otherwise hold the reply for a person instead of telling the client a lie.
  if (claimsOrderAccepted(reply) && !flags.orderPlaced && !flags.orderAmended) {
    const draft = await loadDraftFor(db, conversation.id);
    if (draft && isSummarized(draft) && missingFields(draft).length === 0 && ctx.inboundCount > (draft.summary_at_inbound ?? Infinity)) {
      const placed = await placeChatOrder(db, {
        client: { id: clientRow.id, business_name: clientRow.business_name },
        conversationId: conversation.id,
        draft,
        approval: "safety",
      });
      if (placed.ok || placed.alreadyPlaced) flags.orderPlaced = true;
      await logAgentEvent(db, clientRow.id, "safety_net", { action: "placed_for_agent", ok: placed.ok, reason: placed.ok ? null : placed.reason });
    }
    if (!flags.orderPlaced) {
      flags.humanReviewReasons.push("агент написав, що замовлення прийнято, але в системі його немає");
      await logAgentEvent(db, clientRow.id, "safety_net", { action: "held_unbacked_claim" });
    }
  }

  // A summary the agent wrote without review_order still counts as shown (see noteSummaryShown).
  if (!flags.summaryShown && (await noteSummaryShown(db, conversation.id, reply, ctx.inboundCount).catch(() => false))) {
    flags.summaryShown = true;
    await logAgentEvent(db, clientRow.id, "safety_net", { action: "summary_recorded_without_review_order" });
  }

  // "Додали до замовлення" must mean the order really was changed.
  if (claimsOrderChanged(reply) && !flags.orderAmended && !flags.orderPlaced && !(flags.toolsUsed ?? []).includes("update_order_draft")) {
    flags.humanReviewReasons.push("агент написав, що змінив замовлення, але в системі зміни немає");
    await logAgentEvent(db, clientRow.id, "safety_net", { action: "held_unbacked_change" });
  }

  // Still promising to "clarify" without having asked anyone (the model was already told once):
  // ask for real, so the promise is never empty.
  if (promisesFollowUp(reply) && flags.humanReviewReasons.length === 0 && !flags.orderPlaced && !flags.orderAmended) {
    flags.humanReviewReasons.push("агент пообіцяв клієнту уточнити, тож питання передано команді");
    flags.teamQuestion = `Клієнт написав: «${text.slice(0, 300)}». Агент пообіцяв уточнити — потрібна відповідь команди.`;
    await logAgentEvent(db, clientRow.id, "safety_net", { action: "promise_without_flag" });
  }

  const { count: openFlags } = await db
    .from("mass_order_flags")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientRow.id)
    .eq("resolved", false);

  // An order was just placed: the client is no longer a lead, so the confirmation is routine.
  if (flags.orderPlaced) {
    const { data: fresh } = await db.from("clients").select("pipeline_stage").eq("id", clientRow.id).maybeSingle();
    if (fresh?.pipeline_stage) ctx.client.pipeline_stage = fresh.pipeline_stage as PipelineStage;
  }

  const decision = decideOrderFlowReply({
    flags,
    hasOpenMassOrderFlag: (openFlags ?? 0) > 0,
    pipelineStage: ctx.client.pipeline_stage,
  });

  if (decision.mode === "gate") {
    const { data: draft } = await db
      .from("pending_replies")
      .insert({
        client_id: clientRow.id,
        conversation_id: conversation.id,
        draft_text: reply,
        reply_type: "order_flow",
        reaction: flags.reaction ?? null,
        reaction_message_id: flags.reaction ? msg.message_id : null,
        shows_summary: Boolean(flags.summaryShown),
        team_question: flags.humanReviewReasons.length > 0 ? flags.teamQuestion ?? flags.humanReviewReasons.join("; ") : null,
      })
      .select("id")
      .single();
    if (draft) {
      await announceDraft(db, {
        question: flags.humanReviewReasons.length > 0 ? flags.teamQuestion ?? flags.humanReviewReasons.join("; ") : undefined,
        id: draft.id as string,
        clientId: clientRow.id,
        clientName: clientRow.business_name,
        replyType: "order_flow",
        text: reply,
        clientMessage: text,
        reason: decision.reason,
      });
    }
    await logAgentEvent(db, clientRow.id, "turn", turnDetail(flags, { gated: true, reason: decision.reason }));
    return;
  }

  if (flags.reaction) {
    const r = await setMessageReaction(chatId, msg.message_id, flags.reaction);
    await logAgentEvent(db, clientRow.id, "reaction", { emoji: flags.reaction, ok: r.ok, error: r.error ?? null, via: "auto_sent" });
    if (!r.ok) await notifyAdmin(`Не вдалося поставити реакцію ${flags.reaction} клієнту ${clientRow.business_name}: ${r.error}`);
  }
  const sent = await sendTelegramMessage(chatId, reply);
  await logAgentEvent(db, clientRow.id, "turn", turnDetail(flags, { gated: false, sent: sent.ok }));
  if (sent.ok) {
    await logOutgoing(db, clientRow.id, conversation.id, reply, sent.messageId);
    if (flags.summaryShown && sent.messageId) await markSummarySent(db, conversation.id, sent.messageId);
  } else {
    await notifyAdmin(`Не вдалося надіслати відповідь ${clientRow.business_name}: ${sent.error}`);
  }
}

function turnDetail(flags: TurnFlags, extra: Record<string, unknown>) {
  return {
    tools: flags.toolsUsed ?? [],
    reaction: flags.reaction ?? null,
    summary_shown: Boolean(flags.summaryShown),
    order_placed: Boolean(flags.orderPlaced),
    order_amended: Boolean(flags.orderAmended),
    review_reasons: flags.humanReviewReasons,
    ...extra,
  };
}

async function runAgent(
  db: Db,
  ctx: ToolContext,
  client: ClientRow,
  capturedFields: Record<string, unknown>,
  current: { telegramMessageId: number; text: string },
  state: { justPlaced: OrderStateInput["justPlaced"]; changing: boolean }
): Promise<string | null> {
  const [{ data: rows }, orderCutoff] = await Promise.all([
    db
      .from("messages")
      .select("direction, text, created_at, telegram_message_id, deleted_at")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
    lastChatOrderAt(db, client.id),
  ]);

  // Everything said before the last order from this chat belongs to a conversation that is
  // finished (its summary, the confirmation, the back-and-forth). Showing it to the model is what
  // made it ask again about orders that were already placed — the order state below replaces it.
  // The message being answered is always kept.
  const visible = ((rows ?? []) as (HistoryRow & { deleted_at?: string | null })[]).filter(
    (r) =>
      !r.deleted_at &&
      (!orderCutoff || r.telegram_message_id === current.telegramMessageId || Date.parse(r.created_at) >= Date.parse(orderCutoff))
  );
  // The message being answered goes last, whatever order the replies were stored in.
  const messages: Anthropic.MessageParam[] = buildHistory(visible, current);

  const [guidelines, examples, { count: ordersCount }, orderState] = await Promise.all([
    getActiveGuidelines(db),
    getExamples(db),
    db.from("orders").select("id", { count: "exact", head: true }).eq("client_id", client.id),
    buildOrderState(db, { clientId: client.id, conversationId: ctx.conversationId, justPlaced: state.justPlaced, changing: state.changing }),
  ]);
  const system = buildSystemPrompt({
    client,
    capturedFields,
    guidelines,
    examples,
    ordersCount: ordersCount ?? 0,
    profile: {
      venue_name: client.business_name,
      fop: client.fop ?? undefined,
      address: client.delivery_address ?? undefined,
      payment: client.payment_method ? PAYMENT_LABEL[client.payment_method] : undefined,
    },
    orderState,
  });
  return runAgentLoop(system, messages, ctx);
}

// The tool-use loop, shared by real conversations and the dashboard's practice
// chat (which passes a dry-run ToolContext).
export async function runAgentLoop(
  system: string,
  messages: Anthropic.MessageParam[],
  ctx: ToolContext
): Promise<string | null> {
  const anthropic = getAnthropic();
  let corrected = false;

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
      // The reply is checked once; if it breaks a rule the model gets one chance to fix it.
      const problem = text && !corrected ? replyProblem(text, ctx.flags) : null;
      if (problem) {
        corrected = true;
        messages.push({ role: "assistant", content: response.content });
        messages.push({ role: "user", content: problem });
        continue;
      }
      return text || null;
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      (ctx.flags.toolsUsed ??= []).push(block.name);
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
