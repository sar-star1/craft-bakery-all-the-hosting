import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { PAYMENT_LABEL, type PaymentMethod } from "@/lib/orderRules";
import {
  announceNewOrder,
  getOrderingRules,
  markClientOrdered,
  priceOrderLines,
  saveClientProfile,
} from "@/lib/orders";
import { sendTelegramMessage } from "@/lib/telegram";

type Db = ReturnType<typeof createSupabaseServerClient>;

// ---------------------------------------------------------------------------
// The order lifecycle for Telegram orders, owned by code (not by the model):
//
//   collecting → summary shown to the client → APPROVED → order in the dashboard
//
// A summary counts as approved when the client (a) confirms in words, (b) puts
// a positive reaction on the summary message, (c) carries on with something
// else without objecting, or (d) says nothing for `auto_confirm_minutes`
// (Telegram doesn't tell a bot whether a message was read, so silence after a
// delay stands in for "read, no objection"). After approval the draft is gone:
// the next message starts a NEW order unless the client explicitly asks to
// change the previous one.

export interface DraftLine {
  item_id: string;
  name: string;
  qty: number;
}
export interface OrderDraft {
  lines: DraftLine[];
  venue_name?: string; // назва кав'ярні
  fop?: string;
  address?: string;
  payment_method?: PaymentMethod;
  phone?: string;
  requested_date?: string;
  notes?: string;
  updated_at?: string;
  // Client-message count when the summary was composed; an order can only be
  // approved by something that comes AFTER it.
  summary_at_inbound?: number;
  summary_message_id?: number; // the Telegram message holding the summary (what a 👍 approves)
  summary_sent_at?: string;
}

export type Approval = "text" | "reaction" | "continued" | "implicit" | "safety";
export const APPROVAL_LABEL: Record<Approval, string> = {
  text: "клієнт підтвердив текстом",
  reaction: "клієнт поставив реакцію на підсумок",
  continued: "клієнт перейшов до іншого, не заперечуючи",
  implicit: "неявне: клієнт не відповів на підсумок",
  safety: "клієнт підтвердив (виправлено автоматично)",
};

export const STALE_DRAFT_HOURS = 12;

export function missingFields(draft: OrderDraft): string[] {
  const missing: string[] = [];
  if (draft.lines.length === 0) missing.push("items");
  if (!draft.venue_name) missing.push("venue name (назва кав'ярні)");
  if (!draft.fop) missing.push("ФОП");
  if (!draft.address) missing.push("delivery address");
  if (!draft.payment_method) missing.push("payment method (cash / cashless)");
  return missing;
}

export const isSummarized = (d: OrderDraft) => d.summary_at_inbound !== undefined;

// A draft nobody has touched for half a day is a leftover, not an order in progress.
export function isStale(d: OrderDraft, now = Date.now()): boolean {
  if (!d.updated_at) return false;
  return now - Date.parse(d.updated_at) > STALE_DRAFT_HOURS * 3600 * 1000;
}

export async function loadDraftFor(db: Db, conversationId: string): Promise<OrderDraft | null> {
  const { data } = await db.from("conversations").select("captured_fields").eq("id", conversationId).maybeSingle();
  const draft = ((data?.captured_fields as Record<string, unknown> | null)?.draft_order as OrderDraft | undefined) ?? null;
  return draft;
}

export async function saveDraftFor(db: Db, conversationId: string, draft: OrderDraft | null) {
  const { data } = await db.from("conversations").select("captured_fields").eq("id", conversationId).maybeSingle();
  const fields = { ...((data?.captured_fields as Record<string, unknown> | null) ?? {}) };
  if (draft) fields.draft_order = { ...draft, updated_at: new Date().toISOString() };
  else delete fields.draft_order;
  await db.from("conversations").update({ captured_fields: fields }).eq("id", conversationId);
}

// Remember which Telegram message carries the summary, so a reaction to it can approve the order.
export async function markSummarySent(db: Db, conversationId: string, messageId: number | undefined) {
  const draft = await loadDraftFor(db, conversationId);
  if (!draft || !isSummarized(draft)) return;
  draft.summary_message_id = messageId;
  draft.summary_sent_at = new Date().toISOString();
  await saveDraftFor(db, conversationId, draft);
}

