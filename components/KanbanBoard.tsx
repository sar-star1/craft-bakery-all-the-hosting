"use client";

import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";
import { STATUS_COLUMNS, type Order } from "@/lib/types";
import OrderCard from "./OrderCard";

const COL_LABEL_KEY = {
  pending_review: "colPendingReview",
  new: "colNew",
  confirmed: "colConfirmed",
  in_progress: "colInProgress",
  ready: "colReady",
  completed: "colCompleted",
} as const;

export default function KanbanBoard({
  orders,
  lang,
  onAdvance,
  onBack,
  onOpen,
}: {
  orders: Order[];
  lang: Lang;
  onAdvance: (id: string) => void;
  onBack: (id: string) => void;
  onOpen: (order: Order) => void;
}) {
  const t = STR[lang];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {STATUS_COLUMNS.map((col) => {
        const colOrders = orders.filter((o) => o.status === col);
        return (
          <div key={col} className="min-w-0">
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-[12px] font-medium text-stone-500">{t[COL_LABEL_KEY[col]]}</p>
              <span className="text-[11px] text-stone-400">{colOrders.length}</span>
            </div>
            <div className="bg-stone-100/60 rounded-lg p-2 min-h-[120px]">
              {colOrders.length === 0 ? (
                <p className="text-[12px] text-stone-400 text-center py-6">{t.empty}</p>
              ) : (
                colOrders.map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    lang={lang}
                    onAdvance={onAdvance}
                    onBack={onBack}
                    onOpen={onOpen}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
