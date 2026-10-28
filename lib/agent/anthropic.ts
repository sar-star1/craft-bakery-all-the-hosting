import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export function isAnthropicConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

// Two tiers. Almost everything runs on the cheap model; the strong one is for the hard cases
// (see routing.ts). AGENT_MODEL is the strong tier — it is also what the rare one-off jobs
// (teaching a rule, importing a menu) run on.
export const AGENT_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
export const FAST_MODEL = process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-5-5";

// AGENT_MODEL_ROUTING=off sends everything to the strong model (the old behaviour).
export const modelRoutingOn = () => process.env.AGENT_MODEL_ROUTING !== "off" && FAST_MODEL !== AGENT_MODEL;

let client: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}
