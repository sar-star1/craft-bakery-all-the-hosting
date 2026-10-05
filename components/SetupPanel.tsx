"use client";

import { useState, useTransition } from "react";
import { registerTelegramWebhook, sendAdminTestMessage, testAnthropic, type SetupActionResult } from "@/app/setup-actions";
import type { Lang } from "@/lib/i18n";
import Sidebar from "./Sidebar";
import LangToggle from "./LangToggle";

export interface SetupStatus {
  env: { name: string; secret: boolean; needed: string; set: boolean }[];
  model: string;
  siteUrl: string | null;
  supabase:
    | { ok: true; categories: number; items: number; clients: number; capacityRules: number }
    | { ok: false; error: string }
    | null;
  telegram:
    | { ok: true; username: string; webhookUrl: string | null; pending: number; lastError: string | null }
    | { ok: false; error: string }
    | null;
}

function Row({ ok, children }: { ok: boolean | null; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm py-1">
      <span className="w-4 shrink-0">{ok === null ? "•" : ok ? "✅" : "❌"}</span>
      <div className="min-w-0 text-stone-700">{children}</div>
    </div>
  );
}

function ActionButton({ label, action }: { label: string; action: () => Promise<SetupActionResult> }) {
  const [result, setResult] = useState<SetupActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-2">
      <button
        disabled={pending}
        onClick={() => startTransition(async () => setResult(await action()))}
        className="text-[13px] bg-stone-900 text-white px-3 py-1.5 rounded hover:bg-stone-800 disabled:opacity-50"
      >
        {pending ? "…" : label}
      </button>
      {result && (
        <p className={`text-[12px] mt-1.5 break-words ${result.ok ? "text-emerald-700" : "text-rose-700"}`}>{result.message}</p>
      )}
    </div>
  );
}

