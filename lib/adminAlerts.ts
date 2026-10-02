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

const siteBase = () => process.env.SITE_URL?.replace(/\/$/, "");

// Posts a drafted reply to the admin group with one-tap buttons, and remembers
// the group message so a reply to it can be sent in place of the draft.
export async function announceDraft(
  db: Db,
  draft: { id: string; clientId: string; clientName: string; replyType: string; text: string; clientMessage?: string; reason?: string }
): Promise<void> {
  const base = siteBase();
  const buttons: InlineButton[][] = [
    [
      { text: "✅ Надіслати", callback_data: `ap:${draft.id}` },
      { text: "🚫 Відхилити", callback_data: `rj:${draft.id}` },
    ],
  ];
  if (base) buttons.push([{ text: "Відкрити в дашборді", url: `${base}/clients/${draft.clientId}` }]);

  const lines = [
    `${REPLY_TYPE_LABEL[draft.replyType] ?? "Чернетка"} · ${draft.clientName}${draft.reason ? ` (${draft.reason})` : ""}`,
    draft.clientMessage ? `\nКлієнт: «${draft.clientMessage.slice(0, 600)}»` : "",
    `\nЧернетка:\n«${draft.text.slice(0, 1500)}»`,
    "\n✏️ Щоб надіслати власний текст — відповідайте на це повідомлення.",
  ];
  const res = await notifyAdmin(lines.filter(Boolean).join("\n"), { buttons });
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
    .select("id, client_id, reply_type, draft_text")
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
