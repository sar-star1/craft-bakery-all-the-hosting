"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteSentClientMessage, editSentClientMessage, sendTeamMessage, setClientAgentPaused, tellClientViaAgentAction } from "@/app/actions";
import type { Lang } from "@/lib/i18n";
import type { Message } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

// The conversation with a client, plus the team's controls over it: edit or delete what the
// agent already sent, take the conversation over, write to the client directly.
export default function MessageThread({
  clientId,
  messages,
  paused: initialPaused,
  lang,
  sampleMode = false,
}: {
  clientId: string;
  messages: Message[];
  paused: boolean;
  lang: Lang;
  sampleMode?: boolean;
}) {
  const uk = lang === "uk";
  const router = useRouter();
  const [paused, setPaused] = useState(initialPaused);
  const [draft, setDraft] = useState("");
  const [tell, setTell] = useState("");
  const [tellNote, setTellNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [busy, startTransition] = useTransition();

  const run = (fn: () => Promise<{ error?: string }>, after?: () => void) => {
    setError(undefined);
    if (sampleMode) return;
    startTransition(async () => {
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        after?.();
        router.refresh();
      }
    });
  };

  const togglePause = () => {
    const next = !paused;
    run(() => setClientAgentPaused(clientId, next), () => setPaused(next));
  };
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    run(() => sendTeamMessage(clientId, text), () => {
      setDraft("");
      setPaused(true);
    });
  };
  const sendTell = () => {
    const instruction = tell.trim();
    if (!instruction) return;
    run(
      async () => {
        const r = await tellClientViaAgentAction(clientId, instruction);
        if (!r.error) setTellNote(r.sent ? (uk ? "Надіслано клієнту." : "Sent to the client.") : uk ? `Агент склав повідомлення — чернетка нижче, підтвердіть ✅: «${r.text}»` : `Drafted — confirm it below: “${r.text}”`);
        return r;
      },
      () => setTell("")
    );
  };
  const saveEdit = (id: string) => run(() => editSentClientMessage(id, editText), () => setEditing(null));
  const remove = (id: string) => {
    if (!window.confirm(uk ? "Видалити це повідомлення з чату клієнта? Клієнт його більше не побачить." : "Delete this message from the client's chat? They will no longer see it.")) return;
    run(() => deleteSentClientMessage(id));
  };

  return (
    <div>
      <div
        className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 mb-3 text-[13px] ${
          paused ? "bg-violet-50 border-violet-200 text-violet-900" : "bg-white border-stone-200 text-stone-600"
        }`}
      >
        <span>
          {paused
            ? uk
              ? "🙋 Розмову веде команда — агент мовчить, нові повідомлення клієнта надходять у групу."
              : "🙋 The team is in charge — the agent stays silent; new client messages go to the group."
            : uk
              ? "🤖 Клієнту відповідає агент."
              : "🤖 The agent is answering this client."}
        </span>
        <button
          onClick={togglePause}
          disabled={busy}
          className="text-[12px] px-2.5 py-1 rounded border border-stone-300 bg-white text-stone-700 hover:bg-stone-50 disabled:opacity-50"
        >
          {paused ? (uk ? "Повернути агенту" : "Hand back to the agent") : uk ? "Перебрати розмову" : "Take over"}
        </button>
      </div>

      {messages.length === 0 ? (
        <p className="text-stone-400 text-sm">{uk ? "Повідомлень ще немає." : "No messages yet."}</p>
      ) : (
        <div className="bg-white rounded-md border border-stone-200 p-4 space-y-2 max-h-[28rem] overflow-y-auto">
          {messages.map((m) => {
            const out = m.direction === "out";
            const canChange = out && Boolean(m.telegram_message_id) && !m.deleted_at;
            return (
              <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${out ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-800"} ${m.deleted_at ? "opacity-50" : ""}`}>
                  {editing === m.id ? (
                    <div className="min-w-[16rem]">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={4}
                        className="w-full rounded border border-stone-300 px-2 py-1.5 text-sm text-stone-900"
                        autoFocus
                      />
                      <p className="text-[11px] text-stone-300 mt-1">
                        {uk ? "У клієнта повідомлення зміниться на місці (з позначкою «змінено»)." : "It changes in place in the client's chat (marked “edited”)."}
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => saveEdit(m.id)} disabled={busy || !editText.trim()} className="text-[12px] bg-white text-stone-900 px-2.5 py-1 rounded disabled:opacity-50">
                          {uk ? "Зберегти" : "Save"}
                        </button>
                        <button onClick={() => setEditing(null)} className="text-[12px] text-stone-300 px-1">
                          {uk ? "Скасувати" : "Cancel"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className={`whitespace-pre-wrap ${m.deleted_at ? "line-through" : ""}`}>{m.text}</p>
                  )}
                  <p className="text-[10px] mt-1 text-stone-400">
                    {out ? (m.sent_by === "team" ? (uk ? "Команда" : "Team") : uk ? "Ми" : "Us") : uk ? "Клієнт" : "Client"} · {formatDateTime(m.created_at, lang)}
                    {m.edited_at ? ` · ${uk ? "змінено" : "edited"}` : ""}
                    {m.deleted_at ? ` · ${uk ? "видалено з чату клієнта" : "deleted from the client's chat"}` : ""}
                  </p>
                  {canChange && editing !== m.id && (
                    <div className="flex gap-3 mt-1">
                      <button
                        onClick={() => {
                          setEditing(m.id);
                          setEditText(m.text);
                        }}
                        className="text-[11px] text-stone-400 hover:text-white"
                      >
                        ✏️ {uk ? "Редагувати" : "Edit"}
                      </button>
                      <button onClick={() => remove(m.id)} className="text-[11px] text-stone-400 hover:text-rose-300">
                        🗑 {uk ? "Видалити" : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder={uk ? "Написати клієнту від імені команди…" : "Write to the client as the team…"}
          className="w-full border border-stone-200 rounded px-3 py-2 text-sm bg-white"
        />
        <div className="flex items-center justify-between gap-3 mt-1">
          <p className="text-[11px] text-stone-400">
            {uk ? "Після надсилання агент ставиться на паузу для цього клієнта — далі відповідаєте ви." : "Sending pauses the agent for this client — you carry on from here."}
          </p>
          <button
            onClick={send}
            disabled={busy || !draft.trim()}
            className="text-[12px] bg-stone-900 text-white px-3 py-1.5 rounded hover:bg-stone-800 disabled:opacity-40 shrink-0"
          >
            {uk ? "Надіслати" : "Send"}
          </button>
        </div>
        {error && <p className="text-[12px] text-red-600 mt-1">{error}</p>}
      </div>

      <div className="mt-4 border-t border-stone-200 pt-3">
        <p className="text-[12px] text-stone-500 mb-1">
          {uk ? "📨 Або скажіть агентові, що передати — він сам складе повідомлення, агент лишається в розмові:" : "📨 Or tell the agent what to pass on — it writes the message and stays in the conversation:"}
        </p>
        <textarea
          value={tell}
          onChange={(e) => setTell(e.target.value)}
          rows={2}
          placeholder={uk ? "Напр.: скажи, що безглютенові робимо під замовлення за добу" : "e.g. tell them gluten-free needs a day's notice"}
          className="w-full border border-stone-200 rounded px-3 py-2 text-sm bg-white"
        />
        <div className="flex items-center justify-between gap-3 mt-1">
          <p className="text-[11px] text-stone-400">{tellNote ?? (uk ? "Чернетка з'явиться тут і в групі — надсилається після ✅." : "The draft appears here and in the group — sent after ✅.")}</p>
          <button
            onClick={sendTell}
            disabled={busy || !tell.trim()}
            className="text-[12px] border border-stone-300 bg-white text-stone-800 px-3 py-1.5 rounded hover:bg-stone-50 disabled:opacity-40 shrink-0"
          >
            {uk ? "Скласти повідомлення" : "Draft message"}
          </button>
        </div>
      </div>
    </div>
  );
}
