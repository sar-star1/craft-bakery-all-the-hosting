"use client";

import { useRef, useState, useTransition } from "react";
import {
  discardWebsiteChange,
  publishWebsite,
  saveWebsiteText,
  uploadWebsiteImage,
  type WebsiteActionResult,
} from "@/app/website-actions";
import type { Lang } from "@/lib/i18n";
import type { WebsiteContentRow, WebsiteSection, WebsiteSlot } from "@/lib/website";
import Sidebar from "./Sidebar";
import LangToggle from "./LangToggle";

export interface LastPublish {
  created_at: string;
  changed_keys: string[];
  deploy_triggered: boolean;
  deploy_error: string | null;
}

type Rows = Record<string, WebsiteContentRow>;

// Mirrors hasPendingChange in lib/website.ts (server-only there).
const isPending = (row?: WebsiteContentRow) => Boolean(row && row.draft !== null && row.draft !== (row.published ?? ""));
// What the editor shows: the saved draft, else what is live; '' = the website's default.
const savedValue = (row?: WebsiteContentRow) => row?.draft ?? row?.published ?? "";

const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("uk-UA", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

// Phone photos are often 5–10 MB, over Vercel's 4.5 MB request limit — shrink
// in the browser first; the server then converts to WebP.
async function shrinkPhoto(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" }) : file;
  } catch {
    return file; // e.g. HEIC in a browser that can't decode it — let the server try
  }
}

function StatusBadge({ row, slot }: { row?: WebsiteContentRow; slot: WebsiteSlot }) {
  if (isPending(row)) {
    return <span className="text-[11px] bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">Не опубліковано</span>;
  }
  if (savedValue(row) && savedValue(row) !== slot.default) {
    return <span className="text-[11px] bg-stone-100 text-stone-500 rounded px-1.5 py-0.5">Змінено</span>;
  }
  return null;
}

function SlotField({
  slot,
  row,
  disabled,
  onSaved,
}: {
  slot: WebsiteSlot;
  row?: WebsiteContentRow;
  disabled: boolean;
  onSaved: (row: WebsiteContentRow) => void;
}) {
  const current = savedValue(row) || slot.default;
  const [value, setValue] = useState(current);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = value !== current;

  const run = (action: () => Promise<WebsiteActionResult>) =>
    startTransition(async () => {
      setError(null);
      const res = await action();
      if (!res.ok) return setError(res.error);
      if (res.row) {
        onSaved(res.row);
        setValue(savedValue(res.row) || slot.default);
      }
    });

  const upload = (file: File) =>
    run(async () => {
      const data = new FormData();
      data.set("key", slot.key);
      data.set("file", await shrinkPhoto(file));
      return uploadWebsiteImage(data);
    });

  const changedFromDefault = savedValue(row) !== "" && savedValue(row) !== slot.default;

  return (
    <div className="py-3 border-t border-stone-100 first:border-t-0">
      <div className="flex items-center gap-2 mb-1.5">
        <label className="text-[13px] text-stone-600">{slot.label}</label>
        <StatusBadge row={row} slot={slot} />
      </div>

      {slot.type === "image" ? (
        <div className="flex items-end gap-3">
          <img
            src={current}
            alt={slot.label}
            className="h-28 w-40 object-cover rounded border border-stone-200 bg-stone-50"
          />
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) upload(file);
            }}
          />
          <button
            type="button"
            disabled={disabled || pending}
            onClick={() => fileInput.current?.click()}
            className="text-[13px] border border-stone-300 px-3 py-1.5 rounded hover:bg-stone-100 disabled:opacity-50"
          >
            {pending ? "Завантаження…" : "Замінити фото"}
          </button>
        </div>
      ) : slot.type === "longtext" ? (
        <textarea
          value={value}
          disabled={disabled || pending}
          onChange={(e) => setValue(e.target.value)}
          rows={Math.min(10, Math.max(3, value.split("\n").length + 1))}
          className="w-full text-sm border border-stone-300 rounded px-2.5 py-2 bg-white leading-relaxed disabled:bg-stone-50"
        />
      ) : (
        <input
          value={value}
          disabled={disabled || pending}
          onChange={(e) => setValue(e.target.value)}
          className="w-full text-sm border border-stone-300 rounded px-2.5 py-1.5 bg-white disabled:bg-stone-50"
        />
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[12px]">
        {dirty && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => saveWebsiteText(slot.key, value))}
              className="bg-stone-900 text-white px-3 py-1 rounded disabled:opacity-50"
            >
              {pending ? "Збереження…" : "Зберегти"}
            </button>
            <button type="button" onClick={() => setValue(current)} className="text-stone-500 hover:text-stone-800">
              Скасувати
            </button>
          </>
        )}
        {!dirty && isPending(row) && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => discardWebsiteChange(slot.key))}
            className="text-stone-500 hover:text-stone-800"
          >
            Відмінити зміну (як на сайті зараз)
          </button>
        )}
        {!dirty && changedFromDefault && (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(() => saveWebsiteText(slot.key, ""))}
            className="text-stone-500 hover:text-stone-800"
          >
            Повернути початковий варіант
          </button>
        )}
        {slot.type === "longtext" && (
          <span className="text-stone-400">
            Порожній рядок — новий абзац. **Так** — виділений текст.
          </span>
        )}
        {error && <span className="text-red-600">{error}</span>}
      </div>
    </div>
  );
}

