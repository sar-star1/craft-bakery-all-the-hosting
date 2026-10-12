// Lets Node run the project's TypeScript directly: resolves the "@/…" alias and
// extension-less relative imports. Used only by the tests.
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ROOT = new URL("../../", import.meta.url).pathname;

export async function resolve(specifier, context, next) {
  if (specifier === "next/cache") return next("next/cache.js", context);
  if (specifier.startsWith("@/")) {
    const base = ROOT + specifier.slice(2);
    for (const cand of [base + ".ts", base + "/index.ts"]) if (existsSync(cand)) return next(pathToFileURL(cand).href, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file://" + ROOT)) {
    const url = new URL(specifier, context.parentURL);
    for (const ext of [".ts", "/index.ts"]) if (existsSync(url.pathname + ext)) return next(pathToFileURL(url.pathname + ext).href, context);
  }
  return next(specifier, context);
}
