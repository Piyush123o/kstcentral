-- Run this in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run
-- Safe to run again on a project that already has the tables (it upgrades the access rules).

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text not null,
  phone_key text not null unique,          -- last 10 digits, used to detect duplicates
  info text default '',
  status text not null default 'New',
  tags text[] not null default '{}',
  followup_date date,
  last_contacted_at timestamptz,
  last_contact_type text,                  -- 'call' | 'whatsapp' | 'note'
  created_at timestamptz not null default now()
);

create table if not exists remarks (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  text text default '',
  contact_type text,                       -- 'call' | 'whatsapp' | 'note'
  followup_date date,
  created_at timestamptz not null default now()
);

create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists remarks_customer_idx on remarks(customer_id, created_at desc);
create index if not exists customers_followup_idx on customers(followup_date);

alter table customers enable row level security;
alter table remarks   enable row level security;
alter table templates enable row level security;

-- Remove the old open-to-everyone rules (from the first version), if they exist
drop policy if exists "anon all customers" on customers;
drop policy if exists "anon all remarks"   on remarks;
drop policy if exists "anon all templates" on templates;

-- Only a logged-in user can touch the data
drop policy if exists "auth all customers" on customers;
drop policy if exists "auth all remarks"   on remarks;
drop policy if exists "auth all templates" on templates;
create policy "auth all customers" on customers for all to authenticated using (true) with check (true);
create policy "auth all remarks"   on remarks   for all to authenticated using (true) with check (true);
create policy "auth all templates" on templates for all to authenticated using (true) with check (true);
