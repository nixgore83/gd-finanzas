-- =============================================================================
-- 0004_household_settings_rls.sql — RLS para household_settings
-- =============================================================================
-- Idempotente: safe to re-run.
-- Reutiliza: public.current_household_id()
-- =============================================================================

alter table public.household_settings enable row level security;
alter table public.household_settings force row level security;

drop policy if exists household_settings_select on public.household_settings;
drop policy if exists household_settings_insert on public.household_settings;
drop policy if exists household_settings_update on public.household_settings;
drop policy if exists household_settings_delete on public.household_settings;

create policy household_settings_select on public.household_settings
  for select to authenticated
  using (household_id = public.current_household_id());

create policy household_settings_insert on public.household_settings
  for insert to authenticated
  with check (household_id = public.current_household_id());

create policy household_settings_update on public.household_settings
  for update to authenticated
  using (household_id = public.current_household_id());

create policy household_settings_delete on public.household_settings
  for delete to authenticated
  using (household_id = public.current_household_id());
