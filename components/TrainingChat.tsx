"use client";

import { useRef, useState, useTransition } from "react";
import { practiceCorrect, practiceReply, practiceSaveExample, type PracticeTurn } from "@/app/training-actions";
import type { Lang } from "@/lib/i18n";
import Sidebar from "./Sidebar";
import LangToggle from "./LangToggle";

type Turn = PracticeTurn & { id: number; notes?: string[]; status?: string };

export default function TrainingChat() {
  const [lang, setLang] = useState<Lang>("uk");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // The practice agent's "memory" (its order draft), round-tripped through the server.
  const [state, setState] = useState<Record<string, unknown>>({});
  const nextId = useRef(1);

  const strip = (list: Turn[]): PracticeTurn[] => list.map(({ role, text }) => ({ role, text }));
  const patch = (id: number, change: Partial<Turn>) =>
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...change } : t)));

  const send = () => {
    const text = input.trim();
    if (!text || pending) return;
    const history = [...turns, { id: nextId.current++, role: "client" as const, text }];
    setTurns(history);
    setInput("");
    setError(null);
    startTransition(async () => {
      const res = await practiceReply(strip(history), state);
      if (res.ok) setState(res.state);
      if (res.ok) setTurns((prev) => [...prev, { id: nextId.current++, role: "agent", text: res.text, notes: res.notes }]);
      else setError(res.error);
    });
  };

  const correct = (turn: Turn) => {
    const text = feedback.trim();
    if (!text) return;
    const index = turns.findIndex((t) => t.id === turn.id);
    startTransition(async () => {
      const res = await practiceCorrect(strip(turns.slice(0, index)), turn.text, text);
      if (res.ok) {
        patch(turn.id, { text: res.text, status: res.rule ? `📌 Запам'ятав правило: «${res.rule}»` : "Переписано (як разове зауваження, без правила)." });
        setCorrecting(null);
        setFeedback("");
      } else setError(res.error);
    });
  };

  const useMine = (turn: Turn) => {
    const text = feedback.trim();
    if (!text) return;
    patch(turn.id, { text });
    saveExample(turn.id, text);
    setCorrecting(null);
    setFeedback("");
  };

  const saveExample = (id: number, replyText?: string) => {
    const index = turns.findIndex((t) => t.id === id);
    const clientMsg = [...turns.slice(0, index)].reverse().find((t) => t.role === "client")?.text ?? "";
    const reply = replyText ?? turns[index].text;
    startTransition(async () => {
      const res = await practiceSaveExample(clientMsg, reply);
      patch(id, { status: res.ok ? "👍 Збережено як приклад відповіді." : res.message });
    });
  };

  return (
    <div className="min-h-screen bg-[#FAF6EF] flex text-stone-900">
      <Sidebar lang={lang} setLang={setLang} />
      <main className="flex-1 min-w-0 px-5 md:px-8 py-6 max-w-3xl">
        <div className="flex items-center gap-3 md:hidden mb-4">
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <h1 className="font-serif text-2xl">Тренування агента</h1>
        <p className="text-stone-500 text-sm mt-0.5 mb-5">
          Пишіть як клієнт — агент відповідає так, як відповів би насправді (з усіма правилами, фактами й прикладами),
          але нічого не надсилається і не зберігається. Не подобається відповідь — поправте її: зауваження загального
          характеру агент запам&apos;ятає як правило, а відповіді, які ви схвалили чи написали самі, стануть прикладами.
        </p>

        <div className="space-y-3 mb-4">
          {turns.length === 0 && (
            <p className="text-sm text-stone-400">
              Спробуйте, напр.: «Добрий день, цікавить випічка для кафе — як з доставкою?» або «А у вас є знижки для нових клієнтів?»
            </p>
          )}
          {turns.map((t) => (
            <div key={t.id} className={`flex ${t.role === "client" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] ${t.role === "client" ? "" : "w-full"}`}>
                <div
                  className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                    t.role === "client" ? "bg-stone-900 text-white" : "bg-white border border-stone-200 text-stone-800"
                  }`}
                >
                  {t.text}
                </div>
                {t.role === "agent" && (
                  <div className="mt-1.5">
                    {t.notes?.map((n) => (
                      <p key={n} className="text-[11px] text-amber-700">
                        {n}
                      </p>
                    ))}
                    {t.status && <p className="text-[12px] text-emerald-700 mb-1">{t.status}</p>}
                    {correcting === t.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={feedback}
                          onChange={(e) => setFeedback(e.target.value)}
                          rows={2}
                          autoFocus
                          placeholder="Що не так? Напр.: «занадто офіційно», «не став питань у кінці» — або напишіть власну відповідь"
                          className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
                        />
                        <div className="flex gap-2 flex-wrap">
                          <button
                            disabled={pending || !feedback.trim()}
                            onClick={() => correct(t)}
                            className="text-[12px] bg-stone-900 text-white px-3 py-1.5 rounded disabled:opacity-40"
                          >
                            Агент перепише за зауваженням
                          </button>
                          <button
                            disabled={pending || !feedback.trim()}
                            onClick={() => useMine(t)}
                            className="text-[12px] border border-stone-300 px-3 py-1.5 rounded disabled:opacity-40"
                          >
                            Це і є правильна відповідь
                          </button>
                          <button onClick={() => setCorrecting(null)} className="text-[12px] text-stone-400">
                            Скасувати
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <button
                          disabled={pending}
                          onClick={() => saveExample(t.id)}
                          className="text-[12px] text-stone-500 hover:text-stone-800"
                        >
                          👍 Так відповідати
                        </button>
                        <button
                          disabled={pending}
                          onClick={() => {
                            setCorrecting(t.id);
                            setFeedback("");
                          }}
                          className="text-[12px] text-stone-500 hover:text-stone-800"
                        >
                          ✏️ Виправити
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {pending && <p className="text-[12px] text-stone-400">Агент думає…</p>}
          {error && <p className="text-[12px] text-rose-700">{error}</p>}
        </div>

        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Повідомлення від клієнта…"
            className="flex-1 min-w-0 border border-stone-200 rounded px-3 py-2 text-sm"
          />
          <button
            disabled={pending || !input.trim()}
            onClick={send}
            className="text-sm bg-stone-900 text-white px-4 py-2 rounded hover:bg-stone-800 disabled:opacity-40"
          >
            Надіслати
          </button>
          {turns.length > 0 && (
            <button
              onClick={() => {
                setTurns([]);
                setState({});
                setError(null);
              }}
              className="text-sm text-stone-400 px-2"
            >
              Очистити
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
