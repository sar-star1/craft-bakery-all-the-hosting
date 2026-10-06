"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { refTokenToClientId } from "@/lib/clientToken";
import { MIN_ORDER_TOTAL_UAH } from "@/lib/orderRules";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isTelegramConfigured, notifyAdmin } from "@/lib/telegram";
import type { OrderLine, PipelineStage } from "@/lib/types";


const orderSchema = z.object({
  ref: z.string().max(64).optional(),
  customer_name: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(5).max(40).regex(/^[+\d\s()-]+$/),
  email: z.string().trim().email().max(255),
  address: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(1000).optional(),
  lines: z
    .array(z.object({ item_id: z.string().uuid(), qty: z.number().int().min(1).max(10000) }))
    .min(1)
    .max(200),
});

export type SubmitOrderInput = z.input<typeof orderSchema>;
export type SubmitOrderResult = { ok: true } | { ok: false; error: string; issues?: string[] };

const NEXT_STAGE: Partial<Record<PipelineStage, PipelineStage>> = {
  new_lead: "first_order",
  cold: "first_order",
  warm: "first_order",
  menu_sent: "first_order",
  first_order: "recurring",
  dormant: "recurring",
};

// Prices are always re-read from menu_items here — the browser only ever
// sends item ids and quantities, never trusted amounts.
export async function submitWebsiteOrder(input: SubmitOrderInput): Promise<SubmitOrderResult> {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const data = parsed.data;

  if (!isSupabaseConfigured()) return { ok: false, error: "not_configured" };
  const supabase = createSupabaseServerClient();

  const itemIds = data.lines.map((l) => l.item_id);
  const [{ data: items }, { data: categories }] = await Promise.all([
    supabase.from("menu_items").select("id, name_uk, price, category_id, min_order_override, is_active").in("id", itemIds),
    supabase.from("menu_categories").select("id, name_uk, min_order"),
  ]);

  const itemById = new Map((items ?? []).map((i) => [i.id as string, i]));
  const categoryById = new Map((categories ?? []).map((c) => [c.id as string, c]));

  const lines: OrderLine[] = [];
  const groupQty = new Map<string, number>();
  const issues: string[] = [];

  for (const l of data.lines) {
    const item = itemById.get(l.item_id);
    const category = item ? categoryById.get(item.category_id as string) : undefined;
    if (!item || !category || !item.is_active) return { ok: false, error: "unavailable" };

    const unit = Number(item.price);
    lines.push({
      name: item.name_uk as string,
      category: category.name_uk as string,
      qty: l.qty,
      unit_price: unit,
      subtotal: unit * l.qty,
    });

    if (item.min_order_override) {
      if (l.qty < item.min_order_override) {
        issues.push(`${item.name_uk} — мінімум ${item.min_order_override} шт.`);
      }
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

  let clientId: string | null = null;
  let client: { pipeline_stage: PipelineStage } | null = null;
  const refClientId = refTokenToClientId(data.ref);
  if (refClientId) {
    const { data: row } = await supabase
      .from("clients")
      .select("id, pipeline_stage")
      .eq("id", refClientId)
      .maybeSingle();
    if (row) {
      clientId = row.id as string;
      client = { pipeline_stage: row.pipeline_stage as PipelineStage };
    }
  }

  // An order from a known client's personal link goes straight to "new";
  // one that can't be tied to a client waits for a human look.
  const needsReview = !clientId;

  const summary = lines.map((l) => `${l.name} ×${l.qty}`).join(", ");
  const { data: inserted, error } = await supabase
    .from("orders")
    .insert({
    client_id: clientId,
    source: "website_form",
    customer_name: data.customer_name,
    customer_contact: data.phone,
    item_summary_uk: summary.length > 240 ? `${summary.slice(0, 237)}...` : summary,
    item_details_uk: {
      notes: data.notes || undefined,
      items: lines,
      address: data.address,
      email: data.email,
      phone: data.phone,
    },
    status: needsReview ? "pending_review" : "new",
    deposit_status: "n/a",
    total_amount: total,
  })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, error: "save_failed" };

  // The order is saved. Everything below is bookkeeping and alerts: if any of it
  // fails, the customer must still see their order as accepted.
  try {
    if (clientId && client) {
      await supabase
        .from("clients")
        .update({
          last_order_at: new Date().toISOString(),
          status: "active",
          pipeline_stage: NEXT_STAGE[client.pipeline_stage] ?? client.pipeline_stage,
        })
        .eq("id", clientId);
    }

    if (isTelegramConfigured()) {
      const base = process.env.SITE_URL?.replace(/\/$/, "");
      const status = needsReview ? "pending_review" : "new";
      await notifyAdmin(
        [
          `Нове замовлення з сайту: ${data.customer_name} · ${total} ₴`,
          summary.length > 300 ? `${summary.slice(0, 297)}...` : summary,
          data.address,
          data.phone,
          needsReview ? "Потребує перевірки: замовлення не прив'язане до жодного клієнта." : "",
        ]
          .filter(Boolean)
          .join("\n"),
        {
          buttons: [
            [{ text: needsReview ? "👍 Перевірено" : "✅ Підтвердити", callback_data: `os:${inserted.id}:${status}` }],
            ...(base ? [[{ text: "Відкрити в дашборді", url: `${base}/` }]] : []),
          ],
        }
      );
    }

    revalidatePath("/");
    revalidatePath("/clients");
  } catch (err) {
    console.error("post-order side effects failed", err);
  }
  return { ok: true };
}