export async function logAgentEvent(db: Db, clientId: string | null, kind: string, detail: Record<string, unknown>) {
  try {
    await db.from("agent_events").insert({ client_id: clientId, kind, detail });
  } catch {
    // logging must never break a conversation
  }
}

export type PlaceResult =
  | { ok: true; orderId: string; summary: string; goods: number; deliveryFee: number; grandTotal: number }
  | { ok: false; reason: string; alreadyPlaced?: boolean };

// Puts the draft into the order system (the dashboard's Замовлення board) and
// tells the staff group. Shared by the agent's tool, the reaction handler, the
// silence sweeper and the safety net, so there is exactly one way to place an order.
export async function placeChatOrder(
  db: Db,
  input: { client: { id: string; business_name: string }; conversationId: string; draft: OrderDraft; approval: Approval }
): Promise<PlaceResult> {
  const { client, draft, approval } = input;
  const missing = missingFields(draft);
  if (missing.length) return { ok: false, reason: `still missing ${missing.join(", ")}` };

  const priced = await priceOrderLines(db, draft.lines.map((l) => ({ item_id: l.item_id, qty: l.qty })));
  if (!priced.ok) return { ok: false, reason: priced.issues.join("; ") };

  const summary = priced.lines.map((l) => `${l.name} ×${l.qty}`).join(", ");
  const summaryShort = summary.length > 240 ? `${summary.slice(0, 237)}...` : summary;

  // Same cart, same client, last 15 minutes: it's a repeat of the same approval.
  const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const { data: recent } = await db
    .from("orders")
    .select("id")
    .eq("client_id", client.id)
    .eq("total_amount", priced.grand_total)
    .eq("item_summary_uk", summaryShort)
    .gte("created_at", since)
    .limit(1);
  if (recent?.length) {
    await saveDraftFor(db, input.conversationId, null);
    return { ok: false, reason: "already placed", alreadyPlaced: true };
  }

  const dueDate =
    draft.requested_date && draft.requested_date >= new Date().toISOString().slice(0, 10) ? draft.requested_date : null;
  const { data: inserted, error } = await db
    .from("orders")
    .insert({
      client_id: client.id,
      source: "telegram",
      customer_name: draft.venue_name,
      customer_contact: draft.phone ?? null,
      item_summary_uk: summaryShort,
      item_details_uk: {
        notes: draft.notes,
        items: priced.lines,
        venue_name: draft.venue_name,
        fop: draft.fop,
        address: draft.address,
        payment_method: draft.payment_method,
        phone: draft.phone,
        requested_date: draft.requested_date,
        delivery_fee: priced.delivery_fee,
        goods_total: priced.total,
        approval,
      },
      status: "new",
      deposit_status: "n/a",
      total_amount: priced.grand_total,
      due_date: dueDate,
    })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, reason: "database error while saving the order" };

  await saveDraftFor(db, input.conversationId, null);
  try {
    await saveClientProfile(db, client.id, {
      venue_name: draft.venue_name,
      fop: draft.fop,
      delivery_address: draft.address,
      payment_method: draft.payment_method,
      phone: draft.phone,
    });
    await markClientOrdered(db, client.id);
    await announceNewOrder({
      orderId: inserted.id as string,
      origin: "чату",
      venueName: draft.venue_name!,
      fop: draft.fop,
      address: draft.address,
      paymentMethod: draft.payment_method,
      phone: draft.phone,
      total: priced.grand_total,
      deliveryFee: priced.delivery_fee,
      summary,
      needsReview: false,
      note: draft.requested_date ? `Бажана дата: ${draft.requested_date}` : undefined,
      approvalNote: APPROVAL_LABEL[approval],
    });
  } catch (err) {
    console.error("post-order side effects failed", err);
  }
  await logAgentEvent(db, client.id, "order_placed", { order_id: inserted.id, approval, total: priced.grand_total });
  return { ok: true, orderId: inserted.id as string, summary, goods: priced.total, deliveryFee: priced.delivery_fee, grandTotal: priced.grand_total };
}

// ---- approval by reaction ---------------------------------------------------

const NEGATIVE_REACTIONS = new Set(["👎", "🤬", "😡", "🤮", "💩", "😢", "😭", "😱", "🖕", "🤡"]);

