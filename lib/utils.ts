import type { Lang } from "./i18n";

export function formatDate(dateStr: string | null, lang: Lang, style: "short" | "long" = "short") {
  if (!dateStr) return "—";
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString(lang === "uk" ? "uk-UA" : "en-US", {
    month: style,
    day: "numeric",
  });
}

export function formatDateTime(isoStr: string | null, lang: Lang) {
  if (!isoStr) return "—";
  const date = new Date(isoStr);
  return date.toLocaleDateString(lang === "uk" ? "uk-UA" : "en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatMoney(amount: number | null) {
  if (amount === null || amount === undefined) return "—";
  return `$${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
