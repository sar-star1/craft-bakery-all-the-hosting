"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveMenuItem, type SaveMenuItemState } from "@/app/actions";
import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";
import type { MenuCategory, MenuItem } from "@/lib/types";

const initialState: SaveMenuItemState = {};

export default function MenuItemForm({
  lang,
  item,
  categories,
  defaultCategoryId,
  onClose,
  sampleMode = false,
  onMockSave,
}: {
  lang: Lang;
  item: MenuItem | null;
  categories: MenuCategory[];
  defaultCategoryId?: string;
  onClose: () => void;
  sampleMode?: boolean;
  onMockSave?: (item: MenuItem) => void;
}) {
  const t = STR[lang];
  const [state, formAction, pending] = useActionState(saveMenuItem, initialState);
  const [mockError, setMockError] = useState<string | undefined>();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (sampleMode) return;
    if (!state.error && formRef.current && !pending) {
      if (formRef.current.dataset.submitted === "true") {
        onClose();
      }
    }
  }, [state, pending, onClose, sampleMode]);

  const error = sampleMode ? mockError : state.error;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-stone-900/30" onClick={onClose} />
      <form
        ref={formRef}
        action={
          sampleMode
            ? undefined
            : (formData) => {
                formRef.current!.dataset.submitted = "true";
                formAction(formData);
              }
        }
        onSubmit={
          sampleMode
            ? (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const nameUk = String(formData.get("name_uk") ?? "").trim();
                const categoryId = String(formData.get("category_id") ?? "").trim();
                const priceRaw = String(formData.get("price") ?? "").trim();
                const price = Number(priceRaw);
                if (!nameUk || !categoryId || !priceRaw || Number.isNaN(price)) {
                  setMockError("formError");
                  return;
                }
                const originalPriceRaw = String(formData.get("original_price") ?? "").trim();
                const minOrderOverrideRaw = String(formData.get("min_order_override") ?? "").trim();
                const now = new Date().toISOString();
                onMockSave?.({
                  id: item?.id ?? `menu_mock_${Date.now()}`,
                  category_id: categoryId,
                  name_uk: nameUk,
                  name_en: String(formData.get("name_en") ?? "").trim() || null,
                  description_uk: String(formData.get("description_uk") ?? "").trim() || null,
                  description_en: String(formData.get("description_en") ?? "").trim() || null,
                  price,
                  original_price: originalPriceRaw ? Number(originalPriceRaw) : null,
                  promo_label: String(formData.get("promo_label") ?? "").trim() || null,
                  weight: String(formData.get("weight") ?? "").trim() || null,
                  storage_note: String(formData.get("storage_note") ?? "").trim() || null,
                  badge: String(formData.get("badge") ?? "").trim() || null,
                  freezable: formData.get("freezable") === "on",
                  min_order_override: minOrderOverrideRaw ? Number(minOrderOverrideRaw) : null,
                  photo_url: item?.photo_url ?? null,
                  is_active: formData.get("is_active") === "on",
                  sort_order: item?.sort_order ?? 0,
                  created_at: item?.created_at ?? now,
                  updated_at: now,
                });
                onClose();
              }
            : undefined
        }
        className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
      >
        {item && <input type="hidden" name="id" value={item.id} />}
        {item?.photo_url && <input type="hidden" name="existing_photo_url" value={item.photo_url} />}

        <h2 className="font-serif text-xl mb-5">{item ? t.menuFormTitleEdit : t.menuFormTitleNew}</h2>

        <div className="space-y-4">
          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fItemCategory}</label>
            <select
              name="category_id"
              defaultValue={item?.category_id ?? defaultCategoryId ?? categories[0]?.id}
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {lang === "en" ? c.name_en ?? c.name_uk : c.name_uk}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] text-stone-500 block mb-1">{t.fItemNameUk}</label>
              <input
                name="name_uk"
                defaultValue={item?.name_uk}
                className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[12px] text-stone-500 block mb-1">{t.fItemNameEn}</label>
              <input
                name="name_en"
                defaultValue={item?.name_en ?? ""}
                className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fItemDescriptionUk}</label>
            <textarea
              name="description_uk"
              defaultValue={item?.description_uk ?? ""}
              rows={2}
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fItemDescriptionEn}</label>
            <textarea
              name="description_en"
              defaultValue={item?.description_en ?? ""}
              rows={2}
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[12px] text-stone-500 block mb-1">{t.fItemPrice}</label>
              <input
                type="number"
                step="1"
                name="price"
                defaultValue={item?.price}
                className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[12px] text-stone-500 block mb-1">{t.fItemOriginalPrice}</label>
              <input
                type="number"
                step="1"
                name="original_price"
                defaultValue={item?.original_price ?? ""}
                className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[12px] text-stone-500 block mb-1">{t.fItemPromoLabel}</label>
              <input
                name="promo_label"
                defaultValue={item?.promo_label ?? ""}
                className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] text-stone-500 block mb-1">{t.fItemWeight}</label>
              <input
                name="weight"
                defaultValue={item?.weight ?? ""}
                className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[12px] text-stone-500 block mb-1">{t.fItemBadge}</label>
              <input
                name="badge"
                defaultValue={item?.badge ?? ""}
                className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fItemStorageNote}</label>
            <input
              name="storage_note"
              defaultValue={item?.storage_note ?? ""}
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="text-[12px] text-stone-500 block mb-1">{t.fItemMinOrderOverride}</label>
              <input
                type="number"
                step="1"
                name="min_order_override"
                defaultValue={item?.min_order_override ?? ""}
                className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-stone-600 pb-2">
              <input type="checkbox" name="freezable" defaultChecked={item?.freezable ?? false} />
              {t.fItemFreezable}
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-stone-600">
            <input type="checkbox" name="is_active" defaultChecked={item?.is_active ?? true} />
            {t.fItemActive}
          </label>

          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fItemPhoto}</label>
            {item?.photo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.photo_url}
                alt=""
                className="w-20 h-20 object-cover rounded mb-2 border border-stone-200"
              />
            )}
            <input type="file" name="photo" accept="image/*" disabled={sampleMode} className="w-full text-sm" />
          </div>
        </div>

        {error && (
          <p className="text-[13px] text-red-600 mt-3">{error === "formError" ? t.menuItemError : error}</p>
        )}

        <div className="flex gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 text-sm px-3 py-2 rounded border border-stone-200 text-stone-600 hover:bg-stone-50"
          >
            {t.cancel}
          </button>
          <button
            type="submit"
            disabled={pending}
            className="flex-1 text-sm px-3 py-2 rounded bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-60"
          >
            {t.saveItem}
          </button>
        </div>
      </form>
    </div>
  );
}
