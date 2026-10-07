"use client";

import { useActionState, useRef, useState } from "react";
import { startSeasonalOffer, type SeasonalOfferState } from "@/app/actions";
import { uploadCampaignFile } from "@/app/campaign-actions";
import type { Attachment } from "@/lib/types";
import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";

const initialState: SeasonalOfferState = {};

export default function SeasonalOfferForm({ lang, sampleMode = false }: { lang: Lang; sampleMode?: boolean }) {
  const t = STR[lang];
  const [state, formAction, pending] = useActionState(startSeasonalOffer, initialState);
  const [mockStarted, setMockStarted] = useState(false);
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setFileError(null);
    setUploading(true);
    for (const file of Array.from(list)) {
      if (files.length >= 5) {
        setFileError(lang === "uk" ? "Не більше 5 файлів." : "At most 5 files.");
        break;
      }
      if (sampleMode) {
        setFiles((prev) => [...prev, { url: "#", name: file.name, type: file.type }]);
        continue;
      }
      const body = new FormData();
      body.append("file", file);
      const res = await uploadCampaignFile(body);
      if (res.ok) setFiles((prev) => [...prev, res.file]);
      else setFileError(res.error);
    }
    setUploading(false);
    if (picker.current) picker.current.value = "";
  };

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
      <input type="hidden" name="attachments" value={JSON.stringify(files)} />
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            disabled={uploading}
            onClick={() => picker.current?.click()}
            className="text-[12px] border border-stone-300 px-2.5 py-1 rounded hover:bg-stone-50 disabled:opacity-50"
          >
            {uploading ? (lang === "uk" ? "Завантажую…" : "Uploading…") : lang === "uk" ? "📎 Додати файли" : "📎 Attach files"}
          </button>
          <input
            ref={picker}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
          {files.map((f, i) => (
            <span key={`${f.url}-${i}`} className="text-[12px] bg-stone-100 rounded px-2 py-1 flex items-center gap-1.5">
              {f.name}
              <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-stone-400 hover:text-stone-700">
                ×
              </button>
            </span>
          ))}
        </div>
        <p className="text-[11px] text-stone-400 mt-1">
          {lang === "uk"
            ? "Файли (зображення, PDF, документи до 4 МБ) підуть кожному клієнту разом із повідомленням, після підтвердження."
            : "Files (images, PDF, documents up to 4 MB) go to each client with the message, after approval."}
        </p>
        {fileError && <p className="text-[12px] text-red-600 mt-1">{fileError}</p>}
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-[12px] text-stone-500">{t.seasonalSegment}</label>
        <select name="segment" defaultValue="all" className="border border-stone-200 rounded px-2 py-1.5 text-sm">
          <option value="all">{t.segmentAll}</option>
          <option value="active">{t.segmentActive}</option>
          <option value="dormant">{t.segmentDormant}</option>
        </select>
        <button
          type="submit"
          disabled={pending || uploading}
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
