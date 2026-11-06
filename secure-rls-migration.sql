-- Run in Supabase SQL Editor.
-- IMPORTANT: If you already have customer/remark/template rows, first replace
-- YOUR_SUPABASE_AUTH_USER_UUID below with your user UUID from Authentication -> Users.
-- If all three tables are empty, you may remove/comment out the three UPDATE statements.

alter table public.customers
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.remarks
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;
alter table public.templates
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

-- Backfill existing records to your account. Replace the placeholder UUID first.
update public.customers
set owner_id = 'YOUR_SUPABASE_AUTH_USER_UUID'::uuid
where owner_id is null;

update public.remarks r
set owner_id = c.owner_id
from public.customers c
where r.customer_id = c.id and r.owner_id is null;

update public.templates
set owner_id = 'YOUR_SUPABASE_AUTH_USER_UUID'::uuid
where owner_id is null;

-- New rows created by the signed-in user automatically receive that user's ID.
alter table public.customers alter column owner_id set default auth.uid();
alter table public.remarks alter column owner_id set default auth.uid();
alter table public.templates alter column owner_id set default auth.uid();

-- Require ownership on every row after backfill.
alter table public.customers alter column owner_id set not null;
alter table public.remarks alter column owner_id set not null;
alter table public.templates alter column owner_id set not null;

-- Replace the old global phone uniqueness with per-user uniqueness.
alter table public.customers drop constraint if exists customers_phone_key_key;
drop index if exists public.customers_phone_key_key;
create unique index if not exists customers_owner_phone_key_uidx
  on public.customers(owner_id, phone_key);

-- Enable RLS and remove the earlier policies that exposed all rows to all signed-in users.
alter table public.customers enable row level security;
alter table public.remarks enable row level security;
alter table public.templates enable row level security;

drop policy if exists "anon all customers" on public.customers;
drop policy if exists "anon all remarks" on public.remarks;
drop policy if exists "anon all templates" on public.templates;
drop policy if exists "auth all customers" on public.customers;
drop policy if exists "auth all remarks" on public.remarks;
drop policy if exists "auth all templates" on public.templates;
drop policy if exists "customer owner access" on public.customers;
drop policy if exists "remark owner access" on public.remarks;
drop policy if exists "template owner access" on public.templates;

create policy "customer owner access"
on public.customers for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "remark owner access"
on public.remarks for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "template owner access"
on public.templates for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());
