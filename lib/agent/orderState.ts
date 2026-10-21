import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSummarized, loadDraftFor, missingFields, type OrderDraft } from "@/lib/chatOrders";

type Db = ReturnType<typeof createSupabaseServerClient>;

const STATUS_UK: Record<string, string> = {
  pending_review: "на перевірці",
  new: "нове",
  confirmed: "підтверджене командою",
  in_progress: "у роботі",
  ready: "готове",
  completed: "виконане",
};
// The team has not started on these yet, so the client can still change them from chat.
const AMENDABLE = new Set(["new", "pending_review"]);

export interface LastOrderInfo {
  id?: string;
  created_at: string;
  summary: string;
  total: number | null;
  status: string;
  due_date?: string | null;
}

export interface OrderStateInput {
  draft: Pick<OrderDraft, "lines" | "summary_at_inbound" | "summary_sent_at"> & { missing?: string[] } | null;
  lastOrder: LastOrderInfo | null;
  // The order that this very message approved, placed by the system before the agent runs.
  justPlaced?: { summary: string; total?: number; mode: "ack" | "more" } | null;
  // The client's message changes the summary instead of approving it.
  changing?: boolean;
  now?: number;
}

function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (min < 2) return "щойно";
  if (min < 90) return `${min} хв тому`;
  const h = Math.round(min / 60);
  if (h < 36) return `${h} год тому`;
  return `${Math.round(h / 24)} дн. тому`;
}

// What the agent is told about the order lifecycle on every turn. This is the system's
// record, not the chat's: it must be trusted over anything the old messages seem to say,
// which is how the bot used to keep asking about orders that were already placed.
export function orderStateBlock(input: OrderStateInput): string {
  const now = input.now ?? Date.now();
  const lines: string[] = [];

  if (input.justPlaced) {
    const p = input.justPlaced;
    lines.push(
      `- ЩОЙНО ОФОРМЛЕНО СИСТЕМОЮ: «${p.summary}»${p.total ? ` на ${p.total} ₴` : ""}. Клієнт підтвердив підсумок саме цим повідомленням (будь-яка згода — це підтвердження). ${
        p.mode === "ack"
          ? "Відповідай коротко й тепло: замовлення прийнято (від імені пекарні; не згадуй «менеджера» і не обіцяй «підтвердити деталі та дату»). НІЧОГО не перепитуй, не проси підтвердження, не показуй підсумок знову."
          : "Спершу одним теплим реченням скажи, що замовлення прийнято (від імені пекарні, без «менеджер підтвердить»), а потім відповідай на решту повідомлення — це вже нове питання чи нове замовлення."
      } Не викликай place_order — воно вже оформлене.`
    );
  }

  const d = input.draft;
  if (!d || d.lines.length === 0) {
    lines.push("- Чернетка нового замовлення: немає.");
  } else {
    const items = d.lines.map((l) => `${l.name} ×${l.qty}`).join(", ");
    if (isSummarized(d as OrderDraft) && !d.missing?.length && d.summary_sent_at) {
      lines.push(
        input.changing
          ? `- Чернетка: підсумок «${items}» показано клієнту, але в цьому повідомленні він його ЗМІНЮЄ або заперечує — це НЕ підтвердження. Онови чернетку (update_order_draft з edit_pending: true), знову review_order і покажи новий підсумок.`
          : `- Чернетка: підсумок «${items}» показано клієнту, чекаємо на його відповідь. Підтвердження система оформлює сама.`
      );
    } else {
      lines.push(`- Чернетка нового замовлення збирається: ${items}${d.missing?.length ? `; ще бракує: ${d.missing.join(", ")}` : ""}.`);
    }
  }

  const o = input.lastOrder;
  if (o) {
    const amendable = AMENDABLE.has(o.status);
    lines.push(
      `- Останнє оформлене замовлення: «${o.summary}»${o.total ? `, ${o.total} ₴` : ""}${o.due_date ? `, на ${o.due_date}` : ""}; оформлене ${ago(o.created_at, now)}, статус: ${STATUS_UK[o.status] ?? o.status}. ` +
        `Воно ЗАКРИТЕ: клієнт його вже підтвердив, тож про підтвердження цього замовлення не питай і не повертайся до нього без причини — навіть якщо в старих повідомленнях видно підсумок, на який «ще немає відповіді». ` +
        (amendable
          ? `Його ще можна змінити з чату: якщо клієнт у БУДЬ-ЯКІЙ формі просить додати, змінити, прибрати чи каже «забув(ла)…» — це про ЦЕ замовлення: amend_last_order (адміністраторів буде повідомлено автоматично), а клієнту коротко назви, що змінилось і яка нова сума.`
          : `Його вже опрацьовує команда, змінити з чату не вийде: якщо клієнт просить зміну — request_human_review (question: що саме змінити), а клієнту чесно скажи, що передав команді.`)
    );
  } else {
    lines.push("- Оформлених замовлень у чаті ще не було.");
  }

  lines.push(
    "- Правило: кожне наступне повідомлення клієнта після оформленого замовлення — початок НОВОГО замовлення (або звичайна розмова), крім випадку, коли клієнт просить змінити/доповнити попереднє."
  );
  return `\nСТАН ЗАМОВЛЕННЯ (дані системи — довіряй їм більше, ніж історії розмови)\n${lines.join("\n")}\n`;
}

export async function loadLastOrder(db: Db, clientId: string): Promise<LastOrderInfo | null> {
  const { data } = await db
    .from("orders")
    .select("id, created_at, item_summary_uk, total_amount, status, due_date, source")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    created_at: data.created_at as string,
    summary: String(data.item_summary_uk ?? ""),
    total: data.total_amount === null || data.total_amount === undefined ? null : Number(data.total_amount),
    status: String(data.status),
    due_date: (data.due_date as string | null) ?? null,
  };
}

// The newest order that came out of this chat. Everything said before it belongs to a
// conversation that is finished; the agent starts from what comes after.
export async function lastChatOrderAt(db: Db, clientId: string): Promise<string | null> {
  const { data } = await db
    .from("orders")
    .select("created_at")
    .eq("client_id", clientId)
    .eq("source", "telegram")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.created_at as string | undefined) ?? null;
}

export async function buildOrderState(
  db: Db,
  input: { clientId: string; conversationId: string; justPlaced?: OrderStateInput["justPlaced"]; changing?: boolean }
): Promise<string> {
  const [draft, lastOrder] = await Promise.all([loadDraftFor(db, input.conversationId), loadLastOrder(db, input.clientId)]);
  return orderStateBlock({
    draft: draft ? { ...draft, missing: missingFields(draft) } : null,
    lastOrder,
    justPlaced: input.justPlaced,
    changing: input.changing,
  });
}
