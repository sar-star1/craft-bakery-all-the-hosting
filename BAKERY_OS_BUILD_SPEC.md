# Craft Bakery by Dubova — Admin CRM Build Spec

## Context
This is the backend admin CRM for Craft Bakery by Dubova, part of a broader
"Bakery OS" product I'm building to eventually sell to other bakeries and
similar custom-order businesses (florists, dessert studios, catering).

Two customer-facing websites already exist, built on Lovable.dev:
- B2C site (consumer custom orders)
- B2B / wholesale site (mass orders)

Each currently sits on its own Supabase project. This admin dashboard is a
new Next.js app that connects to both and becomes the single place the
bakery owner manages every order, regardless of source.

## Goal of this build
One unified order pipeline that captures orders from three sources
(website forms, Instagram DMs, manual entry) across three business
categories (B2C, B2B, standardized/mass-order line), notifies the admin
of new orders, and sends an automated confirmation reply to the customer
via Instagram.

## Order categories
- `b2c` — individual custom orders (cakes, etc.)
- `b2b` — wholesale / business client orders
- `standard_line` — СТАНДАРТИЗОВАНА ЛІНІЙКА, a separate standardized
  mass-order product line, distinct from custom B2B work

## Order sources
- `website_form` — structured data submitted directly from either
  Lovable site's order forms
- `instagram` — unstructured DM parsed into structured data via the
  Claude API
- `manual` — entered directly by an admin inside this dashboard, for
  phone orders, walk-ins, or anything the automated channels miss

## Database schema (Supabase / Postgres)

Ukrainian is the primary language (Dubova's actual working language). English
fields are secondary, used only for the case-study/demo view — not required
on every write path.

```sql
create table orders (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('b2c', 'b2b', 'standard_line')),
  source text not null check (source in ('website_form', 'instagram', 'manual')),
  customer_name text not null,
  customer_contact text,              -- phone, IG handle, or email
  item_summary_uk text not null,      -- short human-readable description (Ukrainian, primary)
  item_summary_en text,               -- English version; nullable, backfilled for demo orders only
  item_details_uk jsonb,              -- flexible structured fields per category
  item_details_en jsonb,
  status text not null default 'new'
    check (status in ('new', 'confirmed', 'in_progress', 'ready', 'completed')),
  deposit_status text default 'n/a'
    check (deposit_status in ('paid', 'pending', 'n/a')),
  total_amount numeric,
  due_date date,
  estimated_ready_at timestamptz,     -- nullable now; used by future estimate feature
  raw_message text,                   -- original IG/DM text, if applicable
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index orders_status_idx on orders(status);
create index orders_category_idx on orders(category);
```

## Language
UI language toggle (uk/en) lives in the dashboard, default uk. See attached
`bakery-dashboard.jsx` reference — its `STR` object is the UI string
dictionary to preserve when wiring this to Supabase. Manual entry only
requires Ukrainian input; English fields can be filled later (e.g. via a
Claude API translation call) rather than blocking the form on both languages.

## Required screens

### 1. Orders pipeline (main view)
- Kanban-style board: New → Confirmed → In progress → Ready → Completed
- Filter by category: All / B2C / B2B / Standard line
- Each order card shows: customer name, item summary, source (with icon/dot),
  due date, deposit status, total
- Click a card to open a detail panel with full order info and status controls

### 2. Manual entry form
- Accessible via a persistent "+ New order" button
- Fields: category (select), customer name, contact, item summary,
  item details (free text is fine for v1), due date, deposit status, total
- On submit: insert into `orders` with `source: 'manual'`, `status: 'new'`

### 3. Basic stats bar
- Active orders count (status != completed)
- Orders awaiting deposit
- Total pipeline value

## Integrations to build

### Instagram webhook → structured order
1. Meta webhook receives new DM → POST to `/api/instagram-webhook`
2. Call Claude API with the raw message, prompt it to extract:
   category guess, customer contact, item summary, structured details
3. Insert into `orders` with `source: 'instagram'`, `raw_message` populated
4. Send a fixed-template auto-reply back via Instagram Send API:
   "Hi! We received your order request and will confirm details shortly."
   (Do not generate this reply with AI — use a fixed string. Save AI for
   parsing the incoming message, not the outgoing confirmation.)

### Admin notification
- On new row insert into `orders`, send a notification via Slack or
  Telegram webhook (simplest reliable option for a small team) —
  message should include customer name, category, and item summary
- Do not build a full in-app notification center for v1

### Website form → orders
- Each Lovable site's order form should insert directly into the shared
  `orders` table via Supabase client, tagging `source: 'website_form'`
  and the correct `category`
- This may require light changes on the Lovable side, not just this app

## Explicit non-goals for this phase
- Do not build the `estimated_ready_at` calculation logic yet — the field
  should exist in the schema but stay unused for now
- Do not build AI-generated auto-replies — use fixed template text
- Do not merge the two existing Lovable Supabase projects — this app
  connects to both as separate data sources
- Do not build customer-facing order tracking pages yet

## Open questions to confirm with the bakery owner before finishing
- Exact deposit policy (always required? threshold-based?)
- Who besides the owner needs dashboard access, and do they need
  restricted views (e.g. no pricing visibility for fulfillment staff)
- Real due-date lead times per category, to inform the future estimate feature
