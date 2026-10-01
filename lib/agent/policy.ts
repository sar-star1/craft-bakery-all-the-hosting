import type { PipelineStage } from "@/lib/types";

export interface TurnFlags {
  humanReviewReasons: string[];
  massOrderFlagged: boolean;
  confirmationProposed: boolean;
  menuLinkSent: boolean;
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
  if (pipelineStage === "new_lead" || pipelineStage === "qualifying" || pipelineStage === "menu_sent") {
    return { mode: "gate", reason: "client hasn't ordered yet" };
  }
  return { mode: "send" };
}
