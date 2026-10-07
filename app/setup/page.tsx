import { createSupabaseServerClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { AGENT_MODEL } from "@/lib/agent/anthropic";
import { telegramApi } from "@/lib/telegram";
import { getOrderingRules } from "@/lib/orders";
import { DEFAULT_ORDERING_RULES } from "@/lib/orderRules";
import SetupPanel, { type SetupStatus } from "@/components/SetupPanel";

export const dynamic = "force-dynamic";

const ENV_VARS: { name: string; secret: boolean; needed: string }[] = [
  { name: "SUPABASE_URL", secret: false, needed: "база даних" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", secret: true, needed: "база даних" },
  { name: "TELEGRAM_BOT_TOKEN", secret: true, needed: "бот" },
  { name: "TELEGRAM_BOT_USERNAME", secret: false, needed: "персональні посилання" },
  { name: "TELEGRAM_ADMIN_GROUP_ID", secret: false, needed: "адмін-група" },
  { name: "TELEGRAM_WEBHOOK_SECRET", secret: true, needed: "вебхук" },
  { name: "ANTHROPIC_API_KEY", secret: true, needed: "AI-агент" },
  { name: "SITE_URL", secret: false, needed: "посилання та вебхук" },
  { name: "CRON_SECRET", secret: true, needed: "щоденні/щотижневі завдання" },
  { name: "DASHBOARD_PASSWORD", secret: true, needed: "вхід у дашборд" },
];

export default async function SetupPage() {
  const status: SetupStatus = {
    env: ENV_VARS.map((v) => ({ ...v, set: Boolean(process.env[v.name]) })),
    model: AGENT_MODEL,
    siteUrl: process.env.SITE_URL?.replace(/\/$/, "") ?? null,
    supabase: null,
    telegram: null,
    rules: [],
    ordering: DEFAULT_ORDERING_RULES,
    facts: [],
    examples: [],
  };

  if (isSupabaseConfigured()) {
    try {
      const db = createSupabaseServerClient();
      const count = async (table: string, filter?: [string, string]) => {
        let q = db.from(table).select("id", { count: "exact", head: true });
        if (filter) q = q.eq(filter[0], filter[1]);
        const { count: c, error } = await q;
        if (error) throw new Error(`${table}: ${error.message}`);
        return c ?? 0;
      };
      const [categories, items, clients, capacityRules] = await Promise.all([
        count("menu_categories"),
        count("menu_items"),
        count("clients"),
        count("capacity_rules"),
      ]);
      status.supabase = { ok: true, categories, items, clients, capacityRules };
      const { data: rules } = await db
        .from("agent_guidelines")
        .select("id, text, source, expires_at")
        .eq("active", true)
        .order("created_at", { ascending: true });
      status.rules = (rules ?? []) as SetupStatus["rules"];
      const [{ data: facts }, { data: examples }] = await Promise.all([
        db.from("agent_knowledge").select("id, text, expires_at").order("created_at", { ascending: true }),
        db
          .from("agent_examples")
          .select("id, client_message, reply, quality")
          .order("created_at", { ascending: false })
          .limit(20),
      ]);
      status.facts = (facts ?? []) as SetupStatus["facts"];
      status.ordering = await getOrderingRules(db);
      status.examples = (examples ?? []) as SetupStatus["examples"];
    } catch (err) {
      status.supabase = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  if (process.env.TELEGRAM_BOT_TOKEN) {
    const [me, hook] = await Promise.all([
      telegramApi<{ username: string }>("getMe"),
      telegramApi<{ url: string; pending_update_count: number; last_error_message?: string; allowed_updates?: string[] }>(
        "getWebhookInfo"
      ),
    ]);
    status.telegram = me.ok
      ? {
          ok: true,
          username: me.result.username,
          webhookUrl: hook.ok ? hook.result.url || null : null,
          pending: hook.ok ? hook.result.pending_update_count : 0,
          lastError: hook.ok ? hook.result.last_error_message ?? null : null,
        }
      : { ok: false, error: me.error };
  }

  return <SetupPanel status={status} />;
}
