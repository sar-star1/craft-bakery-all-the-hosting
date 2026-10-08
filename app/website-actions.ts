"use server";

import sharp from "sharp";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  fetchWebsiteManifest,
  hasPendingChange,
  WEBSITE_IMAGES_BUCKET,
  type WebsiteContentRow,
  type WebsiteSlot,
} from "@/lib/website";

export type WebsiteActionResult = { ok: true; row?: WebsiteContentRow; message?: string } | { ok: false; error: string };

const MAX_TEXT = 5000;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel's request limit is 4.5 MB; the editor shrinks photos first
const IMAGE_MAX_WIDTH = 2000;

// Only keys the website actually declares can be written, with the right type.
async function findSlot(key: string): Promise<WebsiteSlot> {
  const slot = (await fetchWebsiteManifest()).flatMap((s) => s.slots).find((s) => s.key === key);
  if (!slot) throw new Error(`Невідоме поле сайту: ${key}`);
  return slot;
}

async function saveDraft(key: string, draft: string): Promise<WebsiteContentRow> {
  const db = createSupabaseServerClient();
  const { data, error } = await db
    .from("website_content")
    .upsert({ key, draft, updated_at: new Date().toISOString() }, { onConflict: "key" })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as WebsiteContentRow;
}

function fail(err: unknown): WebsiteActionResult {
  return { ok: false, error: err instanceof Error ? err.message : String(err) };
}

/** Save text for a slot. An empty value means "use the website's default". */
export async function saveWebsiteText(key: string, value: string): Promise<WebsiteActionResult> {
  await requireAdmin();
  try {
    const slot = await findSlot(key);
    if (slot.type === "image") return { ok: false, error: "Для фото використайте «Замінити фото»." };
    const text = value.replace(/\r\n/g, "\n").trim();
    if (text.length > MAX_TEXT) return { ok: false, error: `Задовгий текст (максимум ${MAX_TEXT} символів).` };
    const draft = text === slot.default.trim() ? "" : text;
    const row = await saveDraft(key, draft);
    revalidatePath("/website");
    return { ok: true, row };
  } catch (err) {
    return fail(err);
  }
}

/** Upload a new photo for an image slot: normalised to a WebP at most 2000px wide. */
export async function uploadWebsiteImage(formData: FormData): Promise<WebsiteActionResult> {
  await requireAdmin();
  try {
    const key = String(formData.get("key") ?? "");
    const file = formData.get("file");
    const slot = await findSlot(key);
    if (slot.type !== "image") return { ok: false, error: "Це поле не фото." };
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Файл не вибрано." };
    if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "Фото завелике — максимум 4 МБ." };
    if (!/^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.type)) {
      return { ok: false, error: "Підтримуються JPG, PNG, WebP та HEIC." };
    }

    const webp = await sharp(Buffer.from(await file.arrayBuffer()))
      .rotate()
      .resize({ width: IMAGE_MAX_WIDTH, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    const db = createSupabaseServerClient();
    const path = `${key}/${Date.now()}.webp`;
    const { error } = await db.storage
      .from(WEBSITE_IMAGES_BUCKET)
      .upload(path, webp, { contentType: "image/webp", cacheControl: "31536000" });
    if (error) return { ok: false, error: error.message };
    const url = db.storage.from(WEBSITE_IMAGES_BUCKET).getPublicUrl(path).data.publicUrl;

    const row = await saveDraft(key, url);
    revalidatePath("/website");
    return { ok: true, row };
  } catch (err) {
    return fail(err);
  }
}

/** Put a slot back to what is live on the website now. */
export async function discardWebsiteChange(key: string): Promise<WebsiteActionResult> {
  await requireAdmin();
  try {
    const db = createSupabaseServerClient();
    const { data: current, error: readError } = await db
      .from("website_content")
      .select("published")
      .eq("key", key)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    const row = await saveDraft(key, current?.published ?? "");
    revalidatePath("/website");
    return { ok: true, row };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Make every saved change live: copy draft → published, then ask Vercel to
 * rebuild the website (which pulls /api/website-content). Also works with no
 * pending changes, to retry a rebuild that failed to start.
 */
export async function publishWebsite(): Promise<WebsiteActionResult> {
  await requireAdmin();
  const hook = process.env.WEBSITE_DEPLOY_HOOK_URL;
  if (!hook) return { ok: false, error: "WEBSITE_DEPLOY_HOOK_URL не задано — див. Налаштування." };

  try {
    const db = createSupabaseServerClient();
    const { data, error } = await db.from("website_content").select("*");
    if (error) throw new Error(error.message);
    const pending = ((data ?? []) as WebsiteContentRow[]).filter(hasPendingChange);

    const now = new Date().toISOString();
    for (const row of pending) {
      const { error: updateError } = await db
        .from("website_content")
        .update({ published: row.draft, published_at: now })
        .eq("key", row.key);
      if (updateError) throw new Error(updateError.message);
    }

    // Published values are saved first, so the build always sees them.
    let deployError: string | null = null;
    try {
      const res = await fetch(hook, { method: "POST" });
      if (!res.ok) deployError = `Vercel відповів ${res.status}`;
    } catch (err) {
      deployError = err instanceof Error ? err.message : String(err);
    }

    await db.from("website_publishes").insert({
      changed_keys: pending.map((r) => r.key),
      deploy_triggered: !deployError,
      deploy_error: deployError,
    });
    revalidatePath("/website");

    if (deployError) {
      return { ok: false, error: `Зміни збережено, але оновлення сайту не запустилось (${deployError}). Натисніть «Опублікувати» ще раз.` };
    }
    return {
      ok: true,
      message: pending.length
        ? `Опубліковано змін: ${pending.length}. Сайт оновиться приблизно за 1–2 хвилини.`
        : "Сайт перебудовується — приблизно 1–2 хвилини.",
    };
  } catch (err) {
    return fail(err);
  }
}
