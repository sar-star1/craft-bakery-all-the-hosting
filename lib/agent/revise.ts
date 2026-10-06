import "server-only";
import { AGENT_MODEL, getAnthropic } from "./anthropic";
import { guidelinesBlock } from "./guidelines";

export interface Revision {
  text: string | null; // null when the feedback needed no rewrite (learn-only)
  rule: string | null; // a general standing rule, if the feedback was one
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
}): Promise<Revision> {
  const response = await getAnthropic().messages.create({
    model: AGENT_MODEL,
    max_tokens: 1200,
    system: `Ти редактор відповідей AI-асистента пекарні Peremoga Bakery. Адміністратор залишив зауваження до чернетки відповіді клієнту.
${guidelinesBlock(input.guidelines)}
Що зробити:
${input.rewrite ? "1. Перепиши чернетку з урахуванням зауваження. Не додавай жодних нових фактів, цін, строків чи цифр — лише те, що вже є в чернетці та діалозі. Якщо зауваження вимагає нових даних, яких немає, залиш відповідь максимально близькою до чернетки." : "1. Чернетка вже оброблена — переписувати її не потрібно, залиш секцію ВІДПОВІДЬ порожньою."}
2. Визнач, чи зауваження загальне (стосується стилю, довжини, тону чи поведінки агента з усіма клієнтами) чи стосується лише цього клієнта/цього випадку. Якщо загальне — сформулюй ОДНЕ коротке правило для агента (одне речення, наказовий спосіб, українською). Якщо тільки цього випадку — правило "немає".

Формат відповіді СУВОРО такий, без пояснень:
ВІДПОВІДЬ:
<текст відповіді клієнту або порожньо>
ПРАВИЛО:
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
  const match = out.match(/ВІДПОВІДЬ:\s*([\s\S]*?)\s*ПРАВИЛО:\s*([\s\S]*)$/);
  const text = match?.[1]?.trim() || null;
  const ruleRaw = match?.[2]?.trim() ?? "";
  const rule = ruleRaw && !/^немає\.?$/i.test(ruleRaw) ? ruleRaw.split("\n")[0].slice(0, 400) : null;
  return { text: input.rewrite ? text : null, rule };
}
