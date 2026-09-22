"use client";

import { useState } from "react";
import Link from "next/link";
import type { Lang } from "@/lib/i18n";
import { CLIENT_STATUS_BADGE, CLIENT_STATUS_KEY, PIPELINE_STAGE_KEY, STR } from "@/lib/i18n";
import { PIPELINE_STAGES, type Client } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import Sidebar from "./Sidebar";
import LangToggle from "./LangToggle";
import NewClientForm from "./NewClientForm";

function ClientCard({ client, lang }: { client: Client; lang: Lang }) {
  const t = STR[lang];
  return (
    <Link
      href={`/clients/${client.id}`}
      className="block bg-white rounded-md border border-stone-200 p-3 mb-3 hover:border-stone-300 hover:shadow-sm transition-colors"
    >
      <p className="font-serif text-[15px] text-stone-900 leading-snug truncate">
        {client.business_name}
      </p>
      <p className="text-[13px] text-stone-500 mt-0.5 truncate">{client.contact_name ?? "—"}</p>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-stone-100">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${CLIENT_STATUS_BADGE[client.status]}`}>
          {t[CLIENT_STATUS_KEY[client.status]]}
        </span>
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
  const t = STR[lang];

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

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {PIPELINE_STAGES.map((stage) => {
            const stageClients = clients.filter((c) => c.pipeline_stage === stage);
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
                    stageClients.map((c) => <ClientCard key={c.id} client={c} lang={lang} />)
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
