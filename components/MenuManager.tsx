"use client";

import { useState } from "react";
import { deleteMenuItem } from "@/app/actions";
import type { Lang } from "@/lib/i18n";
import { CATEGORY_LABEL, STR } from "@/lib/i18n";
import type { MenuItem, SiteContent } from "@/lib/types";
import Sidebar from "./Sidebar";
import LangToggle from "./LangToggle";
import MenuItemForm from "./MenuItemForm";
import SiteContentEditor from "./SiteContentEditor";

export default function MenuManager({
  menuItems: initialMenuItems,
  siteContent,
  sampleMode = false,
}: {
  menuItems: MenuItem[];
  siteContent: SiteContent[];
  sampleMode?: boolean;
}) {
  const [lang, setLang] = useState<Lang>("uk");
  const [items, setItems] = useState(initialMenuItems);
  const [editingItem, setEditingItem] = useState<MenuItem | null | "new">(null);
  const t = STR[lang];

  const handleMockSave = (item: MenuItem) => {
    setItems((prev) => {
      const exists = prev.some((i) => i.id === item.id);
      return exists ? prev.map((i) => (i.id === item.id ? item : i)) : [item, ...prev];
    });
  };

  const handleDelete = (id: string) => {
    if (!confirm(t.deleteItemConfirm)) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
    if (!sampleMode) deleteMenuItem(id);
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
            onClick={() => setEditingItem("new")}
            className="text-sm bg-stone-900 text-white px-4 py-2 rounded hover:bg-stone-800"
          >
            {t.newMenuItem}
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-stone-400 text-sm mb-8">{t.menuEmpty}</p>
        ) : (
          <div className="space-y-2 mb-10">
            {items.map((item) => {
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
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-stone-800 font-medium truncate">{name}</p>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-100 text-stone-500 shrink-0">
                        {CATEGORY_LABEL[lang][item.category]}
                      </span>
                      {!item.is_active && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-stone-200 text-stone-500 shrink-0">
                          {t.inactiveLabel}
                        </span>
                      )}
                    </div>
                    {description && <p className="text-[12px] text-stone-400 truncate mt-0.5">{description}</p>}
                  </div>
                  <p className="text-sm font-medium text-stone-700 shrink-0">${item.price.toFixed(2)}</p>
                  <div className="flex gap-1 shrink-0">
                    <button
                      onClick={() => setEditingItem(item)}
                      className="text-[12px] text-stone-500 hover:text-stone-900 px-2 py-1"
                    >
                      {t.editItem}
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
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

        <SiteContentEditor lang={lang} initialContent={siteContent} sampleMode={sampleMode} />
      </main>

      {editingItem !== null && (
        <MenuItemForm
          lang={lang}
          item={editingItem === "new" ? null : editingItem}
          onClose={() => setEditingItem(null)}
          sampleMode={sampleMode}
          onMockSave={sampleMode ? handleMockSave : undefined}
        />
      )}
    </div>
  );
}
