"use client";

import { useMemo, useState, useTransition } from "react";
import { analyzeHistory, saveHistoryLearning, type HistoryAnalysis } from "@/app/import-actions";
import {
  applyMasks,
  buildPairs,
  detectSenders,
  flagPossibleSensitive,
  looksSpecific,
  parseExport,
  samplePairs,
  type ExportChat,
  type Sender,
} from "@/lib/telegramExport";
import type { Lang } from "@/lib/i18n";
import Sidebar from "./Sidebar";
import LangToggle from "./LangToggle";

const MAX_SAMPLE = 180;

export default function HistoryImport() {
  const [lang, setLang] = useState<Lang>("uk");
  const [chats, setChats] = useState<ExportChat[] | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [ourId, setOurId] = useState("");
  const [fileName, setFileName] = useState("");
  const [analysis, setAnalysis] = useState<HistoryAnalysis | null>(null);
  const [keep, setKeep] = useState<{ rules: boolean[]; patterns: boolean[]; examples: boolean[] }>({ rules: [], patterns: [], examples: [] });
  const [includeExamples, setIncludeExamples] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Items the user chose to leave as they are (everything flagged is masked by default).
  const [leaveAlone, setLeaveAlone] = useState<Set<string>>(new Set());

  const pairs = useMemo(() => (chats && ourId ? buildPairs(chats, ourId) : []), [chats, ourId]);
  const sample = useMemo(() => samplePairs(pairs, MAX_SAMPLE), [pairs]);
  const flags = useMemo(() => flagPossibleSensitive(sample), [sample]);
  const flagKey = (f: { kind: string; text: string }) => `${f.kind}:${f.text}`;
  const toSend = useMemo(
    () => applyMasks(sample, flags.filter((f) => !leaveAlone.has(flagKey(f)))),
    [sample, flags, leaveAlone]
  );

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setAnalysis(null);
    setDone(null);
    try {
      const parsed = parseExport(JSON.parse(await file.text()));
      if (parsed.length === 0) {
        setError("У файлі не знайдено особистих переписок. Експортуйте чати з клієнтами у форматі JSON.");
        return;
      }
      const found = detectSenders(parsed);
      setChats(parsed);
      setSenders(found);
      setOurId(found[0]?.id ?? "");
      setFileName(file.name);
    } catch {
      setError("Не вдалося прочитати файл. Потрібен result.json з експорту Telegram Desktop (формат JSON).");
    }
  };

  const analyze = () =>
    startTransition(async () => {
      setError(null);
      const res = await analyzeHistory(toSend);
      if (!res.ok) return setError(res.error);
      setAnalysis(res.analysis);
      // Anything that still names something specific starts unticked.
      setKeep({
        rules: res.analysis.rules.map((r) => !looksSpecific(r)),
        patterns: res.analysis.patterns.map((r) => !looksSpecific(r)),
        examples: res.analysis.examples.map((e) => !looksSpecific(e.client + " " + e.reply)),
      });
    });

  const save = () =>
    startTransition(async () => {
      if (!analysis) return;
      const pick = <T,>(list: T[], flags: boolean[]) => list.filter((_, i) => flags[i]);
      const res = await saveHistoryLearning({
        rules: pick(analysis.rules, keep.rules),
        patterns: pick(analysis.patterns, keep.patterns),
        examples: includeExamples ? pick(analysis.examples, keep.examples) : [],
      });
      setDone(res.message);
      setAnalysis(null);
    });

  const toggle = (group: keyof typeof keep, i: number) =>
    setKeep((k) => ({ ...k, [group]: k[group].map((v, j) => (j === i ? !v : v)) }));

  return (
    <div className="min-h-screen bg-[#FAF6EF] flex text-stone-900">
      <Sidebar lang={lang} setLang={setLang} />
      <main className="flex-1 min-w-0 px-5 md:px-8 py-6 max-w-3xl">
        <div className="flex items-center gap-3 md:hidden mb-4">
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <h1 className="font-serif text-2xl">Навчання з історії переписок</h1>
        <p className="text-stone-500 text-sm mt-0.5 mb-5">
          Завантажте експорт ваших Telegram-чатів з клієнтами — агент вивчить, як ви спілкуєтесь із новими та постійними
          клієнтами і як зазвичай пишуть вони. Ви побачите результат і самі оберете, що зберегти.
        </p>

        <section className="bg-white rounded-md border border-stone-200 p-4 mb-5 text-sm space-y-2">
          <h2 className="font-serif text-lg">Як зробити експорт</h2>
          <ol className="list-decimal pl-5 text-stone-700 space-y-1">
            <li>Відкрийте Telegram <b>Desktop</b> (на комп&apos;ютері) з акаунта, де ваші переписки з клієнтами.</li>
            <li>Меню ☰ → Налаштування → Додатково → <b>Експорт даних Telegram</b>.</li>
            <li>Позначте лише «Особисті чати», зніміть усі медіа, формат — <b>JSON</b>. Натисніть «Експортувати».</li>
            <li>Завантажте файл <code>result.json</code> нижче.</li>
          </ol>
          <p className="text-[12px] text-stone-500">
            Файл читається <b>у вашому браузері</b>. На аналіз іде лише добірка до {MAX_SAMPLE} пар «клієнт → відповідь»,
            з якої вже вилучено телефони, email-адреси та посилання. Решта переписки нікуди не передається і не зберігається.
          </p>
        </section>

        <section className="bg-white rounded-md border border-stone-200 p-4 mb-5">
          <input type="file" accept=".json,application/json" onChange={(e) => onFile(e.target.files?.[0])} className="text-sm" />
          {error && <p className="text-[13px] text-rose-700 mt-2">{error}</p>}

          {chats && (
            <div className="mt-4 text-sm space-y-3">
              <p className="text-stone-600">
                {fileName}: {chats.length} особистих чатів.
              </p>
              <label className="block text-[12px] text-stone-500">
                Хто з учасників — це ви (пекарня)?
                <select
                  value={ourId}
                  onChange={(e) => {
                    setOurId(e.target.value);
                    setAnalysis(null);
                  }}
                  className="block w-full border border-stone-200 rounded px-3 py-1.5 text-sm text-stone-900 mt-1"
                >
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name || s.id} — у {s.chats} чатах, {s.messages} повідомлень
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-stone-600">
                Знайдено {pairs.length} обмінів «клієнт → ви» ({pairs.filter((p) => p.kind === "new").length} з перших звернень,{" "}
                {pairs.filter((p) => p.kind === "repeat").length} з наступних). Для аналізу візьмемо {sample.length}.
              </p>
              {flags.length > 0 ? (
                <div className="border border-amber-300 bg-amber-50 rounded p-3">
                  <p className="font-medium text-amber-900">
                    ⚠️ Автоматичне маскування могло щось пропустити ({flags.length})
                  </p>
                  <p className="text-[12px] text-stone-600 mb-2">
                    Схоже на імена, назви закладів чи адреси. Позначене буде замінено на «[ім&apos;я]» / «[адреса]» перед
                    відправкою на аналіз. Приберіть позначку, якщо це не особисті дані (наприклад, назва страви).
                  </p>
                  <ul className="max-h-48 overflow-y-auto space-y-1">
                    {flags.map((f) => (
                      <li key={flagKey(f)} className="flex items-center gap-2 text-[13px]">
                        <input
                          type="checkbox"
                          checked={!leaveAlone.has(flagKey(f))}
                          onChange={() =>
                            setLeaveAlone((prev) => {
                              const next = new Set(prev);
                              if (next.has(flagKey(f))) next.delete(flagKey(f));
                              else next.add(flagKey(f));
                              return next;
                            })
                          }
                        />
                        <span>
                          «{f.text}» <span className="text-stone-400">· {f.kind === "address" ? "адреса" : f.kind === "latin" ? "латиницею" : "ім'я/назва"} · ×{f.count}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-[12px] text-emerald-700">Підозрілих місць не знайдено (імена, адреси, назви).</p>
              )}
              <button
                disabled={pending || sample.length < 5}
                onClick={analyze}
                className="text-[13px] bg-stone-900 text-white px-3 py-1.5 rounded hover:bg-stone-800 disabled:opacity-50"
              >
                {pending && !analysis ? "Аналізую…" : "Проаналізувати (відправиться вже замасковане)"}
              </button>
            </div>
          )}
        </section>

        {analysis && (
          <section className="bg-white rounded-md border border-stone-200 p-4 mb-5 text-sm">
            <h2 className="font-serif text-lg mb-1">Що агент вивчив</h2>
            <p className="text-[12px] text-stone-500 mb-3">Приберіть позначки зі зайвого — решта збережеться й діятиме одразу.</p>

            <h3 className="font-medium mb-1">Як відповідає команда (правила)</h3>
            <ul className="space-y-1 mb-4">
              {analysis.rules.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <input type="checkbox" checked={keep.rules[i]} onChange={() => toggle("rules", i)} className="mt-1" />
                  <span>{r}{looksSpecific(r) && <span className="text-amber-700"> ⚠ містить конкретику</span>}</span>
                </li>
              ))}
            </ul>

            <h3 className="font-medium mb-1">Як зазвичай пишуть клієнти</h3>
            <ul className="space-y-1 mb-4">
              {analysis.patterns.map((r, i) => (
                <li key={i} className="flex gap-2">
                  <input type="checkbox" checked={keep.patterns[i]} onChange={() => toggle("patterns", i)} className="mt-1" />
                  <span>{r}{looksSpecific(r) && <span className="text-amber-700"> ⚠ містить конкретику</span>}</span>
                </li>
              ))}
            </ul>

            <label className="flex items-start gap-2 mb-2">
              <input type="checkbox" checked={includeExamples} onChange={(e) => setIncludeExamples(e.target.checked)} className="mt-1" />
              <span>
                <b>Зберегти також дослівні приклади відповідей</b>
                <span className="block text-[12px] text-stone-500">
                  Це уривки справжніх діалогів (без телефонів, email, посилань та імен). Агент бачитиме їх як зразки тону.
                  За замовчуванням вимкнено — тоді зберігаються лише загальні правила й спостереження.
                </span>
              </span>
            </label>
            {includeExamples && (
            <ul className="space-y-2 mb-4">
              {analysis.examples.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <input type="checkbox" checked={keep.examples[i]} onChange={() => toggle("examples", i)} className="mt-1" />
                  <span>
                    <span className="text-stone-500">Клієнт: {e.client}</span>
                    <br />
                    Ми: {e.reply}
                  </span>
                </li>
              ))}
            </ul>
            )}

            <button
              disabled={pending}
              onClick={save}
              className="text-[13px] bg-stone-900 text-white px-3 py-1.5 rounded hover:bg-stone-800 disabled:opacity-50"
            >
              {pending ? "Зберігаю…" : "Зберегти вибране"}
            </button>
          </section>
        )}

        {done && <p className="text-sm text-emerald-700">{done}</p>}
      </main>
    </div>
  );
}
