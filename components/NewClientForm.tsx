"use client";

import { useActionState, useState } from "react";
import { createClient, type CreateClientState } from "@/app/actions";
import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";

const initialState: CreateClientState = {};

export default function NewClientForm({
  lang,
  onClose,
  sampleMode = false,
}: {
  lang: Lang;
  onClose: () => void;
  sampleMode?: boolean;
}) {
  const t = STR[lang];
  const [state, formAction, pending] = useActionState(createClient, initialState);
  const [mockResult, setMockResult] = useState<CreateClientState | null>(null);
  const [copied, setCopied] = useState(false);

  const result = sampleMode ? mockResult : state.clientId ? state : null;

  const handleMockSubmit = (formData: FormData) => {
    const businessName = String(formData.get("business_name") ?? "").trim();
    if (!businessName) {
      setMockResult({ error: "formError" });
      return;
    }
    setMockResult({
      clientId: `client_mock_${Date.now()}`,
      deepLink: "https://t.me/craft_bakery_bot?start=m_sample0000000000000000000000",
    });
  };

  const copyLink = (link: string) => {
    navigator.clipboard?.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (result?.clientId) {
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center px-4">
        <div className="absolute inset-0 bg-stone-900/30" onClick={onClose} />
        <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6">
          <h2 className="font-serif text-xl mb-1">{t.migrationLinkTitle}</h2>
          <p className="text-stone-500 text-sm mb-4">{t.migrationLinkSubtitle}</p>

          {result.deepLink ? (
            <div className="flex items-center gap-2 bg-stone-50 border border-stone-200 rounded px-3 py-2">
              <code className="text-[12px] text-stone-700 truncate flex-1">{result.deepLink}</code>
              <button
                onClick={() => copyLink(result.deepLink!)}
                className="text-[12px] px-2 py-1 rounded bg-stone-900 text-white hover:bg-stone-800 shrink-0"
              >
                {copied ? t.copied : t.copyLink}
              </button>
            </div>
          ) : (
            <p className="text-[13px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              Set TELEGRAM_BOT_USERNAME in .env.local to generate a shareable link.
            </p>
          )}

          <button
            onClick={onClose}
            className="w-full mt-6 text-sm px-3 py-2 rounded bg-stone-900 text-white hover:bg-stone-800"
          >
            {t.done}
          </button>
        </div>
      </div>
    );
  }

  const error = sampleMode ? mockResult?.error : state.error;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-stone-900/30" onClick={onClose} />
      <form
        action={sampleMode ? handleMockSubmit : formAction}
        className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6"
      >
        <h2 className="font-serif text-xl mb-1">{t.newClientFormTitle}</h2>
        <p className="text-stone-500 text-sm mb-5">{t.newClientFormSubtitle}</p>

        <div className="space-y-4">
          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fBusinessName}</label>
            <input
              name="business_name"
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              placeholder={t.fBusinessNamePh}
            />
          </div>
          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fContactName}</label>
            <input name="contact_name" className="w-full border border-stone-200 rounded px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[12px] text-stone-500 block mb-1">{t.fStandingOrderNotes}</label>
            <textarea
              name="standing_order_notes"
              rows={2}
              className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
              placeholder={t.fStandingOrderNotesPh}
            />
          </div>
        </div>

        {error && (
          <p className="text-[13px] text-red-600 mt-3">{error === "formError" ? t.newClientError : error}</p>
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
            {t.addClient}
          </button>
        </div>
      </form>
    </div>
  );
}
