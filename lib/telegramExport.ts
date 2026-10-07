// Reads a Telegram Desktop "Export chat history" JSON in the browser and turns
// it into (client message → our reply) pairs. Nothing here touches the network:
// the raw export never leaves the computer — only a redacted sample is sent for
// analysis.

export interface ExportMessage {
  from: string;
  fromId: string;
  at: number; // ms
  text: string;
}
export interface ExportChat {
  name: string;
  messages: ExportMessage[];
}
export interface Sender {
  id: string;
  name: string;
  messages: number;
  chats: number;
}
export interface Pair {
  client: string;
  reply: string;
  kind: "new" | "repeat";
}

type RawText = string | (string | { text?: string })[] | undefined;
interface RawMessage {
  type?: string;
  date?: string;
  from?: string;
  from_id?: string;
  text?: RawText;
}
interface RawChat {
  name?: string;
  type?: string;
  messages?: RawMessage[];
}

const flatten = (t: RawText): string =>
  typeof t === "string" ? t : Array.isArray(t) ? t.map((p) => (typeof p === "string" ? p : p?.text ?? "")).join("") : "";

export function parseExport(raw: unknown): ExportChat[] {
  const data = raw as { chats?: { list?: RawChat[] }; messages?: RawMessage[]; name?: string; type?: string };
  const chats: RawChat[] = data.chats?.list ?? (data.messages ? [{ name: data.name, type: data.type, messages: data.messages }] : []);
  return chats
    .filter((c) => !c.type || c.type === "personal_chat") // groups and channels are not client conversations
    .map((c) => ({
      name: c.name ?? "",
      messages: (c.messages ?? [])
        .filter((m) => m.type === "message" && m.from_id && m.date)
        .map((m) => ({ from: m.from ?? "", fromId: String(m.from_id), at: Date.parse(m.date as string), text: flatten(m.text).trim() }))
        .filter((m) => m.text && !Number.isNaN(m.at))
        .sort((a, b) => a.at - b.at),
    }))
    .filter((c) => c.messages.length > 0);
}

// The bakery's own account is the one that appears in (nearly) every chat.
export function detectSenders(chats: ExportChat[]): Sender[] {
  const map = new Map<string, Sender & { seen: Set<number> }>();
  chats.forEach((c, i) => {
    for (const m of c.messages) {
      const s = map.get(m.fromId) ?? { id: m.fromId, name: m.from, messages: 0, chats: 0, seen: new Set<number>() };
      s.messages++;
      if (!s.seen.has(i)) {
        s.seen.add(i);
        s.chats++;
      }
      map.set(m.fromId, s);
    }
  });
  return [...map.values()]
    .map(({ seen: _seen, ...s }) => s)
    .sort((a, b) => b.chats - a.chats || b.messages - a.messages)
    .slice(0, 6);
}

const GAP_SAME_TURN = 10 * 60 * 1000;
const GAP_REPLY = 24 * 3600 * 1000;

export function redact(text: string): string {
  return text
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[посилання]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/(?:\+?38)?[\s(-]*0\d{2}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/g, "[телефон]")
    .replace(/\b\d{9,}\b/g, "[номер]")
    .replace(/\s+/g, " ")
    .trim();
}

// Masks the client's and the chat's name (and Ukrainian endings of it: Олена /
// Олено / Олени) so conversations stay anonymous.
export function nameMasker(names: string[]): (text: string) => string {
  const stems = [...new Set(names.flatMap((n) => n.split(/[\s,.\-_|()«»"']+/)).filter((w) => [...w].length >= 3))].map((w) => {
    const chars = [...w];
    const stem = chars.slice(0, Math.max(3, chars.length - 2)).join("").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return stem;
  });
  if (stems.length === 0) return (t) => t;
  const re = new RegExp(`(?<![\\p{L}])(?:${stems.join("|")})\\p{L}*`, "giu");
  return (t) => t.replace(re, "[ім'я]");
}

export function buildPairs(chats: ExportChat[], ourId: string): Pair[] {
  const pairs: Pair[] = [];
  for (const chat of chats) {
    const mask = nameMasker([chat.name, ...chat.messages.filter((m) => m.fromId !== ourId).map((m) => m.from)]);
    // Merge consecutive messages from the same side into one turn.
    const turns: { ours: boolean; text: string; start: number; end: number }[] = [];
    for (const m of chat.messages) {
      const ours = m.fromId === ourId;
      const last = turns[turns.length - 1];
      if (last && last.ours === ours && m.at - last.end <= GAP_SAME_TURN) {
        last.text += `\n${m.text}`;
        last.end = m.at;
      } else turns.push({ ours, text: m.text, start: m.at, end: m.at });
    }
    let exchange = 0;
    for (let i = 0; i + 1 < turns.length; i++) {
      const a = turns[i];
      const b = turns[i + 1];
      if (!a.ours && b.ours && b.start - a.end <= GAP_REPLY) {
        const client = mask(redact(a.text));
        const reply = mask(redact(b.text));
        if (client.length >= 2 && reply.length >= 2) pairs.push({ client, reply, kind: exchange < 2 ? "new" : "repeat" });
        exchange++;
      }
    }
  }
  return pairs;
}

// A deterministic spread: all new-customer openings first (up to a third), the
// rest repeat-customer exchanges, favouring replies with some substance.
export function samplePairs(pairs: Pair[], max: number): Pair[] {
  const substantial = (p: Pair) => p.reply.length >= 12;
  const pick = (list: Pair[], n: number) => {
    const good = list.filter(substantial);
    const step = Math.max(1, Math.floor(good.length / n));
    return good.filter((_, i) => i % step === 0).slice(0, n);
  };
  const fresh = pick(pairs.filter((p) => p.kind === "new"), Math.floor(max / 3));
  const repeat = pick(pairs.filter((p) => p.kind === "repeat"), max - fresh.length);
  return [...fresh, ...repeat];
}
