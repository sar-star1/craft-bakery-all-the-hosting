import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// The public website (separate repo, separate Vercel project) owns its slot
// list: every editable text/photo with a label and default, published at
// <WEBSITE_URL>/content-manifest.json. The dashboard only stores edits in
// website_content (see supabase/schema.sql) — never layout or design.

export type WebsiteSlotType = "text" | "longtext" | "image";

export interface WebsiteSlot {
  key: string;
  label: string;
  type: WebsiteSlotType;
  default: string;
}

export interface WebsiteSection {
  page: string;
  section: string;
  slots: WebsiteSlot[];
}

export interface WebsiteContentRow {
  key: string;
  draft: string | null;
  published: string | null;
  updated_at: string;
  published_at: string | null;
}

export const WEBSITE_IMAGES_BUCKET = "website-images";

export function websiteUrl(): string | null {
  return process.env.WEBSITE_URL?.replace(/\/$/, "") || null;
}

export async function fetchWebsiteManifest(): Promise<WebsiteSection[]> {
  const base = websiteUrl();
  if (!base) throw new Error("WEBSITE_URL is not set");
  const res = await fetch(`${base}/content-manifest.json`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${base}/content-manifest.json answered ${res.status}`);
  const sections = (await res.json()) as WebsiteSection[];
  // Default photos are site-relative (/site/hero.webp); make them loadable here.
  return sections.map((s) => ({
    ...s,
    slots: s.slots.map((slot) =>
      slot.type === "image" && slot.default.startsWith("/") ? { ...slot, default: base + slot.default } : slot
    ),
  }));
}

/** Published values the website builds with. Empty string means "use the default". */
export async function getPublishedWebsiteContent(db: SupabaseClient): Promise<Record<string, string>> {
  const { data, error } = await db.from("website_content").select("key, published").not("published", "is", null);
  if (error) throw new Error(error.message);
  return Object.fromEntries(
    (data ?? []).filter((r) => r.published !== "").map((r) => [r.key as string, r.published as string])
  );
}

/** A row has an unpublished change when its saved draft differs from what is live. */
export function hasPendingChange(row: Pick<WebsiteContentRow, "draft" | "published">): boolean {
  return row.draft !== null && row.draft !== (row.published ?? "");
}
