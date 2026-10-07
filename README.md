# Peremoga Bakery — Admin CRM

Next.js admin dashboard, public ordering storefront, and Telegram AI agent
for Peremoga Bakery's B2B client relationships, built against the schema in
[`supabase/schema.sql`](supabase/schema.sql). Runs entirely on sample data
until real credentials are configured — see Setup below.

## Setup

1. **Create a Supabase project** and run [`supabase/schema.sql`](supabase/schema.sql)
   in its SQL editor. This creates every table the dashboard and the future
   agent use — `clients`, `conversations`, `orders`, `menu_categories`,
   `menu_items`, `site_content`, `capacity_rules`, `mass_order_flags`,
   `pending_replies`, `messages` — plus a public `menu-photos` storage bucket for menu
   item photos.

   Then run [`supabase/seed_menu.sql`](supabase/seed_menu.sql) to load the
   real catalog — 16 categories, 90 items — migrated from the existing
   ordering site's hardcoded `menuData.ts`. Photos are hotlinked to that
   site's CDN/asset host for now; re-host them in `menu-photos` later if
   that site is ever retired.

2. **Install dependencies** (requires Node.js 20+):

   ```bash
   npm install
   ```

3. **Configure environment variables**:

   ```bash
   cp .env.local.example .env.local
   ```

   Fill in:
   - `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (service role, not anon —
     there's no login system yet, so every read/write is routed through
     server-only code; see `lib/supabase/server.ts`)
   - `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME` + `TELEGRAM_ADMIN_GROUP_ID`
     (standard Bot API bot from @BotFather — not Telegram Business Connection)
   - `ANTHROPIC_API_KEY`, `SITE_URL`, `TELEGRAM_WEBHOOK_SECRET`, `CRON_SECRET`,
     `DASHBOARD_PASSWORD`
     (see `.env.local.example` and "Going live" below)

4. **Run the dev server**:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000. Without `.env.local` configured, every view
   falls back to realistic sample data (shown with a banner) so the UI is
   fully testable before any credentials exist.

## What's implemented

- **Orders** (`/`): kanban — Pending review → New → Confirmed → In progress
  → Ready → Completed, filterable by category, manual entry, stats bar.
  Website orders show their itemised cart, address and contact in the panel.
- **Clients** (`/clients`): B2B funnel kanban (New lead → Cold · has questions /
  Warm · something blocking → Menu sent → First order → Recurring → Dormant).
  The agent classifies leads itself and records the specific question or
  blocker, which shows on the card and can be edited by hand; detail page with the Telegram
  conversation, standing order notes, order history, the client's personal
  ordering link, and any pending drafts.
- **Pending Replies** (`/pending-replies`): every message awaiting approval,
  one-tap approve (sends immediately) / reject, plus the manual **seasonal
  offer** form that drafts a personal message per client in a segment.
- **Site menu** (`/menu`): categories (with minimum-order rules), items,
  promo pricing, photos, and terms — the single source of truth.
- **Public storefront** (`/order`): the B2B ordering site, ported from the
  Lovable export and reading the same menu tables. `?ref=<token>` (the
  client's personal link) attributes the order to that client and prefills
  their name. Orders are validated and priced server-side
  (`app/order-actions.ts`) — the browser only sends item ids and quantities.
  Orders under 1 000 ₴ are refused (storefront and server, `lib/orderRules.ts`).
- **Telegram agent** (`/api/telegram/webhook` → `lib/agent`): a standard bot
  that remembers each client, answers from tools only (`get_price`,
  `check_capacity`, `get_delivery_terms`, `get_client_history`,
  `update_captured_fields`, `send_menu_link`, `propose_confirmation`,
  `flag_mass_order`, `request_human_review`).
- **Scheduled jobs** (`vercel.json`): daily overdue reminders and weekly
  re-engagement, both drafted into Pending Replies for approval.
- uk/en toggle throughout (uk default).

## Working from the admin Telegram group

The group is actionable, so day-to-day approvals don't need the dashboard:

- Every draft alert shows the client's message and the draft, with **✅ Надіслати**
  and **🚫 Відхилити** buttons. Replying to the alert with your own text sends
  that text to the client instead.
- Website orders get a one-tap **Перевірено / Підтвердити** button.
- Whoever acts is written onto the alert and the buttons disappear, so everyone
  sees it is handled. Approving is atomic: two admins pressing at once can't
  double-send.
- Anyone in the group can act, so keep the group's membership to staff only.
  The bot ignores button presses from any other chat.
- Batch jobs post the first 15 drafts individually, then a summary.

Re-register the webhook after upgrading (`scripts/telegram-setup.mjs webhook …`)
so Telegram also delivers button presses.

## Teaching the agent

Everything below applies to every reply and campaign draft, from the dashboard
(**Налаштування → Чого навчаємо агента**) or the admin group:

- **Just say it**: `/teach <plain words>` in the group, or the box in Settings.
  It decides whether it is a *rule* (how to behave/sound), a *fact* (about the
  bakery) or an *ordering number* (minimum order, free-delivery threshold,
  delivery fee) and stores it. `/rule` and `/fact` do the same explicitly.
- **Temporary**: start with `до 12.10`, `цього тижня`, `завтра` (or use the date
  picker) and it stops applying by itself — e.g. "this week no deliveries to X".
- **Examples**: every reply the team sends, edits or writes becomes an example
  the agent imitates; the **Тренування** page lets you chat with the real agent
  (nothing is saved or sent) and correct it; **Імпорт історії** reads a Telegram
  Desktop JSON export in the browser, strips phones/e-mails/links, and distils
  how the team and clients talk (you approve what is saved).

## Ordering

Chat is the main way to order. The agent collects venue name, ФОП, address and
payment type (cash / cashless) — repeat clients just confirm the remembered
details — shows a summary priced by `review_order`, and places the order only
after the client confirms in a later message. Delivery is free from the
threshold in Settings and costs the configured fee below it; the agent suggests
adding items to reach it. The website checkout collects the same details. Every
group alert states назва, ФОП, адреса and оплата, remembered or not. The menu
link stays available for photos and browsing.

## Campaign files

The seasonal-offer form accepts up to 5 files (images, PDF, Word/Excel/
PowerPoint, 4 MB each). They are sent after the text of each approved message.

## Approval policy (`lib/agent/policy.ts`)

A reply to a client who just wrote in auto-sends only when it is routine:
an established client, no mass-order signal, nothing that commits the
bakery, and the model didn't ask for a human. Everything else — first-time
leads, mass orders, proposals, reminders, re-engagement, seasonal offers —
waits in Pending Replies.

## Going live

1. **Supabase**: run `supabase/schema.sql`, then `supabase/seed_menu.sql`.
   Add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
2. **Bot**: create it with @BotFather from the business owner's Telegram
   account (`/newbot`). Put the token and username in `.env.local`, then
   check it: `node --env-file=.env.local scripts/telegram-setup.mjs me`.
3. **Admin group**: create a Telegram group, add the bot, send a message,
   run `scripts/telegram-setup.mjs chats`, and use the (negative) id as
   `TELEGRAM_ADMIN_GROUP_ID`.
4. **Secrets**: generate `TELEGRAM_WEBHOOK_SECRET` and `CRON_SECRET`
   (`openssl rand -hex 32`); add `ANTHROPIC_API_KEY`.
5. **Deploy**: push to GitHub, import the repo in Vercel, add every variable
   from `.env.local.example` (including `SITE_URL` = the production URL) in
   Project Settings → Environment Variables, deploy.
6. **Register the webhook**: open `/setup` in the dashboard and press
   "Зареєструвати вебхук" — the token never leaves the server. (The CLI
   `scripts/telegram-setup.mjs webhook …` still works.) In the admin group, send
   `/chatid` to get the group's ID for `TELEGRAM_ADMIN_GROUP_ID`. `/setup` also
   checks every variable, the database, the webhook, the group and the AI model.
7. **Seed operating data**: add rows to `capacity_rules` (Supabase table
   editor) — the agent makes no capacity or lead-time claim without them.
   Optional tunables in the same table: `remarketing_threshold_days`
   (default 14), `dormant_threshold_days` (default 45).
8. **Migrate clients one at a time**: Clients → "+ New client" generates a
   personal `t.me/<bot>?start=…` link to send during their next normal
   contact. Once they open it, the chat is linked to their record.

## Not built yet

- Historical Telegram import (Desktop export → `clients` rows) — deferred
  until the core system is confirmed working.
- Instagram DM handling (the bot already accepts `?start=ig` for leads).
- Per-user accounts: the dashboard has one shared password (`DASHBOARD_PASSWORD`).
  Everything except `/order`, the Telegram webhook and the cron routes is behind
  it, and every dashboard action re-checks the session. With Supabase configured
  and no password set, the dashboard locks itself.
- Re-hosting menu photos in the `menu-photos` bucket (they currently hotlink
  to the old site's CDN).

## Design notes

- **No Telegram Business Connection.** Its `can_reply` only works within 24
  hours of the client's last message, which would block proactive reminders
  and re-engagement. A standard bot has no such window.
- **Orders can be taken in chat or on the site.** In chat the agent builds a
  cart with `get_menu` / `update_order_draft`, shows a summary priced by
  `review_order` (same rules as the site, `priceOrderLines`), and calls
  `place_order` only after the client confirms in a *later* message — enforced
  in code, not just by the prompt. Orders land in the board as source
  "Telegram" with an alert in the admin group. The site stays an option via the
  personal link, whose token links the order to the client deterministically.
- **The agent never states a price, capacity, or delivery figure it didn't
  get from a tool in that conversation turn** (see `lib/agent/prompt.ts`).
