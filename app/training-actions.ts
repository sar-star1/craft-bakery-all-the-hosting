"use server";

import { revalidatePath } from "next/cache";
import { isAnthropicConfigured } from "@/lib/agent/anthropic";
import { addGuideline, getActiveGuidelines } from "@/lib/agent/guidelines";
import { getExamples, recordExample } from "@/lib/agent/memory";
import { buildSystemPrompt } from "@/lib/agent/prompt";
import { reviseDraft } from "@/lib/agent/revise";
import { runAgentLoop } from "@/lib/agent/run";
import type { TurnFlags } from "@/lib/agent/policy";
import { requireAdmin } from "@/lib/auth";
import { PAYMENT_LABEL } from "@/lib/orderRules";
import { createSupabaseServerClient } from "@/lib/supabase/server";


export interface PracticeTurn {
  role: "client" | "agent";
  text: string;
}

const PRACTICE_CLIENT_ID = "00000000-0000-4000-8000-000000000000";

// Talks to the real agent, with the real prompt, tools, rules and examples —
// but as an invented client, with every write and every alert switched off.
export async function practiceReply(
  history: PracticeTurn[],
  state: Record<string, unknown> = {}
): Promise<{ ok: true; text: string; notes: string[]; state: Record<string, unknown> } | { ok: false; error: string }> {
  await requireAdmin();
  if (!isAnthropicConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY не задано." };
  try {
    const db = createSupabaseServerClient();
    const flags: TurnFlags = { humanReviewReasons: [], massOrderFlagged: false, confirmationProposed: false, menuLinkSent: false };
    const client = { id: PRACTICE_CLIENT_ID, business_name: "Тестовий клієнт (тренування)", pipeline_stage: "new_lead" as const };
    const [guidelines, examples] = await Promise.all([getActiveGuidelines(db), getExamples(db)]);
    // "Simulate a returning client": they've ordered before and we remember their details.
    const repeat = state.practice_repeat === true;
    const profile = repeat
      ? { venue_name: "Кав'ярня «Лагідна»", fop: "ФОП Коваленко І. П.", delivery_address: "Київ, вул. Хрещатик 10", payment_method: "cashless" as const, phone: "+380501112233" }
      : undefined;
    const { practice_repeat: _flag, ...memory } = state;
    void _flag;
    const system = buildSystemPrompt({
      client: { ...client, pipeline_stage: repeat ? ("recurring" as never) : client.pipeline_stage, contact_name: null, standing_order_notes: null, blocker_note: null },
      capturedFields: memory,
      guidelines,
      examples,
      ordersCount: repeat ? 3 : 0,
      profile: profile
        ? { venue_name: profile.venue_name, fop: profile.fop, address: profile.delivery_address, payment: PAYMENT_LABEL[profile.payment_method] }
        : undefined,
    });
    const messages = history.map((t) => ({
      role: t.role === "client" ? ("user" as const) : ("assistant" as const),
      content: t.text,
    }));
    while (messages.length > 0 && messages[0].role !== "user") messages.shift();
    const practiceState: Record<string, unknown> = { ...state, ...(profile ? { profile } : {}) };
    const text = await runAgentLoop(system, messages, {
      supabase: db,
      client,
      conversationId: PRACTICE_CLIENT_ID,
      flags,
      dryRun: true,
      inboundCount: history.filter((t) => t.role === "client").length,
      practiceState,
    });
    if (!text) return { ok: false, error: flags.humanReviewReasons.join("; ") || "Агент не дав відповіді." };
    const notes = [
      ...flags.humanReviewReasons.map((r) => `Передав би людині: ${r}`),
      ...(flags.reaction ? [`Поставив би реакцію ${flags.reaction} на повідомлення клієнта`] : []),
      ...(flags.massOrderFlagged ? ["Позначив би як масове замовлення"] : []),
      ...(flags.confirmationProposed ? ["Запропонував домовленість — чекала б на підтвердження"] : []),
    ];
    const { profile: _p, ...nextState } = practiceState;
    void _p;
    return { ok: true, text, notes, state: nextState };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// "That's not how we'd say it": the agent rewrites its reply from the remark,
// and a general remark is stored as a standing rule.
export async function practiceCorrect(
  history: PracticeTurn[],
  reply: string,
  feedback: string
): Promise<{ ok: true; text: string; rule: string | null } | { ok: false; error: string }> {
  await requireAdmin();
  if (!isAnthropicConfigured()) return { ok: false, error: "ANTHROPIC_API_KEY не задано." };
  try {
    const db = createSupabaseServerClient();
    const guidelines = await getActiveGuidelines(db);
    const revision = await reviseDraft({
      draft: reply,
      feedback,
      clientMessage: [...history].reverse().find((t) => t.role === "client")?.text,
      history: history.map((t) => ({ direction: t.role === "client" ? "in" : "out", text: t.text })),
      guidelines,
      rewrite: true,
    });
    if (revision.rule) await addGuideline(db, revision.rule, "admin_feedback");
    revalidatePath("/setup");
    return { ok: true, text: revision.text ?? reply, rule: revision.rule };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// "Yes, exactly like this": save the exchange as a worked example.
export async function practiceSaveExample(clientMessage: string, reply: string): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  try {
    await recordExample(createSupabaseServerClient(), { clientMessage, reply, quality: "written" });
    revalidatePath("/setup");
    return { ok: true, message: "Збережено як приклад." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
