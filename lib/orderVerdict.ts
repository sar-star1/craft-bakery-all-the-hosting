// What a client's message means for an order summary that is waiting for their answer.
// Pure text logic (no server imports), so the dashboard's practice chat can use it too.
//
//   ack    — approves it, thanks, or otherwise accepts it, and nothing else
//   more   — accepts it / moves on, and also brings something new (another question, another order)
//   change — wants to change, add, remove or cancel something in it, corrects it, objects or doubts
//
// The default is to treat a message as approval: an order that was placed too early can be
// amended, while one that is never placed leaves the client waiting and the bot confused.

export type Verdict = "ack" | "more" | "change";
export type ModelLabel = "ACK" | "MORE" | "CHANGE";

const POSITIVE = new Set([
  "так", "ага", "угу", "ок", "окей", "оке", "окі", "ok", "okay", "okey", "добре", "добренько", "гарно", "чудово", "супер", "класно", "клас",
  "відмінно", "ідеально", "прекрасно", "чудесно", "круто", "файно", "норм", "нормально", "гаразд", "дякую", "дякуємо", "дякую-дякую", "дяка",
  "спасибі", "спасибо", "дякуюю", "thanks", "thank", "thx", "good", "great", "nice", "perfect", "cool", "yes", "yep", "yeah", "sure",
  "підходить", "влаштовує", "домовились", "домовилися", "згоден", "згодна", "згодні", "погоджуюсь", "погоджуюся", "давайте", "давай", "беріть",
  "оформлюйте", "оформляйте", "підтверджую", "підтверджуємо", "вірно", "правильно", "точно", "чекаю", "чекаємо", "чекатимемо", "чекатиму",
  "жду", "сподобалось", "відмінне", "прийнято", "зрозуміло", "зрозуміла", "зрозумів", "бачу", "бачила", "бачив", "добро", "ладно", "лад",
  "проблем", "проблеми", "проблема", "без", "все", "усе", "вс", "порядку", "ok.", "👍", "👌", "🙏", "❤", "🔥", "✅", "👏",
]);
// words that may sit around a positive one without changing its meaning
const FILLER = new Set([
  "і", "й", "та", "а", "ну", "то", "тоді", "дуже", "вам", "вас", "за", "це", "же", "ж", "буду", "будемо", "гарного", "доброго", "дня", "вечора",
  "дні", "смачного", "бажаю", "успіхів", "вдалого", "велике", "великий", "будь", "ласка", "будь-ласка", "вже", "тож", "тоді", "у", "в", "на",
  "підсумок", "замовлення", "ми", "я", "нас", "мене", "мені", "чудовий", "хороший", "гарний", "день", "бувайте", "до", "побачення", "зв'язку",
]);
const POSITIVE_EMOJI = /[👍👌🙏❤🔥✅👏😊🙂😉😍🥰💪🤝😁😄😀🤗💯🌟🫶😌☺️🙌👋💙💛💚🧡💜🤍💖]/u;
const POSITIVE_PHRASE = /без\s+проблем|все\s+(?:добре|гаразд|ок|окей|вірно|так|чудово|супер|влаштовує|підходить)|усе\s+(?:добре|гаразд|ок|окей|вірно|так|чудово|супер|влаштовує|підходить)|в\s+порядку|у\s+порядку|так,?\s+давайте|давайте\s+так|все\s+сходиться/iu;

// Words that point to a change or an objection. Their presence only means "don't decide by
// word list" — the message then goes to the model (or the conservative fallback).
const CHANGE =
  /(?:^|[^\p{L}])(?:не|ні|нє|нет|але|однак|стривайте?|почекайте?|зачекайте?|змін\p{L}*|замін\p{L}*|замість|додайте|додати|додай|добав\p{L}*|ще|забув\p{L}*|забули|прибер\p{L}*|видал\p{L}*|скас\p{L}*|відмін\p{L}*|помил\p{L}*|невірн\p{L}*|неправиль\p{L}*|менше|більше|інш\p{L}*|тільки|лише|окрем\p{L}*|перенес\p{L}*|перенос\p{L}*|поміняйте|поміняти)(?![\p{L}])/iu;

// A message that is nothing but approval/thanks/acknowledgement — decided without a model.
export function quickVerdict(text: string): "ack" | null {
  const t = text.trim().toLowerCase();
  if (!t || t.length > 70 || t.includes("?")) return null;
  const withoutPhrases = t.replace(POSITIVE_PHRASE, " ");
  if (CHANGE.test(withoutPhrases)) return null;
  const words = withoutPhrases.match(/[\p{L}'’ʼ-]+/gu) ?? [];
  const hasPhrase = withoutPhrases !== t;
  const hasPositive = hasPhrase || POSITIVE_EMOJI.test(t) || words.some((w) => POSITIVE.has(w));
  if (!hasPositive) return null;
  return words.every((w) => POSITIVE.has(w) || FILLER.has(w)) ? "ack" : null;
}

// When no model is available: clear change/objection signs or a question mean "change",
// everything else counts as approval (see the note at the top).
export function fallbackVerdict(text: string): Verdict {
  return CHANGE.test(text.replace(POSITIVE_PHRASE, " ")) || text.includes("?") ? "change" : "more";
}

export async function classifyVerdict(
  text: string,
  askModel: () => Promise<ModelLabel | null>
): Promise<{ verdict: Verdict; via: "quick" | "model" | "fallback" }> {
  const quick = quickVerdict(text);
  if (quick) return { verdict: quick, via: "quick" };
  try {
    const label = await askModel();
    if (label) return { verdict: label.toLowerCase() as Verdict, via: "model" };
  } catch (err) {
    console.error("approval classifier failed", err);
  }
  return { verdict: fallbackVerdict(text), via: "fallback" };
}
