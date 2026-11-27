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
import { newSectionItems } from "./menuOrder";

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
  // A copy shown in «Новинки» of an item that belongs to another category: it counts toward ITS
  // category's minimum, never toward «Новинки».
  copyFromOtherCategory?: boolean;
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

// The section new products are gathered in (an ordinary category named «Новинки», or made up when there is none).
export const isNewSection = (name: string) => /^(новинки|new)$/i.test(name.trim());

const toStoreItem = (i: MenuItem): StoreItem => ({
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
});

export function buildStoreData(
  categories: MenuCategory[],
  items: MenuItem[],
  siteContent: SiteContent[]
): StoreData {
  const sortedCategories = [...categories].sort((a, b) => a.sort_order - b.sort_order);
  const newSection = sortedCategories.find((c) => isNewSection(c.name_uk));
  // «Новинки»: its own items plus the flagged items of other categories, in the order set in the dashboard.
  const newList = newSectionItems(sortedCategories, items, newSection?.id).filter((i) => i.is_active);
  const asStoreItem = (i: MenuItem, homeId: string | undefined): StoreItem =>
    i.category_id === homeId ? toStoreItem(i) : { ...toStoreItem(i), copyFromOtherCategory: true };
  const flagged = newList.map((i) => asStoreItem(i, newSection?.id));

  const storeCategories = sortedCategories
    .map((cat): StoreCategory => ({
      id: cat.id,
      name: cat.name_uk,
      minOrder: cat.min_order,
      note: cat.note_uk,
      items:
        cat.id === newSection?.id
          ? flagged
          : items
              .filter((i) => i.category_id === cat.id && i.is_active)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map(toStoreItem),
    }))
    .filter((c) => c.items.length > 0);

  // No «Новинки» category yet, but something is flagged: show a section for it at the top.
  if (!newSection && flagged.length > 0) {
    storeCategories.unshift({ id: "new-section", name: "Новинки", minOrder: 0, note: null, items: flagged });
  }

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
