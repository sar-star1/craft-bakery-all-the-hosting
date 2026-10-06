"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { createSeasonalOfferDrafts, type OfferSegment } from "@/lib/jobs";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { markClientOrdered } from "@/lib/orders";
import { rejectPendingReply as rejectReply, sendPendingReply } from "@/lib/replies";
import { getBotDeepLink } from "@/lib/telegram";
import {
  nextStatus,
  prevStatus,
  type DepositStatus,
  type OrderStatus,
  type PipelineStage,
} from "@/lib/types";

const MENU_PHOTOS_BUCKET = "menu-photos";

export interface CreateOrderState {
  error?: string;
}

export async function createOrder(
  _prevState: CreateOrderState,
  formData: FormData
): Promise<CreateOrderState> {
  await requireAdmin();
  const customerName = String(formData.get("customer_name") ?? "").trim();
  const customerContact = String(formData.get("customer_contact") ?? "").trim();
  const itemSummary = String(formData.get("item_summary_uk") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  const dueDate = String(formData.get("due_date") ?? "").trim();
  const depositStatus = String(formData.get("deposit_status") ?? "n/a") as DepositStatus;
  const totalRaw = String(formData.get("total_amount") ?? "").trim();

  if (!customerName || !itemSummary) {
    return { error: "formError" };
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("orders").insert({
    source: "manual",
    customer_name: customerName,
    customer_contact: customerContact || null,
    item_summary_uk: itemSummary,
    item_details_uk: notes ? { notes } : null,
    status: "new",
    deposit_status: depositStatus,
    total_amount: totalRaw ? Number(totalRaw) : null,
    due_date: dueDate || null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/");
  return {};
}

export async function advanceOrderStatus(id: string, currentStatus: OrderStatus) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("orders")
    .update({ status: nextStatus(currentStatus) })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export async function revertOrderStatus(id: string, currentStatus: OrderStatus) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("orders")
    .update({ status: prevStatus(currentStatus) })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/");
}

// Attaches an order that arrived without a personal link to a client, and
// moves that client up the funnel as if they had ordered through their link.
export async function linkOrderToClient(orderId: string, clientId: string) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { data: order } = await supabase
    .from("orders")
    .update({ client_id: clientId })
    .eq("id", orderId)
    .is("client_id", null)
    .select("created_at")
    .maybeSingle();
  if (!order) throw new Error("Order not found or already linked.");
  await markClientOrdered(supabase, clientId, order.created_at as string);
  revalidatePath("/");
  revalidatePath("/clients");
  revalidatePath(`/clients/${clientId}`);
}

export interface PendingReplyActionState {
  error?: string;
}

export async function approvePendingReply(id: string): Promise<PendingReplyActionState> {
  await requireAdmin();
  const result = await sendPendingReply(id);
  return result.ok ? {} : { error: result.error };
}

export async function rejectPendingReply(id: string): Promise<PendingReplyActionState> {
  await requireAdmin();
  const result = await rejectReply(id);
  return result.ok ? {} : { error: result.error };
}

export interface CreateClientState {
  error?: string;
  clientId?: string;
  deepLink?: string | null;
}

export async function createClient(
  _prevState: CreateClientState,
  formData: FormData
): Promise<CreateClientState> {
  await requireAdmin();
  const businessName = String(formData.get("business_name") ?? "").trim();
  const contactName = String(formData.get("contact_name") ?? "").trim();
  const standingOrderNotes = String(formData.get("standing_order_notes") ?? "").trim();

  if (!businessName) {
    return { error: "formError" };
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("clients")
    .insert({
      business_name: businessName,
      contact_name: contactName || null,
      standing_order_notes: standingOrderNotes || null,
      source: "manual_migration",
      status: "engaged",
      // Manual migration is for already-established relationships, not
      // cold leads — they start at the funnel stage they're actually at.
      pipeline_stage: "recurring",
    })
    .select("id")
    .single();

  if (error || !data) {
    return { error: error?.message ?? "Could not create client." };
  }

  revalidatePath("/clients");
  return { clientId: data.id, deepLink: getBotDeepLink(data.id) };
}

export async function updateClientPipelineStage(id: string, stage: PipelineStage) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("clients").update({ pipeline_stage: stage }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

export async function updateClientBlockerNote(id: string, note: string) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("clients")
    .update({ blocker_note: note.trim().slice(0, 500) || null })
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/clients");
  revalidatePath(`/clients/${id}`);
}

export interface SaveMenuItemState {
  error?: string;
}

// Handles both create and edit — presence of a hidden `id` field decides
// which. One source of truth (this table) for the storefront, the
// management screen, and the agent's pricing tool.
export async function saveMenuItem(
  _prevState: SaveMenuItemState,
  formData: FormData
): Promise<SaveMenuItemState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim() || null;
  const categoryId = String(formData.get("category_id") ?? "").trim();
  const nameUk = String(formData.get("name_uk") ?? "").trim();
  const nameEn = String(formData.get("name_en") ?? "").trim();
  const descriptionUk = String(formData.get("description_uk") ?? "").trim();
  const descriptionEn = String(formData.get("description_en") ?? "").trim();
  const priceRaw = String(formData.get("price") ?? "").trim();
  const originalPriceRaw = String(formData.get("original_price") ?? "").trim();
  const promoLabel = String(formData.get("promo_label") ?? "").trim();
  const weight = String(formData.get("weight") ?? "").trim();
  const storageNote = String(formData.get("storage_note") ?? "").trim();
  const badge = String(formData.get("badge") ?? "").trim();
  const freezable = formData.get("freezable") === "on";
  const minOrderOverrideRaw = String(formData.get("min_order_override") ?? "").trim();
  const isActive = formData.get("is_active") === "on";
  const photoFile = formData.get("photo") as File | null;
  const existingPhotoUrl = String(formData.get("existing_photo_url") ?? "").trim() || null;

  const price = Number(priceRaw);
  if (!nameUk || !categoryId || !priceRaw || Number.isNaN(price)) {
    return { error: "formError" };
  }

  const supabase = createSupabaseServerClient();

  let photoUrl = existingPhotoUrl;
  if (photoFile && photoFile.size > 0) {
    const ext = photoFile.name.split(".").pop() || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from(MENU_PHOTOS_BUCKET)
      .upload(path, photoFile, { contentType: photoFile.type });
    if (uploadError) return { error: uploadError.message };
    photoUrl = supabase.storage.from(MENU_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  const record = {
    category_id: categoryId,
    name_uk: nameUk,
    name_en: nameEn || null,
    description_uk: descriptionUk || null,
    description_en: descriptionEn || null,
    price,
    original_price: originalPriceRaw ? Number(originalPriceRaw) : null,
    promo_label: promoLabel || null,
    weight: weight || null,
    storage_note: storageNote || null,
    badge: badge || null,
    freezable,
    min_order_override: minOrderOverrideRaw ? Number(minOrderOverrideRaw) : null,
    photo_url: photoUrl,
    is_active: isActive,
  };

  const { error } = id
    ? await supabase.from("menu_items").update(record).eq("id", id)
    : await supabase.from("menu_items").insert(record);

  if (error) return { error: error.message };

  revalidatePath("/menu");
  return {};
}

export async function deleteMenuItem(id: string) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("menu_items").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/menu");
}

export interface SaveMenuCategoryState {
  error?: string;
}

export async function saveMenuCategory(
  _prevState: SaveMenuCategoryState,
  formData: FormData
): Promise<SaveMenuCategoryState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim() || null;
  const nameUk = String(formData.get("name_uk") ?? "").trim();
  const nameEn = String(formData.get("name_en") ?? "").trim();
  const minOrderRaw = String(formData.get("min_order") ?? "").trim();
  const noteUk = String(formData.get("note_uk") ?? "").trim();
  const noteEn = String(formData.get("note_en") ?? "").trim();

  const minOrder = Number(minOrderRaw);
  if (!nameUk || !minOrderRaw || Number.isNaN(minOrder)) {
    return { error: "formError" };
  }

  const supabase = createSupabaseServerClient();
  const record = {
    name_uk: nameUk,
    name_en: nameEn || null,
    min_order: minOrder,
    note_uk: noteUk || null,
    note_en: noteEn || null,
  };

  const { error } = id
    ? await supabase.from("menu_categories").update(record).eq("id", id)
    : await supabase.from("menu_categories").insert(record);

  if (error) return { error: error.message };

  revalidatePath("/menu");
  return {};
}

export async function deleteMenuCategory(id: string) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("menu_categories").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/menu");
}

export interface SaveSiteContentState {
  error?: string;
}

export async function saveSiteContent(
  _prevState: SaveSiteContentState,
  formData: FormData
): Promise<SaveSiteContentState> {
  await requireAdmin();
  const key = String(formData.get("key") ?? "").trim();
  const contentUk = String(formData.get("content_uk") ?? "").trim();
  const contentEn = String(formData.get("content_en") ?? "").trim();

  if (!key) return { error: "formError" };

  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("site_content")
    .upsert({ key, content_uk: contentUk || null, content_en: contentEn || null });

  if (error) return { error: error.message };
  revalidatePath("/menu");
  return {};
}

export async function deleteSiteContent(key: string) {
  await requireAdmin();
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("site_content").delete().eq("key", key);
  if (error) throw new Error(error.message);
  revalidatePath("/menu");
}

export interface SeasonalOfferState {
  error?: string;
  message?: string;
}

// Drafts one personalised message per client in the chosen segment into
// pending_replies (type seasonal_offer). Runs in the background so the
// request returns immediately; drafts appear as they finish.
export async function startSeasonalOffer(
  _prev: SeasonalOfferState,
  formData: FormData
): Promise<SeasonalOfferState> {
  await requireAdmin();
  const offer = String(formData.get("offer") ?? "").trim();
  const segment = String(formData.get("segment") ?? "all") as OfferSegment;
  if (!offer) return { error: "offerRequired" };
  if (!["all", "active", "dormant"].includes(segment)) return { error: "invalid" };

  after(async () => {
    try {
      await createSeasonalOfferDrafts(offer, segment);
    } catch (err) {
      console.error("seasonal offer failed", err);
    }
  });
  revalidatePath("/pending-replies");
  return { message: "started" };
}
