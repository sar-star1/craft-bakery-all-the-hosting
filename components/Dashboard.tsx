"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { advanceOrderStatus, revertOrderStatus } from "@/app/actions";
import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";
import { nextStatus, prevStatus, type Order } from "@/lib/types";
import Sidebar from "./Sidebar";
import LangToggle from "./LangToggle";
import StatsBar from "./StatsBar";
import FilterBar, { type CategoryFilter } from "./FilterBar";
import KanbanBoard from "./KanbanBoard";
import DetailPanel from "./DetailPanel";
import NewOrderForm from "./NewOrderForm";

export default function Dashboard({
  initialOrders,
  sampleMode = false,
}: {
  initialOrders: Order[];
  // Skips the real Supabase-backed server actions so the UI stays fully
  // interactive when previewing with lib/mockOrders.ts (no DB to write to).
  sampleMode?: boolean;
}) {
  const [lang, setLang] = useState<Lang>("uk");
  const [orders, setOrders] = useState(initialOrders);
  const [filter, setFilter] = useState<CategoryFilter>("all");
  const [openOrderId, setOpenOrderId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [, startTransition] = useTransition();

  // Re-sync whenever the server re-fetches after a mutation revalidates "/".
  useEffect(() => {
    setOrders(initialOrders);
  }, [initialOrders]);

  const t = STR[lang];

  const advance = (id: string) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status: nextStatus(o.status) } : o))
    );
    if (sampleMode) return;
    startTransition(async () => {
      const order = orders.find((o) => o.id === id);
      if (order) await advanceOrderStatus(id, order.status);
    });
  };

  const back = (id: string) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status: prevStatus(o.status) } : o))
    );
    if (sampleMode) return;
    startTransition(async () => {
      const order = orders.find((o) => o.id === id);
      if (order) await revertOrderStatus(id, order.status);
    });
  };

  const addMockOrder = (formData: FormData): string | void => {
    const customerName = String(formData.get("customer_name") ?? "").trim();
    const itemSummary = String(formData.get("item_summary_uk") ?? "").trim();
    if (!customerName || !itemSummary) return "formError";

    const notes = String(formData.get("notes") ?? "").trim();
    const totalRaw = String(formData.get("total_amount") ?? "").trim();
    const newOrder: Order = {
      id: `ord_mock_${Date.now()}`,
      client_id: null,
      category: String(formData.get("category") ?? "b2c") as Order["category"],
      source: "manual",
      customer_name: customerName,
      customer_contact: String(formData.get("customer_contact") ?? "").trim() || null,
      item_summary_uk: itemSummary,
      item_summary_en: null,
      item_details_uk: notes ? { notes } : null,
      item_details_en: null,
      status: "new",
      deposit_status: String(formData.get("deposit_status") ?? "n/a") as Order["deposit_status"],
      total_amount: totalRaw ? Number(totalRaw) : null,
      due_date: String(formData.get("due_date") ?? "").trim() || null,
      raw_message: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setOrders((prev) => [newOrder, ...prev]);
  };

  const filtered = useMemo(
    () => (filter === "all" ? orders : orders.filter((o) => o.category === filter)),
    [orders, filter]
  );

  const openOrder = orders.find((o) => o.id === openOrderId) ?? null;

  return (
    <div className="min-h-screen bg-[#FAF6EF] flex text-stone-900">
      <Sidebar lang={lang} setLang={setLang} />

      <main className="flex-1 min-w-0 px-5 md:px-8 py-6">
        {sampleMode && (
          <div className="mb-5 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Showing sample data — Supabase isn&apos;t configured yet, so nothing here is saved.
            Add credentials to <code>.env.local</code> to connect real orders.
          </div>
        )}
        <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 md:hidden mb-2">
              <LangToggle lang={lang} setLang={setLang} />
            </div>
            <h1 className="font-serif text-2xl">{t.title}</h1>
            <p className="text-stone-500 text-sm mt-0.5">{t.subtitle}</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="text-sm bg-stone-900 text-white px-4 py-2 rounded hover:bg-stone-800"
          >
            {t.newOrder}
          </button>
        </div>

        <StatsBar orders={orders} lang={lang} />
        <FilterBar lang={lang} filter={filter} setFilter={setFilter} />
        <KanbanBoard
          orders={filtered}
          lang={lang}
          onAdvance={advance}
          onBack={back}
          onOpen={(order) => setOpenOrderId(order.id)}
        />
      </main>

      <DetailPanel
        order={openOrder}
        lang={lang}
        onClose={() => setOpenOrderId(null)}
        onAdvance={advance}
        onBack={back}
      />

      {showForm && (
        <NewOrderForm
          lang={lang}
          onClose={() => setShowForm(false)}
          onMockSubmit={sampleMode ? addMockOrder : undefined}
        />
      )}
    </div>
  );
}
