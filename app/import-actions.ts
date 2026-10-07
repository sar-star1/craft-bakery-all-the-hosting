"use server";

import { revalidatePath } from "next/cache";
import { AGENT_MODEL, getAnthropic, isAnthropicConfigured } from "@/lib/agent/anthropic";
import { addGuideline } from "@/lib/agent/guidelines";
import { recordExample } from "@/lib/agent/memory";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface HistoryPair {
  client: string;
  reply: string;
  kind: "new" | "repeat";
}

export interface HistoryAnalysis {
  rules: string[];
  patterns: string[];
  examples: { client: string; reply: string }[];
}

const MAX_PAIRS = 180;

// Reads real conversations (already sampled and stripped of phone numbers,
// e-mails and links in the browser) and distils how the team talks and how
// clients talk, so the agent can sound like the bakery from day one.
export async function analyzeHistory(pairs: HistoryPair[]): Promise<{ ok: true; analysis: HistoryAnalysis } | { ok: false; error: string }> {
  await requireAdmin();
  if (!isAnthropicConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY не задано." };
  const used = pairs.slice(0, MAX_PAIRS).map((p) => ({
    client: String(p.client).slice(0, 300),
    reply: String(p.reply).slice(0, 300),
    kind: p.kind === "new" ? ("new" as const) : ("repeat" as const),
  }));
  if (used.length < 5) return { ok: false, error: "Замало діалогів для аналізу (потрібно хоча б 5 пар «клієнт → відповідь»)." };

  try {
    const response = await getAnthropic().messages.create({
      model: AGENT_MODEL,
      max_tokens: 4000,
      system: `Ти аналізуєш реальні переписки пекарні Peremoga Bakery з клієнтами (B2B: кав'ярні, заклади) у Telegram. Кожна пара — повідомлення клієнта і відповідь команди; позначка (новий) — перші звернення, (постійний) — клієнт, що вже замовляв.

Твоє завдання — допомогти AI-асистенту звучати як команда. Не вигадуй і не переказуй конкретні ціни, умови чи факти — лише манеру спілкування й поведінку.

Відповідай СУВОРО в такому форматі:

ПРАВИЛА:
- <до 12 конкретних правил для асистента, наказовим способом, українською: звертання («ви»/«ти»), тон, довжина відповідей, вітання, емодзі, як відповідають постійним клієнтам окремо від нових, як уточнюють замовлення, як прощаються тощо. Лише те, що справді видно з діалогів, без загальників.>
КЛІЄНТИ:
- <до 8 спостережень про те, як клієнти зазвичай пишуть і що просять: скорочення, «як завжди», типові запити, коли пишуть, у якій формі називають кількість тощо. Формулюй як «Клієнти зазвичай …».>
ПРИКЛАДИ: <номери до 25 найкращих і найтиповіших пар через кому (різні ситуації, і нові, і постійні клієнти); обирай відповіді, які найкраще передають манеру команди>`,
      messages: [
        {
          role: "user",
          content: used
            .map((p, i) => `#${i + 1} (${p.kind === "new" ? "новий" : "постійний"})\nКлієнт: ${p.client}\nМи: ${p.reply}`)
            .join("\n\n"),
        },
      ],
    });
    const out = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    const section = (name: string, next: string[]) => {
      const rest = next.map((n) => `${n}:`).join("|");
      const end = rest ? `\\n(?:${rest})|$` : "$";
      const m = out.match(new RegExp(`${name}:\\s*([\\s\\S]*?)(?=${end})`));
      return m?.[1] ?? "";
    };
    const bullets = (s: string) =>
      s
        .split("\n")
        .map((l) => l.replace(/^[-•*\d.)\s]+/, "").trim())
        .filter((l) => l.length > 3)
        .slice(0, 12);
    const picked = [...new Set((section("ПРИКЛАДИ", []).match(/\d+/g) ?? []).map(Number))]
      .filter((n) => n >= 1 && n <= used.length)
      .slice(0, 25);
    return {
      ok: true,
      analysis: {
        rules: bullets(section("ПРАВИЛА", ["КЛІЄНТИ", "ПРИКЛАДИ"])),
        patterns: bullets(section("КЛІЄНТИ", ["ПРАВИЛА", "ПРИКЛАДИ"])).slice(0, 8),
        examples: picked.map((n) => ({ client: used[n - 1].client, reply: used[n - 1].reply })),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function saveHistoryLearning(input: HistoryAnalysis): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const db = createSupabaseServerClient();
  let rules = 0;
  let examples = 0;
  for (const r of input.rules.slice(0, 12)) if (await addGuideline(db, r, "history_import")) rules++;
  for (const p of input.patterns.slice(0, 8)) if (await addGuideline(db, p, "history_import")) rules++;
  for (const e of input.examples.slice(0, 25)) {
    await recordExample(db, { clientMessage: e.client, reply: e.reply, quality: "written" });
    examples++;
  }
  revalidatePath("/setup");
  return { ok: true, message: `Збережено: ${rules} правил і спостережень, ${examples} прикладів. Їх видно й можна редагувати в Налаштуваннях.` };
}
