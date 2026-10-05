"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, safeEqual, sessionToken } from "@/lib/authToken";

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function login(formData: FormData) {
  const expected = process.env.DASHBOARD_PASSWORD;
  const next = safeNext(formData.get("next"));
  if (!expected) redirect(`/login?error=config&next=${encodeURIComponent(next)}`);

  const given = String(formData.get("password") ?? "");
  const ok = safeEqual(await sessionToken(given), await sessionToken(expected));
  if (!ok) {
    await new Promise((r) => setTimeout(r, 700)); // slows down guessing
    redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  }

  (await cookies()).set(SESSION_COOKIE, await sessionToken(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(next);
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
