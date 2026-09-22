"use client";

import { useState, useTransition } from "react";
import { approvePendingReply, rejectPendingReply } from "@/app/actions";
import type { Lang } from "@/lib/i18n";
import {
  PENDING_REPLY_STATUS_KEY,
  PENDING_REPLY_TYPE_BADGE,
  PENDING_REPLY_TYPE_KEY,
  STR,
} from "@/lib/i18n";
import type { PendingReply, PendingReplyStatus } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

export default function PendingReplyCard({
  reply,
  lang,
  sampleMode = false,
  clientName,
}: {
  reply: PendingReply;
  lang: Lang;
  sampleMode?: boolean;
  // Shown in the global Pending Replies view where cards span clients;
  // omitted in ClientDetail where the page is already scoped to one.
  clientName?: string;
}) {
  const t = STR[lang];
  const [status, setStatus] = useState<PendingReplyStatus>(reply.status);
  const [error, setError] = useState<string | undefined>();
  const [pending, startTransition] = useTransition();

  const resolve = (nextStatus: "approved_sent" | "rejected") => {
    setError(undefined);
    if (sampleMode) {
      setStatus(nextStatus);
      return;
    }
    startTransition(async () => {
      const result =
        nextStatus === "approved_sent"
          ? await approvePendingReply(reply.id)
          : await rejectPendingReply(reply.id);
      if (result.error) {
        setError(result.error);
        return;
      }
      setStatus(nextStatus);
    });
  };

  return (
    <div className="border border-amber-200 bg-amber-50 rounded p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[11px] text-amber-700 uppercase tracking-wide">{t.pendingReplyDraft}</p>
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${PENDING_REPLY_TYPE_BADGE[reply.reply_type]}`}
        >
          {t[PENDING_REPLY_TYPE_KEY[reply.reply_type]]}
        </span>
      </div>
      {clientName && <p className="text-[12px] text-stone-600 font-medium mb-1">{clientName}</p>}
      <p className="text-stone-700 text-sm mb-1">{reply.draft_text}</p>
      <p className="text-[11px] text-stone-400 mb-2">{formatDateTime(reply.created_at, lang)}</p>

      {status === "awaiting_approval" ? (
        <>
          <p className="text-[11px] text-stone-400 mb-2">{t.pendingReplyNote}</p>
          <div className="flex gap-2">
            <button
              onClick={() => resolve("approved_sent")}
              disabled={pending}
              className="text-[12px] px-2.5 py-1 rounded bg-stone-900 text-white hover:bg-stone-800 disabled:opacity-60"
            >
              {t.pendingReplyApprove}
            </button>
            <button
              onClick={() => resolve("rejected")}
              disabled={pending}
              className="text-[12px] px-2.5 py-1 rounded border border-stone-200 text-stone-600 hover:bg-stone-50 disabled:opacity-60"
            >
              {t.pendingReplyReject}
            </button>
          </div>
          {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}
        </>
      ) : (
        <span className="text-[12px] text-stone-500">{t[PENDING_REPLY_STATUS_KEY[status]]}</span>
      )}
    </div>
  );
}
