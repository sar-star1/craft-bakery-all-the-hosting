import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getStorefrontLink } from "@/lib/clientToken";
import type { createSupabaseServerClient } from "@/lib/supabase/server";
import { ALLOWED_REACTIONS, notifyAdmin } from "@/lib/telegram";
import { getKnowledge } from "./memory";
import { ORDER_TOOLS, isOrderTool, runOrderTool } from "./orderTools";
import type { PipelineStage } from "@/lib/types";
import type { TurnFlags } from "./policy";

export interface ToolContext {
  supabase: ReturnType<typeof createSupabaseServerClient>;
  client: { id: string; business_name: string; pipeline_stage: PipelineStage };
  conversationId: string;
  flags: TurnFlags;
  // Practice chat in the dashboard: nothing may be written or announced.
  dryRun?: boolean;
  // Client messages in this conversation so far (incl. the one being answered).
  inboundCount: number;
  // Practice chat only: the "conversation memory", sent back and forth with the browser.
  practiceState?: Record<string, unknown>;
}

export const AGENT_TOOLS: Anthropic.Tool[] = [
  ...ORDER_TOOLS,
  {
    name: "get_price",
    description:
      "Look up current menu items and prices by name (in Ukrainian or transliterated). Returns matching items with price in UAH, any promo price, weight, and minimum order. The ONLY valid source for any price you state.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Item name or part of it, e.g. 'круасан' or 'наполеон'" } },
      required: ["query"],
    },
  },
  {
    name: "check_capacity",
    description:
      "Look up production capacity and lead-time rules for a requested quantity/date. Returns the bakery's capacity rules and the relevant category minimums. The ONLY valid source for any capacity or lead-time claim. If the rules don't clearly cover the question, call request_human_review instead of guessing.",
    input_schema: {
      type: "object",
      properties: {
        item: { type: "string", description: "What they want, e.g. 'круасани'" },
        quantity: { type: "number", description: "Requested quantity" },
        needed_by: { type: "string", description: "Requested date if any, YYYY-MM-DD" },
      },
      required: ["quantity"],
    },
  },
  {
    name: "get_delivery_terms",
    description:
      "Get delivery zones, days, costs, minimum order amounts and payment terms. The ONLY valid source for any delivery or payment claim.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_business_info",
    description:
      "Facts the bakery's team has taught you about the business: policies, what we do and don't do, payment details, contacts, anything not covered by prices/capacity/delivery. The ONLY valid source for such claims. If it has no answer, call request_human_review.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_client_history",
    description:
      "Get this client's record: standing order notes, funnel stage, last contact/order dates, and their most recent orders.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_captured_fields",
    description:
      "Save facts learned about this client or their request so they're remembered next time (e.g. preferences, volumes, delivery address, decision-maker). Merges into the conversation's captured fields.",
    input_schema: {
      type: "object",
      properties: { fields: { type: "object", description: "Key/value facts to remember" } },
      required: ["fields"],
    },
  },
  {
    name: "classify_lead",
    description:
      "For a client who has NOT ordered yet: record whether they are cold (unsure, has questions or concerns) or warm (wants to order but something is blocking them), and what exactly the question or blocker is. Updates their funnel stage and the note admins see. Call again whenever it changes. Not for clients who already ordered.",
    input_schema: {
      type: "object",
      properties: {
        temperature: { type: "string", enum: ["cold", "warm"] },
        blocker: {
          type: "string",
          description: "Short, concrete note in Ukrainian: their open question/concern (cold) or what holds them back (warm)",
        },
      },
      required: ["temperature", "blocker"],
    },
  },
  {
    name: "send_menu_link",
    description:
      "Get this client's personal ordering-page link. Orders are placed on the website, not in chat — use this whenever they want to order or see the current menu, and include the returned URL in your reply.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "propose_confirmation",
    description:
      "Call when your reply proposes or confirms something that commits the bakery (a standing arrangement, a special condition, a change to a regular order). A human approves such replies before they're sent.",
    input_schema: {
      type: "object",
      properties: { summary: { type: "string", description: "One-line summary of what is being proposed" } },
      required: ["summary"],
    },
  },
  {
    name: "flag_mass_order",
    description:
      "Call immediately when the client mentions bulk/mass ordering or volumes far beyond a normal cafe order. Notifies the admin; the conversation then requires human approval.",
    input_schema: {
      type: "object",
      properties: { matched_text: { type: "string", description: "The client's words that triggered this" } },
      required: ["matched_text"],
    },
  },
  {
    name: "react_to_message",
    description:
      "Put an emoji reaction on the client's message you are answering, sent together with your reply (not instead of it). Use it only where the team's rules say it fits — e.g. 👍 when the client confirms an order or agrees, 🙏 for thanks. Never on complaints, worries or questions; don't react to every message.",
    input_schema: {
      type: "object",
      properties: { emoji: { type: "string", enum: [...ALLOWED_REACTIONS] } },
      required: ["emoji"],
    },
  },
  {
    name: "request_human_review",
    description:
      "Call when you're unsure, the client is upset, asks for something outside the tools' coverage, or a tool returned nothing usable. Your drafted reply will wait for a human to approve instead of being sent automatically.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string" } },
      required: ["reason"],
    },
  },
];

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<string> {
  const args = (input ?? {}) as Record<string, unknown>;
  const { supabase, client, conversationId, flags } = ctx;

  switch (name) {
    case "get_price": {
      const words = String(args.query ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 1);
      const [{ data: items }, { data: categories }] = await Promise.all([
        supabase.from("menu_items").select("*").eq("is_active", true),
        supabase.from("menu_categories").select("id, name_uk, min_order"),
      ]);
      const categoryById = new Map((categories ?? []).map((c) => [c.id as string, c]));
      const scored = (items ?? [])
        .map((i) => {
          const hay = `${i.name_uk} ${categoryById.get(i.category_id)?.name_uk ?? ""}`.toLowerCase();
          return { i, score: words.filter((w) => hay.includes(w)).length };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8);
      if (scored.length === 0) return "No matching menu items found.";
      return json(
        scored.map(({ i }) => ({
          id: i.id,
          name: i.name_uk,
          category: categoryById.get(i.category_id)?.name_uk,
          price_uah: i.price,
          original_price_uah: i.original_price,
          promo: i.promo_label,
          weight: i.weight,
          min_order: i.min_order_override ?? categoryById.get(i.category_id)?.min_order,
        }))
      );
    }

    case "check_capacity": {
      const [{ data: rules }, { data: categories }] = await Promise.all([
        supabase.from("capacity_rules").select("rule_type, value, notes"),
        supabase.from("menu_categories").select("name_uk, min_order, note_uk"),
      ]);
      return json({
        requested: { item: args.item ?? null, quantity: args.quantity, needed_by: args.needed_by ?? null },
        capacity_rules: rules ?? [],
        category_minimums: categories ?? [],
        note:
          (rules ?? []).length === 0
            ? "No capacity rules are configured yet — you cannot make any capacity or lead-time claim; call request_human_review."
            : "Answer only from these rules; if they don't cover the question, call request_human_review.",
      });
    }

    case "get_delivery_terms": {
      const { data } = await supabase.from("site_content").select("content_json").eq("key", "delivery_terms").maybeSingle();
      return data?.content_json ? json(data.content_json) : "Delivery terms are not configured.";
    }

    case "get_business_info": {
      const facts = await getKnowledge(supabase);
      return facts.length
        ? json({ facts })
        : "No business facts have been added yet. If the question needs one, call request_human_review.";
    }

    case "get_client_history": {
      const [{ data: row }, { data: orders }] = await Promise.all([
        supabase
          .from("clients")
          .select("business_name, contact_name, pipeline_stage, blocker_note, standing_order_notes, last_contact_at, last_order_at")
          .eq("id", client.id)
          .single(),
        supabase
          .from("orders")
          .select("created_at, item_summary_uk, total_amount, status")
          .eq("client_id", client.id)
          .order("created_at", { ascending: false })
          .limit(10),
      ]);
      return json({ client: row, recent_orders: orders ?? [] });
    }

    case "update_captured_fields": {
      if (ctx.dryRun) return "Saved (practice mode — not stored).";
      const fields = { ...((args.fields ?? {}) as Record<string, unknown>) };
      delete fields.draft_order; // the cart is only changed through the order tools
      const { data: convo } = await supabase.from("conversations").select("captured_fields").eq("id", conversationId).single();
      const merged = { ...((convo?.captured_fields as Record<string, unknown>) ?? {}), ...fields };
      await supabase.from("conversations").update({ captured_fields: merged }).eq("id", conversationId);
      return "Saved.";
    }

    case "send_menu_link": {
      const link = getStorefrontLink(client.id);
      if (!link) {
        flags.humanReviewReasons.push("ordering link unavailable (SITE_URL not set)");
        return "The ordering link is unavailable right now. Tell the client you'll send it shortly.";
      }
      flags.menuLinkSent = true;
      if (client.pipeline_stage === "new_lead") {
        await supabase.from("clients").update({ pipeline_stage: "menu_sent" }).eq("id", client.id);
        client.pipeline_stage = "menu_sent";
      }
      return `Personal ordering link (include exactly as-is): ${link}`;
    }

    case "classify_lead": {
      if (!["new_lead", "cold", "warm", "menu_sent"].includes(client.pipeline_stage)) {
        return "This client has already ordered; lead classification does not apply.";
      }
      const temperature = args.temperature === "warm" ? "warm" : "cold";
      const blocker = String(args.blocker ?? "").trim().slice(0, 500) || null;
      await supabase.from("clients").update({ pipeline_stage: temperature, blocker_note: blocker }).eq("id", client.id);
      client.pipeline_stage = temperature;
      return "Saved.";
    }

    case "propose_confirmation": {
      flags.confirmationProposed = true;
      const { data: convo } = await supabase.from("conversations").select("captured_fields").eq("id", conversationId).single();
      await supabase
        .from("conversations")
        .update({
          status: "confirming",
          captured_fields: { ...((convo?.captured_fields as Record<string, unknown>) ?? {}), proposal: args.summary },
        })
        .eq("id", conversationId);
      return "Recorded. A human will review this reply before it's sent.";
    }

    case "flag_mass_order": {
      flags.massOrderFlagged = true;
      if (ctx.dryRun) return "Flagged (practice mode — nobody was notified).";
      await supabase.from("mass_order_flags").insert({
        client_id: client.id,
        conversation_id: conversationId,
        matched_text: String(args.matched_text ?? ""),
      });
      const base = process.env.SITE_URL?.replace(/\/$/, "");
      await notifyAdmin(
        `Масове замовлення: ${client.business_name}\n«${String(args.matched_text ?? "")}»${base ? `\n${base}/clients/${client.id}` : ""}`
      );
      return "Flagged. The admin has been notified; a human will handle the reply.";
    }

    case "react_to_message": {
      const emoji = String(args.emoji ?? "");
      if (!(ALLOWED_REACTIONS as readonly string[]).includes(emoji)) return `Not allowed. Use one of: ${ALLOWED_REACTIONS.join(" ")}`;
      flags.reaction = emoji;
      return ctx.dryRun
        ? `Practice mode: ${emoji} would be put on the client's message together with your reply.`
        : `OK — ${emoji} will be put on the client's message together with your reply. Still write your normal reply.`;
    }

    case "request_human_review": {
      flags.humanReviewReasons.push(String(args.reason ?? "unspecified"));
      return "Noted. Write the best reply you can; a human will review it before it's sent.";
    }

    default:
      if (isOrderTool(name)) return runOrderTool(name, args, ctx);
      return `Unknown tool: ${name}`;
  }
}
