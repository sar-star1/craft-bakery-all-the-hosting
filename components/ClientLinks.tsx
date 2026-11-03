"use client";

import { useState } from "react";

// Ready-to-send invitation for one client: the site link (menu, prices, ordering) and the bot link
// (questions, changes). The team pastes it into their existing chat with the client.
export function invitationText(orderLink: string | null, botLink: string | null): string {
  const lines = ["Добрий день! Тепер замовляти у Peremoga Bakery зручніше."];
  if (orderLink) lines.push(`Меню, ціни й замовлення в кілька кліків: ${orderLink}`);
  if (botLink) lines.push(`А якщо є питання чи потрібно щось змінити — пишіть нашому помічнику в Telegram: ${botLink}`);
  return lines.join("\n");
}

export function CopyButton({ text, label, done = "Скопійовано ✓" }: { text: string; label: string; done?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Скопіюйте вручну:", text);
        }
      }}
      className="text-[12px] bg-stone-900 text-white px-3 py-1.5 rounded hover:bg-stone-800 whitespace-nowrap"
    >
      {copied ? done : label}
    </button>
  );
}

export default function ClientLinks({ orderLink, botLink, inBot }: { orderLink: string | null; botLink: string | null; inBot: boolean }) {
  return (
    <div className="bg-white rounded-md border border-stone-200 p-4 mb-6 space-y-4">
      {orderLink && (
        <div>
          <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">Персональне посилання на замовлення</p>
          <code className="text-[12px] text-stone-700 break-all">{orderLink}</code>
        </div>
      )}
      <div>
        <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">Telegram-бот</p>
        {inBot ? (
          <p className="text-[13px] text-stone-600">Клієнт уже спілкується з ботом.</p>
        ) : botLink ? (
          <code className="text-[12px] text-stone-700 break-all">{botLink}</code>
        ) : (
          <p className="text-[13px] text-amber-700">Посилання на бота недоступне: у Vercel не задано TELEGRAM_BOT_USERNAME.</p>
        )}
      </div>
      {(orderLink || botLink) && (
        <div>
          <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">Повідомлення для клієнта (вставте в наш чат із ним)</p>
          <pre className="text-[12px] text-stone-700 whitespace-pre-wrap bg-stone-50 border border-stone-200 rounded p-3 mb-2 font-sans">
            {invitationText(orderLink, inBot ? null : botLink)}
          </pre>
          <CopyButton text={invitationText(orderLink, inBot ? null : botLink)} label="Скопіювати повідомлення" />
        </div>
      )}
    </div>
  );
}
