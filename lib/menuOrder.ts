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

// ---- «Новинки» ------------------------------------------------------------------------------
// The section lists its own items plus the flagged items of other categories ("copies"). They share
// one order: own items by `sort_order`, copies by `new_sort_order` (a copy nobody has placed yet goes
// to the end, in the order of its home category). Moving anything in this list renumbers all of it.

export interface NewSectionRow extends Sortable {
  category_id: string;
  is_active: boolean;
  show_in_new?: boolean;
  new_sort_order?: number | null;
}

const UNPLACED = 1_000_000;

// `newCategoryId` is the «Новинки» category (undefined when there is none: then only copies are listed).
// Copies are included only while active; own items always (the dashboard shows hidden ones too).
export function newSectionItems<T extends NewSectionRow>(categories: { id: string; sort_order: number }[], items: T[], newCategoryId?: string): T[] {
  const catOrder = new Map(categories.map((c) => [c.id, c.sort_order]));
  const own = items.filter((i) => newCategoryId !== undefined && i.category_id === newCategoryId).sort(bySortOrder);
  const copies = items
    .filter((i) => i.category_id !== newCategoryId && i.is_active && i.show_in_new)
    .sort((a, b) => (catOrder.get(a.category_id) ?? 0) - (catOrder.get(b.category_id) ?? 0) || bySortOrder(a, b));
  return [...own.map((i, idx) => ({ i, key: i.sort_order, idx })), ...copies.map((i, idx) => ({ i, key: i.new_sort_order ?? UNPLACED, idx: own.length + idx }))]
    .sort((a, b) => a.key - b.key || a.idx - b.idx)
    .map((e) => e.i);
}

export interface NewSectionUpdate {
  id: string;
  field: "sort_order" | "new_sort_order";
  value: number;
}

// Moves one entry a step in the merged list and returns what has to be written (only what changed).
export function moveInNewSection<T extends NewSectionRow>(list: T[], newCategoryId: string | undefined, id: string, dir: -1 | 1): NewSectionUpdate[] {
  const i = list.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [];
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  const updates: NewSectionUpdate[] = [];
  next.forEach((r, idx) => {
    const own = newCategoryId !== undefined && r.category_id === newCategoryId;
    const field = own ? "sort_order" : "new_sort_order";
    const current = own ? r.sort_order : r.new_sort_order;
    if (current !== idx) updates.push({ id: r.id, field, value: idx });
  });
  return updates;
}
