"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Lang } from "@/lib/i18n";
import { STR } from "@/lib/i18n";
import LangToggle from "./LangToggle";

export default function Sidebar({
  lang,
  setLang,
}: {
  lang: Lang;
  setLang: (lang: Lang) => void;
}) {
  const t = STR[lang];
  const pathname = usePathname();
  const isOrders = pathname === "/";
  const isClients = pathname.startsWith("/clients");
  const isPendingReplies = pathname.startsWith("/pending-replies");
  const isMenu = pathname.startsWith("/menu");

  return (
    <aside className="w-56 shrink-0 border-r border-stone-200 bg-white/60 px-5 py-6 hidden md:flex md:flex-col">
      <div className="mb-6">
        <p className="font-serif text-lg leading-tight">{t.brand1}</p>
        <p className="font-serif text-lg leading-tight text-stone-400 italic">{t.brand2}</p>
      </div>
      <LangToggle lang={lang} setLang={setLang} />
      <nav className="space-y-1 text-[14px] mt-6">
        <Link
          href="/"
          className={`block px-3 py-1.5 rounded ${
            isOrders ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"
          }`}
        >
          {t.navOrders}
        </Link>
        <Link
          href="/clients"
          className={`block px-3 py-1.5 rounded ${
            isClients ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"
          }`}
        >
          {t.navCustomers}
        </Link>
        <Link
          href="/pending-replies"
          className={`block px-3 py-1.5 rounded ${
            isPendingReplies ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"
          }`}
        >
          {t.navPendingReplies}
        </Link>
        <Link
          href="/menu"
          className={`block px-3 py-1.5 rounded ${
            isMenu ? "bg-stone-900 text-white" : "text-stone-500 hover:bg-stone-100"
          }`}
        >
          {t.navMenu}
        </Link>
        <span className="block px-3 py-1.5 rounded text-stone-300 cursor-default">
          {t.navCalendar}
        </span>
        <span className="block px-3 py-1.5 rounded text-stone-300 cursor-default">
          {t.navSettings}
        </span>
      </nav>
    </aside>
  );
}
