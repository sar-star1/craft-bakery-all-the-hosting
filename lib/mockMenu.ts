// Sample menu categories/items/site content for testing the Menu management
// screen before Supabase is wired up. Shapes match menu_categories/
// menu_items/site_content exactly (see supabase/schema.sql). The real
// catalog (~90 items across 15 categories) lives in supabase/seed_menu.sql,
// generated from the actual site's menuData.ts.
import type { MenuCategory, MenuItem, SiteContent } from "./types";

export const mockMenuCategories: MenuCategory[] = [
  {
    id: "cat_0",
    name_uk: "Новинки",
    name_en: "New",
    min_order: 1,
    note_uk: null,
    note_en: null,
    sort_order: -1,
    created_at: "2026-01-05T10:00:00Z",
  },
  {
    id: "cat_1",
    name_uk: "Класичні круасани і равлик",
    name_en: "Classic croissants",
    min_order: 6,
    note_uk: "Мінімальне замовлення від 6 шт. з асортименту · Термін зберігання: 2-3 дні",
    note_en: "Minimum order 6 units from the range · Shelf life: 2-3 days",
    sort_order: 0,
    created_at: "2026-01-05T10:00:00Z",
  },
  {
    id: "cat_2",
    name_uk: "Торти",
    name_en: "Cakes",
    min_order: 1,
    note_uk: "Термін зберігання: 4 дні",
    note_en: "Shelf life: 4 days",
    sort_order: 1,
    created_at: "2026-01-05T10:00:00Z",
  },
];

export const mockMenuItems: MenuItem[] = [
  {
    id: "menu_3",
    category_id: "cat_0",
    name_uk: "Тарт з малиною",
    name_en: "Raspberry tart",
    description_uk: "Пісочна основа, фісташкова начинка та свіжа малина.",
    description_en: null,
    price: 1050,
    original_price: null,
    promo_label: null,
    weight: "1,33 кг",
    storage_note: "Термін придатності: 3 доби.",
    badge: "NEW",
    freezable: false,
    min_order_override: null,
    photo_url: "/menu/6dc13a9303fb.jpg",
    is_active: true,
    sort_order: 1,
    created_at: "2026-01-05T10:00:00Z",
    updated_at: "2026-01-05T10:00:00Z",
  },
  {
    id: "menu_1",
    category_id: "cat_1",
    name_uk: "Шоколадний",
    name_en: "Chocolate",
    description_uk: "Листкове тісто з вершковим маслом. Начинка: шоколадно-фундучна.",
    description_en: "Butter puff pastry. Chocolate-hazelnut filling.",
    price: 73,
    original_price: null,
    promo_label: null,
    weight: "136 г",
    storage_note: null,
    badge: null,
    freezable: false,
    min_order_override: null,
    photo_url: null,
    is_active: true,
    sort_order: 0,
    created_at: "2026-01-05T10:00:00Z",
    updated_at: "2026-01-05T10:00:00Z",
  },
  {
    id: "menu_2",
    category_id: "cat_2",
    name_uk: "Наполеон чорничний",
    name_en: "Blueberry Napoleon",
    description_uk:
      "Наполеон з чорничним кремом на основі заварного крему з вершками та чорницею, декорований лохиною.",
    description_en: "Blueberry Napoleon with pastry cream, cream, and blueberries.",
    price: 1250,
    original_price: 1500,
    promo_label: "Товар тижня · -15%",
    weight: "1,7 кг",
    storage_note: "Термін придатності: 4 доби.",
    badge: null,
    freezable: false,
    min_order_override: null,
    photo_url: "/menu/9ba679784787.png",
    is_active: true,
    sort_order: 0,
    created_at: "2026-01-05T10:00:00Z",
    updated_at: "2026-01-05T10:00:00Z",
  },
];

export const mockSiteContent: SiteContent[] = [
  {
    key: "terms",
    content_uk: "Мінімальна сума замовлення — 1 000 грн. Оплата: ФОП або готівка.",
    content_en: "Minimum order amount — 1000 UAH. Payment: invoice or cash.",
    content_json: null,
    updated_at: "2026-01-05T10:00:00Z",
  },
];

// Structured entries the public storefront reads (kept separate from
// mockSiteContent, which only holds the plain-text blocks the CRM's terms
// editor manages).
export const mockStorefrontContent: SiteContent[] = [
  {
    key: "promo_banner",
    content_uk: null,
    content_en: null,
    content_json: { active: true, title: "Товар тижня", subtitle: "Знижки на обрані позиції — обмежений час" },
    updated_at: "2026-01-05T10:00:00Z",
  },
  {
    key: "delivery_terms",
    content_uk: null,
    content_en: null,
    content_json: {
      title: "УМОВИ ДОСТАВКИ",
      blocks: [
        {
          heading: "Для м. Києва",
          lines: ["Мінімальна сума замовлення — 1 000 грн", "При замовленні від 2 000 грн доставка безкоштовна"],
        },
      ],
    },
    updated_at: "2026-01-05T10:00:00Z",
  },
];
