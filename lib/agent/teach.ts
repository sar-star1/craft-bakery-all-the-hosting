import "server-only";
import { getOrderingRules } from "@/lib/orders";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { AGENT_MODEL, getAnthropic } from "./anthropic";
import { addGuideline } from "./guidelines";
import { addKnowledge } from "./memory";
import { formatValidity, todayKyiv } from "./validity";

type Db = ReturnType<typeof createSupabaseServerClient>;

const SETTING_LABEL: Record<string, string> = {
  min_order_total: "Мінімальна сума замовлення",
  free_delivery_from: "Безкоштовна доставка від",
  delivery_fee: "Вартість доставки",
};

export type TeachResult =
  | { ok: true; kind: "rule" | "fact"; id: string | null; text: string; expires: string | null; message: string }
  | { ok: true; kind: "setting"; id: null; text: string; expires: null; message: string }
  | { ok: false; message: string };

// "Just tell the agent": one sentence in plain language is turned into the right
// kind of memory — a behaviour rule, a (possibly temporary) fact about the
// bakery, or one of the ordering numbers — and stored.
export async function teachFromText(db: Db, input: string, source: "teach"): Promise<TeachResult> {
  const text = input.trim();
  if (!text) return { ok: false, message: "Напишіть, чого навчити агента." };

  const response = await getAnthropic().messages.create({
    model: AGENT_MODEL,
    max_tokens: 400,
    system: `Ти розбираєш інструкції для AI-асистента пекарні Peremoga Bakery. Сьогодні ${todayKyiv()} (Київ). Визнач, що саме хоче команда, і відповідай СУВОРО в такому форматі, без пояснень:

ТИП: правило | факт | налаштування
ТЕКСТ: <одне ясне речення українською, у наказовому способі для правила («Звертайся на ви.») або як констатація для факту («Цього тижня немає доставки на Троєщину.»)>
ДО: <YYYY-MM-DD останній день дії, якщо інструкція тимчасова («цього тижня» = найближча неділя, «до 15.10» тощо), інакше "немає">
КЛЮЧ: <min_order_total | free_delivery_from | delivery_fee, якщо це зміна числа в умовах замовлення, інакше "немає">
ЗНАЧЕННЯ: <число в гривнях для налаштування, інакше "немає">

Підказки:
- правило = як поводитись, звучати, що пропонувати, чого не робити.
- факт = інформація про пекарню чи її роботу (обмеження, графік, реквізити, що робимо/не робимо), у тому числі тимчасова.
- налаштування = мінімальна сума замовлення (min_order_total), поріг безкоштовної доставки (free_delivery_from), вартість доставки (delivery_fee).`,
    messages: [{ role: "user", content: text }],
  });
  const out = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  const field = (name: string) => out.match(new RegExp(`${name}:\\s*(.+)`, "i"))?.[1]?.trim() ?? "";

  const typeRaw = field("ТИП").toLowerCase();
  const cleaned = field("ТЕКСТ") || text;
  const untilRaw = field("ДО");
  const expires = /^\d{4}-\d{2}-\d{2}$/.test(untilRaw) ? untilRaw : null;

  if (typeRaw.startsWith("налаш")) {
    const key = field("КЛЮЧ");
    const value = Number(field("ЗНАЧЕННЯ").replace(/\s/g, ""));
    if (key in SETTING_LABEL && Number.isFinite(value) && value >= 0) {
      const current = await getOrderingRules(db);
      const next = { ...current, [key]: value };
      await db.from("site_content").upsert({ key: "ordering_rules", content_json: next }, { onConflict: "key" });
      return {
        ok: true,
        kind: "setting",
        id: null,
        text: cleaned,
        expires: null,
        message: `${SETTING_LABEL[key]}: було ${current[key as keyof typeof current]} ₴, стало ${value} ₴ (діє і в чаті, і на сайті).`,
      };
    }
  }

  if (typeRaw.startsWith("факт")) {
    const id = await addKnowledge(db, cleaned, source, expires);
    const until = formatValidity(expires);
    return { ok: true, kind: "fact", id, text: cleaned, expires, message: `Факт збережено: «${cleaned}»${until ? ` (${until})` : ""}` };
  }

  const id = await addGuideline(db, cleaned, source, expires);
  const until = formatValidity(expires);
  return { ok: true, kind: "rule", id, text: cleaned, expires, message: `Правило збережено: «${cleaned}»${until ? ` (${until})` : ""}` };
}
