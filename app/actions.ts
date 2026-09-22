"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBotDeepLink, sendTelegramMessage } from "@/lib/telegram";
import {
  nextStatus,
  prevStatus,
  type DepositStatus,
  type OrderCategory,
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
  const category = String(formData.get("category") ?? "") as OrderCategory;
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
    category,
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
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("orders")
    .update({ status: nextStatus(currentStatus) })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export async function revertOrderStatus(id: string, currentStatus: OrderStatus) {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("orders")
    .update({ status: prevStatus(currentStatus) })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/");
}

export interface PendingReplyActionState {
  error?: string;
}

// Approving IS sending: this calls the Telegram bot's sendMessage right
// away, then flips status straight to 'approved_sent' — there's no
// separate "approved but not yet delivered" state (see schema.sql).
export async function approvePendingReply(id: string): Promise<PendingReplyActionState> {
  const supabase = createSupabaseServerClient();

  const { data: reply, error: fetchError } = await supabase
    .from("pending_replies")
    .select("id, draft_text, client_id")
    .eq("id", id)
    .single();

  if (fetchError || !reply) {
    return { error: fetchError?.message ?? "Draft not found." };
  }

  const { data: client, error: clientError } = await supabase
    .from("clients")
    .select("telegram_chat_id")
    .eq("id", reply.client_id)
    .single();

  if (clientError || !client?.telegram_chat_id) {
    return { error: "This client has no linked Telegram chat yet." };
  }

  const sendResult = await sendTelegramMessage(client.telegram_chat_id, reply.draft_text);
  if (!sendResult.ok) {
    return { error: sendResult.error };
  }

  const { error: updateError } = await supabase
    .from("pending_replies")
    .update({ status: "approved_sent" })
    .eq("id", id);

  if (updateError) return { error: updateError.message };

  revalidatePath("/clients");
  revalidatePath("/pending-replies");
  return {};
}

export async function rejectPendingReply(id: string): Promise<PendingReplyActionState> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("pending_replies")
    .update({ status: "rejected" })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/clients");
  revalidatePath("/pending-replies");
  return {};
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
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("clients").update({ pipeline_stage: stage }).eq("id", id);
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
  const id = String(formData.get("id") ?? "").trim() || null;
  const category = String(formData.get("category") ?? "b2b") as OrderCategory;
  const nameUk = String(formData.get("name_uk") ?? "").trim();
  const nameEn = String(formData.get("name_en") ?? "").trim();
  const descriptionUk = String(formData.get("description_uk") ?? "").trim();
  const descriptionEn = String(formData.get("description_en") ?? "").trim();
  const priceRaw = String(formData.get("price") ?? "").trim();
  const isActive = formData.get("is_active") === "on";
  const photoFile = formData.get("photo") as File | null;
  const existingPhotoUrl = String(formData.get("existing_photo_url") ?? "").trim() || null;

  const price = Number(priceRaw);
  if (!nameUk || !priceRaw || Number.isNaN(price)) {
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
    category,
    name_uk: nameUk,
    name_en: nameEn || null,
    description_uk: descriptionUk || null,
    description_en: descriptionEn || null,
    price,
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
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("menu_items").delete().eq("id", id);
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
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from("site_content").delete().eq("key", key);
  if (error) throw new Error(error.message);
  revalidatePath("/menu");
}
