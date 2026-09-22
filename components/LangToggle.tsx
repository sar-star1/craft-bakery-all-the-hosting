"use client";

import type { Lang } from "@/lib/i18n";

export default function LangToggle({
  lang,
  setLang,
}: {
  lang: Lang;
  setLang: (lang: Lang) => void;
}) {
  return (
    <div className="flex rounded-full border border-stone-200 p-0.5 text-[12px]">
      {(["uk", "en"] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2.5 py-1 rounded-full transition-colors ${
            lang === l ? "bg-stone-900 text-white" : "text-stone-400 hover:text-stone-700"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
