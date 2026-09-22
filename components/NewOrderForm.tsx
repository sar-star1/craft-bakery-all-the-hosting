"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createOrder, type CreateOrderState } from "@/app/actions";
import type { Lang } from "@/lib/i18n";
import { CATEGORY_LABEL, STR } from "@/lib/i18n";

const initialState: CreateOrderState = {};

export default function NewOrderForm({
  lang,
  onClose,
  onMockSubmit,
}: {
  lang: Lang;
  onClose: () => void;
  // When set, skips the real Supabase-backed server action and hands the
  // raw FormData to the caller instead — used by the sample-data fallback
  // on the root page when Supabase isn't configured yet.
  onMockSubmit?: (formData: FormData) => string | void;
}) {
  const t = STR[lang];
  const [state, formAction, pending] = useActionState(createOrder, initialState);
  const [mockError, setMockError] = useState<string | undefined>();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (onMockSubmit) return;
    if (!state.error && formRef.current && !pending) {
      // A successful submit clears the error and this effect fires once
      // after `pending` flips back to false — close the modal.
      if (formRef.current.dataset.submitted === "true") {
        onClose();
      }
    }
  }, [state, pending, onClose, onMockSubmit]);

  const error = onMockSubmit ? mockError : state.error;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-stone-900/30" onClick={onClose} />
      <form
        ref={formRef}
        action={
          onMockSubmit
            ? undefined
            : (formData) => {
                formRef.current!.dataset.submitted = "true";
                formAction(formData);
              }
        }
        onSubmit={
          onMockSubmit
            ? (e) => {
                e.preventDefault();
                const result = onMockSubmit(new FormData(e.currentTarget));
                if (result) {
                  setMockError(result);
                } else {
                  onClose();
                }
              }
            : undefined
        }
        className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="font-serif text-xl mb-1">{t.formTitle}</h2>
        <p className="text-stone-500 text-sm mb-5">{t.formSubtitle}</p>

        <div className="space-y-4">
          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fCategory}</label>
            <select
              name="category"
              defaultValue="b2c"
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
            >
              <option value="b2c">{CATEGORY_LABEL[lang].b2c}</option>
              <option value="b2b">{CATEGORY_LABEL[lang].b2b}</option>
              <option value="standard_line">{CATEGORY_LABEL[lang].standard_line}</option>
            </select>
          </div>

          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fCustomer}</label>
            <input
              name="customer_name"
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              placeholder={t.fCustomerPh}
            />
          </div>

          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fContact}</label>
            <input
              name="customer_contact"
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              placeholder={t.fContactPh}
            />
          </div>

          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fItem}</label>
            <input
              name="item_summary_uk"
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              placeholder={t.fItemPh}
            />
          </div>

          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fDetails}</label>
            <textarea
              name="notes"
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              rows={2}
              placeholder={t.fDetailsPh}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] text-stone-500 block mb-1">{t.fDueDate}</label>
              <input
                type="date"
                name="due_date"
                className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[12px] text-stone-500 block mb-1">{t.fTotal}</label>
              <input
                type="number"
                name="total_amount"
                className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fDeposit}</label>
            <select
              name="deposit_status"
              defaultValue="n/a"
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
            >
              <option value="pending">{t.depositOptPending}</option>
              <option value="paid">{t.depositOptPaid}</option>
              <option value="n/a">{t.depositOptNA}</option>
            </select>
          </div>
        </div>

        {error && (
          <p className="text-[13px] text-red-600 mt-3">
            {error === "formError" ? t.formError : error}
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
            {t.addOrder}
          </button>
        </div>
      </form>
    </div>
  );
}
