"use client";

import { useState } from "react";
import type { Lang } from "@/lib/i18n";
import { SOURCE_DOT, SOURCE_LABEL, STR } from "@/lib/i18n";
import { STATUS_COLUMNS, type Order } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/utils";

export default function DetailPanel({
  order,
  lang,
  onClose,
  onAdvance,
  onBack,
  clients,
  onLink,
}: {
  order: Order | null;
  lang: Lang;
  onClose: () => void;
  onAdvance: (id: string) => void;
  onBack: (id: string) => void;
  clients: { id: string; business_name: string }[];
  onLink: (orderId: string, clientId: string) => void;
}) {
  const [pick, setPick] = useState("");
  if (!order) return null;
  const t = STR[lang];
  const itemSummary = lang === "en" ? order.item_summary_en ?? order.item_summary_uk : order.item_summary_uk;
  const details = lang === "en" ? order.item_details_en : order.item_details_uk;
  const notes = details?.notes ?? "—";

  return (
    <div className="fixed inset-0 z-20 flex justify-end">
      <div className="absolute inset-0 bg-stone-900/20" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white h-full shadow-xl p-6 overflow-y-auto">
        <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-sm mb-6">
          {t.close}
        </button>
        <h2 className="font-serif text-2xl text-stone-900 leading-tight">{order.customer_name}</h2>
        <p className="text-stone-500 text-sm mt-1">{itemSummary}</p>

        <div className="mt-6 space-y-4 text-sm">
          <div>
            <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.details}</p>
            <p className="text-stone-700">{notes}</p>
          </div>
          <div className="flex gap-8">
            <div>
              <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.dueDate}</p>
              <p className="text-stone-700">{formatDate(order.due_date, lang, "long")}</p>
            </div>
            <div>
              <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.total}</p>
              <p className="text-stone-700">{formatMoney(order.total_amount)}</p>
            </div>
          </div>
          <div>
            <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.receivedVia}</p>
            <p className="text-stone-700 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${SOURCE_DOT[order.source]}`} />
              {SOURCE_LABEL[lang][order.source]}
            </p>
          </div>
          {order.customer_contact && (
            <div>
              <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.fContact}</p>
              <p className="text-stone-700">{order.customer_contact}</p>
            </div>
          )}
          {details?.email && (
            <div>
              <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.orderEmail}</p>
              <p className="text-stone-700 break-all">{details.email}</p>
            </div>
          )}
          {details?.address && (
            <div>
              <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.orderAddress}</p>
              <p className="text-stone-700">{details.address}</p>
            </div>
          )}
          {details?.items && details.items.length > 0 && (
            <div>
              <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.orderItems}</p>
              <ul className="space-y-1">
                {details.items.map((line, i) => (
                  <li key={i} className="flex justify-between gap-3 text-[13px] text-stone-700">
                    <span className="min-w-0">
                      {line.name}
                      <span className="text-stone-400"> · {line.category}</span>
                    </span>
                    <span className="whitespace-nowrap text-stone-500">
                      {line.qty} × {formatMoney(line.unit_price)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.orderClient}</p>
            {order.client_id ? (
              <p className="text-stone-700">
                {clients.find((c) => c.id === order.client_id)?.business_name ?? "—"}
              </p>
            ) : (
              <div>
                <p className="text-amber-700 text-[13px] mb-2">{t.orderUnlinked}</p>
                <div className="flex gap-2">
                  <select
                    value={pick}
                    onChange={(e) => setPick(e.target.value)}
                    className="flex-1 min-w-0 border border-stone-200 rounded px-2 py-1.5 text-[13px]"
                  >
                    <option value="">{t.orderLinkPick}</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.business_name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!pick}
                    onClick={() => {
                      onLink(order.id, pick);
                      setPick("");
                    }}
                    className="text-[13px] bg-stone-900 text-white px-3 py-1.5 rounded hover:bg-stone-800 disabled:opacity-40"
                  >
                    {t.orderLinkBtn}
                  </button>
                </div>
              </div>
            )}
          </div>
          <div>
            <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.deposit}</p>
            <p className="text-stone-700">
              {order.deposit_status === "n/a"
                ? t.depositOptNA
                : order.deposit_status === "paid"
                ? t.depositOptPaid
                : t.depositOptPending}
            </p>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-stone-100 flex gap-2">
          {order.status !== STATUS_COLUMNS[0] && (
            <button
              onClick={() => onBack(order.id)}
              className="flex-1 text-sm px-3 py-2 rounded border border-stone-200 text-stone-600 hover:bg-stone-50"
            >
              {t.moveBack}
            </button>
          )}
          {order.status !== STATUS_COLUMNS[STATUS_COLUMNS.length - 1] && (
            <button
              onClick={() => onAdvance(order.id)}
              className="flex-1 text-sm px-3 py-2 rounded bg-stone-900 text-white hover:bg-stone-800"
            >
              {t.advance}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
