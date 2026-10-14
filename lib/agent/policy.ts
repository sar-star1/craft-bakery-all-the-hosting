import type { PipelineStage } from "@/lib/types";

export interface TurnFlags {
  humanReviewReasons: string[];
  massOrderFlagged: boolean;
  confirmationProposed: boolean;
  menuLinkSent: boolean;
  // An emoji reaction to put on the client's message together with the reply.
  reaction?: string;
  // The reply carries a priced order summary (its Telegram message is what a 👍 approves).
  summaryShown?: boolean;
  orderPlaced?: boolean;
  // The order was placed by the system itself, from the client's approving message, before the agent ran.
  placedBySystem?: boolean;
  orderAmended?: boolean;
  toolsUsed?: string[];
  // What the agent wants the team to answer (request_human_review's `question`).
  teamQuestion?: string;
  // Set by review_order while delivery is still paid: how much is missing for free delivery,
  // and whether the client already added things after being told.
  freeDeliveryShortfall?: number;
  stillShortAfterAdding?: boolean;
}

export type ReplyDecision = { mode: "send" } | { mode: "gate"; reason: string };

// "Middle ground" approval policy, for replies to a client who just wrote in
// (reply_type 'order_flow'). Anything proactive — reminders, re-engagement,
// seasonal offers — never reaches this function: those are always drafted
// into pending_replies (see lib/agent/draft.ts and lib/jobs.ts).
//
// A reply auto-sends only when it's routine: an established client, no
// mass-order signal, no proposal that commits us to something, and the model
// itself didn't ask for a human. Everything else waits for approval.
export function decideOrderFlowReply(input: {
  flags: TurnFlags;
  hasOpenMassOrderFlag: boolean;
  pipelineStage: PipelineStage;
}): ReplyDecision {
  const { flags, hasOpenMassOrderFlag, pipelineStage } = input;

  if (flags.massOrderFlagged || hasOpenMassOrderFlag) {
    return { mode: "gate", reason: "mass-order conversation" };
  }
  if (flags.humanReviewReasons.length > 0) {
    return { mode: "gate", reason: flags.humanReviewReasons.join("; ") };
  }
  if (flags.confirmationProposed) {
    return { mode: "gate", reason: "proposes a commitment" };
  }
  if (pipelineStage === "new_lead" || pipelineStage === "in_conversation" || pipelineStage === "dormant") {
    return { mode: "gate", reason: "client hasn't ordered yet" };
  }
  return { mode: "send" };
}
