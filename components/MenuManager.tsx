"use client";

import { useState } from "react";
import { deleteMenuCategory, deleteMenuItem } from "@/app/actions";
import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";
import type { MenuCategory, MenuItem, SiteContent } from "@/lib/types";
import { formatMoney } from "@/lib/utils";
import Sidebar from "./Sidebar";
import LangToggle from "./LangToggle";
import MenuItemForm from "./MenuItemForm";
import MenuCategoryForm from "./MenuCategoryForm";
import SiteContentEditor from "./SiteContentEditor";

export default function MenuManager({
  categories: initialCategories,
  menuItems: initialMenuItems,
  siteContent,
  sampleMode = false,
}: {
  categories: MenuCategory[];
  menuItems: MenuItem[];
  siteContent: SiteContent[];
  sampleMode?: boolean;
}) {
  const [lang, setLang] = useState<Lang>("uk");
  const [categories, setCategories] = useState(initialCategories);
  const [items, setItems] = useState(initialMenuItems);
  const [editingItem, setEditingItem] = useState<{ item: MenuItem | null; categoryId: string } | null>(
    null
  );
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null | "new">(null);
  const t = STR[lang];

  const handleMockSaveItem = (item: MenuItem) => {
    setItems((prev) => {
      const exists = prev.some((i) => i.id === item.id);
      return exists ? prev.map((i) => (i.id === item.id ? item : i)) : [item, ...prev];
    });
  };

  const handleMockSaveCategory = (category: MenuCategory) => {
    setCategories((prev) => {
      const exists = prev.some((c) => c.id === category.id);
      return exists ? prev.map((c) => (c.id === category.id ? category : c)) : [...prev, category];
    });
  };

  const handleDeleteItem = (id: string) => {
    if (!confirm(t.deleteItemConfirm)) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (!sampleMode) deleteMenuItem(id);
  };

  const handleDeleteCategory = (id: string) => {
    if (!confirm(t.deleteCategoryConfirm)) return;
    setCategories((prev) => prev.filter((c) => c.id !== id));
    setItems((prev) => prev.filter((i) => i.category_id !== id));
    if (!sampleMode) deleteMenuCategory(id);
  };

  return (
    <div className="min-h-screen bg-[#FAF6EF] flex text-stone-900">
      <Sidebar lang={lang} setLang={setLang} />

      <main className="flex-1 min-w-0 px-5 md:px-8 py-6 max-w-3xl">
        {sampleMode && (
          <div className="mb-5 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Showing sample data — Supabase isn&apos;t configured yet.
          </div>
        )}

        <div className="flex items-center gap-3 md:hidden mb-4">
          <LangToggle lang={lang} setLang={setLang} />
        </div>

        <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
          <div>
            <h1 className="font-serif text-2xl">{t.menuTitle}</h1>
            <p className="text-stone-500 text-sm mt-0.5">{t.menuSubtitle}</p>
          </div>
          <button
            onClick={() => setEditingCategory("new")}
            className="text-sm bg-stone-900 text-white px-4 py-2 rounded hover:bg-stone-800"
          >
            {t.newCategory}
          </button>
        </div>

        <div className="space-y-8 mb-10">
          {categories.map((category) => {
            const categoryName = lang === "en" ? category.name_en ?? category.name_uk : category.name_uk;
            const categoryNote = lang === "en" ? category.note_en : category.note_uk;
            const categoryItems = items.filter((i) => i.category_id === category.id);

            return (
              <section key={category.id}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <h2 className="font-serif text-lg">{categoryName}</h2>
                    <p className="text-[12px] text-stone-400">
                      {t.minOrderLabel}: {category.min_order} {t.itemsUnit}
                      {categoryNote ? ` · ${categoryNote}` : ""}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => setEditingCategory(category)}
                      className="text-[12px] text-stone-500 hover:text-stone-900 px-2 py-1"
                    >
                      {t.editCategory}
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(category.id)}
                      className="text-[12px] text-red-500 hover:text-red-700 px-2 py-1"
                    >
                      {t.deleteCategory}
                    </button>
                  </div>
                </div>

                {categoryItems.length === 0 ? (
                  <p className="text-stone-400 text-sm mb-2">{t.menuEmpty}</p>
                ) : (
                  <div className="space-y-2 mb-2">
                    {categoryItems.map((item) => {
                      const name = lang === "en" ? item.name_en ?? item.name_uk : item.name_uk;
                      const description = lang === "en" ? item.description_en : item.description_uk;
                      return (
                        <div
                          key={item.id}
                          className="bg-white rounded-md border border-stone-200 p-3 flex items-center gap-3"
                        >
                          {item.photo_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.photo_url}
                              alt=""
                              className="w-12 h-12 object-cover rounded shrink-0 border border-stone-100"
                            />
                          ) : (
                            <div className="w-12 h-12 rounded shrink-0 bg-stone-100" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm text-stone-800 font-medium truncate">{name}</p>
                              {item.weight && (
                                <span className="text-[11px] text-stone-400 shrink-0">{item.weight}</span>
                              )}
                              {item.badge && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 shrink-0">
                                  {item.badge}
                                </span>
                              )}
                              {item.promo_label && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 shrink-0">
                                  {item.promo_label}
                                </span>
                              )}
                              {!item.is_active && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-200 text-stone-500 shrink-0">
                                  {t.inactiveLabel}
                                </span>
                              )}
                            </div>
                            {description && (
                              <p className="text-[12px] text-stone-400 truncate mt-0.5">{description}</p>
                            )}
                          </div>
                          <div className="text-right shrink-0">
                            {item.original_price && (
                              <p className="text-[11px] text-stone-400 line-through">
                                {formatMoney(item.original_price)}
                              </p>
                            )}
                            <p className="text-sm font-medium text-stone-700">{formatMoney(item.price)}</p>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <button
                              onClick={() => setEditingItem({ item, categoryId: category.id })}
                              className="text-[12px] text-stone-500 hover:text-stone-900 px-2 py-1"
                            >
                              {t.editItem}
                            </button>
                            <button
                              onClick={() => handleDeleteItem(item.id)}
                              className="text-[12px] text-red-500 hover:text-red-700 px-2 py-1"
                            >
                              {t.deleteItem}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <button
                  onClick={() => setEditingItem({ item: null, categoryId: category.id })}
                  className="text-[13px] text-stone-500 hover:text-stone-900"
                >
                  {t.addItemToCategory}
                </button>
              </section>
            );
          })}
        </div>

        <SiteContentEditor lang={lang} initialContent={siteContent} sampleMode={sampleMode} />
      </main>

      {editingItem !== null && (
        <MenuItemForm
          lang={lang}
          item={editingItem.item}
          categories={categories}
          defaultCategoryId={editingItem.categoryId}
          onClose={() => setEditingItem(null)}
          sampleMode={sampleMode}
          onMockSave={sampleMode ? handleMockSaveItem : undefined}
        />
      )}

      {editingCategory !== null && (
        <MenuCategoryForm
          lang={lang}
          category={editingCategory === "new" ? null : editingCategory}
          onClose={() => setEditingCategory(null)}
          sampleMode={sampleMode}
          onMockSave={sampleMode ? handleMockSaveCategory : undefined}
        />
      )}
    </div>
  );
}
