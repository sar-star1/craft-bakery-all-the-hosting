-- Craft Bakery by Dubova — CRM + AI agent schema
-- Run this in the Supabase SQL editor. Standard-Telegram-bot version —
-- replaces the earlier Business Connection-based schema.

create table clients (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  contact_name text,
  telegram_chat_id text unique,
  status text not null default 'engaged'
    check (status in ('active', 'engaged', 'dormant')),
  -- Where they are on the path from stranger to repeat customer. Distinct
  -- from `status` above, which is about recency, not funnel position — a
  -- client can be 'recurring' and still show 'dormant' status if they've
  -- gone quiet. Drives the grouped Clients pipeline view.
  pipeline_stage text not null default 'new_lead'
    check (pipeline_stage in ('new_lead', 'qualifying', 'menu_sent', 'first_order', 'recurring', 'dormant')),
  standing_order_notes text,
  last_contact_at timestamptz,
  last_order_at timestamptz,
  source text check (source in ('instagram', 'website_form', 'manual_migration')),
  created_at timestamptz default now()
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  captured_fields jsonb default '{}',
  status text not null default 'gathering'
    check (status in ('gathering', 'confirming', 'committed', 'abandoned')),
  last_message_at timestamptz default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  category text not null check (category in ('b2c', 'b2b', 'standard_line')),
  source text not null check (source in ('website_form', 'telegram', 'manual')),
  customer_name text not null,
  customer_contact text,              -- phone, Telegram handle, or email
  item_summary_uk text not null,      -- short human-readable description (Ukrainian, primary)
  item_summary_en text,               -- English version; nullable, backfilled for demo orders only
  item_details_uk jsonb,              -- flexible structured fields per category
  item_details_en jsonb,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'new', 'confirmed', 'in_progress', 'ready', 'completed')),
  deposit_status text default 'n/a'
    check (deposit_status in ('paid', 'pending', 'n/a')),
  total_amount numeric,
  due_date date,
  raw_message text,                   -- original Telegram message text, if applicable
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Single source of truth for the B2B ordering site's menu AND what the
-- agent reads for pricing questions in chat — one unified project, so the
-- management screen, the live storefront, and the agent all see the same
-- row the instant it's edited. Replaces the earlier flat `pricing` table.
create table menu_items (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('b2c', 'b2b', 'standard_line')) default 'b2b',
  name_uk text not null,
  name_en text,
  description_uk text,          -- ingredients, allergens, portion notes, etc.
  description_en text,
  price numeric not null,
  photo_url text,                -- public URL in the `menu-photos` storage bucket
  is_active boolean not null default true,   -- hide without deleting
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Freeform site copy that isn't tied to one menu item — terms & conditions,
-- allergen disclaimers, delivery policy, etc. `key` is a short slug the
-- storefront looks up by (e.g. 'terms', 'allergen_notice').
create table site_content (
  key text primary key,
  content_uk text,
  content_en text,
  updated_at timestamptz default now()
);

create table capacity_rules (
  id uuid primary key default gen_random_uuid(),
  rule_type text not null,
  value text not null,
  notes text
);

create table mass_order_flags (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  conversation_id uuid references conversations(id),
  matched_text text,
  resolved boolean default false,
  created_at timestamptz default now()
);

-- The approval gate. Under the "middle ground" policy, routine order_flow
-- replies may be auto-sent by the agent without ever creating a row here —
-- see lib/agent/policy.ts for the exact rule. Every weekly_reminder,
-- remarketing, and seasonal_offer message, and anything tied to a
-- mass-order-flagged conversation, always lands here regardless of type.
-- Approving a row calls the Telegram bot's sendMessage immediately
-- (status goes straight to 'approved_sent') — there's no separate
-- "approved but not yet sent" state, matching the enum below.
create table pending_replies (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id),
  conversation_id uuid references conversations(id),
  draft_text text not null,
  reply_type text not null
    check (reply_type in ('order_flow', 'weekly_reminder', 'remarketing', 'seasonal_offer')),
  status text not null default 'awaiting_approval'
    check (status in ('awaiting_approval', 'approved_sent', 'rejected')),
  created_at timestamptz default now()
);

create index orders_status_idx on orders(status);
create index orders_category_idx on orders(category);
create index clients_status_idx on clients(status);
create index clients_pipeline_stage_idx on clients(pipeline_stage);
create index conversations_client_idx on conversations(client_id);
create index mass_order_flags_resolved_idx on mass_order_flags(resolved);
create index pending_replies_status_idx on pending_replies(status);
create index menu_items_category_idx on menu_items(category);

-- The dashboard and agent only ever talk to these tables through the
-- service-role key on the server (see lib/supabase/server.ts), which
-- bypasses RLS. Enabling RLS with no policies means an anon/public key
-- (should one ever leak into client code) gets zero access instead of each
-- table's implicit default. The public storefront, once migrated in, reads
-- menu_items/site_content through this same app's server code too — never
-- give the storefront its own direct anon-key access to this project.
alter table clients enable row level security;
alter table conversations enable row level security;
alter table orders enable row level security;
alter table menu_items enable row level security;
alter table site_content enable row level security;
alter table capacity_rules enable row level security;
alter table mass_order_flags enable row level security;
alter table pending_replies enable row level security;

-- Public bucket for menu photos — served directly by Supabase's CDN, no
-- signed URLs needed since these are just product photos, not sensitive.
insert into storage.buckets (id, name, public)
values ('menu-photos', 'menu-photos', true)
on conflict (id) do nothing;
