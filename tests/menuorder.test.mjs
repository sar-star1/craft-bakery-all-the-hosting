import "./harness/register.mjs";
import { makeChecker } from "./harness/check.mjs";

const { check, done } = makeChecker();
const { moveWithin, nextSortOrder, bySortOrder } = await import("../lib/menuOrder.ts");

const row = (id, sort_order, created_at = "2026-01-0" + id) => ({ id, sort_order, created_at });
const list = [row("1", 0), row("2", 1), row("3", 2)];

const norm = (u) => JSON.stringify([...u].sort((a, b) => a.id.localeCompare(b.id)));
check("moving the middle item up swaps it with the first", norm(moveWithin(list, "2", -1)) === norm([{ id: "1", sort_order: 1 }, { id: "2", sort_order: 0 }]));
check("moving down swaps with the next", norm(moveWithin(list, "2", 1)) === norm([{ id: "2", sort_order: 2 }, { id: "3", sort_order: 1 }]));
check("the first item can't go up and the last can't go down", moveWithin(list, "1", -1).length === 0 && moveWithin(list, "3", 1).length === 0);
check("an unknown id changes nothing", moveWithin(list, "x", 1).length === 0);

// a list where several items share a number (new items used to be saved with 0)
const tangled = [row("1", 0), row("2", 0), row("3", 0), row("4", 3)];
const upd = moveWithin(tangled, "3", -1);
const after = new Map(tangled.map((r) => [r.id, r.sort_order]));
for (const u of upd) after.set(u.id, u.sort_order);
const order = [...after.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id).join(",");
check("a tied list is renumbered 0..n-1 and the move happens on the displayed order", order === "1,3,2,4" && new Set(after.values()).size === 4, order);
check("ties are shown oldest first", [row("2", 0), row("1", 0)].sort(bySortOrder)[0].id === "1");
check("a new item goes to the end", nextSortOrder([{ sort_order: 0 }, { sort_order: 7 }]) === 8 && nextSortOrder([]) === 0);

const ok = done();
process.exit(ok ? 0 : 1);
