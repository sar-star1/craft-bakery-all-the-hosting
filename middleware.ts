import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/authToken";

// Password gate for the dashboard. Public on purpose: the /order storefront
// (clients place orders there), the Telegram webhook and the cron routes (both
// authenticate themselves with their own secrets), the login page, and the
// read-only published website text the public site builds from.
export async function middleware(request: NextRequest) {
  const password = process.env.DASHBOARD_PASSWORD;
  const hasRealData = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!password) {
    if (!hasRealData) return NextResponse.next();
    return redirectToLogin(request, "config");
  }

  const cookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (cookie && safeEqual(cookie, await sessionToken(password))) return NextResponse.next();
  return redirectToLogin(request);
}

function redirectToLogin(request: NextRequest, error?: string) {
  const url = request.nextUrl.clone();
  const next = request.nextUrl.pathname + request.nextUrl.search;
  url.pathname = "/login";
  url.search = `?${error ? `error=${error}&` : ""}next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|login|order(?:/|$)|api/telegram/webhook|api/cron/|api/website-content$|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|css|js|woff2?)$).*)",
  ],
};
