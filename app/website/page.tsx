import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { fetchWebsiteManifest, websiteUrl, type WebsiteContentRow, type WebsiteSection } from "@/lib/website";
import WebsiteEditor, { type LastPublish } from "@/components/WebsiteEditor";

export const dynamic = "force-dynamic";

export default async function WebsitePage() {
  const url = websiteUrl();
  let sections: WebsiteSection[] = [];
  let loadError: string | null = null;
  let rows: WebsiteContentRow[] = [];
  let lastPublish: LastPublish | null = null;

  if (url) {
    try {
      sections = await fetchWebsiteManifest();
    } catch (err) {
      loadError = `Не вдалося завантажити список полів сайту: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  if (isSupabaseConfigured()) {
    const db = createSupabaseServerClient();
    const [{ data, error }, { data: publishes }] = await Promise.all([
      db.from("website_content").select("*"),
      db
        .from("website_publishes")
        .select("created_at, changed_keys, deploy_triggered, deploy_error")
        .order("created_at", { ascending: false })
        .limit(1),
    ]);
    if (error) loadError = loadError ?? error.message;
    rows = (data ?? []) as WebsiteContentRow[];
    lastPublish = (publishes?.[0] as LastPublish | undefined) ?? null;
  }

  return (
    <WebsiteEditor
      websiteUrl={url}
      sections={sections}
      rows={rows}
      lastPublish={lastPublish}
      loadError={loadError}
      sampleMode={!isSupabaseConfigured()}
      canPublish={Boolean(process.env.WEBSITE_DEPLOY_HOOK_URL)}
    />
  );
}
