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

// The reply says the (already placed) order was changed or added to.
export function claimsOrderChanged(text: string): boolean {
  return /(?:додали|додав|додала|змінили|змінив|змінила|оновили|оновив|оновила|внесли|вніс|дописали|дописав)[^.!?\n]{0,70}замовленн|замовлення\s+(?:оновлено|змінено|доповнено)/iu.test(text);
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

// The reply promises to find something out or pass it on ("уточню в команди", "перевірю",
// "передам менеджеру"). Such a promise is only honest if a person is actually asked.
export function promisesFollowUp(text: string): boolean {
  return /(?:^|[^\p{L}])(?:уточню|уточнимо|уточнюю|уточнюємо|з['’ʼ]ясую|з['’ʼ]ясуємо|з['’ʼ]ясовую|дізнаюсь|дізнаюся|дізнаємось|дізнаємося|перевірю|перевіримо|перевіряю|передам\s+(?:це\s+|питання\s+)?(?:команді|менеджеру|адмін|керівнику|власнику|колегам)|передамо\s+(?:це\s+|питання\s+)?(?:команді|менеджеру|адмін|керівнику|власнику|колегам)|зв['’ʼ]яжусь|зв['’ʼ]яжемося|зв['’ʼ]яжемось|повернуся\s+(?:до\s+вас\s+)?з\s+відповід|повернемося\s+(?:до\s+вас\s+)?з\s+відповід)(?![\p{L}])/iu.test(
    text
  );
}

// What is wrong with a finished reply, if anything — returned as an instruction to the
// model, which gets one chance to write it again before the reply goes anywhere.
export function replyProblem(
  text: string,
  flags: {
    humanReviewReasons: string[];
    orderPlaced?: boolean;
    orderAmended?: boolean;
    summaryShown?: boolean;
    freeDeliveryShortfall?: number;
    stillShortAfterAdding?: boolean;
    toolsUsed?: string[];
  }
): string | null {
  if (claimsOrderChanged(text) && !flags.orderAmended && !flags.orderPlaced && !(flags.toolsUsed ?? []).includes("update_order_draft")) {
    return "Ти пишеш, що додав чи змінив замовлення, але amend_last_order не викликано — у системі нічого не змінилось. Якщо клієнт просить доповнити або змінити вже ОФОРМЛЕНЕ замовлення — виклич amend_last_order і лише тоді скажи, що змінено (з новою сумою з результату). Якщо це нове замовлення — працюй через update_order_draft і не кажи, що змінив оформлене.";
  }
  if (promisesFollowUp(text) && flags.humanReviewReasons.length === 0 && !flags.orderPlaced && !flags.orderAmended) {
    return "Ти пообіцяв клієнту щось уточнити, перевірити або передати команді, але не викликав request_human_review — тож нікого насправді не попросили. Якщо відповіді справді немає в даних інструментів: виклич request_human_review (reason і question — що саме команда має з'ясувати) і напиши клієнту коротку тепло-чесну відповідь, що уточнюєш і повернешся, без вигаданих строків. Якщо відповідь у тебе є — перепиши без обіцянки уточнити.";
  }
  const short = flags.freeDeliveryShortfall;
  if (short && flags.summaryShown && !new RegExp(`(?<![\\d])${short}(?![\\d])`).test(text.replace(/[\s ]/g, ""))) {
    return flags.stillShortAfterAdding
      ? `Клієнт уже отримав підказку добрати до безкоштовної доставки й щось додав, але все ще бракує ${short} ₴, а у відповіді цього немає. Перепиши: тепло й по-людськи визнай, що додане ще не дотягує, і скажи точно, скільки лишилось (${short} ₴); запропонуй, що можна додати, без тиску. Решту (підсумок) збережи.`
      : `У підсумку доставка платна, а у відповіді не сказано, скільки бракує до безкоштовної: ${short} ₴. Перепиши, додавши це одним теплим реченням і, за бажанням, ідею, що додати. Решту збережи.`;
  }
  return null;
}
