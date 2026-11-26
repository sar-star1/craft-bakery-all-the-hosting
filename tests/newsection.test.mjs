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

const ok = done();
process.exit(ok ? 0 : 1);
