// Shared by the middleware (edge runtime) and server code, so it only uses
// Web Crypto — no Node APIs.
export const SESSION_COOKIE = "bakery_session";

export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`bakery-crm-session:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
