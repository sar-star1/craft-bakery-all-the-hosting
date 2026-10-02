import "server-only";
import { getStorefrontLink } from "@/lib/clientToken";
import { AGENT_MODEL, getAnthropic } from "./anthropic";

export type OutboundKind = "weekly_reminder" | "remarketing" | "seasonal_offer";

const KIND_INSTRUCTIONS: Record<OutboundKind, string> = {
  weekly_reminder:
    "Це нагадування регулярному клієнту, який давно не замовляв. Ненав'язливо запитай, чи потрібне замовлення на цей тиждень, нагадай про його звичне замовлення (якщо воно відоме з нотаток) і запропонуй оформити його на сайті за посиланням.",
  remarketing:
    "Це повторне залучення клієнта, який цікавився, але ще не замовляв (або давно не замовляв). Тепло нагадай про себе, запитай, чи актуально, і запропонуй переглянути актуальне меню за посиланням.",
  seasonal_offer:
    "Це сезонна пропозиція від пекарні. Персоналізуй її під клієнта (його звичні позиції, тип закладу), коротко й привабливо, і запроси переглянути меню за посиланням.",
};

// Re-engagement is tailored to where the lead got stuck: a cold lead gets a
// low-pressure offer to answer questions; a warm one gets their specific
// blocker addressed without inventing any facts or figures.
function leadContext(stage?: string, blocker?: string | null): string {
  if (stage === "cold") {
    return `Стан ліда: холодний — ще не впевнений, мав питання чи сумніви${blocker ? ` (${blocker})` : ""}. Не тисни: коротко поверни до теми, запропонуй відповісти на питання.`;
  }
  if (stage === "warm") {
    return `Стан ліда: теплий — хотів замовити, але щось заважало${blocker ? ` (${blocker})` : ""}. Делікатно згадай про це і запитай, чи вдалося вирішити, чи можемо допомогти. Не обіцяй нічого нового (знижок, умов) — лише запропонуй написати нам.`;
  }
  return "";
}

// Writes ONE outbound message for a client. It never states prices or figures
// on its own: the link is inserted by code (so it can't be hallucinated), and
// the only numbers allowed are those in the admin-provided offer text.
export async function draftOutbound(input: {
  kind: OutboundKind;
  clientId: string;
  businessName: string;
  contactName: string | null;
  standingOrderNotes: string | null;
  recentOrders: string[];
  leadStage?: string;
  blockerNote?: string | null;
  offerText?: string;
}): Promise<string | null> {
  const link = getStorefrontLink(input.clientId);
  if (!link) return null;

  const response = await getAnthropic().messages.create({
    model: AGENT_MODEL,
    max_tokens: 2000,
    system: `Ти пишеш одне коротке повідомлення в Telegram від крафтової пекарні Craft Bakery by Dubova для B2B-клієнта. Українською, тепло й по-діловому, 2–4 речення, звичайний текст без markdown. ${KIND_INSTRUCTIONS[input.kind]}

ПРАВИЛА
- Не називай жодних цін, знижок, сум чи строків, окрім тих, що прямо наведені в тексті пропозиції нижче (якщо він є).
- Посилання на меню вставляй ТОЧНО як токен {{MENU_LINK}} — один раз, там де воно доречне. Не вигадуй інших посилань.
- Не вигадуй фактів про клієнта. Поверни лише текст повідомлення, без пояснень.`,
    messages: [
      {
        role: "user",
        content: [
          `Клієнт: ${input.businessName}${input.contactName ? ` (контакт: ${input.contactName})` : ""}`,
          `Нотатки про постійне замовлення: ${input.standingOrderNotes ?? "немає"}`,
          `Останні замовлення: ${input.recentOrders.length ? input.recentOrders.join("; ") : "немає"}`,
          input.kind === "remarketing" ? leadContext(input.leadStage, input.blockerNote) : "",
          input.offerText ? `Текст пропозиції від адміністратора: ${input.offerText}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    ],
  });

  const text = response.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("\n")
    .trim();
  if (!text) return null;
  return text.includes("{{MENU_LINK}}") ? text.replaceAll("{{MENU_LINK}}", link) : `${text}\n${link}`;
}
