"use client";

import { useState } from "react";
import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";
import type { PendingReply } from "@/lib/types";
import Sidebar from "./Sidebar";
import LangToggle from "./LangToggle";
import PendingReplyCard from "./PendingReplyCard";

export interface PendingReplyWithClientName extends PendingReply {
  clientName: string;
}

export default function PendingRepliesList({
  replies,
  sampleMode = false,
}: {
  replies: PendingReplyWithClientName[];
  sampleMode?: boolean;
}) {
  const [lang, setLang] = useState<Lang>("uk");
  const t = STR[lang];

  const awaiting = replies.filter((r) => r.status === "awaiting_approval");
  const resolved = replies.filter((r) => r.status !== "awaiting_approval");

  return (
    <div className="min-h-screen bg-[#FAF6EF] flex text-stone-900">
      <Sidebar lang={lang} setLang={setLang} />

      <main className="flex-1 min-w-0 px-5 md:px-8 py-6 max-w-2xl">
        {sampleMode && (
          <div className="mb-5 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
            Showing sample data — Supabase isn&apos;t configured yet.
          </div>
        )}

        <div className="flex items-center gap-3 md:hidden mb-4">
          <LangToggle lang={lang} setLang={setLang} />
        </div>

        <h1 className="font-serif text-2xl">{t.pendingRepliesTitle}</h1>
        <p className="text-stone-500 text-sm mt-0.5 mb-6">{t.pendingRepliesSubtitle}</p>

        {awaiting.length === 0 ? (
          <p className="text-stone-400 text-sm">{t.pendingRepliesEmpty}</p>
        ) : (
          <div className="space-y-3 mb-8">
            {awaiting.map((reply) => (
              <PendingReplyCard
                key={reply.id}
                reply={reply}
                lang={lang}
                sampleMode={sampleMode}
                clientName={reply.clientName}
              />
            ))}
          </div>
        )}

        {resolved.length > 0 && (
          <div className="space-y-3 opacity-60">
            {resolved.map((reply) => (
              <PendingReplyCard
                key={reply.id}
                reply={reply}
                lang={lang}
                sampleMode={sampleMode}
                clientName={reply.clientName}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
