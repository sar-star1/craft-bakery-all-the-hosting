// Sample menu items/site content for testing the Menu management screen
// before Supabase is wired up. Shapes match menu_items/site_content exactly.
import type { MenuItem, SiteContent } from "./types";

export const mockMenuItems: MenuItem[] = [
  {
    id: "menu_1",
    category: "b2b",
    name_uk: "Круасан класичний",
    name_en: "Classic croissant",
    description_uk: "Вершкове масло, шари 27 разів. Алергени: глютен, молоко.",
    description_en: "Butter, 27-layer lamination. Allergens: gluten, dairy.",
    price: 1.4,
    photo_url: null,
    is_active: true,
    sort_order: 0,
    created_at: "2026-01-05T10:00:00Z",
    updated_at: "2026-01-05T10:00:00Z",
  },
  {
    id: "menu_2",
    category: "b2b",
    name_uk: "Асорті випічки на сніданок",
    name_en: "Breakfast pastry assortment",
    description_uk: "Мікс круасанів, синабонів і данських. Мін. замовлення 20 шт.",
    description_en: "Mix of croissants, cinnamon rolls, and danishes. Min order 20.",
    price: 2.1,
    photo_url: null,
    is_active: true,
    sort_order: 1,
    created_at: "2026-01-05T10:00:00Z",
    updated_at: "2026-01-05T10:00:00Z",
  },
];

export const mockSiteContent: SiteContent[] = [
  {
    key: "terms",
    content_uk: "Мінімальне замовлення — 20 одиниць. Оплата при отриманні або передоплата 50%.",
    content_en: "Minimum order is 20 units. Payment on delivery or 50% deposit.",
    updated_at: "2026-01-05T10:00:00Z",
  },
];
