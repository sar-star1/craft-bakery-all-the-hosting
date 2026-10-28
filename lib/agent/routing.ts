// Which model answers a message. Pure functions (no server-only), so they are easy to test.
//
// Every turn starts on the cheap model. It starts on the strong one only when the client's
// message looks hard; it moves up to the strong one mid-turn when the cheap model's work
// doesn't hold up (see runAgentLoop).

export interface ModelRoute {
  start: "fast" | "strong";
  // Why the turn started on the strong model (empty when it started cheap).
  hard: string[];
  // Why the turn moved from the cheap model to the strong one, if it did.
  escalatedBecause?: string;
  calls: { fast: number; strong: number };
  tokens: { fast: { in: number; out: number; cached: number }; strong: { in: number; out: number; cached: number } };
}

export const newRoute = (start: "fast" | "strong", hard: string[] = []): ModelRoute => ({
  start,
  hard,
  calls: { fast: 0, strong: 0 },
  tokens: { fast: { in: 0, out: 0, cached: 0 }, strong: { in: 0, out: 0, cached: 0 } },
});

// Signals that a message needs the stronger model: where a wrong answer costs money or trust,
// or where the cheap model is most likely to miss what is being asked.
const HARD: [string, RegExp][] = [
  ["скарга або проблема", /скарг|претензі|претензи|незадовол|недовол|обман|зіпсов|несвіж|черств|пліснявіл|волос|отруї|отруєн|повернен|відшкод|компенсац|жахлив|огидн|ганьб|розчарув|не привез|не доставил|запізни|спізнил|жалоб|верните|возврат|ужасн|испорч|\bсуд\b|юрист|санепід|поліці/i],
  ["знижка або особливі умови", /знижк|скидк|дешевш|відстрочк|відтермінув|в борг|в кредит|передоплат|постоплат|договір|договор|контракт|індивідуальн\w* умов|спецціна|особлив\w* умов|торг\b/i],
  ["алергени або склад", /алерг|аллерг|глютен|лактоз|арахіс|горіх|веган|консервант|діабет|інгредієнт|ингредиент|халяль|кошер/i],
  ["масове або подія", /оптом|гурт|масов|кейтеринг|весілл|банкет|фуршет|корпоратив|франшиз|мереж[аіу]\b/i],
  ["особисте виготовлення", /індивідуальн|свій дизайн|логотип|брендован|персоналізов|торт з напис|за ескіз|по ескіз|ескіз/i],
  ["просить людину", /менеджер|оператор|директор|власник|керівник|живу людину|живий чолов|з людиною/i],
  ["великі обсяги", /\d{3,}\s*(шт|штук|порц|кг|кілограм|коробк|упаков)/i],
];

export function hardReasons(text: string): string[] {
  const reasons = HARD.filter(([, re]) => re.test(text)).map(([why]) => why);
  if (text.length > 700) reasons.push("довге повідомлення");
  if ((text.match(/\d+\s*(шт|штук|порц|кг|х|x|×)/gi) ?? []).length >= 4) reasons.push("довгий список позицій");
  return reasons;
}

type Msg = { role: string; content: unknown };

// What the client has written since the agent last spoke (a burst arrives as several user turns).
export function trailingClientText(messages: Msg[]): string {
  const parts: string[] = [];
  for (let i = messages.length - 1; i >= 0 && messages[i].role === "user"; i--) {
    const c = messages[i].content;
    if (typeof c === "string") parts.unshift(c);
  }
  return parts.join("\n");
}

const num = (s: string) => s.replace(/(\d)[\s ](?=\d{3}\b)/g, "$1").replace(",", ".");

// Amounts of money in the reply that appear nowhere in what the model was given (tool results,
// the conversation, the rules). A cheap model that invents a price shows up here.
export function unsourcedAmounts(reply: string, sources: string): string[] {
  const known = new Set((num(sources).match(/\d+(?:\.\d+)?/g) ?? []).map((n) => String(Number(n))));
  const found = [...num(reply).matchAll(/(\d+(?:\.\d+)?)\s*(?:грн|₴|uah|гривень|гривні|гривня)/gi)].map((m) => String(Number(m[1])));
  return [...new Set(found.filter((n) => !known.has(n)))];
}

// Everything the model has been shown, as one string to look amounts up in.
export function sourceText(system: unknown, messages: Msg[]): string {
  const flat = (c: unknown): string =>
    typeof c === "string"
      ? c
      : Array.isArray(c)
        ? c.map((b) => (b && typeof b === "object" ? flat((b as { text?: unknown; content?: unknown }).text ?? (b as { content?: unknown }).content) : "")).join("\n")
        : "";
  return [flat(system), ...messages.map((m) => flat(m.content))].join("\n");
}

// The system prompt is long and mostly the same from message to message; only the
// «ПОТОЧНА СИТУАЦІЯ» tail changes. Marking the stable part for caching makes repeat reads cheap.
const VOLATILE_MARK = "\nПОТОЧНА СИТУАЦІЯ\n";
export function systemBlocks(system: string): string | { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[] {
  const at = system.indexOf(VOLATILE_MARK);
  if (at < 4000) return system;
  return [
    { type: "text", text: system.slice(0, at), cache_control: { type: "ephemeral" } },
    { type: "text", text: system.slice(at) },
  ];
}
