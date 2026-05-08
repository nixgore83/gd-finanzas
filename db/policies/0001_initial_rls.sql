-- =============================================================================
-- 0001_initial_rls.sql — RLS, helper function, and on_auth_user_created trigger
-- =============================================================================
-- Idempotent: safe to re-run.
-- Applied via `npm run db:policies` (uses DIRECT_URL with postgres role,
-- which has BYPASSRLS = true, so this script is unaffected by its own policies).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper: which household does the current authenticated user belong to?
-- -----------------------------------------------------------------------------
-- SECURITY DEFINER lets it read household_members despite the caller's RLS.
-- LIMIT 1 because in V1 every user belongs to exactly one household.
create or replace function public.current_household_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select household_id
  from public.household_members
  where user_id = auth.uid()
  limit 1
$$;

revoke all on function public.current_household_id() from public;
grant execute on function public.current_household_id() to authenticated;

-- -----------------------------------------------------------------------------
-- Enable RLS on all public tables
-- -----------------------------------------------------------------------------
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.profiles          enable row level security;

-- Force RLS even for table owners (defense in depth; service_role still bypasses).
alter table public.households        force row level security;
alter table public.household_members force row level security;
alter table public.profiles          force row level security;

-- -----------------------------------------------------------------------------
-- households
-- -----------------------------------------------------------------------------
drop policy if exists households_select  on public.households;
drop policy if exists households_update  on public.households;

create policy households_select
  on public.households
  for select
  to authenticated
  using (id = public.current_household_id());

create policy households_update
  on public.households
  for update
  to authenticated
  using (id = public.current_household_id())
  with check (id = public.current_household_id());

-- INSERT/DELETE: only via service_role (no policy = denied for authenticated).

-- -----------------------------------------------------------------------------
-- household_members
-- -----------------------------------------------------------------------------
drop policy if exists household_members_select on public.household_members;

create policy household_members_select
  on public.household_members
  for select
  to authenticated
  using (household_id = public.current_household_id());

-- INSERT/UPDATE/DELETE: only service_role.

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_update on public.profiles;

create policy profiles_select
  on public.profiles
  for select
  to authenticated
  using (
    id = auth.uid()
    or id in (
      select user_id
      from public.household_members
      where household_id = public.current_household_id()
    )
  );

create policy profiles_update
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- INSERT: only via the on_auth_user_created trigger (SECURITY DEFINER).
-- DELETE: cascades from auth.users deletion; no direct DELETE allowed.

-- -----------------------------------------------------------------------------
-- Trigger: on auth.users insert, create matching profile row
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      split_part(new.email, '@', 1)
    )
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Trigger: keep profiles.updated_at fresh
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function public.set_updated_at();
