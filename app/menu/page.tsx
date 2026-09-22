import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { MenuItem, SiteContent } from "@/lib/types";
import { mockMenuItems, mockSiteContent } from "@/lib/mockMenu";
import MenuManager from "@/components/MenuManager";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  if (!isSupabaseConfigured()) {
    return <MenuManager menuItems={mockMenuItems} siteContent={mockSiteContent} sampleMode />;
  }

  const supabase = createSupabaseServerClient();
  const [{ data: menuItems, error }, { data: siteContent }] = await Promise.all([
    supabase.from("menu_items").select("*").order("sort_order", { ascending: true }),
    supabase.from("site_content").select("*"),
  ]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <p className="font-serif text-xl mb-2">Couldn&apos;t load the menu</p>
          <p className="text-stone-500 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <MenuManager
      menuItems={(menuItems ?? []) as MenuItem[]}
      siteContent={(siteContent ?? []) as SiteContent[]}
    />
  );
}
