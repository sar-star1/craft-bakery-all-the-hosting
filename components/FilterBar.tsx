"use client";

import type { Lang } from "@/lib/i18n";
import { CATEGORY_LABEL, STR } from "@/lib/i18n";
import type { OrderCategory } from "@/lib/types";

export type CategoryFilter = OrderCategory | "all";

export default function FilterBar({
  lang,
  filter,
  setFilter,
}: {
  lang: Lang;
  filter: CategoryFilter;
  setFilter: (f: CategoryFilter) => void;
}) {
  const t = STR[lang];
  const options: CategoryFilter[] = ["all", "b2c", "b2b", "standard_line"];

  return (
    <div className="flex gap-1.5 mb-5 flex-wrap">
      {options.map((f) => (
        <button
          key={f}
          onClick={() => setFilter(f)}
          className={`text-[13px] px-3 py-1 rounded-full border ${
            filter === f
              ? "bg-stone-900 text-white border-stone-900"
              : "border-stone-200 text-stone-500 hover:border-stone-300"
          }`}
        >
          {f === "all" ? t.filterAll : CATEGORY_LABEL[lang][f]}
        </button>
      ))}
    </div>
  );
}
