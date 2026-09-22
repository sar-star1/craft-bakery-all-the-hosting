import React, { useState, useMemo } from "react";

// ---- i18n: UI chrome + order content, so the same data renders in either language ----
const STR = {
  uk: {
    brand1: "Craft Bakery",
    brand2: "by Dubova",
    navOrders: "Замовлення",
    navCustomers: "Клієнти",
    navCalendar: "Календар",
    navSettings: "Налаштування",
    connectedSources: "Підключено джерел: 2",
    b2cSite: "B2C сайт",
    b2bSite: "B2B сайт",
    title: "Замовлення",
    subtitle: "Кожен запит — від повідомлення до видачі.",
    newOrder: "+ Нове замовлення",
    statActive: "Активні замовлення",
    statDeposit: "Очікують завдаток",
    statValue: "Сума в роботі",
    filterAll: "Усі замовлення",
    colNew: "Нове звернення",
    colConfirmed: "Підтверджено",
    colInProgress: "У роботі",
    colReady: "Готово",
    colPickedUp: "Видано",
    empty: "Тут порожньо",
    depositPaid: "Завдаток отримано",
    depositPending: "Завдаток: очікується",
    close: "Закрити",
    details: "Деталі",
    dueDate: "Дата виконання",
    total: "Сума",
    receivedVia: "Отримано через",
    deposit: "Завдаток",
    moveBack: "Назад",
    advance: "Наступний етап",
    formTitle: "Нове замовлення",
    formSubtitle: "Для дзвінків, візитів або того, що пропустив інший канал.",
    fCategory: "Категорія",
    fCustomer: "Ім'я клієнта *",
    fCustomerPh: "Для кого це замовлення?",
    fContact: "Контакт",
    fContactPh: "Телефон, Instagram або email",
    fItem: "Товар *",
    fItemPh: "Що замовляють?",
    fDetails: "Деталі",
    fDetailsPh: "Розмір, смак, алергії, самовивіз чи доставка...",
    fDueDate: "Дата виконання",
    fTotal: "Сума ($)",
    fDeposit: "Завдаток",
    cancel: "Скасувати",
    addOrder: "Додати замовлення",
    formError: "Вкажіть ім'я клієнта та товар.",
    depositOptPending: "Очікується",
    depositOptPaid: "Отримано",
    depositOptNA: "Немає",
  },
  en: {
    brand1: "Craft Bakery",
    brand2: "by Dubova",
    navOrders: "Orders",
    navCustomers: "Customers",
    navCalendar: "Calendar",
    navSettings: "Settings",
    connectedSources: "Connected to 2 sources",
    b2cSite: "B2C site",
    b2bSite: "B2B site",
    title: "Orders",
    subtitle: "Every inquiry, from message to pickup.",
    newOrder: "+ New order",
    statActive: "Active orders",
    statDeposit: "Awaiting deposit",
    statValue: "Pipeline value",
    filterAll: "All orders",
    colNew: "New inquiry",
    colConfirmed: "Confirmed",
    colInProgress: "In progress",
    colReady: "Ready",
    colPickedUp: "Picked up",
    empty: "Nothing here",
    depositPaid: "Deposit paid",
    depositPending: "Deposit pending",
    close: "Close",
    details: "Details",
    dueDate: "Due date",
    total: "Total",
    receivedVia: "Received via",
    deposit: "Deposit",
    moveBack: "Back",
    advance: "Advance status",
    formTitle: "New order",
    formSubtitle: "For phone orders, walk-ins, or anything a channel missed.",
    fCategory: "Category",
    fCustomer: "Customer name *",
    fCustomerPh: "Who is this order for?",
    fContact: "Contact",
    fContactPh: "Phone, IG handle, or email",
    fItem: "Item *",
    fItemPh: "What are they ordering?",
    fDetails: "Details",
    fDetailsPh: "Size, flavor, dietary notes, delivery vs pickup...",
    fDueDate: "Due date",
    fTotal: "Total ($)",
    fDeposit: "Deposit",
    cancel: "Cancel",
    addOrder: "Add order",
    formError: "Customer name and item are required.",
    depositOptPending: "Pending",
    depositOptPaid: "Paid",
    depositOptNA: "N/A",
  },
};

const CATEGORY_LABEL = {
  uk: { b2c: "B2C", b2b: "B2B", standard_line: "Стандартна лінійка" },
  en: { b2c: "B2C", b2b: "B2B", standard_line: "Standard line" },
};