function SecretGenerator() {
  const [value, setValue] = useState("");
  const generate = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    setValue([...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
  };
  return (
    <div className="mt-2">
      <button onClick={generate} className="text-[13px] border border-stone-300 px-3 py-1.5 rounded hover:bg-stone-100">
        Згенерувати випадковий секрет
      </button>
      {value && (
        <p className="mt-2 text-[12px]">
          <code className="break-all bg-stone-100 px-2 py-1 rounded select-all">{value}</code>
          <span className="block text-stone-500 mt-1">
            Створюється в браузері й нікуди не надсилається. Скопіюйте у Vercel і збережіть у менеджері паролів.
            Для кожної змінної (TELEGRAM_WEBHOOK_SECRET, CRON_SECRET) генеруйте окреме значення.
          </span>
        </p>
      )}
    </div>
  );
}

export default function SetupPanel({ status }: { status: SetupStatus }) {
  const [lang, setLang] = useState<Lang>("uk");
  const expectedHook = status.siteUrl ? `${status.siteUrl}/api/telegram/webhook` : null;
  const envSet = (name: string) => status.env.find((e) => e.name === name)?.set ?? false;

  return (
    <div className="min-h-screen bg-[#FAF6EF] flex text-stone-900">
      <Sidebar lang={lang} setLang={setLang} />
      <main className="flex-1 min-w-0 px-5 md:px-8 py-6 max-w-3xl">
        <div className="flex items-center gap-3 md:hidden mb-4">
          <LangToggle lang={lang} setLang={setLang} />
        </div>
        <h1 className="font-serif text-2xl">Налаштування та перевірка</h1>
        <p className="text-stone-500 text-sm mt-0.5 mb-6">
          Усе, що потрібно для роботи бота. Значення секретів тут ніколи не показуються — лише чи вони задані.
        </p>

        <section className="bg-white rounded-md border border-stone-200 p-4 mb-5">
          <h2 className="font-serif text-lg mb-2">1. Змінні середовища (Vercel)</h2>
          {status.env.map((e) => (
            <Row key={e.name} ok={e.set}>
              <code className="text-[12px]">{e.name}</code> <span className="text-stone-400">— {e.needed}</span>
            </Row>
          ))}
          <p className="text-[12px] text-stone-500 mt-2">
            Після зміни змінних у Vercel потрібен новий деплой (Deployments → Redeploy), інакше вони не діють.
          </p>
          <SecretGenerator />
        </section>

        <section className="bg-white rounded-md border border-stone-200 p-4 mb-5">
          <h2 className="font-serif text-lg mb-2">2. База даних</h2>
          {!status.supabase ? (
            <Row ok={false}>Supabase не підключено.</Row>
          ) : status.supabase.ok ? (
            <>
              <Row ok={true}>
                Підключено: {status.supabase.categories} категорій, {status.supabase.items} позицій меню,{" "}
                {status.supabase.clients} клієнтів.
              </Row>
              <Row ok={status.supabase.capacityRules > 0}>
                Правила потужності: {status.supabase.capacityRules}.{" "}
                {status.supabase.capacityRules === 0 &&
                  "Поки їх немає, агент не обіцятиме строки чи обсяги, а передаватиме питання команді."}
              </Row>
            </>
          ) : (
            <Row ok={false}>Помилка: {status.supabase.error}</Row>
          )}
        </section>

        <section className="bg-white rounded-md border border-stone-200 p-4 mb-5">
          <h2 className="font-serif text-lg mb-2">3. Telegram-бот</h2>
          {!status.telegram ? (
            <Row ok={false}>TELEGRAM_BOT_TOKEN не задано.</Row>
          ) : !status.telegram.ok ? (
            <Row ok={false}>Токен не працює: {status.telegram.error}</Row>
          ) : (
            <>
              <Row ok={true}>Бот знайдено: @{status.telegram.username}</Row>
              <Row ok={envSet("TELEGRAM_BOT_USERNAME")}>
                TELEGRAM_BOT_USERNAME має бути <code className="text-[12px]">{status.telegram.username}</code>
              </Row>
              <Row ok={Boolean(expectedHook) && status.telegram.webhookUrl === expectedHook}>
                Вебхук: {status.telegram.webhookUrl ?? "не зареєстровано"}
                {status.telegram.pending > 0 && ` · у черзі: ${status.telegram.pending}`}
              </Row>
              {status.telegram.lastError && <Row ok={false}>Остання помилка доставки: {status.telegram.lastError}</Row>}
              <ActionButton label="Зареєструвати вебхук" action={registerTelegramWebhook} />
            </>
          )}
        </section>

        <section className="bg-white rounded-md border border-stone-200 p-4 mb-5">
          <h2 className="font-serif text-lg mb-2">4. Адмін-група</h2>
          <Row ok={envSet("TELEGRAM_ADMIN_GROUP_ID")}>
            TELEGRAM_ADMIN_GROUP_ID {envSet("TELEGRAM_ADMIN_GROUP_ID") ? "задано" : "не задано"}
          </Row>
          <p className="text-[12px] text-stone-500 mt-1">
            Щоб дізнатися ID: додайте бота в групу (лише співробітники!), зареєструйте вебхук вище і напишіть у групі{" "}
            <code>/chatid</code> — бот відповість числом (від&apos;ємним). Додайте його у Vercel як TELEGRAM_ADMIN_GROUP_ID і
            перерозгорніть.
          </p>
          <ActionButton label="Надіслати тест в адмін-групу" action={sendAdminTestMessage} />
        </section>

        <section className="bg-white rounded-md border border-stone-200 p-4 mb-5">
          <h2 className="font-serif text-lg mb-2">5. AI-агент</h2>
          <Row ok={envSet("ANTHROPIC_API_KEY")}>
            Модель: <code className="text-[12px]">{status.model}</code>
          </Row>
          <ActionButton label="Перевірити AI" action={testAnthropic} />
        </section>
      </main>
    </div>
  );
}
