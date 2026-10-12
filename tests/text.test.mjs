import { sanitizeReply, claimsOrderAccepted, fallbackReaction } from "../lib/agent/postprocess.ts";
import { parseValidity, endOfThisWeek, formatValidity } from "../lib/agent/validity.ts";
import { parseExport, detectSenders, buildPairs, samplePairs, redact, nameMasker, flagPossibleSensitive, applyMasks, looksSpecific } from "../lib/telegramExport.ts";
import { makeChecker } from "./harness/check.mjs";

const { check, done } = makeChecker();

// ---- what the agent writes
let r = sanitizeReply("Будь ласка 🙏 [react_to_message: 🙏]");
check("a leaked reaction tag is removed and rescued as a reaction", r.text === "Будь ласка 🙏" && r.reaction === "🙏", JSON.stringify(r));
check("any other fake tool tag is removed", sanitizeReply("Добре.\n[place_order: client_confirmed=true]").text === "Добре.");
check("normal bracketed text is untouched", sanitizeReply("Доставка в середу [14.10] з 9:00").text === "Доставка в середу [14.10] з 9:00");
for (const s of ["Прийнято на п'ятницю, 16.10: 13 мигдалевих круасанів ✅", "Прийнято на середу ✅ Підтверджу деталі та дату.", "Замовлення оформлено.", "Оформив для вас на середу", "Записав: Гречаний × 4"]) check(`claims acceptance: «${s.slice(0, 36)}»`, claimsOrderAccepted(s));
for (const s of ["Підсумок на п'ятницю: ...", "Яку дату зручно?", "Мигдалевий круасан коштує 83 грн", "Доставка безкоштовна від 2000 грн", "Так, є ✅"]) check(`does not claim: «${s.slice(0, 36)}»`, !claimsOrderAccepted(s));
check("bare thanks → 🙏", fallbackReaction("Дякую !") === "🙏" && fallbackReaction("дуже дякую") === "🙏");
check("bare ok / так → 👍", fallbackReaction("Так") === "👍" && fallbackReaction("Добре!") === "👍");
check("real requests get no automatic reaction", fallbackReaction("Так, 5 асорті. Дякую") === null && fallbackReaction("Ні , дякую") === null && fallbackReaction("Дякую за інфо, а коли доставка?") === null);

// ---- temporary facts
const wk = parseValidity("цього тижня немає доставки на Троєщину");
check("'цього тижня' expires at the end of this week", wk.text === "немає доставки на Троєщину" && wk.expires === endOfThisWeek());
check("'до 12.10' parses a date; no prefix means no expiry", /-10-12$/.test(parseValidity("до 12.10 не робимо макарони").expires) && parseValidity("просто факт").expires === null);
check("validity is shown in Ukrainian", /^діє до \d\d\.\d\d\.\d{4}$/.test(formatValidity("2026-10-12")));

// ---- Telegram export
const mk = (id, who, date, text) => ({ id, type: "message", date, from: who === "us" ? "Peremoga" : "Клієнт " + who, from_id: who === "us" ? "user1" : "user" + who, text });
const chatA = { name: "Олена Коваленко", type: "personal_chat", messages: [
  mk(1, "A", "2026-03-01T10:00:00", "Добрий день, хочу замовити круасани, телефон 0501234567"),
  mk(2, "A", "2026-03-01T10:01:00", "десь 30 штук"),
  mk(3, "us", "2026-03-01T10:20:00", ["Доброго дня, Олено! ", { type: "bold", text: "Так" }, ", скиньте адресу."]),
  mk(4, "A", "2026-03-08T09:00:00", "як завжди на завтра"),
  mk(5, "us", "2026-03-08T09:05:00", "Прийняли 👍"),
  { id: 6, type: "service", date: "2026-03-15T09:03:00", from: "x", from_id: "user9", text: "" },
] };
const group = { name: "Група", type: "private_supergroup", messages: [mk(1, "C", "2026-04-01T12:00:00", "ігнор")] };
const chats = parseExport({ chats: { list: [chatA, group] } });
check("groups are skipped and service messages dropped", chats.length === 1 && chats[0].messages.length === 5);
check("our account is detected as the one in the chats", detectSenders(chats)[0].id === "user1" || detectSenders(chats).some((s) => s.id === "user1"));
const pairs = buildPairs(chats, "user1");
check("consecutive messages merge into one turn", pairs[0].client.includes("круасани") && pairs[0].client.includes("30 штук"));
check("first exchanges are 'new', later ones 'repeat'", pairs[0].kind === "new" && pairs[1].kind === "new");
check("phones, e-mails, links and names are removed", !/0501234567|Олен/.test(JSON.stringify(pairs)) && redact("пишіть https://x.com/menu") === "пишіть [посилання]", JSON.stringify(pairs));
check("name masking handles Ukrainian endings", nameMasker(["Олена Коваленко"])("Добрий день, Олено! Це Олена") === "Добрий день, [ім'я]! Це [ім'я]");
const sample = [{ client: "передайте Андрію що ми на вул. Хрещатик 10", reply: "Добре. ФОП Іваненко І. І. підтверджує? Дякуємо", kind: "new" }, { client: "доставте до Coffee Lab", reply: "Так", kind: "repeat" }];
const flags = flagPossibleSensitive(sample);
check("possible leftovers are flagged: name, address, ФОП, Latin café name", flags.some((f) => /^Андр/.test(f.text)) && flags.some((f) => f.kind === "address") && flags.some((f) => /ФОП Іваненко/.test(f.text)) && flags.some((f) => f.text === "Coffee"), JSON.stringify(flags));
check("applying the masks removes them", !/Андр|Хрещатик|Іваненко|Coffee/.test(JSON.stringify(applyMasks(sample, flags))));
check("analysis results that mention names or numbers are marked specific", looksSpecific("Звертайся до Олега на ви") && !looksSpecific("Відповідай коротко, на «ви»."));
check("sampling returns something sensible", samplePairs(pairs, 10).length > 0);

process.exit(done() ? 0 : 1);
