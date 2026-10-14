import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import {
  isStale,
  isSummarized,
  loadDraftFor,
  logAgentEvent,
  missingFields,
  placeChatOrder,
  saveDraftFor,
  type Approval,
  type OrderDraft,
} from "@/lib/chatOrders";
import { PAYMENT_LABEL } from "@/lib/orderRules";
import { announceNewOrder, getClientProfile, priceOrderLines, type ClientProfile } from "@/lib/orders";
import type { ToolContext } from "./tools";

// Taking an order in chat. The cart lives in the conversation (or, in the
// dashboard's practice chat, in a state object that round-trips through the
// browser). The agent never states prices itself: every figure it gives comes
// from review_order, which prices the cart from the live menu with exactly the
// same rules as the website — delivery fee included. Whether an order is
// really in the system is decided by code (lib/chatOrders.ts), not by what the
// agent says.

export const ORDER_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_menu",
    description:
      "The full current menu: categories (with their minimum order) and every item with its id, price in UAH, weight and promo. Use it to see what exists and to get item ids for the order. Optionally filter by a category name fragment.",
    input_schema: {
      type: "object",
      properties: { category: { type: "string", description: "Optional category name or part of it" } },
    },
  },
  {
    name: "update_order_draft",
    description:
      "Build or change the order being put together in this chat. `items` upserts by item id (qty 0 removes an item). Also saves the order details: venue_name (назва кав'ярні), fop, address, payment_method ('cash' or 'cashless'), phone, requested_date (YYYY-MM-DD), notes. For a returning client use use_saved_profile: true to fill venue/ФОП/address/payment/phone from what we remember, and repeat_last_order: true to start from their previous order. Any change requires showing the client a fresh summary again.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { item_id: { type: "string" }, qty: { type: "integer", minimum: 0 } },
            required: ["item_id", "qty"],
          },
        },
        venue_name: { type: "string", description: "Назва кав'ярні / закладу" },
        fop: { type: "string", description: "ФОП (the legal entity / payer)" },
        address: { type: "string", description: "Delivery address" },
        payment_method: { type: "string", enum: ["cash", "cashless"], description: "cash = готівка, cashless = безготівка" },
        phone: { type: "string", description: "Recipient's phone number (optional)" },
        requested_date: { type: "string", description: "Wanted delivery date, YYYY-MM-DD" },
        notes: { type: "string", description: "Comment for the bakery" },
        use_saved_profile: { type: "boolean", description: "Fill the details from what we remember about this client" },
        repeat_last_order: { type: "boolean", description: "Start the cart from this client's previous order" },
        edit_pending: {
          type: "boolean",
          description:
            "Set true ONLY when a summary was already shown and the client is now changing THAT order. If they are starting a different order, first place the pending one (place_order, approval 'continued') instead.",
        },
        clear: { type: "boolean", description: "Discard the whole draft (client changed their mind)" },
      },
    },
  },
  {
    name: "review_order",
    description:
      "Price and check the current draft against the menu and ordering rules. Returns the lines, the goods total, the delivery fee (free above the threshold), how much more is needed for free delivery, any rule problems (minimums), and what is still missing. The ONLY valid source for the order summary you show the client — and you MUST show it and get an explicit yes before place_order.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "place_order",
    description:
      "Put the order into the order system. Only after review_order was shown to the client AND the client then approved it in a later message: approval 'text' when they confirm in words, 'continued' when they moved on to something else without objecting to the summary. Fails otherwise — and if it fails the order is NOT placed: never tell the client it was accepted.",
    input_schema: {
      type: "object",
      properties: {
        client_confirmed: { type: "boolean", description: "true only if the client approved the summary (or moved on without objecting)" },
        approval: { type: "string", enum: ["text", "continued"] },
      },
      required: ["client_confirmed"],
    },
  },
  {
    name: "amend_last_order",
    description:
      "Change the client's most recent order that is already in the system — ONLY when the client explicitly asks to add to or change that earlier order. Otherwise a new message is a new order. `items` entries: mode 'add' (default) adds the quantity, 'set' sets it exactly (0 removes). Fails if the order is already confirmed by the team; then do not claim it was changed — request_human_review.",
    input_schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item_id: { type: "string" },
              qty: { type: "integer", minimum: 0 },
              mode: { type: "string", enum: ["add", "set"] },
            },
            required: ["item_id", "qty"],
          },
        },
        notes: { type: "string" },
        address: { type: "string" },
        requested_date: { type: "string", description: "YYYY-MM-DD" },
      },
    },
  },
];

