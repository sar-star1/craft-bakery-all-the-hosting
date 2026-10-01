"use client";

import { useActionState, useState } from "react";
import { startSeasonalOffer, type SeasonalOfferState } from "@/app/actions";
import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";

const initialState: SeasonalOfferState = {};

export default function SeasonalOfferForm({ lang, sampleMode = false }: { lang: Lang; sampleMode?: boolean }) {
  const t = STR[lang];
  const [state, formAction, pending] = useActionState(startSeasonalOffer, initialState);
  const [mockStarted, setMockStarted] = useState(false);

  const started = sampleMode ? mockStarted : state.message === "started";
  const error = !sampleMode && state.error === "offerRequired" ? t.seasonalRequired : undefined;

  return (
    <form
      action={sampleMode ? undefined : formAction}
      onSubmit={
        sampleMode
          ? (e) => {
              e.preventDefault();
              setMockStarted(true);
            }
          : undefined
      }
      className="bg-white rounded-md border border-stone-200 p-4 mb-8 space-y-3"
    >
      <div>
        <h2 className="font-serif text-lg">{t.seasonalTitle}</h2>
        <p className="text-[12px] text-stone-500 mt-0.5">{t.seasonalHint}</p>
      </div>
      <textarea
        name="offer"
        rows={2}
        placeholder={t.seasonalOfferPh}
        className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-[12px] text-stone-500">{t.seasonalSegment}</label>
        <select name="segment" defaultValue="all" className="border border-stone-200 rounded px-2 py-1.5 text-sm">
          <option value="all">{t.segmentAll}</option>
          <option value="active">{t.segmentActive}</option>
          <option value="dormant">{t.segmentDormant}</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="ml-auto text-sm px-3 py-1.5 rounded bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-60"
        >
          {t.seasonalGenerate}
        </button>
      </div>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      {started && <p className="text-[13px] text-emerald-700">{t.seasonalStarted}</p>}
    </form>
  );
}
