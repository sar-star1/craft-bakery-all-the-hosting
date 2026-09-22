"use client";

import { useState } from "react";
import { deleteSiteContent, saveSiteContent } from "@/app/actions";
import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";
import type { SiteContent } from "@/lib/types";

function ContentBlock({
  block,
  lang,
  sampleMode,
  onRemove,
}: {
  block: SiteContent;
  lang: Lang;
  sampleMode: boolean;
  onRemove: () => void;
}) {
  const t = STR[lang];
  const [key, setKey] = useState(block.key);
  const [contentUk, setContentUk] = useState(block.content_uk ?? "");
  const [contentEn, setContentEn] = useState(block.content_en ?? "");
  const [saved, setSaved] = useState(false);
  const isNew = block.key === "";

  const handleSave = async () => {
    if (!key.trim()) return;
    if (!sampleMode) {
      const formData = new FormData();
      formData.set("key", key.trim());
      formData.set("content_uk", contentUk);
      formData.set("content_en", contentEn);
      await saveSiteContent({}, formData);
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="bg-white rounded-md border border-stone-200 p-3 space-y-2">
      <input
        value={key}
        onChange={(e) => setKey(e.target.value)}
        placeholder={t.fTermsKey}
        readOnly={!isNew}
        className="w-full text-[12px] font-mono text-stone-500 border border-stone-200 rounded px-2 py-1 disabled:bg-stone-50"
      />
      <textarea
        value={contentUk}
        onChange={(e) => setContentUk(e.target.value)}
        placeholder={t.fTermsContentUk}
        rows={2}
        className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
      />
      <textarea
        value={contentEn}
        onChange={(e) => setContentEn(e.target.value)}
        placeholder={t.fTermsContentEn}
        rows={2}
        className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
      />
      <div className="flex gap-2">
        <button
          onClick={handleSave}
          className="text-[12px] px-2.5 py-1 rounded bg-stone-900 text-white hover:bg-stone-800"
        >
          {saved ? t.copied : t.saveContent}
        </button>
        <button
          onClick={() => {
            if (!sampleMode && !isNew) deleteSiteContent(key);
            onRemove();
          }}
          className="text-[12px] px-2.5 py-1 rounded border border-stone-200 text-stone-600 hover:bg-stone-50"
        >
          {t.deleteItem}
        </button>
      </div>
    </div>
  );
}

export default function SiteContentEditor({
  lang,
  initialContent,
  sampleMode = false,
}: {
  lang: Lang;
  initialContent: SiteContent[];
  sampleMode?: boolean;
}) {
  const t = STR[lang];
  const [blocks, setBlocks] = useState(initialContent);

  return (
    <section>
      <h2 className="font-serif text-lg mb-1">{t.termsTitle}</h2>
      <p className="text-stone-500 text-sm mb-3">{t.termsSubtitle}</p>

      <div className="space-y-3 mb-3">
        {blocks.map((block, idx) => (
          <ContentBlock
            key={block.key || `new-${idx}`}
            block={block}
            lang={lang}
            sampleMode={sampleMode}
            onRemove={() => setBlocks((prev) => prev.filter((b) => b !== block))}
          />
        ))}
      </div>

      <button
        onClick={() =>
          setBlocks((prev) => [...prev, { key: "", content_uk: "", content_en: "", updated_at: new Date().toISOString() }])
        }
        className="text-[13px] text-stone-500 hover:text-stone-900"
      >
        {t.addTermsBlock}
      </button>
    </section>
  );
}