const ORDER_TOOL_NAMES = new Set(ORDER_TOOLS.map((t) => t.name));
export const isOrderTool = (name: string) => ORDER_TOOL_NAMES.has(name);

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function loadDraft(ctx: ToolContext): Promise<OrderDraft> {
  const empty: OrderDraft = { lines: [] };
  if (ctx.dryRun) return (ctx.practiceState?.draft_order as OrderDraft | undefined) ?? empty;
  const draft = await loadDraftFor(ctx.supabase, ctx.conversationId);
  if (!draft) return empty;
  // A leftover from a previous day isn't an order in progress.
  if (isStale(draft)) {
    await saveDraftFor(ctx.supabase, ctx.conversationId, null);
    return empty;
  }
  return draft;
}

async function saveDraft(ctx: ToolContext, draft: OrderDraft | null) {
  if (ctx.dryRun) {
    if (ctx.practiceState) {
      if (draft) ctx.practiceState.draft_order = draft;
      else delete ctx.practiceState.draft_order;
    }
    return;
  }
  await saveDraftFor(ctx.supabase, ctx.conversationId, draft);
}

async function savedProfile(ctx: ToolContext): Promise<ClientProfile & { business_name?: string }> {
  if (ctx.dryRun) return (ctx.practiceState?.profile as ClientProfile | undefined) ?? {};
  return getClientProfile(ctx.supabase, ctx.client.id);
}

const trimmed = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) || undefined : undefined);

