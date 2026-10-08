import { NextResponse } from "next/server";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { getPublishedWebsiteContent } from "@/lib/website";

// Public, read-only: the website's build (scripts/fetch-content.mjs in the
// website repo) pulls the published text/photo edits from here. Returns only
// website_content.published — the same text that is already visible on the
// public site — so it needs no secret, and the website never gets direct
// access to this database.
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ content: {} });
  try {
    const content = await getPublishedWebsiteContent(createSupabaseServerClient());
    return NextResponse.json({ content }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
