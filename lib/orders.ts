import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { DEFAULT_ORDERING_RULES, PAYMENT_LABEL, deliveryFor, type OrderingRules, type PaymentMethod } from "@/lib/orderRules";
import { isTelegramConfigured, notifyAdmin } from "@/lib/telegram";
import type { OrderLine, PipelineStage } from "@/lib/types";

type Db = ReturnType<typeof createSupabaseServerClient>;

const NEXT_STAGE: Partial<Record<PipelineStage, PipelineStage>> = {
  new_lead: "first_order",
  cold: "first_order",
  warm: "first_order",
  menu_sent: "first_order",
  first_order: "recurring",
  dormant: "recurring",
};

// A client just ordered: stamp the order date, mark them active and move them
// one step up the funnel (first order → recurring). Used both when an order
// arrives through their personal link and when an admin attaches an order to a
// client by hand.
export async function markClientOrdered(db: Db, clientId: string, orderedAt: string = new Date().toISOString()) {
  const { data: row } = await db.from("clients").select("pipeline_stage").eq("id", clientId).maybeSingle();
  if (!row) return;
  const stage = row.pipeline_stage as PipelineStage;
  await db
    .from("clients")
    .update({ last_order_at: orderedAt, status: "active", pipeline_stage: NEXT_STAGE[stage] ?? stage })
    .eq("id", clientId);
}

// ---------------------------------------------------------------------------
// Pricing and validation shared by the website and the Telegram agent, so the
// two can never disagree about prices or minimums. Prices are always re-read
// from menu_items — callers only ever supply item ids and quantities.


export async function getOrderingRules(db: Db): Promise<OrderingRules> {
  const { data } = await db.from("site_content").select("content_json").eq("key", "ordering_rules").maybeSingle();
  const raw = (data?.content_json ?? {}) as Partial<Record<keyof OrderingRules, unknown>>;
  const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== null && v !== "" ? Number(v) : fallback);
  return {
    min_order_total: num(raw.min_order_total, DEFAULT_ORDERING_RULES.min_order_total),
    free_delivery_from: num(raw.free_delivery_from, DEFAULT_ORDERING_RULES.free_delivery_from),
    delivery_fee: num(raw.delivery_fee, DEFAULT_ORDERING_RULES.delivery_fee),
  };
}

export type PricedOrder =
  | { ok: true; lines: OrderLine[]; total: number; delivery_fee: number; grand_total: number; rules: OrderingRules }
  | { ok: false; error: "unavailable" | "minimums" | "min_total"; issues: string[] };

export async function priceOrderLines(db: Db, input: { item_id: string; qty: number }[]): Promise<PricedOrder> {
  const itemIds = input.map((l) => l.item_id);
  const [{ data: items }, { data: categories }, rules] = await Promise.all([
    db.from("menu_items").select("id, name_uk, price, category_id, min_order_override, is_active").in("id", itemIds),
    db.from("menu_categories").select("id, name_uk, min_order"),
    getOrderingRules(db),
  ]);

  const itemById = new Map((items ?? []).map((i) => [i.id as string, i]));
  const categoryById = new Map((categories ?? []).map((c) => [c.id as string, c]));

  const lines: OrderLine[] = [];
  const groupQty = new Map<string, number>();
  const issues: string[] = [];

  for (const l of input) {
    const item = itemById.get(l.item_id);
    const category = item ? categoryById.get(item.category_id as string) : undefined;
    if (!item || !category || !item.is_active) {
      return { ok: false, error: "unavailable", issues: ["Одна з позицій недоступна в меню."] };
    }

    const unit = Number(item.price);
    lines.push({
      item_id: item.id as string,
      name: item.name_uk as string,
      category: category.name_uk as string,
      qty: l.qty,
      unit_price: unit,
      subtotal: unit * l.qty,
    });

    if (item.min_order_override) {
      if (l.qty < item.min_order_override) issues.push(`${item.name_uk} — мінімум ${item.min_order_override} шт.`);
    } else {
      groupQty.set(category.id as string, (groupQty.get(category.id as string) ?? 0) + l.qty);
    }
  }
  for (const [categoryId, qty] of groupQty) {
    const category = categoryById.get(categoryId)!;
    if (qty < (category.min_order as number)) {
      issues.push(`${category.name_uk} — мінімум ${category.min_order} шт. у групі (зараз ${qty})`);
    }
  }
  if (issues.length > 0) return { ok: false, error: "minimums", issues };

  const total = lines.reduce((s, l) => s + l.subtotal, 0);
  if (total < rules.min_order_total) {
    return {
      ok: false,
      error: "min_total",
      issues: [`Мінімальна сума замовлення — ${rules.min_order_total.toLocaleString("uk-UA")} грн (зараз ${total} грн)`],
    };
  }
  const delivery_fee = deliveryFor(total, rules);
  return { ok: true, lines, total, delivery_fee, grand_total: total + delivery_fee, rules };
}