export async function runOrderTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  const { supabase, client } = ctx;

  switch (name) {
    case "get_menu": {
      const filter = String(args.category ?? "").trim().toLowerCase();
      const [{ data: categories }, { data: items }] = await Promise.all([
        supabase.from("menu_categories").select("id, name_uk, min_order, note_uk, sort_order").order("sort_order"),
        supabase.from("menu_items").select("id, category_id, name_uk, price, original_price, promo_label, weight, min_order_override, sort_order").eq("is_active", true).order("sort_order"),
      ]);
      const menu = (categories ?? [])
        .filter((c) => !filter || String(c.name_uk).toLowerCase().includes(filter))
        .map((c) => ({
          category: c.name_uk,
          min_order_in_category: c.min_order,
          note: c.note_uk,
          items: (items ?? [])
            .filter((i) => i.category_id === c.id)
            .map((i) => ({
              id: i.id,
              name: i.name_uk,
              price_uah: i.price,
              ...(i.original_price ? { was_uah: i.original_price } : {}),
              ...(i.promo_label ? { promo: i.promo_label } : {}),
              weight: i.weight,
              ...(i.min_order_override ? { own_min_order: i.min_order_override } : {}),
            })),
        }));
      return menu.length ? json(menu) : "No category matches that name.";
    }

    case "update_order_draft": {
      if (args.clear === true) {
        await saveDraft(ctx, null);
        return "Draft cleared.";
      }
      const draft = await loadDraft(ctx);

      // A summary was already shown and nobody has approved it yet. Adding items now
      // would silently merge a possibly different order into it — make the agent choose.
      const touchesItems = Array.isArray(args.items) && args.items.length > 0;
      if (isSummarized(draft) && touchesItems && args.edit_pending !== true) {
        return "Not changed: a summary of the current order was already shown to the client and is waiting for their approval. If the client is CHANGING that order, call update_order_draft again with edit_pending: true. If they are starting a different order and did not object to the summary, first call place_order (client_confirmed: true, approval: 'continued'), then start the new order. Never mix two orders.";
      }

      if (args.use_saved_profile === true) {
        const p = await savedProfile(ctx);
        draft.venue_name = p.venue_name ?? p.business_name ?? draft.venue_name;
        draft.fop = p.fop ?? draft.fop;
        draft.address = p.delivery_address ?? draft.address;
        draft.payment_method = p.payment_method ?? draft.payment_method;
        draft.phone = p.phone ?? draft.phone;
      }

      if (args.repeat_last_order === true) {
        if (ctx.dryRun) return "Practice mode: 'repeat last order' isn't simulated — add the items by hand.";
        const { data: last } = await supabase
          .from("orders")
          .select("item_details_uk")
          .eq("client_id", client.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const prev = ((last?.item_details_uk as { items?: { item_id?: string; name: string; qty: number }[] } | null)?.items ?? []);
        if (!prev.length) return "This client has no previous order to repeat.";
        const { data: menu } = await supabase.from("menu_items").select("id, name_uk, is_active");
        const byId = new Map((menu ?? []).map((m) => [m.id as string, m]));
        const byName = new Map((menu ?? []).map((m) => [String(m.name_uk), m]));
        const dropped: string[] = [];
        for (const l of prev) {
          const m = (l.item_id && byId.get(l.item_id)) || byName.get(l.name);
          if (!m || !m.is_active) {
            dropped.push(l.name);
            continue;
          }
          const existing = draft.lines.find((x) => x.item_id === m.id);
          if (existing) existing.qty = l.qty;
          else draft.lines.push({ item_id: m.id as string, name: m.name_uk as string, qty: l.qty });
        }
        if (dropped.length) args.__dropped = dropped;
      }

      const items = Array.isArray(args.items) ? (args.items as { item_id?: unknown; qty?: unknown }[]) : [];
      const wanted = items.filter((i) => typeof i.item_id === "string");
      if (wanted.length) {
        const { data: rows } = await supabase
          .from("menu_items")
          .select("id, name_uk, is_active")
          .in("id", wanted.map((i) => i.item_id as string));
        const known = new Map((rows ?? []).filter((r) => r.is_active).map((r) => [r.id as string, r.name_uk as string]));
        const unknown: string[] = [];
        for (const i of wanted) {
          const id = i.item_id as string;
          const qty = Math.max(0, Math.min(10000, Math.floor(Number(i.qty) || 0)));
          if (!known.has(id)) {
            unknown.push(id);
            continue;
          }
          const existing = draft.lines.find((l) => l.item_id === id);
          if (qty === 0) draft.lines = draft.lines.filter((l) => l.item_id !== id);
          else if (existing) existing.qty = qty;
          else draft.lines.push({ item_id: id, name: known.get(id)!, qty });
        }
        if (unknown.length) {
          return `Not saved — these ids are not on the menu: ${unknown.join(", ")}. Look the items up with get_menu or get_price first.`;
        }
      }

      if ("venue_name" in args) draft.venue_name = trimmed(args.venue_name, 120);
      if ("fop" in args) draft.fop = trimmed(args.fop, 200);
      if ("address" in args) draft.address = trimmed(args.address, 500);
      if ("phone" in args) draft.phone = trimmed(args.phone, 40);
      if ("notes" in args) draft.notes = trimmed(args.notes, 1000);
      if ("payment_method" in args) draft.payment_method = args.payment_method === "cash" || args.payment_method === "cashless" ? args.payment_method : undefined;
      if (typeof args.requested_date === "string") {
        const d = args.requested_date.trim();
        draft.requested_date = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : undefined;
      }
      // anything changed → the summary must be shown again and approved again
      draft.summary_at_inbound = undefined;
      draft.summary_message_id = undefined;
      draft.summary_sent_at = undefined;
      await saveDraft(ctx, draft);
      return json({
        saved: true,
        items_in_draft: draft.lines.length,
        ...(Array.isArray(args.__dropped) ? { no_longer_on_menu: args.__dropped } : {}),
        details: { venue_name: draft.venue_name ?? null, fop: draft.fop ?? null, address: draft.address ?? null, payment_method: draft.payment_method ? PAYMENT_LABEL[draft.payment_method] : null },
        missing: missingFields(draft),
        next: "Call review_order and show the client the summary.",
      });
    }

    case "review_order": {
      const draft = await loadDraft(ctx);
      const missing = missingFields(draft);
      if (draft.lines.length === 0) return json({ empty: true, missing });
      const priced = await priceOrderLines(supabase, draft.lines.map((l) => ({ item_id: l.item_id, qty: l.qty })));
      if (!priced.ok) return json({ lines: draft.lines.map((l) => ({ name: l.name, qty: l.qty })), problems: priced.issues, missing });

      const toFree = priced.delivery_fee > 0 ? priced.rules.free_delivery_from - priced.total : 0;
      // Told before how much was missing, the client added something, and it is still not enough.
      const stillShort = toFree > 0 && draft.shortfall_uah !== undefined && toFree < draft.shortfall_uah;
      draft.shortfall_uah = toFree > 0 ? toFree : undefined;
      ctx.flags.freeDeliveryShortfall = toFree > 0 ? toFree : undefined;
      ctx.flags.stillShortAfterAdding = stillShort;

      draft.summary_at_inbound = ctx.inboundCount;
      draft.summary_message_id = undefined;
      draft.summary_sent_at = undefined;
      await saveDraft(ctx, draft);
      // The reply that carries this summary is remembered once it is actually sent,
      // so a reaction to it can approve the order.
      if (missing.length === 0) ctx.flags.summaryShown = true;
      return json({
        lines: priced.lines.map((l) => ({ name: l.name, qty: l.qty, unit_price_uah: l.unit_price, subtotal_uah: l.subtotal })),
        goods_total_uah: priced.total,
        delivery_fee_uah: priced.delivery_fee,
        grand_total_uah: priced.grand_total,
        free_delivery_from_uah: priced.rules.free_delivery_from,
        ...(toFree > 0 ? { add_for_free_delivery_uah: toFree } : {}),
        ...(stillShort
          ? { still_short_after_adding: true, note: `The client was already told what was missing for free delivery and added something, but ${toFree} UAH is still missing. Say so warmly and plainly, with the exact number.` }
          : {}),
        details: {
          venue_name: draft.venue_name ?? null,
          fop: draft.fop ?? null,
          address: draft.address ?? null,
          payment: draft.payment_method ? PAYMENT_LABEL[draft.payment_method] : null,
          phone: draft.phone ?? null,
          requested_date: draft.requested_date ?? null,
          notes: draft.notes ?? null,
        },
        missing,
        ready_for_confirmation: missing.length === 0,
        next: missing.length
          ? "Ask the client for the missing details before asking them to confirm."
          : "Show this summary to the client and ask them to confirm. Place the order only after their next message confirms it.",
      });
    }

    case "place_order": {
      const NOT_ACCEPTED = " Do NOT tell the client the order is accepted — it is not in the system.";
      // The system already placed it this turn (the client's message was the approval).
      if (ctx.flags.placedBySystem) return "The order is already in the system — it was placed automatically when the client approved. Tell the client it is accepted and that a manager will confirm the details and date. Do not call place_order again.";
      if (args.client_confirmed !== true) return `Not placed: the client has not approved the summary.${NOT_ACCEPTED}`;
      const approval: Approval = args.approval === "continued" ? "continued" : "text";
      const draft = await loadDraft(ctx);
      const missing = missingFields(draft);
      if (missing.length) return `Not placed: still missing ${missing.join(", ")}. Ask the client for these, then review_order again.${NOT_ACCEPTED}`;
      if (!isSummarized(draft) || ctx.inboundCount <= (draft.summary_at_inbound ?? Infinity)) {
        return `Not placed: first show the client the summary from review_order and wait for their approval in a LATER message.${NOT_ACCEPTED}`;
      }

      if (ctx.dryRun) {
        const priced = await priceOrderLines(supabase, draft.lines.map((l) => ({ item_id: l.item_id, qty: l.qty })));
        if (!priced.ok) return `Not placed: ${priced.issues.join("; ")}${NOT_ACCEPTED}`;
        await saveDraft(ctx, null);
        const summary = priced.lines.map((l) => `${l.name} ×${l.qty}`).join(", ");
        return `Practice mode: the order would be in the system now (${summary}; goods ${priced.total} UAH + delivery ${priced.delivery_fee} UAH = ${priced.grand_total} UAH). Nothing was saved. Tell the client it's accepted and a manager will confirm details and date. The client's NEXT message is a new order unless they explicitly ask to change this one.`;
      }

      const res = await placeChatOrder(supabase, { client, conversationId: ctx.conversationId, draft, approval });
      if (!res.ok) {
        if (res.alreadyPlaced) return "This exact order is already in the system (placed a moment ago). You may tell the client it is accepted.";
        if (/database/.test(res.reason)) ctx.flags.humanReviewReasons.push("could not save the order from chat");
        return `Not placed: ${res.reason}.${NOT_ACCEPTED}`;
      }
      ctx.flags.orderPlaced = true;
      return `Order placed and visible to the team in the dashboard (${res.summary}; goods ${res.goods} UAH + delivery ${res.deliveryFee} UAH = ${res.grandTotal} UAH). Tell the client it's accepted and that a manager will confirm the details and delivery date. Do not promise a specific time. The client's NEXT message is a NEW order unless they explicitly ask to change this one (then use amend_last_order).`;
    }

    case "amend_last_order": {
      const NOT_CHANGED = " Do NOT tell the client the order was changed.";
      const wanted = (Array.isArray(args.items) ? args.items : []) as { item_id?: string; qty?: number; mode?: string }[];
      if (ctx.dryRun) {
        return `Practice mode: the client's previous order would be changed now (${wanted.length} item change(s)). Nothing was saved. Tell the client what you changed.`;
      }

      // "My last order" means the most recent one, whatever its state — never an older
      // order that happens to still be open.
      const { data: last } = await supabase
        .from("orders")
        .select("id, status, item_details_uk, due_date")
        .eq("client_id", client.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!last || !["new", "pending_review"].includes(String(last.status))) {
        return `Not changed: the client's latest order ${last ? "is already being handled by the team" : "does not exist"}.${NOT_CHANGED} Call request_human_review so a person handles the change, or — if the client just wants more — start a new order.`;
      }

      const details = (last.item_details_uk ?? {}) as Record<string, unknown> & {
        items?: { item_id?: string; name: string; qty: number }[];
      };
      const { data: menu } = await supabase.from("menu_items").select("id, name_uk");
      const idByName = new Map((menu ?? []).map((m) => [String(m.name_uk), m.id as string]));
      const qty = new Map<string, number>();
      for (const l of details.items ?? []) {
        const id = l.item_id ?? idByName.get(l.name);
        if (id) qty.set(id, (qty.get(id) ?? 0) + l.qty);
      }
      for (const w of wanted) {
        if (typeof w.item_id !== "string") continue;
        const n = Math.max(0, Math.min(10000, Math.floor(Number(w.qty) || 0)));
        const current = qty.get(w.item_id) ?? 0;
        qty.set(w.item_id, w.mode === "set" ? n : current + n);
      }
      const lines = [...qty.entries()].filter(([, n]) => n > 0).map(([item_id, n]) => ({ item_id, qty: n }));
      if (lines.length === 0) return `Not changed: the order would be empty.${NOT_CHANGED}`;
      const priced = await priceOrderLines(supabase, lines);
      if (!priced.ok) return `Not changed: ${priced.issues.join("; ")}.${NOT_CHANGED}`;

      const summary = priced.lines.map((l) => `${l.name} ×${l.qty}`).join(", ");
      const patch: Record<string, unknown> = {
        item_summary_uk: summary.length > 240 ? `${summary.slice(0, 237)}...` : summary,
        total_amount: priced.grand_total,
      };
      const newDetails: Record<string, unknown> = {
        ...details,
        items: priced.lines,
        delivery_fee: priced.delivery_fee,
        goods_total: priced.total,
        amended_at: new Date().toISOString(),
      };
      if (typeof args.notes === "string") newDetails.notes = args.notes.trim().slice(0, 1000);
      if (typeof args.address === "string" && args.address.trim()) newDetails.address = args.address.trim().slice(0, 500);
      if (typeof args.requested_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.requested_date.trim())) {
        newDetails.requested_date = args.requested_date.trim();
        patch.due_date = args.requested_date.trim();
      }
      patch.item_details_uk = newDetails;
      const { error } = await supabase.from("orders").update(patch).eq("id", last.id);
      if (error) {
        ctx.flags.humanReviewReasons.push("could not change the order from chat");
        return `Not changed: a technical error.${NOT_CHANGED}`;
      }

      ctx.flags.orderAmended = true;
      await logAgentEvent(supabase, client.id, "order_amended", { order_id: last.id, total: priced.grand_total });
      try {
        await announceNewOrder({
          orderId: last.id as string,
          origin: "чату",
          venueName: String(newDetails.venue_name ?? client.business_name),
          fop: newDetails.fop as string | undefined,
          address: newDetails.address as string | undefined,
          paymentMethod: newDetails.payment_method as "cash" | "cashless" | undefined,
          phone: newDetails.phone as string | undefined,
          total: priced.grand_total,
          deliveryFee: priced.delivery_fee,
          summary,
          needsReview: false,
          amended: true,
          approvalNote: "клієнт попросив змінити попереднє замовлення",
        });
      } catch (err) {
        console.error("amend alert failed", err);
      }
      return json({
        changed: true,
        lines: priced.lines.map((l) => ({ name: l.name, qty: l.qty, subtotal_uah: l.subtotal })),
        goods_total_uah: priced.total,
        delivery_fee_uah: priced.delivery_fee,
        grand_total_uah: priced.grand_total,
        next: "Tell the client the order was updated, using these numbers. The team has been notified.",
      });
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
