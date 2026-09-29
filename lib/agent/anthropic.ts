import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export function isAnthropicConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export const AGENT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

let client: Anthropic | null = null;
export function getAnthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}
