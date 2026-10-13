import "server-only";
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type Db = ReturnType<typeof createSupabaseServerClient>;

const WAIT_MS = 45_000; // how long a second message waits for the first to finish
const LOCK_MS = 90_000; // a lock left behind by a crashed run expires by itself

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// One agent run per client at a time. Without it, two quick messages are answered
// by overlapping runs that can't see each other's replies or order drafts.
export async function withClientLock<T>(db: Db, clientId: string, fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + WAIT_MS;
  let held = false;
  while (Date.now() < deadline) {
    const { data } = await db
      .from("clients")
      .update({ agent_lock_until: new Date(Date.now() + LOCK_MS).toISOString() })
      .eq("id", clientId)
      .or(`agent_lock_until.is.null,agent_lock_until.lt.${new Date().toISOString()}`)
      .select("id");
    if (data?.length) {
      held = true;
      break;
    }
    await sleep(700);
  }
  // If the wait ran out, carry on anyway: a slow reply beats a lost one.
  try {
    return await fn();
  } finally {
    if (held) await db.from("clients").update({ agent_lock_until: null }).eq("id", clientId);
  }
}
