// Checks applied to what the agent wrote, before a client sees it. The model is
// good but not perfectly disciplined: these catch the specific ways it has gone
// wrong in real conversations.

// A tool-call written out as text ("[react_to_message: 🙏]") instead of being
// called. Remove it, and rescue the intent when it was a reaction.
export function sanitizeReply(text: string): { text: string; reaction?: string } {
  let reaction: string | undefined;
  const cleaned = text
    .replace(/\[\s*react_to_message\s*[:=]?\s*([^\]]*)\]/gi, (_m, arg: string) => {
      const emoji = (arg.match(/[👍❤🙏🔥👌]/u) ?? [])[0];
      if (emoji) reaction = emoji;
      return "";
    })
    // any other bracketed snake_case "tool call" the model might invent
    .replace(/\[\s*[a-z]+(?:_[a-z]+)+\s*[:=][^\]]*\]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\s{2,}$/g, "")
    .trim();
  return { text: cleaned, reaction };
}

// The reply tells the client an order is accepted / recorded.
export function claimsOrderAccepted(text: string): boolean {
  return /(?:^|[^\p{L}])(?:прийнято|прийняли|замовлення\s+(?:прийнято|оформлено|оформили|записано)|оформив(?:ла)?|оформила|оформили|оформлено|записав|записала|записали\s+(?:на|замовлення))(?![\p{L}])/iu.test(
    text
  );
}

// Reactions that need no judgment: a bare thank-you or a bare "ok". The model is
// supposed to choose these itself (react_to_message) but often writes the emoji
// into the text instead, so a plain message gets its reaction from here.
export function fallbackReaction(clientText: string): string | null {
  const t = clientText.trim().toLowerCase().replace(/[!.,)\s]+$/g, "");
  if (t.length > 40) return null;
  if (/^(?:дуже\s+)?(?:дякую|дякуємо|спасибі|дяка|thanks|thank you|thx)(?:\s+(?:вам|велике|за все))?$/.test(t)) return "🙏";
  if (/^(?:ок|окей|ok|okay|добре|гаразд|так|ага|угу|домовились|чудово|супер|класно|підходить|буду чекати)$/.test(t)) return "👍";
  return null;
}
