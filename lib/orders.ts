import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { MIN_ORDER_TOTAL_UAH } from "@/lib/orderRules";
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


export type PricedOrder =
  | { ok: true; lines: OrderLine[]; total: number }
  | { ok: false; error: "unavailable" | "minimums" | "min_total"; issues: string[] };

export async function priceOrderLines(db: Db, input: { item_id: string; qty: number }[]): Promise<PricedOrder> {
  const itemIds = input.map((l) => l.item_id);
  const [{ data: items }, { data: categories }] = await Promise.all([
    db.from("menu_items").select("id, name_uk, price, category_id, min_order_override, is_active").in("id", itemIds),
    db.from("menu_categories").select("id, name_uk, min_order"),
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
  if (total < MIN_ORDER_TOTAL_UAH) {
    return {
      ok: false,
      error: "min_total",
      issues: [`Мінімальна сума замовлення — ${MIN_ORDER_TOTAL_UAH.toLocaleString("uk-UA")} грн (зараз ${total} грн)`],
    };
  }
  return { ok: true, lines, total };
}

// The group alert for a freshly saved order, with its one-tap button.
export async function announceNewOrder(input: {
  orderId: string;
  origin: "сайту" | "чату";
  customerName: string;
  total: number;
  summary: string;
  address?: string;
  phone?: string;
  needsReview: boolean;
  note?: string;
}) {
  if (!isTelegramConfigured()) return;
  const base = process.env.SITE_URL?.replace(/\/$/, "");
  const status = input.needsReview ? "pending_review" : "new";
  await notifyAdmin(
    [
      `Нове замовлення з ${input.origin}: ${input.customerName} · ${input.total} ₴`,
      input.summary.length > 300 ? `${input.summary.slice(0, 297)}...` : input.summary,
      input.address,
      input.phone,
      input.note,
      input.needsReview ? "Потребує перевірки: замовлення не прив'язане до жодного клієнта." : "",
    ]
      .filter(Boolean)
      .join("\n"),
    {
      buttons: [
        [{ text: input.needsReview ? "👍 Перевірено" : "✅ Підтвердити", callback_data: `os:${input.orderId}:${status}` }],
        ...(base ? [[{ text: "Відкрити в дашборді", url: `${base}/` }]] : []),
      ],
    }
  );
}
