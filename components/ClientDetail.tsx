"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { updateClientPipelineStage } from "@/app/actions";
import type { Lang } from "@/lib/i18n";
import {
  CATEGORY_BADGE,
  CATEGORY_LABEL,
  CLIENT_STATUS_BADGE,
  CLIENT_STATUS_KEY,
  PIPELINE_STAGE_BADGE,
  PIPELINE_STAGE_KEY,
  STR,
} from "@/lib/i18n";
import { PIPELINE_STAGES, type Client, type Conversation, type Order, type PendingReply } from "@/lib/types";
import { formatDateTime, formatMoney } from "@/lib/utils";
import Sidebar from "./Sidebar";
import LangToggle from "./LangToggle";
import PendingReplyCard from "./PendingReplyCard";

export default function ClientDetail({
  client,
  conversation,
  pendingReplies,
  orders,
  sampleMode = false,
}: {
  client: Client;
  conversation: Conversation | null;
  pendingReplies: PendingReply[];
  orders: Order[];
  sampleMode?: boolean;
}) {
  const [lang, setLang] = useState<Lang>("uk");
  const [stage, setStage] = useState(client.pipeline_stage);
  const [, startTransition] = useTransition();
  const t = STR[lang];

  const handleStageChange = (next: Client["pipeline_stage"]) => {
    setStage(next);
    if (sampleMode) return;
    startTransition(async () => {
      await updateClientPipelineStage(client.id, next);
    });
  };

  return (
    <div className="min-h-screen bg-[#FAF6EF] flex text-stone-900">
      <Sidebar lang={lang} setLang={setLang} />

      <main className="flex-1 min-w-0 px-5 md:px-8 py-6 max-w-3xl">
        {sampleMode && (
          <div className="mb-5 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Showing sample data — Supabase isn&apos;t configured yet.
          </div>
        )}

        <div className="flex items-center gap-3 md:hidden mb-4">
          <LangToggle lang={lang} setLang={setLang} />
        </div>

        <Link href="/clients" className="text-stone-400 hover:text-stone-700 text-sm mb-4 inline-block">
          ← {t.clientBack}
        </Link>

        <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
          <div>
            <h1 className="font-serif text-2xl">{client.business_name}</h1>
            <p className="text-stone-500 text-sm mt-0.5">{client.contact_name ?? "—"}</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-[11px] font-medium px-2 py-1 rounded ${CLIENT_STATUS_BADGE[client.status]}`}
            >
              {t[CLIENT_STATUS_KEY[client.status]]}
            </span>
            <select
              value={stage}
              onChange={(e) => handleStageChange(e.target.value as Client["pipeline_stage"])}
              className={`text-[11px] font-medium px-2 py-1 rounded border-none ${PIPELINE_STAGE_BADGE[stage]}`}
            >
              {PIPELINE_STAGES.map((s) => (
                <option key={s} value={s}>
                  {t[PIPELINE_STAGE_KEY[s]]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
          <div>
            <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">
              {t.clientLastContact}
            </p>
            <p className="text-stone-700">
              {client.last_contact_at ? formatDateTime(client.last_contact_at, lang) : t.clientNever}
            </p>
          </div>
          <div>
            <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.clientLastOrder}</p>
            <p className="text-stone-700">
              {client.last_order_at ? formatDateTime(client.last_order_at, lang) : t.clientNever}
            </p>
          </div>
        </div>

        {client.standing_order_notes && (
          <div className="bg-white rounded-md border border-stone-200 p-4 mb-6">
            <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">
              {t.clientStandingOrder}
            </p>
            <p className="text-stone-700 text-sm">{client.standing_order_notes}</p>
          </div>
        )}

        <section className="mb-8">
          <h2 className="font-serif text-lg mb-3">{t.clientConversation}</h2>
          {!conversation ? (
            <p className="text-stone-400 text-sm">{t.clientNoConversation}</p>
          ) : (
            <div className="bg-white rounded-md border border-stone-200 p-4 space-y-3">
              <p className="text-[12px] text-stone-500">
                {t.details}: <span className="text-stone-700">{conversation.status}</span>
                {" · "}
                {formatDateTime(conversation.last_message_at, lang)}
              </p>

              <div className="space-y-3">
                {pendingReplies.map((reply) => (
                  <PendingReplyCard key={reply.id} reply={reply} lang={lang} sampleMode={sampleMode} />
                ))}
              </div>
            </div>
          )}
        </section>

        <section>
          <h2 className="font-serif text-lg mb-3">{t.clientOrderHistory}</h2>
          {orders.length === 0 ? (
            <p className="text-stone-400 text-sm">{t.clientNoOrders}</p>
          ) : (
            <div className="space-y-2">
              {orders.map((order) => {
                const summary = lang === "en" ? order.item_summary_en ?? order.item_summary_uk : order.item_summary_uk;
                return (
                  <div
                    key={order.id}
                    className="bg-white rounded-md border border-stone-200 p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-stone-800 truncate">{summary}</p>
                      <p className="text-[12px] text-stone-400 mt-0.5">
                        {formatDateTime(order.created_at, lang)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${CATEGORY_BADGE[order.category]}`}
                      >
                        {CATEGORY_LABEL[lang][order.category]}
                      </span>
                      <span className="text-sm font-medium text-stone-700">
                        {formatMoney(order.total_amount)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
