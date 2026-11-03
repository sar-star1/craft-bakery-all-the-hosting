"use client";

import type { Lang } from "@/lib/i18n";
import { SOURCE_DOT, SOURCE_LABEL, STR } from "@/lib/i18n";
import { dt } from "@/lib/dashText";
import type { Order, OrderStatus } from "@/lib/types";
import { formatDate, formatDateTime, formatMoney } from "@/lib/utils";

const STATUS_KEY = {
  pending_review: "colPendingReview",
  new: "colNew",
  confirmed: "colConfirmed",
  in_progress: "colInProgress",
  ready: "colReady",
  completed: "colCompleted",
} as const;

const STATUS_BADGE: Record<OrderStatus, string> = {
  pending_review: "bg-amber-50 text-amber-800",
  new: "bg-sky-50 text-sky-800",
  confirmed: "bg-indigo-50 text-indigo-800",
  in_progress: "bg-violet-50 text-violet-800",
  ready: "bg-emerald-50 text-emerald-800",
  completed: "bg-stone-100 text-stone-500",
};

// A client's orders, newest first and grouped by month: a short summary on top, the latest month
// open, older months folded away, and each order opens to show what was in it.
export default function ClientOrders({ orders, lang }: { orders: Order[]; lang: Lang }) {
  const t = STR[lang];
  const d = dt(lang);
  if (orders.length === 0) return <p className="text-stone-400 text-sm">{t.clientNoOrders}</p>;

  const sorted = [...orders].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const total = sorted.reduce((sum, o) => sum + (o.total_amount ?? 0), 0);

  const groups = new Map<string, Order[]>();
  for (const o of sorted) {
    const key = o.created_at.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const monthLabel = (key: string) =>
    new Date(`${key}-01T00:00:00`).toLocaleDateString(lang === "uk" ? "uk-UA" : "en-US", { month: "long", year: "numeric" });

  return (
    <div>
      <div className="grid grid-cols-3 gap-3 mb-4">
        <Stat label={d.ordersTotal} value={formatMoney(total)} sub={d.ordersCount(sorted.length)} />
        <Stat label={d.avgOrder} value={formatMoney(Math.round(total / sorted.length))} />
        <Stat label={d.lastOrder} value={formatDateTime(sorted[0].created_at, lang)} />
      </div>

      <div className="space-y-3">
        {[...groups.entries()].map(([key, list], i) => (
          <details key={key} open={i === 0} className="group bg-white rounded-md border border-stone-200">
            <summary className="cursor-pointer list-none flex items-center justify-between gap-3 px-4 py-3 select-none">
              <span className="font-serif text-[15px] capitalize">{monthLabel(key)}</span>
              <span className="text-[12px] text-stone-500">
                {d.ordersCount(list.length)} · {formatMoney(list.reduce((s, o) => s + (o.total_amount ?? 0), 0))}
                <span className="ml-2 text-stone-300 group-open:rotate-90 inline-block transition-transform">›</span>
              </span>
            </summary>
            <ul className="divide-y divide-stone-100 border-t border-stone-100">
              {list.map((o) => (
                <OrderRow key={o.id} order={o} lang={lang} />
              ))}
            </ul>
          </details>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-md border border-stone-200 px-3 py-2.5">
      <p className="text-[11px] text-stone-400 uppercase tracking-wide">{label}</p>
      <p className="font-serif text-lg mt-0.5 leading-tight">{value}</p>
      {sub && <p className="text-[11px] text-stone-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function OrderRow({ order, lang }: { order: Order; lang: Lang }) {
  const t = STR[lang];
  const d = dt(lang);
  const summary = lang === "en" ? order.item_summary_en ?? order.item_summary_uk : order.item_summary_uk;
  const details = order.item_details_uk;
  const lines = details?.items ?? [];
  return (
    <li>
      <details className="group/row">
        <summary className="cursor-pointer list-none flex items-center gap-3 px-4 py-2.5 hover:bg-stone-50 select-none">
          <span className="text-[12px] text-stone-400 w-14 shrink-0">{new Date(order.created_at).toLocaleDateString(lang === "uk" ? "uk-UA" : "en-US", { day: "numeric", month: "short" })}</span>
          <span className="text-[13px] text-stone-800 truncate min-w-0 flex-1">{summary}</span>
          <span className={`text-[11px] px-1.5 py-0.5 rounded shrink-0 ${STATUS_BADGE[order.status]}`}>{t[STATUS_KEY[order.status]]}</span>
          <span className="text-[13px] font-medium text-stone-700 w-20 text-right shrink-0">{formatMoney(order.total_amount)}</span>
        </summary>
        <div className="px-4 pb-3 pt-1 bg-stone-50/60 text-[12px] text-stone-600 space-y-2">
          <p className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${SOURCE_DOT[order.source]}`} />
            {SOURCE_LABEL[lang][order.source]}
            {order.due_date ? ` · ${d.due}: ${formatDate(order.due_date, lang)}` : ""}
          </p>
          {lines.length > 0 ? (
            <div>
              <p className="text-stone-400 uppercase tracking-wide text-[10px] mb-0.5">{d.items}</p>
              <ul>
                {lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>
                      {l.name} ×{l.qty}
                    </span>
                    <span className="text-stone-500">{formatMoney(l.subtotal)}</span>
                  </li>
                ))}
                {typeof details?.delivery_fee === "number" && (
                  <li className="flex justify-between gap-3 text-stone-500">
                    <span>{d.delivery}</span>
                    <span>{details.delivery_fee > 0 ? formatMoney(details.delivery_fee) : "—"}</span>
                  </li>
                )}
              </ul>
            </div>
          ) : (
            <p className="text-stone-400">{d.noItems}</p>
          )}
          {details?.address && (
            <p>
              <span className="text-stone-400">{d.address}: </span>
              {details.address}
            </p>
          )}
          {details?.payment_method && (
            <p>
              <span className="text-stone-400">{d.payment}: </span>
              {details.payment_method === "cash" ? d.cash : d.cashless}
            </p>
          )}
          {details?.notes && (
            <p>
              <span className="text-stone-400">{d.notes}: </span>
              {details.notes}
            </p>
          )}
        </div>
      </details>
    </li>
  );
}
