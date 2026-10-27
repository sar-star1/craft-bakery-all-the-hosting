import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { announceDraft } from "@/lib/adminAlerts";
import { isAnthropicConfigured, AGENT_MODEL, getAnthropic } from "@/lib/agent/anthropic";
import { approveAllReplies } from "@/lib/agent/policy";
import { getActiveGuidelines, guidelinesBlock } from "@/lib/agent/guidelines";
import { sendPendingReply } from "@/lib/replies";
import { notifyAdmin } from "@/lib/telegram";

type Db = ReturnType<typeof createSupabaseServerClient>;
export type TellResult = { ok: true; text: string; draftId: string; sent: boolean } | { ok: false; error: string };

// "Go and tell the client this and that": the team says WHAT, the agent finds the words — in the
// bakery's voice and following the rules — without anyone taking over the conversation.
export async function composeForClient(db: Db, clientId: string, instruction: string): Promise<string> {
  const [{ data: client }, { data: rows }, guidelines] = await Promise.all([
    db.from("clients").select("business_name, contact_name").eq("id", clientId).maybeSingle(),
    db.from("messages").select("direction, text, deleted_at").eq("client_id", clientId).order("created_at", { ascending: false }).limit(14),
    getActiveGuidelines(db),
  ]);
  const history = (rows ?? [])
    .filter((m) => !m.deleted_at)
    .reverse()
    .map((m) => `${m.direction === "in" ? "Клієнт" : "Ми"}: ${String(m.text).slice(0, 500)}`)
    .join("\n");
  const response = await getAnthropic().messages.create({
    model: AGENT_MODEL,
    max_tokens: 700,
    system: `Ти асистент пекарні Peremoga Bakery і пишеш клієнтові в Telegram. Команда дала вказівку, що йому передати. Напиши коротке тепле повідомлення від імені пекарні («ми»), яке передає саме те, що сказала команда.
- Не додавай жодних фактів, цін, дат чи обіцянок, яких немає у вказівці.
- Враховуй діалог: не повторюй сказане; якщо раніше ми обіцяли щось уточнити — скажи результат.
- Тон, довжина й манера — за правилами нижче. Без markdown.
- Відповідай ЛИШЕ текстом повідомлення клієнту.
${guidelinesBlock(guidelines)}`,
    messages: [
      {
        role: "user",
        content: `Клієнт: ${client?.business_name ?? "—"}${client?.contact_name ? ` (${client.contact_name})` : ""}\n\nОстанні повідомлення:\n${history || "(діалог порожній)"}\n\nВказівка команди — що передати клієнту:\n${instruction}`,
      },
    ],
  });
  return response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}

// Writes the message and puts it in front of the team (✅ to send). When strict approval is
// switched off it is sent straight away — the instruction itself was the team's decision.
export async function tellClientViaAgent(db: Db, input: { clientId: string; instruction: string; by: string }): Promise<TellResult> {
  const instruction = input.instruction.trim();
  if (!instruction) return { ok: false, error: "Напишіть, що передати клієнту." };
  if (!isAnthropicConfigured()) return { ok: false, error: "AI не налаштовано (ANTHROPIC_API_KEY)." };

  let text: string;
  try {
    text = await composeForClient(db, input.clientId, instruction);
  } catch (err) {
    return { ok: false, error: `Не вдалося скласти повідомлення: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!text) return { ok: false, error: "Агент не склав повідомлення — спробуйте сформулювати інакше." };

  const [{ data: client }, { data: conv }] = await Promise.all([
    db.from("clients").select("business_name").eq("id", input.clientId).maybeSingle(),
    db.from("conversations").select("id").eq("client_id", input.clientId).order("last_message_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const { data: draft, error } = await db
    .from("pending_replies")
    .insert({
      client_id: input.clientId,
      conversation_id: (conv?.id as string | undefined) ?? null,
      draft_text: text,
      reply_type: "order_flow",
      status: "awaiting_approval",
    })
    .select("id")
    .single();
  if (error || !draft) return { ok: false, error: "Не вдалося зберегти чернетку." };

  const draftId = draft.id as string;
  if (!approveAllReplies()) {
    const sent = await sendPendingReply(draftId);
    if (sent.ok) return { ok: true, text, draftId, sent: true };
    await notifyAdmin(`Не вдалося надіслати клієнту ${client?.business_name ?? ""}: ${sent.error}`).catch(() => {});
  }
  await announceDraft(db, {
    id: draftId,
    clientId: input.clientId,
    clientName: (client?.business_name as string) ?? "—",
    replyType: "order_flow",
    text,
    reason: "за вказівкою команди",
    note: `📨 Вказівка (${input.by}): «${instruction.slice(0, 300)}»`,
  });
  return { ok: true, text, draftId, sent: false };
}
