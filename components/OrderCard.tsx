"use client";

import type { Lang } from "@/lib/i18n";
import { CATEGORY_BADGE, CATEGORY_LABEL, SOURCE_DOT, SOURCE_LABEL, STR } from "@/lib/i18n";
import { STATUS_COLUMNS, type Order } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/utils";

export default function OrderCard({
  order,
  lang,
  onAdvance,
  onBack,
  onOpen,
}: {
  order: Order;
  lang: Lang;
  onAdvance: (id: string) => void;
  onBack: (id: string) => void;
  onOpen: (order: Order) => void;
}) {
  const t = STR[lang];
  const itemSummary = lang === "en" ? order.item_summary_en ?? order.item_summary_uk : order.item_summary_uk;

  return (
    <div
      onClick={() => onOpen(order)}
      className="bg-white rounded-md border border-stone-200 p-3 mb-3 cursor-pointer hover:border-stone-300 hover:shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-serif text-[15px] text-stone-900 leading-snug truncate">
            {order.customer_name}
          </p>
          <p className="text-[13px] text-stone-500 mt-0.5 leading-snug">{itemSummary}</p>
        </div>
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap ${CATEGORY_BADGE[order.category]}`}
        >
          {CATEGORY_LABEL[lang][order.category]}
        </span>
      </div>

      <div className="flex items-center gap-3 mt-3 text-[12px] text-stone-500">
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${SOURCE_DOT[order.source]}`} />
          {SOURCE_LABEL[lang][order.source]}
        </span>
        <span>{formatDate(order.due_date, lang)}</span>
        <span className="ml-auto font-medium text-stone-700">{formatMoney(order.total_amount)}</span>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-stone-100">
        <span
          className={`text-[11px] px-1.5 py-0.5 rounded ${
            order.deposit_status === "paid"
              ? "bg-emerald-50 text-emerald-700"
              : order.deposit_status === "pending"
              ? "bg-amber-50 text-amber-700"
              : "text-stone-400"
          }`}
        >
          {order.deposit_status === "n/a"
            ? "—"
            : order.deposit_status === "paid"
            ? t.depositPaid
            : t.depositPending}
        </span>
        <div className="flex gap-1">
          {order.status !== STATUS_COLUMNS[0] && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onBack(order.id);
              }}
              className="text-[12px] text-stone-400 hover:text-stone-700 px-1.5"
              aria-label={t.moveBack}
            >
              ←
            </button>
          )}
          {order.status !== STATUS_COLUMNS[STATUS_COLUMNS.length - 1] && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onAdvance(order.id);
              }}
              className="text-[12px] text-stone-400 hover:text-stone-700 px-1.5"
              aria-label={t.advance}
            >
              →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
