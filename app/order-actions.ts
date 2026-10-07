"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { refTokenToClientId } from "@/lib/clientToken";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { announceNewOrder, markClientOrdered, priceOrderLines, saveClientProfile } from "@/lib/orders";

const orderSchema = z.object({
  ref: z.string().max(64).optional(),
  customer_name: z.string().trim().min(1).max(120), // назва кав'ярні
  fop: z.string().trim().min(2).max(200),
  payment_method: z.enum(["cash", "cashless"]),
  phone: z.string().trim().min(5).max(40).regex(/^[+\d\s()-]+$/),
  email: z.string().trim().email().max(255).optional().or(z.literal("")),
  address: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(1000).optional(),
  lines: z
    .array(z.object({ item_id: z.string().uuid(), qty: z.number().int().min(1).max(10000) }))
    .min(1)
    .max(200),
});

export type SubmitOrderInput = z.input<typeof orderSchema>;
export type SubmitOrderResult = { ok: true } | { ok: false; error: string; issues?: string[] };

// Prices are always re-read from menu_items here — the browser only ever
// sends item ids and quantities, never trusted amounts.
export async function submitWebsiteOrder(input: SubmitOrderInput): Promise<SubmitOrderResult> {
  const parsed = orderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const data = parsed.data;

  if (!isSupabaseConfigured()) return { ok: false, error: "not_configured" };
  const supabase = createSupabaseServerClient();

  const priced = await priceOrderLines(supabase, data.lines.map((l) => ({ item_id: l.item_id, qty: l.qty })));
  if (!priced.ok) return { ok: false, error: priced.error, issues: priced.issues };
  const { lines, total, delivery_fee, grand_total } = priced;

  let clientId: string | null = null;
  const refClientId = refTokenToClientId(data.ref);
  if (refClientId) {
    const { data: row } = await supabase
      .from("clients")
      .select("id")
      .eq("id", refClientId)
      .maybeSingle();
    if (row) {
      clientId = row.id as string;
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
      venue_name: data.customer_name,
      fop: data.fop,
      payment_method: data.payment_method,
      address: data.address,
      email: data.email || undefined,
      phone: data.phone,
      delivery_fee,
      goods_total: total,
      ref_received: Boolean(data.ref),
    },
    status: needsReview ? "pending_review" : "new",
    deposit_status: "n/a",
    total_amount: grand_total,
  })
    .select("id")
    .single();
  if (error || !inserted) return { ok: false, error: "save_failed" };

  // The order is saved. Everything below is bookkeeping and alerts: if any of it
  // fails, the customer must still see their order as accepted.
  try {
    if (clientId) {
      // Remember the details so the next order only needs a "still the same?".
      await saveClientProfile(supabase, clientId, {
        venue_name: data.customer_name,
        fop: data.fop,
        delivery_address: data.address,
        payment_method: data.payment_method,
        phone: data.phone,
      });
      await markClientOrdered(supabase, clientId);
    }

    await announceNewOrder({
      orderId: inserted.id as string,
      origin: "сайту",
      venueName: data.customer_name,
      fop: data.fop,
      address: data.address,
      paymentMethod: data.payment_method,
      phone: data.phone,
      total: grand_total,
      deliveryFee: delivery_fee,
      summary,
      needsReview,
    });

    revalidatePath("/");
    revalidatePath("/clients");
  } catch (err) {
    console.error("post-order side effects failed", err);
  }
  return { ok: true };
}
