import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { MenuCategory, MenuItem, SiteContent } from "@/lib/types";
import { mockMenuCategories, mockMenuItems, mockSiteContent } from "@/lib/mockMenu";
import MenuManager from "@/components/MenuManager";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  if (!isSupabaseConfigured()) {
    return (
      <MenuManager
        categories={mockMenuCategories}
        menuItems={mockMenuItems}
        siteContent={mockSiteContent}
        sampleMode
      />
    );
  }

  const supabase = createSupabaseServerClient();
  const [{ data: categories, error }, { data: menuItems }, { data: siteContent }] = await Promise.all([
    supabase.from("menu_categories").select("*").order("sort_order", { ascending: true }),
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

  // The terms/notes editor only manages plain-text blocks — structured
  // entries (delivery_terms, promo_banner) live in content_json and are
  // seeded via SQL for now rather than edited here.
  const textContent = ((siteContent ?? []) as SiteContent[]).filter(
    (c) => c.content_uk !== null || c.content_en !== null
  );

  return (
    <MenuManager
      categories={(categories ?? []) as MenuCategory[]}
      menuItems={(menuItems ?? []) as MenuItem[]}
      siteContent={textContent}
    />
  );
}
