import "./harness/register.mjs";
import { makeChecker } from "./harness/check.mjs";

const { check, done } = makeChecker();
const { buildStoreData, isNewSection } = await import("../lib/storefront.ts");

const cat = (id, name, sort_order, min_order = 1) => ({ id, name_uk: name, name_en: null, min_order, note_uk: null, note_en: null, sort_order, created_at: "" });
const item = (id, category_id, name, extra = {}) => ({ id, category_id, name_uk: name, name_en: null, description_uk: null, description_en: null, price: 100, original_price: null, promo_label: null, weight: null, storage_note: null, badge: null, freezable: false, min_order_override: null, photo_url: null, is_active: true, sort_order: 0, created_at: "", updated_at: "", ...extra });

check("«Новинки» is recognised by name", isNewSection("Новинки") && isNewSection(" новинки ") && isNewSection("New") && !isNewSection("Торти"));

const cats = [cat("n", "Новинки", 0, 1), cat("c", "Класичні круасани", 1, 6), cat("t", "Торти", 2, 1)];
const items = [
  item("i1", "n", "Тарт з малиною"),
  item("i2", "c", "Шоколадний"),
  item("i3", "c", "Мигдальний", { show_in_new: true, sort_order: 1 }),
  item("i4", "t", "Наполеон", { show_in_new: true, is_active: false }),
  item("i5", "t", "Медовик"),
];
const data = buildStoreData(cats, items, []);
const byName = (n) => data.categories.find((c) => c.name === n);

check("a flagged item stays in its own category", byName("Класичні круасани").items.map((i) => i.name).join() === "Шоколадний,Мигдальний");
check("…and is also listed in «Новинки», after the category's own items", byName("Новинки").items.map((i) => i.name).join() === "Тарт з малиною,Мигдальний");
check("…marked as a copy, so the cart counts it only toward its own category", byName("Новинки").items[1].copyFromOtherCategory === true && !byName("Класичні круасани").items[1].copyFromOtherCategory && !byName("Новинки").items[0].copyFromOtherCategory);
check("a hidden (inactive) flagged item is not shown anywhere", !data.categories.some((c) => c.items.some((i) => i.name === "Наполеон")));
check("an unflagged item does not leak into «Новинки»", !byName("Новинки").items.some((i) => i.name === "Медовик"));
check("each category keeps its own minimum", byName("Класичні круасани").minOrder === 6 && byName("Новинки").minOrder === 1);

// no «Новинки» category at all
const withoutNew = buildStoreData([cat("c", "Класичні круасани", 1, 6), cat("t", "Торти", 2)], [item("i3", "c", "Мигдальний", { show_in_new: true }), item("i5", "t", "Медовик")], []);
check("without a «Новинки» category a section is made up at the top, with no minimum of its own", withoutNew.categories[0].name === "Новинки" && withoutNew.categories[0].minOrder === 0 && withoutNew.categories[0].items.length === 1 && withoutNew.categories[0].items[0].copyFromOtherCategory === true);
const none = buildStoreData([cat("c", "Торти", 1)], [item("i5", "c", "Медовик")], []);
check("nothing flagged and no such category → no «Новинки» section", !none.categories.some((c) => c.name === "Новинки"));

// order inside «Новинки»: own items and copies share one list, moved with ▲▼
const { newSectionItems, moveInNewSection } = await import("../lib/menuOrder.ts");
const apply = (list, updates) => list.map((i) => { const u = updates.find((x) => x.id === i.id); return u ? { ...i, [u.field]: u.value } : i; });
const names = (cs, its) => newSectionItems(cs, its, "n").map((i) => i.name_uk).join();
let cur = items.map((i) => ({ ...i }));
check("unplaced copies go after the section's own items", names(cats, cur) === "Тарт з малиною,Мигдальний");
let up = moveInNewSection(newSectionItems(cats, cur, "n"), "n", "i3", -1);
cur = apply(cur, up);
check("a copy can be moved above an own item", names(cats, cur) === "Мигдальний,Тарт з малиною");
const afterMove = buildStoreData(cats, cur, []);
check("the website shows the same order", afterMove.categories.find((c) => c.name === "Новинки").items.map((i) => i.name).join() === "Мигдальний,Тарт з малиною");
check("the copy is still marked as a copy, the own item is not", afterMove.categories[0].items[0].copyFromOtherCategory === true && !afterMove.categories[0].items[1].copyFromOtherCategory);
check("moving past the ends changes nothing", moveInNewSection(newSectionItems(cats, cur, "n"), "n", "i3", -1).length === 0 && moveInNewSection(newSectionItems(cats, cur, "n"), "n", "i1", 1).length === 0);
// two copies from different categories, plus own
const more = [...cur, item("i6", "t", "Чізкейк", { show_in_new: true })];
check("a newly flagged item lands last", names(cats, more) === "Мигдальний,Тарт з малиною,Чізкейк");
up = moveInNewSection(newSectionItems(cats, more, "n"), "n", "i6", -1);
check("moving renumbers own items via sort_order and copies via new_sort_order", up.some((u) => u.id === "i1" && u.field === "sort_order") && up.some((u) => u.id === "i6" && u.field === "new_sort_order"));
check("…and the new order holds", names(cats, apply(more, up)) === "Мигдальний,Чізкейк,Тарт з малиною");
// without a «Новинки» category only copies are ordered, with new_sort_order
const solo = [item("a", "c", "А", { show_in_new: true }), item("b", "t", "Б", { show_in_new: true })];
const soloCats = [cat("c", "Круасани", 1), cat("t", "Торти", 2)];
const sl = newSectionItems(soloCats, solo, undefined);
const su = moveInNewSection(sl, undefined, "b", -1);
check("with no «Новинки» category copies are still orderable", sl.map((i) => i.name_uk).join() === "А,Б" && newSectionItems(soloCats, apply(solo, su), undefined).map((i) => i.name_uk).join() === "Б,А");

const ok = done();
process.exit(ok ? 0 : 1);
