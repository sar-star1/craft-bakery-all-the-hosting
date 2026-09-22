# Craft Bakery by Dubova — Admin CRM

Next.js admin dashboard for the unified order pipeline described in
`BAKERY_OS_BUILD_SPEC.md`. This first pass covers the `orders` table and the
pipeline (kanban) view: stats bar, category filter, order detail panel, and
manual order entry. The Instagram webhook and admin notifications are not
built yet — those come next.

## Setup

1. **Create the Supabase project** that will host the shared `orders` table
   (a project separate from the two Lovable site projects). In its SQL
   editor, run [`supabase/schema.sql`](supabase/schema.sql).

2. **Install dependencies** (requires Node.js 20+ — this machine didn't have
   Node installed when the project was scaffolded, so this hasn't been run
   yet):

   ```bash
   npm install
   ```

3. **Configure environment variables**:

   ```bash
   cp .env.local.example .env.local
   ```

   Fill in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from
   Project Settings → API in your Supabase dashboard. The service role key
   is used server-only (Server Components + Server Actions) — there's no
   login system yet, so this is how the dashboard reads/writes without
   exposing a key to the browser. Restrict who can reach this app (e.g. put
   it behind your own auth or a private URL) before using it with real data.

4. **Run the dev server**:

   ```bash
   npm run dev
   ```

   Open http://localhost:3000.

## What's implemented

- Kanban pipeline: New → Confirmed → In progress → Ready → Completed
- Category filter: All / B2C / B2B / Standard line
- Order detail panel with status advance/back
- "+ New order" manual entry form (inserts with `source: 'manual'`)
- Stats bar: active orders, orders awaiting deposit, pipeline value (sum of
  `total_amount` across non-completed orders)
- uk/en language toggle, uk default, following the `STR` dictionary pattern
  from the reference `bakery-dashboard.jsx`

## Not built yet (per the spec's phasing)

- `/api/instagram-webhook` (Meta webhook → Claude API parse → insert →
  fixed-template auto-reply)
- Admin notification (Slack/Telegram on new order)
- Website form → `orders` insert wiring on the two Lovable sites
- Auth / restricted views for non-owner staff
- `estimated_ready_at` calculation

## Notes on data mapping

- Manual entry only requires the Ukrainian fields (`item_summary_uk`,
  `item_details_uk`), matching the spec — English fields stay null until
  backfilled later.
- Free-text "details" from the manual form is stored as
  `item_details_uk: { notes: "..." }` to fit the `jsonb` column while
  keeping v1 simple.
- "Pipeline value" sums `total_amount` for every order not yet `completed`.
