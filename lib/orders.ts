import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { PipelineStage } from "@/lib/types";

type Db = ReturnType<typeof createSupabaseServerClient>;

const NEXT_STAGE: Partial<Record<PipelineStage, PipelineStage>> = {
  new_lead: "first_order",
  cold: "first_order",
  warm: "first_order",
  menu_sent: "first_order",
  first_order: "recurring",
  dormant: "recurring",
};

// A client just ordered: stamp the order date, mark them active and move them
// one step up the funnel (first order → recurring). Used both when an order
// arrives through their personal link and when an admin attaches an order to a
// client by hand.
export async function markClientOrdered(db: Db, clientId: string, orderedAt: string = new Date().toISOString()) {
  const { data: row } = await db.from("clients").select("pipeline_stage").eq("id", clientId).maybeSingle();
  if (!row) return;
  const stage = row.pipeline_stage as PipelineStage;
  await db
    .from("clients")
    .update({ last_order_at: orderedAt, status: "active", pipeline_stage: NEXT_STAGE[stage] ?? stage })
    .eq("id", clientId);
}
