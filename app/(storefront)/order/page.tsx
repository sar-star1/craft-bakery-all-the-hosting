import type { Metadata } from "next";
import Storefront from "@/components/storefront/Storefront";
import { refTokenToClientId } from "@/lib/clientToken";
import { mockMenuCategories, mockMenuItems, mockStorefrontContent } from "@/lib/mockMenu";
import { getOrderingRules } from "@/lib/orders";
import { DEFAULT_ORDERING_RULES } from "@/lib/orderRules";
import { buildStoreData } from "@/lib/storefront";
import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { MenuCategory, MenuItem, SiteContent } from "@/lib/types";

export const metadata: Metadata = {
  title: "Peremoga Bakery — замовлення",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

export default async function OrderPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const { ref } = await searchParams;

  if (!isSupabaseConfigured()) {
    return (
      <Storefront
        data={buildStoreData(mockMenuCategories, mockMenuItems, mockStorefrontContent)}
        rules={DEFAULT_ORDERING_RULES}
        sampleMode
      />
    );
  }

  const supabase = createSupabaseServerClient();
  const clientId = refTokenToClientId(ref);

  const [{ data: categories }, { data: items }, { data: content }, clientRow, rules] = await Promise.all([
    supabase.from("menu_categories").select("*"),
    supabase.from("menu_items").select("*"),
    supabase.from("site_content").select("*"),
    clientId
      ? supabase.from("clients").select("business_name, fop, delivery_address, payment_method, phone").eq("id", clientId).maybeSingle()
      : Promise.resolve({ data: null }),
    getOrderingRules(supabase),
  ]);

  return (
    <Storefront
      data={buildStoreData(
        (categories ?? []) as MenuCategory[],
        (items ?? []) as MenuItem[],
        (content ?? []) as SiteContent[]
      )}
      refToken={clientRow.data ? ref : undefined}
      prefillName={clientRow.data?.business_name as string | undefined}
      rules={rules}
      profile={
        clientRow.data
          ? {
              fop: (clientRow.data.fop as string | null) ?? undefined,
              address: (clientRow.data.delivery_address as string | null) ?? undefined,
              payment_method: (clientRow.data.payment_method as "cash" | "cashless" | null) ?? undefined,
              phone: (clientRow.data.phone as string | null) ?? undefined,
            }
          : undefined
      }
    />
  );
}
