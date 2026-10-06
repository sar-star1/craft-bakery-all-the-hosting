import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { announceNewOrder, markClientOrdered, priceOrderLines } from "@/lib/orders";
import type { ToolContext } from "./tools";

// Taking an order in chat. The cart lives in the conversation (or, in the
// dashboard's practice chat, in a state object that round-trips through the
// browser). The agent never states prices itself: every figure it gives comes
// from review_order, which prices the cart from the live menu with exactly the
// same rules as the website.

interface DraftLine {
  item_id: string;
  name: string;
  qty: number;
}
interface OrderDraft {
  lines: DraftLine[];
  address?: string;
  phone?: string;
  requested_date?: string;
  notes?: string;
  // How many client messages existed when the summary was last shown. An order
  // can only be placed after a LATER client message (their confirmation).
  summary_at_inbound?: number;
}

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
      "Build or change the order being put together in this chat. `items` upserts by item id (qty 0 removes an item); address, phone, requested_date (YYYY-MM-DD) and notes are saved as given. Any change requires showing the client a fresh summary again. Item ids come from get_menu or get_price.",
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
        address: { type: "string", description: "Delivery address" },
        phone: { type: "string", description: "Recipient's phone number" },
        requested_date: { type: "string", description: "Wanted delivery date, YYYY-MM-DD" },
        notes: { type: "string", description: "Comment for the bakery" },
        clear: { type: "boolean", description: "Discard the whole draft (client changed their mind)" },
      },
    },
  },
  {
    name: "review_order",
    description:
      "Price and check the current draft against the menu and ordering rules. Returns the lines, the total, any rule problems (minimums), and what is still missing. The ONLY valid source for the order summary you show the client — and you MUST show it and get an explicit yes before place_order.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "place_order",
    description:
      "Place the order. Only after review_order was shown to the client AND the client then explicitly confirmed it in a later message. Fails otherwise.",
    input_schema: {
      type: "object",
      properties: { client_confirmed: { type: "boolean", description: "true only if the client explicitly confirmed the summary" } },
      required: ["client_confirmed"],
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
  if (ctx.dryRun) return ((ctx.practiceState?.draft_order as OrderDraft | undefined) ?? empty);
  const { data } = await ctx.supabase.from("conversations").select("captured_fields").eq("id", ctx.conversationId).maybeSingle();
  return ((data?.captured_fields as Record<string, unknown> | null)?.draft_order as OrderDraft | undefined) ?? empty;
}

async function saveDraft(ctx: ToolContext, draft: OrderDraft | null) {
  if (ctx.dryRun) {
    if (ctx.practiceState) {
      if (draft) ctx.practiceState.draft_order = draft;
      else delete ctx.practiceState.draft_order;
    }
    return;
  }
  const { data } = await ctx.supabase.from("conversations").select("captured_fields").eq("id", ctx.conversationId).maybeSingle();
  const fields = { ...((data?.captured_fields as Record<string, unknown> | null) ?? {}) };
  if (draft) fields.draft_order = draft;
  else delete fields.draft_order;
  await ctx.supabase.from("conversations").update({ captured_fields: fields }).eq("id", ctx.conversationId);
}

function missingFields(draft: OrderDraft): string[] {
  const missing: string[] = [];
  if (draft.lines.length === 0) missing.push("items");
  if (!draft.address) missing.push("delivery address");
  if (!draft.phone) missing.push("recipient phone");
  return missing;
}

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
      if (typeof args.address === "string") draft.address = args.address.trim().slice(0, 500) || undefined;
      if (typeof args.phone === "string") draft.phone = args.phone.trim().slice(0, 40) || undefined;
      if (typeof args.notes === "string") draft.notes = args.notes.trim().slice(0, 1000) || undefined;
      if (typeof args.requested_date === "string") {
        const d = args.requested_date.trim();
        draft.requested_date = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : undefined;
      }
      draft.summary_at_inbound = undefined; // anything changed → must be re-shown and re-confirmed
      await saveDraft(ctx, draft);
      return json({ saved: true, items_in_draft: draft.lines.length, missing: missingFields(draft), next: "Call review_order and show the client the summary." });
    }

    case "review_order": {
      const draft = await loadDraft(ctx);
      const missing = missingFields(draft);
      if (draft.lines.length === 0) return json({ empty: true, missing });
      const priced = await priceOrderLines(supabase, draft.lines.map((l) => ({ item_id: l.item_id, qty: l.qty })));
      if (!priced.ok) return json({ lines: draft.lines.map((l) => ({ name: l.name, qty: l.qty })), problems: priced.issues, missing });

      draft.summary_at_inbound = ctx.inboundCount;
      await saveDraft(ctx, draft);
      return json({
        lines: priced.lines.map((l) => ({ name: l.name, qty: l.qty, unit_price_uah: l.unit_price, subtotal_uah: l.subtotal })),
        total_uah: priced.total,
        delivery: { address: draft.address ?? null, phone: draft.phone ?? null, requested_date: draft.requested_date ?? null, notes: draft.notes ?? null },
        missing,
        ready_for_confirmation: missing.length === 0,
        next: missing.length
          ? "Ask the client for the missing details before asking them to confirm."
          : "Show this summary to the client and ask them to confirm. Place the order only after their next message confirms it.",
      });
    }

    case "place_order": {
      if (args.client_confirmed !== true) return "Not placed: the client has not confirmed.";
      const draft = await loadDraft(ctx);
      const missing = missingFields(draft);
      if (missing.length) return `Not placed: still missing ${missing.join(", ")}.`;
      if (draft.summary_at_inbound === undefined || ctx.inboundCount <= draft.summary_at_inbound) {
        return "Not placed: first show the client the summary from review_order and wait for their confirmation in their NEXT message.";
      }
      const priced = await priceOrderLines(supabase, draft.lines.map((l) => ({ item_id: l.item_id, qty: l.qty })));
      if (!priced.ok) return `Not placed: ${priced.issues.join("; ")}`;

      const summary = priced.lines.map((l) => `${l.name} ×${l.qty}`).join(", ");
      if (ctx.dryRun) {
        await saveDraft(ctx, null);
        return `Practice mode: the order would be placed now (${summary}, ${priced.total} UAH). Nothing was saved. Tell the client it's accepted and a manager will confirm details and date.`;
      }

      // Guard against a double-send: same client, same total and items, last 15 minutes.
      const since = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from("orders")
        .select("id")
        .eq("client_id", client.id)
        .eq("total_amount", priced.total)
        .eq("item_summary_uk", summary.length > 240 ? `${summary.slice(0, 237)}...` : summary)
        .gte("created_at", since)
        .limit(1);
      if (recent?.length) {
        await saveDraft(ctx, null);
        return "This exact order was already placed a moment ago. Tell the client it's already accepted.";
      }

      const dueDate =
        draft.requested_date && draft.requested_date >= new Date().toISOString().slice(0, 10) ? draft.requested_date : null;
      const { data: inserted, error } = await supabase
        .from("orders")
        .insert({
          client_id: client.id,
          source: "telegram",
          customer_name: client.business_name,
          customer_contact: draft.phone,
          item_summary_uk: summary.length > 240 ? `${summary.slice(0, 237)}...` : summary,
          item_details_uk: {
            notes: draft.notes,
            items: priced.lines,
            address: draft.address,
            phone: draft.phone,
            requested_date: draft.requested_date,
          },
          status: "new",
          deposit_status: "n/a",
          total_amount: priced.total,
          due_date: dueDate,
        })
        .select("id")
        .single();
      if (error || !inserted) {
        ctx.flags.humanReviewReasons.push("could not save the order from chat");
        return "Not placed: a technical error. Tell the client you'll pass it to the team right away.";
      }

      await saveDraft(ctx, null);
      try {
        await markClientOrdered(supabase, client.id);
        await announceNewOrder({
          orderId: inserted.id as string,
          origin: "чату",
          customerName: client.business_name,
          total: priced.total,
          summary,
          address: draft.address,
          phone: draft.phone,
          needsReview: false,
          note: draft.requested_date ? `Бажана дата: ${draft.requested_date}` : undefined,
        });
      } catch (err) {
        console.error("post-order side effects failed", err);
      }
      return `Order placed (${summary}, ${priced.total} UAH). Tell the client it's accepted and that a manager will confirm the details and delivery date. Do not promise a specific time.`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