export default function WebsiteEditor({
  websiteUrl,
  sections,
  rows: initialRows,
  lastPublish,
  loadError,
  sampleMode,
  canPublish,
}: {
  websiteUrl: string | null;
  sections: WebsiteSection[];
  rows: WebsiteContentRow[];
  lastPublish: LastPublish | null;
  loadError: string | null;
  sampleMode: boolean;
  canPublish: boolean;
}) {
  const [lang, setLang] = useState<Lang>("uk");
  const [rows, setRows] = useState<Rows>(() => Object.fromEntries(initialRows.map((r) => [r.key, r])));
  const [publishResult, setPublishResult] = useState<WebsiteActionResult | null>(null);
  const [publishing, startPublish] = useTransition();

  const slotKeys = new Set(sections.flatMap((s) => s.slots.map((slot) => slot.key)));
  const pendingCount = Object.values(rows).filter((r) => slotKeys.has(r.key) && isPending(r)).length;
  const pages = [...new Set(sections.map((s) => s.page))];

  const publish = () =>
    startPublish(async () => {
      setPublishResult(null);
      const res = await publishWebsite();
      setPublishResult(res);
      if (res.ok) {
        setRows((prev) =>
          Object.fromEntries(
            Object.entries(prev).map(([k, r]) => [k, isPending(r) ? { ...r, published: r.draft } : r])
          )
        );
      }
    });

  return (
    <div className="min-h-screen bg-[#FAF6EF] flex text-stone-900">
      <Sidebar lang={lang} setLang={setLang} />
      <main className="flex-1 min-w-0 px-5 md:px-8 py-6 max-w-3xl">
        <div className="flex items-center gap-3 md:hidden mb-4">
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <h1 className="font-serif text-2xl">Публічний сайт</h1>
        <p className="text-stone-500 text-sm mt-0.5 mb-5">
          Тексти та фото сайту{" "}
          {websiteUrl ? (
            <a href={websiteUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {websiteUrl.replace(/^https?:\/\//, "")}
            </a>
          ) : (
            "пекарні"
          )}
          . Дизайн і розташування блоків не змінюються. Збережені зміни з&apos;являються на сайті після «Опублікувати».
        </p>

        {!websiteUrl && (
          <section className="bg-white rounded-md border border-stone-200 p-4 mb-5 text-sm text-stone-700">
            Сайт ще не підключено: задайте у Vercel змінну <code className="text-[12px]">WEBSITE_URL</code> (адреса
            сайту, напр. https://peremogabakery.com.ua) і зробіть Redeploy.
          </section>
        )}
        {loadError && (
          <section className="bg-red-50 rounded-md border border-red-200 p-4 mb-5 text-sm text-red-700">{loadError}</section>
        )}
        {sampleMode && websiteUrl && (
          <section className="bg-amber-50 rounded-md border border-amber-200 p-4 mb-5 text-sm text-amber-800">
            Демо-режим: база даних не підключена, тому зберігати зміни не можна.
          </section>
        )}

        {sections.length > 0 && (
          <div className="sticky top-0 z-10 -mx-5 md:-mx-8 px-5 md:px-8 py-3 mb-5 bg-[#FAF6EF]/95 backdrop-blur border-b border-stone-200">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={publish}
                disabled={sampleMode || !canPublish || publishing}
                className="bg-stone-900 text-white text-sm px-4 py-2 rounded disabled:opacity-40"
              >
                {publishing ? "Публікація…" : "Опублікувати на сайті"}
              </button>
              <span className="text-sm text-stone-600">
                {pendingCount ? `Неопублікованих змін: ${pendingCount}` : "Усі збережені зміни вже на сайті"}
              </span>
            </div>
            {!canPublish && !sampleMode && (
              <p className="text-[12px] text-stone-500 mt-1.5">
                Публікація вимкнена: задайте у Vercel змінну <code>WEBSITE_DEPLOY_HOOK_URL</code> (див. Налаштування).
              </p>
            )}
            {publishResult && (
              <p className={`text-[13px] mt-1.5 ${publishResult.ok ? "text-green-700" : "text-red-600"}`}>
                {publishResult.ok ? publishResult.message : publishResult.error}
              </p>
            )}
            {!publishResult && lastPublish && (
              <p className="text-[12px] text-stone-500 mt-1.5">
                Остання публікація: {formatTime(lastPublish.created_at)}
                {lastPublish.deploy_error && (
                  <span className="text-red-600"> — оновлення сайту не запустилось, натисніть «Опублікувати» ще раз</span>
                )}
              </p>
            )}
          </div>
        )}

        {pages.map((page) => (
          <div key={page} className="mb-8">
            {pages.length > 1 && <h2 className="font-serif text-xl mb-3">{page}</h2>}
            {sections
              .filter((s) => s.page === page)
              .map((section) => {
                const changed = section.slots.filter((slot) => isPending(rows[slot.key])).length;
                return (
                  <details key={section.section} className="bg-white rounded-md border border-stone-200 mb-3 group">
                    <summary className="cursor-pointer select-none px-4 py-3 flex items-center gap-2">
                      <span className="font-serif text-lg flex-1">{section.section}</span>
                      {changed > 0 && (
                        <span className="text-[11px] bg-amber-100 text-amber-800 rounded px-1.5 py-0.5">
                          {changed} не опубл.
                        </span>
                      )}
                      <span className="text-stone-400 text-sm group-open:rotate-90 transition-transform">›</span>
                    </summary>
                    <div className="px-4 pb-3">
                      {section.slots.map((slot) => (
                        <SlotField
                          key={slot.key}
                          slot={slot}
                          row={rows[slot.key]}
                          disabled={sampleMode}
                          onSaved={(row) => setRows((prev) => ({ ...prev, [row.key]: row }))}
                        />
                      ))}
                    </div>
                  </details>
                );
              })}
          </div>
        ))}
      </main>
    </div>
  );
}
