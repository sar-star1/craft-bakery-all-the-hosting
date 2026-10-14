import "server-only";
import { AGENT_MODEL, getAnthropic } from "./anthropic";
import { guidelinesBlock } from "./guidelines";

export interface Revision {
  text: string | null; // null when the feedback needed no rewrite (learn-only)
  rule: string | null; // a general standing rule, if the feedback was one
  fact: string | null; // a general fact about the bakery, if the team's answer was one
}

// Turns an admin's free-text feedback on a draft into (a) a rewritten draft and
// (b) — only when the feedback is general, not about this one client — a short
// standing rule that is stored and applied to every future reply.
export async function reviseDraft(input: {
  draft: string;
  feedback: string;
  clientMessage?: string;
  history: { direction: string; text: string }[];
  guidelines: string[];
  rewrite: boolean;
  // Set when the draft is a holding reply and the feedback is the team's ANSWER to this question.
  question?: string | null;
}): Promise<Revision> {
  const response = await getAnthropic().messages.create({
    model: AGENT_MODEL,
    max_tokens: 1200,
    system: `Ти редактор відповідей AI-асистента пекарні Peremoga Bakery. Адміністратор залишив зауваження до чернетки відповіді клієнту.
${guidelinesBlock(input.guidelines)}
${input.question ? `ЦЕ ВІДПОВІДЬ НА ПИТАННЯ КОМАНДІ. Агент не знав відповіді й спитав команду: «${input.question}». Чернетка — лише проміжна відповідь клієнту («уточню»). Адміністратор нижче дає САМУ ВІДПОВІДЬ, а не зауваження до стилю.
` : ""}Що зробити:
${input.question ? "1. Напиши клієнту готову відповідь, яка дає саме те, що сказав адміністратор: тепло, коротко, без «уточню» і без нових фактів, цін чи цифр поза словами адміністратора. 2. Якщо відповідь адміністратора загальна (правило роботи пекарні, що ми робимо/не робимо, умови), сформулюй ОДИН короткий факт українською в ФАКТ; якщо вона стосується лише цього клієнта чи випадку — ФАКТ «немає». ПРАВИЛО завжди «немає»." : input.rewrite ? "1. Перепиши чернетку з урахуванням зауваження. Не додавай жодних нових фактів, цін, строків чи цифр — лише те, що вже є в чернетці та діалозі. Якщо зауваження вимагає нових даних, яких немає, залиш відповідь максимально близькою до чернетки." : "1. Чернетка вже оброблена — переписувати її не потрібно, залиш секцію ВІДПОВІДЬ порожньою."}
${input.question ? "" : "2. Визнач, чи зауваження загальне (стосується стилю, довжини, тону чи поведінки агента з усіма клієнтами) чи стосується лише цього клієнта/цього випадку. Якщо загальне — сформулюй ОДНЕ коротке правило для агента (одне речення, наказовий спосіб, українською). Якщо тільки цього випадку — правило \"немає\"."}

Формат відповіді СУВОРО такий, без пояснень:
ВІДПОВІДЬ:
<текст відповіді клієнту або порожньо>
ПРАВИЛО:
<одне речення або слово "немає">
ФАКТ:
<одне речення або слово "немає">`,
    messages: [
      {
        role: "user",
        content: [
          input.history.length
            ? `Діалог:\n${input.history.map((m) => `${m.direction === "in" ? "Клієнт" : "Ми"}: ${m.text}`).join("\n")}`
            : "",
          input.clientMessage ? `Останнє повідомлення клієнта: ${input.clientMessage}` : "",
          `Чернетка:\n${input.draft}`,
          `Зауваження адміністратора:\n${input.feedback}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
  });

  const out = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
  const match = out.match(/ВІДПОВІДЬ:\s*([\s\S]*?)\s*ПРАВИЛО:\s*([\s\S]*?)(?:\s*ФАКТ:\s*([\s\S]*))?$/);
  const text = match?.[1]?.trim() || null;
  const oneLine = (raw: string | undefined, max: number) => {
    const v = (raw ?? "").trim();
    return v && !/^немає\.?$/i.test(v) ? v.split("\n")[0].slice(0, max) : null;
  };
  const rule = input.question ? null : oneLine(match?.[2], 400);
  const fact = input.question ? oneLine(match?.[3], 500) : null;
  return { text: input.rewrite ? text : null, rule, fact };
}
