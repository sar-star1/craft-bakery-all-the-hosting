"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { saveMenuCategory, type SaveMenuCategoryState } from "@/app/actions";
import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";
import type { MenuCategory } from "@/lib/types";

const initialState: SaveMenuCategoryState = {};

export default function MenuCategoryForm({
  lang,
  category,
  onClose,
  sampleMode = false,
  onMockSave,
}: {
  lang: Lang;
  category: MenuCategory | null;
  onClose: () => void;
  sampleMode?: boolean;
  onMockSave?: (category: MenuCategory) => void;
}) {
  const t = STR[lang];
  const [state, formAction, pending] = useActionState(saveMenuCategory, initialState);
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
    <div className="fixed inset-0 z-40 flex items-center justify-center px-4">
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
                const minOrderRaw = String(formData.get("min_order") ?? "").trim();
                const minOrder = Number(minOrderRaw);
                if (!nameUk || !minOrderRaw || Number.isNaN(minOrder)) {
                  setMockError("formError");
                  return;
                }
                onMockSave?.({
                  id: category?.id ?? `menu_cat_mock_${Date.now()}`,
                  name_uk: nameUk,
                  name_en: String(formData.get("name_en") ?? "").trim() || null,
                  min_order: minOrder,
                  note_uk: String(formData.get("note_uk") ?? "").trim() || null,
                  note_en: String(formData.get("note_en") ?? "").trim() || null,
                  sort_order: category?.sort_order ?? 0,
                  created_at: category?.created_at ?? new Date().toISOString(),
                });
                onClose();
              }
            : undefined
        }
        className="relative bg-white rounded-lg shadow-xl w-full max-w-sm p-6"
      >
        {category && <input type="hidden" name="id" value={category.id} />}

        <h2 className="font-serif text-xl mb-5">
          {category ? t.categoryFormTitleEdit : t.categoryFormTitleNew}
        </h2>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] text-stone-500 block mb-1">{t.fCategoryNameUk}</label>
              <input
                name="name_uk"
                defaultValue={category?.name_uk}
                className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[12px] text-stone-500 block mb-1">{t.fCategoryNameEn}</label>
              <input
                name="name_en"
                defaultValue={category?.name_en ?? ""}
                className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fCategoryMinOrder}</label>
            <input
              type="number"
              step="1"
              name="min_order"
              defaultValue={category?.min_order ?? 1}
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fCategoryNoteUk}</label>
            <input
              name="note_uk"
              defaultValue={category?.note_uk ?? ""}
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fCategoryNoteEn}</label>
            <input
              name="note_en"
              defaultValue={category?.note_en ?? ""}
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
            />
          </div>
        </div>

        {error && (
          <p className="text-[13px] text-red-600 mt-3">
            {error === "formError" ? t.categoryFormError : error}
          </p>
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
            {t.saveCategory}
          </button>
        </div>
      </form>
    </div>
  );
}