export function isApprovingReaction(emojis: string[]): boolean {
  return emojis.length > 0 && emojis.some((e) => !NEGATIVE_REACTIONS.has(e));
}

const ACK_TEXT = "Прийнято ✅ Менеджер підтвердить деталі та дату. Якщо щось змінити — напишіть.";

// A client put a reaction on a message. If it's on the order summary and it's a
// positive one, that is the approval: place the order and acknowledge it.
export async function handleReactionApproval(
  db: Db,
  input: { chatId: string; messageId: number; emojis: string[] }
): Promise<boolean> {
  if (!isApprovingReaction(input.emojis)) return false;
  const { data: client } = await db
    .from("clients")
    .select("id, business_name")
    .eq("telegram_chat_id", input.chatId)
    .maybeSingle();
  if (!client) return false;
  const { data: convos } = await db
    .from("conversations")
    .select("id, captured_fields")
    .eq("client_id", client.id)
    .order("last_message_at", { ascending: false })
    .limit(3);
  for (const c of convos ?? []) {
    const draft = (c.captured_fields as Record<string, unknown> | null)?.draft_order as OrderDraft | undefined;
    if (!draft || draft.summary_message_id !== input.messageId) continue;
    const placed = await placeChatOrder(db, {
      client: { id: client.id as string, business_name: client.business_name as string },
      conversationId: c.id as string,
      draft,
      approval: "reaction",
    });
    await logAgentEvent(db, client.id as string, "reaction_approval", { emojis: input.emojis, placed: placed.ok, reason: placed.ok ? null : placed.reason });
    if (placed.ok) {
      const sent = await sendTelegramMessage(input.chatId, ACK_TEXT);
      if (sent.ok) await db.from("messages").insert({ client_id: client.id, conversation_id: c.id, direction: "out", text: ACK_TEXT, telegram_message_id: sent.messageId ?? null });
    }
    return placed.ok;
  }
  return false;
}

// ---- approval by silence ----------------------------------------------------

// Places every order whose summary was sent more than `auto_confirm_minutes`
// ago and which the client hasn't touched since. Runs opportunistically (any
// incoming Telegram update, a dashboard visit) and from the daily cron.
export async function sweepPendingOrders(db: Db, opts: { excludeClientId?: string } = {}): Promise<number> {
  const rules = await getOrderingRules(db);
  if (!rules.auto_confirm_minutes) return 0;
  const cutoff = Date.now() - rules.auto_confirm_minutes * 60 * 1000;

  const { data: convos } = await db
    .from("conversations")
    .select("id, client_id, captured_fields")
    .order("last_message_at", { ascending: false })
    .limit(200);

  let placed = 0;
  for (const c of convos ?? []) {
    const draft = (c.captured_fields as Record<string, unknown> | null)?.draft_order as OrderDraft | undefined;
    if (!draft || !draft.summary_sent_at || !c.client_id) continue;
    if (opts.excludeClientId && c.client_id === opts.excludeClientId) continue;
    if (Date.parse(draft.summary_sent_at) > cutoff) continue;

    // Did the client write anything after the summary? Then the agent is handling it.
    const { count } = await db
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("client_id", c.client_id)
      .eq("direction", "in")
      .gt("created_at", draft.summary_sent_at);
    if ((count ?? 0) > 0) continue;

    const { data: client } = await db.from("clients").select("id, business_name, telegram_chat_id").eq("id", c.client_id).maybeSingle();
    if (!client) continue;
    const result = await placeChatOrder(db, {
      client: { id: client.id as string, business_name: client.business_name as string },
      conversationId: c.id as string,
      draft,
      approval: "implicit",
    });
    if (result.ok) {
      placed++;
      if (client.telegram_chat_id) {
        const text = "Оформили ваше замовлення за підсумком вище ✅ Менеджер підтвердить деталі та дату. Якщо щось змінити — напишіть.";
        const sent = await sendTelegramMessage(client.telegram_chat_id as string, text);
        if (sent.ok) await db.from("messages").insert({ client_id: client.id, conversation_id: c.id, direction: "out", text, telegram_message_id: sent.messageId ?? null });
      }
    }
  }
  return placed;
}

export { PAYMENT_LABEL };
