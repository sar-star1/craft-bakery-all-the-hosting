// Order of menu items inside a category (and of categories on the menu): `sort_order`, lowest first,
// ties broken by creation time so a list never reshuffles itself.

export interface Sortable {
  id: string;
  sort_order: number;
  created_at?: string | null;
}

export const bySortOrder = (a: Sortable, b: Sortable) =>
  a.sort_order - b.sort_order || String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));

// A new entry goes to the end of its list.
export const nextSortOrder = (rows: { sort_order: number }[]) => (rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 1 : 0);

// Moves one entry a step up (-1) or down (+1) and renumbers the whole list 0..n-1 (which also
// untangles lists where several entries share a number). Returns only the rows whose number changed.
export function moveWithin(rows: Sortable[], id: string, dir: -1 | 1): { id: string; sort_order: number }[] {
  const sorted = [...rows].sort(bySortOrder);
  const i = sorted.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= sorted.length) return [];
  [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
  const original = new Map(rows.map((r) => [r.id, r.sort_order]));
  return sorted.map((r, idx) => ({ id: r.id, sort_order: idx })).filter((r) => original.get(r.id) !== r.sort_order);
}
