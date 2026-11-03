"use client";

import { useState, type ReactNode } from "react";
import type { Lang } from "@/lib/i18n";
import { dt } from "@/lib/dashText";

// One column of a board. Long columns show the newest few cards and a "show more" button, and
// scroll on their own, so a column that keeps growing never makes the whole page long.
export default function BoardColumn<T extends { id: string }>({
  label,
  items,
  render,
  empty,
  lang,
  limit = 8,
}: {
  label: string;
  items: T[];
  render: (item: T) => ReactNode;
  empty: string;
  lang: Lang;
  limit?: number;
}) {
  const [all, setAll] = useState(false);
  const t = dt(lang);
  const shown = all ? items : items.slice(0, limit);
  const hidden = items.length - shown.length;
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-[12px] font-medium text-stone-500">{label}</p>
        <span className="text-[11px] text-stone-400">{items.length}</span>
      </div>
      <div className="bg-stone-100/60 rounded-lg p-2 min-h-[120px] max-h-[75vh] overflow-y-auto">
        {items.length === 0 ? <p className="text-[12px] text-stone-400 text-center py-6">{empty}</p> : shown.map((item) => <div key={item.id}>{render(item)}</div>)}
        {hidden > 0 && (
          <button onClick={() => setAll(true)} className="w-full text-[12px] text-stone-500 hover:text-stone-800 py-2 rounded hover:bg-stone-200/60">
            {t.showMore(hidden)}
          </button>
        )}
        {all && items.length > limit && (
          <button onClick={() => setAll(false)} className="w-full text-[12px] text-stone-400 hover:text-stone-700 py-2">
            {t.showLess}
          </button>
        )}
      </div>
    </div>
  );
}
