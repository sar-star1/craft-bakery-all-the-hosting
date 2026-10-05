import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/authToken";

// Real data is in play once Supabase is configured; from then on the
// dashboard must never be reachable without a password.
const hasRealData = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function isAdminSession(): Promise<boolean> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return !hasRealData(); // sample mode / local dev stays open
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return Boolean(value) && safeEqual(value as string, await sessionToken(password));
}

// Server Actions can be invoked from any URL, so the middleware alone isn't
// enough: every dashboard action re-checks the session itself.
export async function requireAdmin(): Promise<void> {
  if (!(await isAdminSession())) throw new Error("Unauthorized");
}
