// Shapes the public storefront renders, built from the unified menu tables
// (menu_categories / menu_items / site_content). Prices stay numeric here
// and are formatted only at display time.
import type {
  DeliveryTermsBlock,
  MenuCategory,
  MenuItem,
  PromoBannerContent,
  SiteContent,
} from "./types";

export interface StoreItem {
  id: string;
  name: string;
  price: number;
  originalPrice: number | null;
  promo: string | null;
  description: string | null;
  weight: string | null;
  storage: string | null;
  badge: string | null;
  freezable: boolean;
  minOrder: number | null;
  image: string | null;
}

export interface StoreCategory {
  id: string;
  name: string;
  minOrder: number;
  note: string | null;
  items: StoreItem[];
}

export interface StoreDeliveryTerms {
  title: string;
  blocks: DeliveryTermsBlock[];
}

export interface StoreData {
  categories: StoreCategory[];
  promo: PromoBannerContent;
  terms: StoreDeliveryTerms | null;
}

export function formatUAH(amount: number): string {
  return `${amount.toLocaleString("uk-UA", { maximumFractionDigits: 0 })} ₴`;
}

export function buildStoreData(
  categories: MenuCategory[],
  items: MenuItem[],
  siteContent: SiteContent[]
): StoreData {
  const storeCategories = [...categories]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((cat): StoreCategory => ({
      id: cat.id,
      name: cat.name_uk,
      minOrder: cat.min_order,
      note: cat.note_uk,
      items: items
        .filter((i) => i.category_id === cat.id && i.is_active)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((i): StoreItem => ({
          id: i.id,
          name: i.name_uk,
          price: Number(i.price),
          originalPrice: i.original_price === null ? null : Number(i.original_price),
          promo: i.promo_label,
          description: i.description_uk,
          weight: i.weight,
          storage: i.storage_note,
          badge: i.badge,
          freezable: i.freezable,
          minOrder: i.min_order_override,
          image: i.photo_url,
        })),
    }))
    .filter((c) => c.items.length > 0);

  const promoRow = siteContent.find((c) => c.key === "promo_banner")?.content_json as
    | Partial<PromoBannerContent>
    | null
    | undefined;
  const termsRow = siteContent.find((c) => c.key === "delivery_terms")?.content_json as
    | Partial<StoreDeliveryTerms>
    | null
    | undefined;

  return {
    categories: storeCategories,
    promo: {
      active: promoRow?.active ?? false,
      title: promoRow?.title ?? "",
      subtitle: promoRow?.subtitle ?? "",
    },
    terms: termsRow?.blocks ? { title: termsRow.title ?? "", blocks: termsRow.blocks } : null,
  };
}
