"use server";

import { requireAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Attachment } from "@/lib/types";

const BUCKET = "campaign-files";
const MAX_BYTES = 4 * 1024 * 1024; // Vercel's request limit is 4.5 MB
const ALLOWED = [
  /^image\/(jpeg|png|webp|gif)$/,
  /^application\/pdf$/,
  /^application\/vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)$/,
  /^application\/(msword|vnd\.ms-excel)$/,
];

export async function uploadCampaignFile(formData: FormData): Promise<{ ok: true; file: Attachment } | { ok: false; error: string }> {
  await requireAdmin();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Файл не вибрано." };
  if (file.size > MAX_BYTES) return { ok: false, error: `Файл завеликий (${(file.size / 1048576).toFixed(1)} МБ). Максимум — 4 МБ: стисніть зображення або PDF.` };
  if (!ALLOWED.some((re) => re.test(file.type))) return { ok: false, error: "Підтримуються зображення, PDF, Word, Excel та PowerPoint." };

  const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80) || "file";
  const path = `${Date.now()}-${safe}`;
  const db = createSupabaseServerClient();
  const { error } = await db.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (error) return { ok: false, error: error.message };
  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  return { ok: true, file: { url: data.publicUrl, name: file.name, type: file.type } };
}
