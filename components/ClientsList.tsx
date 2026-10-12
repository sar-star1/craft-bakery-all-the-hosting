"use client";

import { useEffect, useState, useTransition } from "react";
import { deleteClient, updateClientPipelineStage } from "@/app/actions";
import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import { CLIENT_STATUS_BADGE, CLIENT_STATUS_KEY, PIPELINE_STAGE_KEY, STR } from "@/lib/i18n";
import { PIPELINE_STAGES, type Client } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import Sidebar from "./Sidebar";
import LangToggle from "./LangToggle";
import NewClientForm from "./NewClientForm";

function ClientCard({
  client,
  lang,
  onMove,
  onDelete,
}: {
  client: Client;
  lang: Lang;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const t = STR[lang];
  const stop = (e: React.MouseEvent, fn: () => void) => {
    e.preventDefault(); // the card is a link — these buttons must not open it
    e.stopPropagation();
    fn();
  };
  const idx = PIPELINE_STAGES.indexOf(client.pipeline_stage);
  const hasOrdered = client.pipeline_stage === "first_order" || client.pipeline_stage === "recurring";
  return (
    <Link
      href={`/clients/${client.id}`}
      className="block bg-white rounded-md border border-stone-200 p-3 mb-3 hover:border-stone-300 hover:shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-serif text-[15px] text-stone-900 leading-snug truncate">{client.business_name}</p>
        <button
          onClick={(e) =>
            stop(e, () => {
              if (window.confirm(lang === "uk" ? `Видалити клієнта «${client.business_name}»? Переписку й чернетки буде видалено, замовлення залишаться без прив'язки.` : `Delete client “${client.business_name}”?`)) onDelete();
            })
          }
          title={lang === "uk" ? "Видалити клієнта" : "Delete client"}
          className="text-stone-300 hover:text-rose-600 text-sm leading-none shrink-0"
        >
          ×
        </button>
      </div>
      <p className="text-[13px] text-stone-500 mt-0.5 truncate">{client.contact_name ?? "—"}</p>
      {!hasOrdered && client.lead_temperature && (
        <span
          className={`inline-block mt-2 text-[10px] font-medium px-1.5 py-0.5 rounded ${
            client.lead_temperature === "warm" ? "bg-orange-100 text-orange-900" : "bg-sky-100 text-sky-900"
          }`}
        >
          {client.lead_temperature === "warm" ? t.tempWarm : t.tempCold}
        </span>
      )}
      {client.blocker_note && !hasOrdered && (
        <p className="text-[12px] text-stone-600 mt-2 leading-snug line-clamp-3 bg-stone-50 rounded px-2 py-1.5">
          {client.blocker_note}
        </p>
      )}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-stone-100">
        <div className="flex items-center gap-1">
          <button
            disabled={idx <= 0}
            onClick={(e) => stop(e, () => onMove(-1))}
            className="w-6 h-6 rounded border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-25 text-[12px]"
            title={lang === "uk" ? "Перемістити назад" : "Move back"}
          >
            ←
          </button>
          <button
            disabled={idx >= PIPELINE_STAGES.length - 1}
            onClick={(e) => stop(e, () => onMove(1))}
            className="w-6 h-6 rounded border border-stone-200 text-stone-500 hover:bg-stone-50 disabled:opacity-25 text-[12px]"
            title={lang === "uk" ? "Перемістити далі" : "Move forward"}
          >
            →
          </button>
        </div>
        <span className="text-[11px] text-stone-400">
          {client.last_contact_at ? formatDateTime(client.last_contact_at, lang) : t.clientNever}
        </span>
      </div>
    </Link>
  );
}

export default function ClientsList({
  clients,
  sampleMode = false,
}: {
  clients: Client[];
  sampleMode?: boolean;
}) {
  const [lang, setLang] = useState<Lang>("uk");
  const [showForm, setShowForm] = useState(false);
  const [items, setItems] = useState(clients);
  const [, startTransition] = useTransition();
  const t = STR[lang];

  // Re-sync when the server sends fresh data (new leads, orders that moved someone).
  useEffect(() => setItems(clients), [clients]);

  const move = (id: string, dir: -1 | 1) => {
    const c = items.find((x) => x.id === id);
    if (!c) return;
    const next = PIPELINE_STAGES[PIPELINE_STAGES.indexOf(c.pipeline_stage) + dir];
    if (!next) return;
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, pipeline_stage: next } : x)));
    if (sampleMode) return;
    startTransition(async () => {
      await updateClientPipelineStage(id, next);
    });
  };

  const remove = (id: string) => {
    setItems((prev) => prev.filter((x) => x.id !== id));
    if (sampleMode) return;
    startTransition(async () => {
      await deleteClient(id, false);
    });
  };

  return (
    <div className="min-h-screen bg-[#FAF6EF] flex text-stone-900">
      <Sidebar lang={lang} setLang={setLang} />

      <main className="flex-1 min-w-0 px-5 md:px-8 py-6">
        {sampleMode && (
          <div className="mb-5 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Showing sample data — Supabase isn&apos;t configured yet.
          </div>
        )}
        <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 md:hidden mb-2">
              <LangToggle lang={lang} setLang={setLang} />
            </div>
            <h1 className="font-serif text-2xl">{t.navClientsTitle}</h1>
            <p className="text-stone-500 text-sm mt-0.5">{t.clientPipelineSubtitle}</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="text-sm bg-stone-900 text-white px-4 py-2 rounded hover:bg-stone-800"
          >
            {t.newClient}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {PIPELINE_STAGES.map((stage) => {
            const stageClients = items.filter((c) => c.pipeline_stage === stage);
            return (
              <div key={stage} className="min-w-0">
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-[12px] font-medium text-stone-500">{t[PIPELINE_STAGE_KEY[stage]]}</p>
                  <span className="text-[11px] text-stone-400">{stageClients.length}</span>
                </div>
                <div className="bg-stone-100/60 rounded-lg p-2 min-h-[120px]">
                  {stageClients.length === 0 ? (
                    <p className="text-[12px] text-stone-400 text-center py-6">{t.empty}</p>
                  ) : (
                    stageClients.map((c) => (
                      <ClientCard key={c.id} client={c} lang={lang} onMove={(d) => move(c.id, d)} onDelete={() => remove(c.id)} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {showForm && (
        <NewClientForm lang={lang} onClose={() => setShowForm(false)} sampleMode={sampleMode} />
      )}
    </div>
  );
}
