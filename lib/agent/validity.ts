// "Valid until" handling for facts and rules the team teaches ("no deliveries
// to Troieshchyna this week"). Dates are Kyiv calendar dates (YYYY-MM-DD).

const kyivToday = (): Date => {
  const [y, m, d] = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Kyiv" }).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const todayKyiv = () => iso(kyivToday());

export function endOfThisWeek(): string {
  const d = kyivToday();
  const day = d.getUTCDay(); // 0 = Sunday
  d.setUTCDate(d.getUTCDate() + (day === 0 ? 0 : 7 - day));
  return iso(d);
}

export function formatValidity(expires: string | null | undefined): string | null {
  if (!expires) return null;
  const [y, m, d] = expires.split("-");
  return `діє до ${d}.${m}.${y}`;
}

// Understands a leading "до 12.10", "до 12.10.2026", "цього тижня", "на цей
// тиждень", "сьогодні", "завтра" before the actual text. No prefix → no expiry.
export function parseValidity(input: string): { text: string; expires: string | null } {
  const text = input.trim();

  const week = text.match(/^(?:цього тижня|на цей тиждень|до кінця тижня|на тиждень)[\s:,—-]*/i);
  if (week) return { text: text.slice(week[0].length).trim(), expires: endOfThisWeek() };

  const day = text.match(/^(сьогодні|завтра)[\s:,—-]*/i);
  if (day) {
    const d = kyivToday();
    if (/завтра/i.test(day[1])) d.setUTCDate(d.getUTCDate() + 1);
    return { text: text.slice(day[0].length).trim(), expires: iso(d) };
  }

  const until = text.match(/^до\s+(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?[\s:,—-]*/i);
  if (until) {
    const today = kyivToday();
    let year = until[3] ? Number(until[3]) : today.getUTCFullYear();
    if (year < 100) year += 2000;
    let date = new Date(Date.UTC(year, Number(until[2]) - 1, Number(until[1])));
    if (!until[3] && date < today) date = new Date(Date.UTC(year + 1, Number(until[2]) - 1, Number(until[1])));
    if (!Number.isNaN(date.getTime())) return { text: text.slice(until[0].length).trim(), expires: iso(date) };
  }
  return { text, expires: null };
}
