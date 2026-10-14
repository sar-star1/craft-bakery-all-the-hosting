import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { AGENT_MODEL, getAnthropic, isAnthropicConfigured } from "@/lib/agent/anthropic";
import {
  isSummarized,
  loadDraftFor,
  logAgentEvent,
  missingFields,
  placeChatOrder,
  type OrderDraft,
  type PlaceResult,
} from "@/lib/chatOrders";
import { classifyVerdict, type ModelLabel, type Verdict } from "@/lib/orderVerdict";

type Db = ReturnType<typeof createSupabaseServerClient>;
export { quickVerdict, fallbackVerdict, type Verdict } from "@/lib/orderVerdict";

const SYSTEM = `Клієнт пекарні отримав підсумок замовлення. Нижче — цей підсумок і наступне повідомлення клієнта. Визнач, що це за повідомлення. Відповідай ОДНИМ словом:

ACK — клієнт погоджується, дякує, підтверджує або будь-яким способом показує, що підсумок його влаштовує («так», «ок», «добре», «дякую», «супер», «без проблем», «чудово», «чекаю», смайлик, і взагалі будь-що схвальне чи нейтрально-схвальне), і більше нічого не просить.
MORE — те саме (погодився, подякував або просто пішов далі), але в повідомленні є ще щось окреме, що не стосується зміни цього підсумку: питання про інше, нове замовлення (напр. на іншу дату), інша тема.
CHANGE — клієнт хоче щось змінити, додати, прибрати чи скасувати саме в цьому підсумку, виправляє дані, заперечує, сумнівається або питає про склад чи суму цього підсумку так, що відповідь потрібна ДО оформлення.

Якщо в тексті немає явної зміни чи заперечення — обирай ACK або MORE: оформлене замовлення потім можна змінити. Тільки одне слово.`;

// Decides what the client's message means for an order summary waiting on an answer.
// Plain acknowledgements are recognised without a model; anything else is classified by
// the model, and if that is unavailable a conservative text check stands in.
export async function classifySummaryReply(text: string, summary: string): Promise<{ verdict: Verdict; via: "quick" | "model" | "fallback" }> {
  return classifyVerdict(text, async () => {
    if (!isAnthropicConfigured()) return null;
    const res = await getAnthropic().messages.create({
      model: AGENT_MODEL,
      max_tokens: 40,
      system: SYSTEM,
      messages: [{ role: "user", content: `ПІДСУМОК:\n${summary.slice(0, 1500)}\n\nПОВІДОМЛЕННЯ КЛІЄНТА:\n${text.slice(0, 800)}` }],
    });
    const out = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join(" ");
    return (out.match(/ACK|MORE|CHANGE/i)?.[0].toUpperCase() as ModelLabel | undefined) ?? null;
  });
}

export const draftText = (d: OrderDraft) => d.lines.map((l) => `${l.name} ×${l.qty}`).join(", ");

export interface ApprovalOutcome {
  verdict: Verdict;
  via: "quick" | "model" | "fallback";
  placed?: Extract<PlaceResult, { ok: true }> | { alreadyPlaced: true };
}

// The client wrote after we showed them a complete order summary. If the message approves it
// in ANY way — or just carries on with something else without objecting — the order is placed
// right here, before the agent answers, so it never depends on the model remembering to do it.
// Returns null when there is nothing waiting for approval.
export async function approveSummaryByMessage(
  db: Db,
  input: { client: { id: string; business_name: string }; conversationId: string; text: string; inboundCount: number }
): Promise<ApprovalOutcome | null> {
  const draft = await loadDraftFor(db, input.conversationId);
  if (!draft || !isSummarized(draft) || missingFields(draft).length > 0) return null;
  // The summary must really have reached the client, and the message must come after it.
  if (!draft.summary_sent_at || input.inboundCount <= (draft.summary_at_inbound ?? Infinity)) return null;

  const { verdict, via } = await classifySummaryReply(input.text, draftText(draft));
  const outcome: ApprovalOutcome = { verdict, via };
  if (verdict !== "change") {
    const placed = await placeChatOrder(db, {
      client: input.client,
      conversationId: input.conversationId,
      draft,
      approval: verdict === "ack" ? "text" : "continued",
    });
    if (placed.ok) outcome.placed = placed;
    else if (placed.alreadyPlaced) outcome.placed = { alreadyPlaced: true };
  }
  await logAgentEvent(db, input.client.id, "approval_detected", { verdict, via, placed: Boolean(outcome.placed), text: input.text.slice(0, 120) });
  return outcome;
}
