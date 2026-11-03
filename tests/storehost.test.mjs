import "./harness/register.mjs";
const { NextRequest } = await import("next/server");
import { makeChecker } from "./harness/check.mjs";

process.env.SITE_URL = "https://dash.example.com";
process.env.DASHBOARD_PASSWORD = "secret";
const { check, done } = makeChecker();
const { middleware } = await import("../middleware.ts");
const { getStorefrontLink } = await import("../lib/clientToken.ts");
const req = (url, host) => new NextRequest(url, { headers: { host } });

const CL = "33333333-3333-4333-8333-333333333333";
const token = CL.replace(/-/g, "");
check("without STORE_URL clients get SITE_URL/order?ref=", getStorefrontLink(CL) === `https://dash.example.com/order?ref=${token}`, String(getStorefrontLink(CL)));
process.env.STORE_URL = "https://order.peremogabakery.com/";
check("with STORE_URL the short domain's front page is the link", getStorefrontLink(CL) === `https://order.peremogabakery.com/?ref=${token}`, String(getStorefrontLink(CL)));

let r = await middleware(req(`https://order.peremogabakery.com/?ref=${token}`, "order.peremogabakery.com"));
check("the short domain's front page shows the storefront (rewrite, query kept)", r.headers.get("x-middleware-rewrite")?.endsWith(`/order?ref=${token}`), String(r.headers.get("x-middleware-rewrite")));
r = await middleware(req("https://order.peremogabakery.com/clients", "order.peremogabakery.com"));
check("a dashboard address on the short domain goes back to the storefront", r.status === 307 && new URL(r.headers.get("location")).pathname === "/" && !r.headers.get("location").includes("login"), `${r.status} ${r.headers.get("location")}`);
r = await middleware(req("https://dash.example.com/clients", "dash.example.com"));
check("the dashboard host still asks for the password", r.status === 307 && new URL(r.headers.get("location")).pathname === "/login", `${r.status} ${r.headers.get("location")}`);
r = await middleware(req("https://dash.example.com/", "dash.example.com"));
check("…and its front page is still the dashboard, not the storefront", !r.headers.get("x-middleware-rewrite"));

const ok = done();
process.exit(ok ? 0 : 1);