// What we remember about a client between orders. Saved after every order and
// whenever the client gives us new details.
export interface ClientProfile {
  venue_name?: string;
  fop?: string;
  delivery_address?: string;
  payment_method?: PaymentMethod;
  phone?: string;
}

export async function getClientProfile(db: Db, clientId: string): Promise<ClientProfile & { business_name?: string }> {
  const { data } = await db
    .from("clients")
    .select("business_name, fop, delivery_address, payment_method, phone")
    .eq("id", clientId)
    .maybeSingle();
  if (!data) return {};
  return {
    business_name: data.business_name as string,
    fop: (data.fop as string | null) ?? undefined,
    delivery_address: (data.delivery_address as string | null) ?? undefined,
    payment_method: (data.payment_method as PaymentMethod | null) ?? undefined,
    phone: (data.phone as string | null) ?? undefined,
  };
}

export async function saveClientProfile(db: Db, clientId: string, p: ClientProfile) {
  const patch: Record<string, string> = {};
  if (p.venue_name) patch.business_name = p.venue_name;
  if (p.fop) patch.fop = p.fop;
  if (p.delivery_address) patch.delivery_address = p.delivery_address;
  if (p.payment_method) patch.payment_method = p.payment_method;
  if (p.phone) patch.phone = p.phone;
  if (Object.keys(patch).length) await db.from("clients").update(patch).eq("id", clientId);
}

// The group alert for a freshly saved order, with its one-tap button. It always
// states who the order is for and how it's paid — including for repeat clients
// whose details were remembered rather than typed again.
export async function announceNewOrder(input: {
  orderId: string;
  origin: "сайту" | "чату";
  venueName: string;
  fop?: string;
  address?: string;
  paymentMethod?: PaymentMethod;
  phone?: string;
  total: number; // what the client pays, delivery included
  deliveryFee: number;
  summary: string;
  needsReview: boolean;
  note?: string;
}) {
  if (!isTelegramConfigured()) return;
  const base = process.env.SITE_URL?.replace(/\/$/, "");
  const status = input.needsReview ? "pending_review" : "new";
  await notifyAdmin(
    [
      `Нове замовлення з ${input.origin} · ${input.total} ₴${input.deliveryFee ? ` (з доставкою ${input.deliveryFee} ₴)` : " (доставка безкоштовна)"}`,
      `Назва: ${input.venueName}`,
      `ФОП: ${input.fop ?? "—"}`,
      `Адреса: ${input.address ?? "—"}`,
      `Оплата: ${input.paymentMethod ? PAYMENT_LABEL[input.paymentMethod] : "—"}`,
      input.phone ? `Телефон: ${input.phone}` : "",
      "",
      input.summary.length > 300 ? `${input.summary.slice(0, 297)}...` : input.summary,
      input.note,
      input.needsReview ? "Потребує перевірки: замовлення не прив'язане до жодного клієнта." : "",
    ]
      .filter((l): l is string => typeof l === "string")
      .join("\n")
      .replace(/\n{3,}/g, "\n\n"),
    {
      buttons: [
        [{ text: input.needsReview ? "👍 Перевірено" : "✅ Підтвердити", callback_data: `os:${input.orderId}:${status}` }],
        ...(base ? [[{ text: "Відкрити в дашборді", url: `${base}/` }]] : []),
      ],
    }
  );
}
