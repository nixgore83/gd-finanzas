-- =============================================================================
-- 0003_patrimonio_rls.sql — RLS para net_worth_snapshots, account_balances, holdings
-- =============================================================================
-- Idempotente: safe to re-run. Aplica via `npm run db:policies`.
-- Reutiliza:
--   - public.current_household_id()
--   - public.set_updated_at()
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Habilitar RLS
-- -----------------------------------------------------------------------------
alter table public.net_worth_snapshots enable row level security;
alter table public.account_balances    enable row level security;
alter table public.holdings            enable row level security;

alter table public.net_worth_snapshots force row level security;
alter table public.account_balances    force row level security;
alter table public.holdings            force row level security;

-- -----------------------------------------------------------------------------
-- net_worth_snapshots — household-scoped (tiene household_id directo)
-- -----------------------------------------------------------------------------
drop policy if exists nws_select on public.net_worth_snapshots;
drop policy if exists nws_insert on public.net_worth_snapshots;
drop policy if exists nws_update on public.net_worth_snapshots;
drop policy if exists nws_delete on public.net_worth_snapshots;

create policy nws_select on public.net_worth_snapshots
  for select to authenticated
  using (household_id = public.current_household_id());

create policy nws_insert on public.net_worth_snapshots
  for insert to authenticated
  with check (household_id = public.current_household_id());

create policy nws_update on public.net_worth_snapshots
  for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

create policy nws_delete on public.net_worth_snapshots
  for delete to authenticated
  using (household_id = public.current_household_id());

-- trigger updated_at
drop trigger if exists set_updated_at on public.net_worth_snapshots;
create trigger set_updated_at
  before update on public.net_worth_snapshots
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- account_balances — derivado via net_worth_snapshots.household_id
-- -----------------------------------------------------------------------------
drop policy if exists ab_select on public.account_balances;
drop policy if exists ab_insert on public.account_balances;
drop policy if exists ab_update on public.account_balances;
drop policy if exists ab_delete on public.account_balances;

create policy ab_select on public.account_balances
  for select to authenticated
  using (
    exists (
      select 1 from public.net_worth_snapshots s
      where s.id = account_balances.snapshot_id
        and s.household_id = public.current_household_id()
    )
  );

create policy ab_insert on public.account_balances
  for insert to authenticated
  with check (
    exists (
      select 1 from public.net_worth_snapshots s
      where s.id = account_balances.snapshot_id
        and s.household_id = public.current_household_id()
    )
  );

create policy ab_update on public.account_balances
  for update to authenticated
  using (
    exists (
      select 1 from public.net_worth_snapshots s
      where s.id = account_balances.snapshot_id
        and s.household_id = public.current_household_id()
    )
  )
  with check (
    exists (
      select 1 from public.net_worth_snapshots s
      where s.id = account_balances.snapshot_id
        and s.household_id = public.current_household_id()
    )
  );

create policy ab_delete on public.account_balances
  for delete to authenticated
  using (
    exists (
      select 1 from public.net_worth_snapshots s
      where s.id = account_balances.snapshot_id
        and s.household_id = public.current_household_id()
    )
  );

-- -----------------------------------------------------------------------------
-- holdings — derivado via net_worth_snapshots.household_id
-- -----------------------------------------------------------------------------
drop policy if exists holdings_select on public.holdings;
drop policy if exists holdings_insert on public.holdings;
drop policy if exists holdings_update on public.holdings;
drop policy if exists holdings_delete on public.holdings;

create policy holdings_select on public.holdings
  for select to authenticated
  using (
    exists (
      select 1 from public.net_worth_snapshots s
      where s.id = holdings.snapshot_id
        and s.household_id = public.current_household_id()
    )
  );

create policy holdings_insert on public.holdings
  for insert to authenticated
  with check (
    exists (
      select 1 from public.net_worth_snapshots s
      where s.id = holdings.snapshot_id
        and s.household_id = public.current_household_id()
    )
  );

create policy holdings_update on public.holdings
  for update to authenticated
  using (
    exists (
      select 1 from public.net_worth_snapshots s
      where s.id = holdings.snapshot_id
        and s.household_id = public.current_household_id()
    )
  )
  with check (
    exists (
      select 1 from public.net_worth_snapshots s
      where s.id = holdings.snapshot_id
        and s.household_id = public.current_household_id()
    )
  );

create policy holdings_delete on public.holdings
  for delete to authenticated
  using (
    exists (
      select 1 from public.net_worth_snapshots s
      where s.id = holdings.snapshot_id
        and s.household_id = public.current_household_id()
    )
  );
