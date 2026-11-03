"use client";

import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";
import { STATUS_COLUMNS, type Order } from "@/lib/types";
import OrderCard from "./OrderCard";
import BoardColumn from "./BoardColumn";

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

  const byNewest = (list: Order[]) => [...list].sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at));

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
      {STATUS_COLUMNS.map((col) => (
        <BoardColumn
          key={col}
          label={t[COL_LABEL_KEY[col]]}
          items={byNewest(orders.filter((o) => o.status === col))}
          empty={t.empty}
          lang={lang}
          // Finished orders pile up forever: show only the latest few unless asked.
          limit={col === "completed" ? 4 : 8}
          render={(o) => <OrderCard order={o} lang={lang} onAdvance={onAdvance} onBack={onBack} onOpen={onOpen} />}
        />
      ))}
    </div>
  );
}
