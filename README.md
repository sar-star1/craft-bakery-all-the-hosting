# Craft Bakery by Dubova — Admin CRM

Next.js admin dashboard and (in progress) AI agent for Craft Bakery's B2B
client relationships, built against the schema in
[`supabase/schema.sql`](supabase/schema.sql). Runs entirely on sample data
until real credentials are configured — see Setup below.

## Setup

1. **Create a Supabase project** and run [`supabase/schema.sql`](supabase/schema.sql)
   in its SQL editor. This creates every table the dashboard and the future
   agent use — `clients`, `conversations`, `orders`, `menu_items`,
   `site_content`, `capacity_rules`, `mass_order_flags`, `pending_replies` —
   plus a public `menu-photos` storage bucket for menu item photos.

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
   - `ANTHROPIC_API_KEY` for the agent loop (not built yet)

4. **Run the dev server**:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000. Without `.env.local` configured, every view
   falls back to realistic sample data (shown with a banner) so the UI is
   fully testable before any credentials exist.

## What's implemented

- **Orders** (`/`): kanban — Pending review → New → Confirmed → In progress
  → Ready → Completed, filterable by category, manual entry form, stats bar
- **Clients** (`/clients`): B2B client pipeline as a kanban by funnel stage
  — New lead → Qualifying → Menu sent → First order → Recurring → Dormant.
  Client detail page shows standing order notes, conversation status, order
  history, and any pending reply drafts for that client. "+ New client"
  generates a Telegram deep link (`t.me/<bot>?start=m_<token>`) for
  gradually migrating existing clients one at a time.
- **Pending Replies** (`/pending-replies`): every message the agent drafts
  — client replies, weekly reminders, re-engagement, seasonal offers —
  waits here for one-tap approve/reject. Approving calls the Telegram bot's
  `sendMessage` immediately (see `app/actions.ts`); nothing sends on its own.
- **Site menu** (`/menu`): management screen for `menu_items` and
  `site_content` — name/description/price/photo per item in uk/en, plus
  freeform terms/notes blocks. This is meant to become the single source of
  truth the public ordering site, this dashboard, and the AI agent all read
  from, once the site is connected (see below).
- uk/en language toggle throughout (uk default), following the `STR`
  dictionary pattern from `reference/bakery-dashboard.jsx`.

## Not built yet

- The Telegram bot webhook and the Claude-powered agent loop (tools:
  `update_captured_fields`, `check_capacity`, `get_price`,
  `get_client_history`, `propose_confirmation`, `flag_mass_order`)
- Connecting the actual public ordering site (currently a separate Lovable
  export) to `menu_items`/`site_content`, and adding the `?ref=<client
  token>` capture on its order form so orders link to the right client
  automatically instead of needing manual matching
- Daily overdue-reminder job and the manual seasonal-offer trigger
- Historical Telegram conversation import (Telegram Desktop export →
  `clients` rows) — deliberately deferred until the core system is working

## Design notes worth knowing before touching this code

- **Approval gate ("middle ground" policy):** routine order-flow replies
  may eventually auto-send once the agent is built; reminders, re-engagement
  messages, seasonal offers, and anything tied to a mass-order flag always
  require human approval, no exceptions. See the comment above
  `pending_replies` in `supabase/schema.sql`.
- **No Telegram Business Connection.** Client migration is a standard bot
  (BotFather) that existing clients are asked to message via a personal
  deep link, sent gradually during natural contact — not an automatic
  switch. Business Connection was evaluated and rejected: its `can_reply`
  permission only works within 24 hours of the client's last incoming
  message, which would have blocked proactive reminders and re-engagement
  entirely.
- **Order/client matching:** the personalized link the agent sends
  (`?ref=<client-token>`) carries the client's identity through to the
  order form, so completed orders link to the right client deterministically
  — never by fuzzy-matching names after the fact.
