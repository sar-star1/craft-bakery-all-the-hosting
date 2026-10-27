import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { notifyAdmin, type InlineButton } from "@/lib/telegram";

type Db = ReturnType<typeof createSupabaseServerClient>;

export const REPLY_TYPE_LABEL: Record<string, string> = {
  order_flow: "Відповідь клієнту",
  weekly_reminder: "Нагадування",
  remarketing: "Повторне залучення",
  seasonal_offer: "Сезонна пропозиція",
};

// "📨 Передати клієнту": tell the agent what to say to this client (it finds the words), without
// taking the conversation over. "🙋 Перебрати розмову": write yourself, agent silent.
export const tellButtons = (clientId: string): InlineButton[] => [
  { text: "📨 Передати клієнту", callback_data: `tl:${clientId}` },
  { text: "🙋 Перебрати розмову", callback_data: `tk:${clientId}` },
];

const siteBase = () => process.env.SITE_URL?.replace(/\/$/, "");

export interface DraftAlert {
  id: string;
  clientId: string;
  clientName: string;
  replyType: string;
  text: string;
  clientMessage?: string;
  reason?: string;
  // What the agent needs the team to answer (set when it asked for help).
  question?: string;
  note?: string; // appended line, e.g. who revised it
  attachments?: { name: string }[];
}

export function buildDraftAlert(draft: DraftAlert): { text: string; buttons: InlineButton[][] } {
  const base = siteBase();
  const buttons: InlineButton[][] = [
    [
      { text: "✅ Надіслати", callback_data: `ap:${draft.id}` },
      { text: "🚫 Відхилити", callback_data: `rj:${draft.id}` },
    ],
  ];
  buttons.push(tellButtons(draft.clientId));
  if (base) buttons.push([{ text: "Відкрити в дашборді", url: `${base}/clients/${draft.clientId}` }]);

  const lines = [
    `${REPLY_TYPE_LABEL[draft.replyType] ?? "Чернетка"} · ${draft.clientName}${draft.reason ? ` (${draft.reason})` : ""}`,
    draft.question ? `\n❓ Питання до команди: ${draft.question.slice(0, 600)}` : "",
    draft.clientMessage ? `\nКлієнт: «${draft.clientMessage.slice(0, 600)}»` : "",
    `\nЧернетка:\n«${draft.text.slice(0, 1500)}»`,
    draft.attachments?.length ? `\n📎 Файли: ${draft.attachments.map((a) => a.name).join(", ")}` : "",
    draft.note ? `\n${draft.note}` : "",
    draft.question
      ? "\n✏️ Дайте відповідь на це повідомлення: звичайним текстом — агент сам складе відповідь клієнту з ваших слів (і запам'ятає її як факт, якщо вона загальна); текст з «!» піде клієнту як є."
      : "\n✏️ Відповідь на це повідомлення: звичайний текст — зауваження агенту (перепише чернетку й, якщо зауваження загальне, запам'ятає правило); текст, що починається з «!», піде клієнту як є.",
  ];
  return { text: lines.filter(Boolean).join("\n"), buttons };
}

// Posts a drafted reply to the admin group with one-tap buttons, and remembers
// the group message so replies to it (feedback, or "!" text) can be matched.
export async function announceDraft(db: Db, draft: DraftAlert): Promise<void> {
  const { text, buttons } = buildDraftAlert(draft);
  const res = await notifyAdmin(text, { buttons });
  if (res.ok && res.messageId) {
    await db.from("pending_replies").update({ admin_message_id: res.messageId }).eq("id", draft.id);
  }
}

const MAX_DRAFT_ALERTS = 15;

// Batch jobs (reminders, re-engagement, seasonal offers) can create many
// drafts at once: the first few get their own actionable alert, the rest are
// summarised with a dashboard link so the group isn't flooded.
export async function announceDrafts(db: Db, draftIds: string[], label: string): Promise<void> {
  if (draftIds.length === 0) return;
  const { data } = await db
    .from("pending_replies")
    .select("id, client_id, reply_type, draft_text, attachments")
    .in("id", draftIds.slice(0, MAX_DRAFT_ALERTS));
  const clientIds = [...new Set((data ?? []).map((d) => d.client_id as string))];
  const { data: clients } = await db.from("clients").select("id, business_name").in("id", clientIds);
  const names = new Map((clients ?? []).map((c) => [c.id as string, c.business_name as string]));

  for (const d of data ?? []) {
    await announceDraft(db, {
      id: d.id as string,
      clientId: d.client_id as string,
      clientName: names.get(d.client_id as string) ?? "—",
      replyType: d.reply_type as string,
      text: d.draft_text as string,
      attachments: (d.attachments as { name: string }[] | null) ?? [],
    });
    await new Promise((r) => setTimeout(r, 400)); // stay under Telegram's group rate limit
  }

  if (draftIds.length > MAX_DRAFT_ALERTS) {
    const base = siteBase();
    await notifyAdmin(
      `${label}: ще ${draftIds.length - MAX_DRAFT_ALERTS} чернеток чекають на підтвердження.${base ? `\n${base}/pending-replies` : ""}`
    );
  }
}