const CHANNEL_LABEL = {
  uk: { Instagram: "Instagram", Website: "Сайт", Manual: "Вручну" },
  en: { Instagram: "Instagram", Website: "Website", Manual: "Manual" },
};

// ---- Mock data. Item/details are bilingual so the same order reads naturally in either language ----
const initialOrders = [
  {
    id: "ord_1",
    customer: "Олена Марчетті",
    channel: "Instagram",
    type: "b2c",
    item: { uk: "Весільний торт, 3 яруси, ваніль", en: "3-tier vanilla wedding cake" },
    details: { uk: "На 60 осіб, без горіхів, золоте листя", en: "Serves 60, nut-free, gold leaf finish" },
    date: "2026-09-06",
    deposit: "Paid",
    total: 480,
    status: "new",
  },
  {
    id: "ord_2",
    customer: "Corner Cafe Kyiv",
    channel: "Website",
    type: "b2b",
    item: { uk: "Круасани, 200 шт на тиждень", en: "Weekly croissant supply — 200 units" },
    details: { uk: "Постійне замовлення, вт/пт доставка", en: "Standing order, Tues/Fri delivery" },
    date: "2026-09-02",
    deposit: "N/A",
    total: 340,
    status: "confirmed",
  },
  {
    id: "ord_3",
    customer: "Софія Бондар",
    channel: "Manual",
    type: "b2c",
    item: { uk: "Дитячий торт на замовлення", en: "Custom birthday cake" },
    details: { uk: "Тема динозаврів, на 12 осіб — прийнято по телефону", en: "Dinosaur theme, serves 12 — taken by phone" },
    date: "2026-09-03",
    deposit: "Pending",
    total: 95,
    status: "new",
  },
  {
    id: "ord_4",
    customer: "Марта Коваленко",
    channel: "Instagram",
    type: "b2c",
    item: { uk: "Вежа з макаронс", en: "Macaron tower" },
    details: { uk: "150 штук, 5 смаків, заручини", en: "150 pieces, 5 flavors, engagement party" },
    date: "2026-09-01",
    deposit: "Paid",
    total: 260,
    status: "in_progress",
  },
  {
    id: "ord_5",
    customer: "Lviv Hotel Group",
    channel: "Website",
    type: "b2b",
    item: { uk: "Випічка на сніданок", en: "Breakfast pastry order" },
    details: { uk: "80 шт асорті, щопонеділка", en: "80 assorted, recurring Mondays" },
    date: "2026-08-31",
    deposit: "N/A",
    total: 210,
    status: "ready",
  },
  {
    id: "ord_6",
    customer: "Fresh Mart Kyiv",
    channel: "Website",
    type: "standard_line",
    item: { uk: "Стандартизована лінійка — набір 12 SKU", en: "Standardized line — 12 SKU box" },
    details: { uk: "Щотижневе замовлення, роздрібна упаковка", en: "Weekly standing order, packaged retail line" },
    date: "2026-08-30",
    deposit: "N/A",
    total: 610,
    status: "picked_up",
  },
];

const COLUMNS = ["new", "confirmed", "in_progress", "ready", "picked_up"];
const COL_LABEL_KEY = {
  new: "colNew",
  confirmed: "colConfirmed",
  in_progress: "colInProgress",
  ready: "colReady",
  picked_up: "colPickedUp",
};

const CHANNEL_DOT = {
  Instagram: "bg-rose-500",
  Website: "bg-emerald-600",
  Manual: "bg-stone-400",
};

const TYPE_BADGE = {
  b2c: "bg-amber-100 text-amber-900",
  b2b: "bg-stone-800 text-white",
  standard_line: "bg-rose-100 text-rose-900",
};

const emptyForm = {
  category: "b2c",
  customer: "",
  contact: "",
  item: "",
  details: "",
  date: "",
  deposit: "Pending",
  total: "",
};

function nextStatus(status) {
  const idx = COLUMNS.indexOf(status);
  return idx < COLUMNS.length - 1 ? COLUMNS[idx + 1] : status;
}
function prevStatus(status) {
  const idx = COLUMNS.indexOf(status);
  return idx > 0 ? COLUMNS[idx - 1] : status;
}

