// A small in-memory stand-in for Supabase's REST API (PostgREST), enough for the
// queries the app makes. Lets the tests run the real code without a database.
import http from "node:http";

export const tables = {};
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const match = (row, key, expr) => {
  const [op, ...rest] = expr.split(".");
  const val = rest.join(".");
  const v = row[key];
  if (op === "eq") return String(v) === val;
  if (op === "in") return val.slice(1, -1).split(",").includes(String(v));
  if (op === "is") return val === "null" ? v === null || v === undefined : String(v) === val;
  if (op === "gte") return String(v) >= val;
  if (op === "gt") return String(v) > val;
  if (op === "lt") return String(v) < val;
  return true;
};

export function start(port) {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const u = new URL(req.url, "http://x");
        const t = u.pathname.replace("/rest/v1/", "");
        const rows = (tables[t] ??= []);
        const filters = [...u.searchParams].filter(([k]) => !["select", "order", "limit", "offset", "columns"].includes(k));
        const sel = () => rows.filter((r) => filters.every(([k, e]) => match(r, k, e)));
        const wantObj = (req.headers.accept ?? "").includes("vnd.pgrst.object");
        const send = (code, data) => {
          resp.statusCode = code;
          resp.setHeader("Content-Type", "application/json");
          resp.end(data === undefined ? "" : JSON.stringify(data));
        };
        const out = (list, code = 200) => {
          if (wantObj) return list.length === 1 ? send(code, list[0]) : send(406, { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" });
          return send(code, list);
        };
        if (req.method === "GET" || req.method === "HEAD") {
          let list = sel();
          const o = u.searchParams.get("order");
          if (o) {
            const [k, d] = o.split(".");
            list = [...list].sort((a, b) => (a[k] > b[k] ? 1 : -1) * (d === "desc" ? -1 : 1));
          }
          const lim = u.searchParams.get("limit");
          if (lim) list = list.slice(0, Number(lim));
          if (req.headers.prefer?.includes("count=exact")) resp.setHeader("Content-Range", `0-${Math.max(0, list.length - 1)}/${list.length}`);
          if (req.method === "HEAD") return send(200);
          return out(list);
        }
        if (req.method === "POST") {
          const input = JSON.parse(body || "{}");
          const arr = Array.isArray(input) ? input : [input];
          const created = arr.map((r) => {
            const row = { id: uuid(), created_at: new Date().toISOString(), ...r };
            rows.push(row);
            return row;
          });
          return req.headers.prefer?.includes("return=representation") ? out(created, 201) : send(201);
        }
        if (req.method === "PATCH") {
          const patch = JSON.parse(body || "{}");
          const hit = sel();
          hit.forEach((r) => Object.assign(r, patch));
          return req.headers.prefer?.includes("return=representation") ? out(hit) : send(204);
        }
        if (req.method === "DELETE") {
          sel().forEach((r) => rows.splice(rows.indexOf(r), 1));
          return send(204);
        }
        send(404, {});
      });
    });
    srv.listen(port, () => res(srv));
  });
}

// Telegram stub: records every Bot API call and answers { ok: true }.
export function stubTelegram() {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith("https://api.telegram.org/")) {
      calls.push({ method: String(url).split("/").pop(), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 900 + calls.length } }), { headers: { "Content-Type": "application/json" } });
    }
    return realFetch(url, init);
  };
  return calls;
}