function LangToggle({ lang, setLang }) {
  return (
    <div className="flex rounded-full border border-stone-200 p-0.5 text-[12px]">
      {["uk", "en"].map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`px-2.5 py-1 rounded-full transition-colors ${
            lang === l ? "bg-stone-900 text-white" : "text-stone-400 hover:text-stone-700"
          }`}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

function OrderCard({ order, lang, t, onAdvance, onBack, onOpen }) {
  return (
    <div
      onClick={() => onOpen(order)}
      className="bg-white rounded-md border border-stone-200 p-3 mb-3 cursor-pointer hover:border-stone-300 hover:shadow-sm transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-serif text-[15px] text-stone-900 leading-snug truncate">
            {order.customer}
          </p>
          <p className="text-[13px] text-stone-500 mt-0.5 leading-snug">
            {order.item[lang]}
          </p>
        </div>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap ${TYPE_BADGE[order.type]}`}>
          {CATEGORY_LABEL[lang][order.type]}
        </span>
      </div>

      <div className="flex items-center gap-3 mt-3 text-[12px] text-stone-500">
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${CHANNEL_DOT[order.channel]}`} />
          {CHANNEL_LABEL[lang][order.channel]}
        </span>
        <span>
          {new Date(order.date).toLocaleDateString(lang === "uk" ? "uk-UA" : "en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
        <span className="ml-auto font-medium text-stone-700">${order.total}</span>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-stone-100">
        <span
          className={`text-[11px] px-1.5 py-0.5 rounded ${
            order.deposit === "Paid"
              ? "bg-emerald-50 text-emerald-700"
              : order.deposit === "Pending"
              ? "bg-amber-50 text-amber-700"
              : "text-stone-400"
          }`}
        >
          {order.deposit === "N/A" ? "—" : order.deposit === "Paid" ? t.depositPaid : t.depositPending}
        </span>
        <div className="flex gap-1">
          {order.status !== "new" && (
            <button
              onClick={(e) => { e.stopPropagation(); onBack(order.id); }}
              className="text-[12px] text-stone-400 hover:text-stone-700 px-1.5"
              aria-label={t.moveBack}
            >
              ←
            </button>
          )}
          {order.status !== "picked_up" && (
            <button
              onClick={(e) => { e.stopPropagation(); onAdvance(order.id); }}
              className="text-[12px] text-stone-400 hover:text-stone-700 px-1.5"
              aria-label={t.advance}
            >
              →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailPanel({ order, lang, t, onClose, onAdvance, onBack }) {
  if (!order) return null;
  return (
    <div className="fixed inset-0 z-20 flex justify-end">
      <div className="absolute inset-0 bg-stone-900/20" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white h-full shadow-xl p-6 overflow-y-auto">
        <button onClick={onClose} className="text-stone-400 hover:text-stone-700 text-sm mb-6">
          {t.close}
        </button>
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${TYPE_BADGE[order.type]}`}>
          {CATEGORY_LABEL[lang][order.type]}
        </span>
        <h2 className="font-serif text-2xl text-stone-900 mt-3 leading-tight">{order.customer}</h2>
        <p className="text-stone-500 text-sm mt-1">{order.item[lang]}</p>

        <div className="mt-6 space-y-4 text-sm">
          <div>
            <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.details}</p>
            <p className="text-stone-700">{order.details[lang]}</p>
          </div>
          <div className="flex gap-8">
            <div>
              <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.dueDate}</p>
              <p className="text-stone-700">
                {new Date(order.date).toLocaleDateString(lang === "uk" ? "uk-UA" : "en-US", {
                  month: "long",
                  day: "numeric",
                })}
              </p>
            </div>
            <div>
              <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.total}</p>
              <p className="text-stone-700">${order.total}</p>
            </div>
          </div>
          <div>
            <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.receivedVia}</p>
            <p className="text-stone-700 flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${CHANNEL_DOT[order.channel]}`} />
              {CHANNEL_LABEL[lang][order.channel]}
            </p>
          </div>
          <div>
            <p className="text-stone-400 text-[11px] uppercase tracking-wide mb-1">{t.deposit}</p>
            <p className="text-stone-700">
              {order.deposit === "N/A" ? "—" : order.deposit === "Paid" ? t.depositOptPaid : t.depositOptPending}
            </p>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-stone-100 flex gap-2">
          {order.status !== "new" && (
            <button
              onClick={() => onBack(order.id)}
              className="flex-1 text-sm px-3 py-2 rounded border border-stone-200 text-stone-600 hover:bg-stone-50"
            >
              {t.moveBack}
            </button>
          )}
          {order.status !== "picked_up" && (
            <button
              onClick={() => onAdvance(order.id)}
              className="flex-1 text-sm px-3 py-2 rounded bg-stone-900 text-white hover:bg-stone-800"
            >
              {t.advance}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BakeryDashboard() {
  const [lang, setLang] = useState("uk");
  const t = STR[lang];
  const [orders, setOrders] = useState(initialOrders);
  const [filter, setFilter] = useState("all");
  const [openOrder, setOpenOrder] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState("");

  const advance = (id) =>
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: nextStatus(o.status) } : o)));
  const back = (id) =>
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: prevStatus(o.status) } : o)));

  const submitManualOrder = (e) => {
    e.preventDefault();
    if (!form.customer.trim() || !form.item.trim()) {
      setFormError(t.formError);
      return;
    }
    const newOrder = {
      id: `ord_${Date.now()}`,
      customer: form.customer.trim(),
      channel: "Manual",
      type: form.category,
      item: { uk: form.item.trim(), en: form.item.trim() },
      details: { uk: form.details.trim() || "—", en: form.details.trim() || "—" },
      date: form.date || new Date().toISOString().slice(0, 10),
      deposit: form.deposit,
      total: Number(form.total) || 0,
      status: "new",
    };
    setOrders((prev) => [newOrder, ...prev]);
    setForm(emptyForm);
    setFormError("");
    setShowForm(false);
  };

  const filtered = useMemo(
    () => (filter === "all" ? orders : orders.filter((o) => o.type === filter)),
    [orders, filter]
  );

  const stats = useMemo(() => {
    const active = orders.filter((o) => o.status !== "picked_up").length;
    const pendingDeposit = orders.filter((o) => o.deposit === "Pending").length;
    const revenue = orders.reduce((sum, o) => sum + o.total, 0);
    return { active, pendingDeposit, revenue };
  }, [orders]);

  return (
    <div className="min-h-screen bg-[#FAF6EF] flex text-stone-900">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-stone-200 bg-white/60 px-5 py-6 hidden md:flex md:flex-col">
        <div className="mb-6">
          <p className="font-serif text-lg leading-tight">{t.brand1}</p>
          <p className="font-serif text-lg leading-tight text-stone-400 italic">{t.brand2}</p>
        </div>
        <LangToggle lang={lang} setLang={setLang} />
        <nav className="space-y-1 text-[14px] mt-6">
          <a className="block px-3 py-1.5 rounded bg-stone-900 text-white">{t.navOrders}</a>
          <a className="block px-3 py-1.5 rounded text-stone-500 hover:bg-stone-100">{t.navCustomers}</a>
          <a className="block px-3 py-1.5 rounded text-stone-500 hover:bg-stone-100">{t.navCalendar}</a>
          <a className="block px-3 py-1.5 rounded text-stone-500 hover:bg-stone-100">{t.navSettings}</a>
        </nav>
        <div className="mt-auto pt-6 border-t border-stone-200 text-[12px] text-stone-400">
          {t.connectedSources}
          <div className="flex items-center gap-1.5 mt-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {t.b2cSite}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> {t.b2bSite}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 min-w-0 px-5 md:px-8 py-6">
        <div className="flex items-start justify-between flex-wrap gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 md:hidden mb-2">
              <LangToggle lang={lang} setLang={setLang} />
            </div>
            <h1 className="font-serif text-2xl">{t.title}</h1>
            <p className="text-stone-500 text-sm mt-0.5">{t.subtitle}</p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="text-sm bg-stone-900 text-white px-4 py-2 rounded hover:bg-stone-800"
          >
            {t.newOrder}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6 max-w-xl">
          <div className="bg-white rounded-md border border-stone-200 px-4 py-3">
            <p className="text-[11px] text-stone-400 uppercase tracking-wide">{t.statActive}</p>
            <p className="font-serif text-2xl mt-0.5">{stats.active}</p>
          </div>
          <div className="bg-white rounded-md border border-stone-200 px-4 py-3">
            <p className="text-[11px] text-stone-400 uppercase tracking-wide">{t.statDeposit}</p>
            <p className="font-serif text-2xl mt-0.5">{stats.pendingDeposit}</p>
          </div>
          <div className="bg-white rounded-md border border-stone-200 px-4 py-3">
            <p className="text-[11px] text-stone-400 uppercase tracking-wide">{t.statValue}</p>
            <p className="font-serif text-2xl mt-0.5">${stats.revenue}</p>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-1.5 mb-5 flex-wrap">
          {["all", "b2c", "b2b", "standard_line"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`text-[13px] px-3 py-1 rounded-full border ${
                filter === f
                  ? "bg-stone-900 text-white border-stone-900"
                  : "border-stone-200 text-stone-500 hover:border-stone-300"
              }`}
            >
              {f === "all" ? t.filterAll : CATEGORY_LABEL[lang][f]}
            </button>
          ))}
        </div>

        {/* Kanban */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {COLUMNS.map((col) => {
            const colOrders = filtered.filter((o) => o.status === col);
            return (
              <div key={col} className="min-w-0">
                <div className="flex items-center justify-between mb-2 px-1">
                  <p className="text-[12px] font-medium text-stone-500">{t[COL_LABEL_KEY[col]]}</p>
                  <span className="text-[11px] text-stone-400">{colOrders.length}</span>
                </div>
                <div className="bg-stone-100/60 rounded-lg p-2 min-h-[120px]">
                  {colOrders.length === 0 ? (
                    <p className="text-[12px] text-stone-400 text-center py-6">{t.empty}</p>
                  ) : (
                    colOrders.map((o) => (
                      <OrderCard
                        key={o.id}
                        order={o}
                        lang={lang}
                        t={t}
                        onAdvance={advance}
                        onBack={back}
                        onOpen={setOpenOrder}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <DetailPanel
        order={openOrder}
        lang={lang}
        t={t}
        onClose={() => setOpenOrder(null)}
        onAdvance={(id) => { advance(id); setOpenOrder((o) => (o ? { ...o, status: nextStatus(o.status) } : o)); }}
        onBack={(id) => { back(id); setOpenOrder((o) => (o ? { ...o, status: prevStatus(o.status) } : o)); }}
      />

      {showForm && (
        <div className="fixed inset-0 z-30 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-stone-900/30" onClick={() => setShowForm(false)} />
          <form
            onSubmit={submitManualOrder}
            className="relative bg-white rounded-lg shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
          >
            <h2 className="font-serif text-xl mb-1">{t.formTitle}</h2>
            <p className="text-stone-500 text-sm mb-5">{t.formSubtitle}</p>

            <div className="space-y-4">
              <div>
                <label className="text-[12px] text-stone-500 block mb-1">{t.fCategory}</label>
                <select
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                  className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
                >
                  <option value="b2c">{CATEGORY_LABEL[lang].b2c}</option>
                  <option value="b2b">{CATEGORY_LABEL[lang].b2b}</option>
                  <option value="standard_line">{CATEGORY_LABEL[lang].standard_line}</option>
                </select>
              </div>

              <div>
                <label className="text-[12px] text-stone-500 block mb-1">{t.fCustomer}</label>
                <input
                  value={form.customer}
                  onChange={(e) => setForm((f) => ({ ...f, customer: e.target.value }))}
                  className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
                  placeholder={t.fCustomerPh}
                />
              </div>

              <div>
                <label className="text-[12px] text-stone-500 block mb-1">{t.fContact}</label>
                <input
                  value={form.contact}
                  onChange={(e) => setForm((f) => ({ ...f, contact: e.target.value }))}
                  className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
                  placeholder={t.fContactPh}
                />
              </div>

              <div>
                <label className="text-[12px] text-stone-500 block mb-1">{t.fItem}</label>
                <input
                  value={form.item}
                  onChange={(e) => setForm((f) => ({ ...f, item: e.target.value }))}
                  className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
                  placeholder={t.fItemPh}
                />
              </div>

              <div>
                <label className="text-[12px] text-stone-500 block mb-1">{t.fDetails}</label>
                <textarea
                  value={form.details}
                  onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))}
                  className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
                  rows={2}
                  placeholder={t.fDetailsPh}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] text-stone-500 block mb-1">{t.fDueDate}</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[12px] text-stone-500 block mb-1">{t.fTotal}</label>
                  <input
                    type="number"
                    value={form.total}
                    onChange={(e) => setForm((f) => ({ ...f, total: e.target.value }))}
                    className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
                    placeholder="0"
                  />
                </div>
              </div>

              <div>
                <label className="text-[12px] text-stone-500 block mb-1">{t.fDeposit}</label>
                <select
                  value={form.deposit}
                  onChange={(e) => setForm((f) => ({ ...f, deposit: e.target.value }))}
                  className="w-full border border-stone-200 rounded px-3 py-2 text-sm"
                >
                  <option value="Pending">{t.depositOptPending}</option>
                  <option value="Paid">{t.depositOptPaid}</option>
                  <option value="N/A">{t.depositOptNA}</option>
                </select>
              </div>
            </div>

            {formError && <p className="text-[13px] text-red-600 mt-3">{formError}</p>}

            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError(""); }}
                className="flex-1 text-sm px-3 py-2 rounded border border-stone-200 text-stone-600 hover:bg-stone-50"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                className="flex-1 text-sm px-3 py-2 rounded bg-stone-900 text-white hover:bg-stone-800"
              >
                {t.addOrder}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
