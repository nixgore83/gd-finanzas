-- =============================================================================
-- 0002_v1_core_rls.sql — RLS + triggers para las 13 tablas de Hito 1
-- =============================================================================
-- Idempotente: safe to re-run. Aplica via `npm run db:policies`.
-- Reutiliza:
--   - public.current_household_id()
--   - public.set_updated_at()
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Habilitar RLS en todas las tablas nuevas
-- -----------------------------------------------------------------------------
alter table public.institutions     enable row level security;
alter table public.accounts         enable row level security;
alter table public.categories       enable row level security;
alter table public.tags             enable row level security;
alter table public.transaction_tags enable row level security;
alter table public.transactions     enable row level security;
alter table public.recurrences      enable row level security;
alter table public.forecasts        enable row level security;
alter table public.budgets          enable row level security;
alter table public.fx_rates         enable row level security;
alter table public.imports          enable row level security;
alter table public.import_lines     enable row level security;
alter table public.financial_goals  enable row level security;

alter table public.institutions     force row level security;
alter table public.accounts         force row level security;
alter table public.categories       force row level security;
alter table public.tags             force row level security;
alter table public.transaction_tags force row level security;
alter table public.transactions     force row level security;
alter table public.recurrences      force row level security;
alter table public.forecasts        force row level security;
alter table public.budgets          force row level security;
alter table public.fx_rates         force row level security;
alter table public.imports          force row level security;
alter table public.import_lines     force row level security;
alter table public.financial_goals  force row level security;

-- -----------------------------------------------------------------------------
-- institutions — global lookup. SELECT abierto, escritura solo service_role.
-- -----------------------------------------------------------------------------
drop policy if exists institutions_select on public.institutions;
create policy institutions_select on public.institutions
  for select to authenticated
  using (true);
-- INSERT/UPDATE/DELETE: solo service_role (bypass RLS).

-- -----------------------------------------------------------------------------
-- fx_rates — global, alimentado por cron. SELECT abierto, escritura service_role.
-- -----------------------------------------------------------------------------
drop policy if exists fx_rates_select on public.fx_rates;
create policy fx_rates_select on public.fx_rates
  for select to authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- accounts — household-scoped
-- -----------------------------------------------------------------------------
drop policy if exists accounts_select on public.accounts;
drop policy if exists accounts_insert on public.accounts;
drop policy if exists accounts_update on public.accounts;
drop policy if exists accounts_delete on public.accounts;

create policy accounts_select on public.accounts
  for select to authenticated
  using (household_id = public.current_household_id());

create policy accounts_insert on public.accounts
  for insert to authenticated
  with check (household_id = public.current_household_id());

create policy accounts_update on public.accounts
  for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

create policy accounts_delete on public.accounts
  for delete to authenticated
  using (household_id = public.current_household_id());

-- -----------------------------------------------------------------------------
-- categories — household-scoped
-- -----------------------------------------------------------------------------
drop policy if exists categories_select on public.categories;
drop policy if exists categories_insert on public.categories;
drop policy if exists categories_update on public.categories;
drop policy if exists categories_delete on public.categories;

create policy categories_select on public.categories
  for select to authenticated
  using (household_id = public.current_household_id());

create policy categories_insert on public.categories
  for insert to authenticated
  with check (household_id = public.current_household_id());

create policy categories_update on public.categories
  for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

create policy categories_delete on public.categories
  for delete to authenticated
  using (household_id = public.current_household_id());

-- -----------------------------------------------------------------------------
-- tags — household-scoped
-- -----------------------------------------------------------------------------
drop policy if exists tags_select on public.tags;
drop policy if exists tags_insert on public.tags;
drop policy if exists tags_update on public.tags;
drop policy if exists tags_delete on public.tags;

create policy tags_select on public.tags
  for select to authenticated
  using (household_id = public.current_household_id());

create policy tags_insert on public.tags
  for insert to authenticated
  with check (household_id = public.current_household_id());

create policy tags_update on public.tags
  for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

create policy tags_delete on public.tags
  for delete to authenticated
  using (household_id = public.current_household_id());

-- -----------------------------------------------------------------------------
-- transactions — household-scoped
-- -----------------------------------------------------------------------------
drop policy if exists transactions_select on public.transactions;
drop policy if exists transactions_insert on public.transactions;
drop policy if exists transactions_update on public.transactions;
drop policy if exists transactions_delete on public.transactions;

create policy transactions_select on public.transactions
  for select to authenticated
  using (household_id = public.current_household_id());

create policy transactions_insert on public.transactions
  for insert to authenticated
  with check (household_id = public.current_household_id());

create policy transactions_update on public.transactions
  for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

create policy transactions_delete on public.transactions
  for delete to authenticated
  using (household_id = public.current_household_id());

-- -----------------------------------------------------------------------------
-- transaction_tags — derivado via transaction.household_id
-- -----------------------------------------------------------------------------
drop policy if exists transaction_tags_select on public.transaction_tags;
drop policy if exists transaction_tags_insert on public.transaction_tags;
drop policy if exists transaction_tags_delete on public.transaction_tags;

create policy transaction_tags_select on public.transaction_tags
  for select to authenticated
  using (
    exists (
      select 1 from public.transactions t
      where t.id = transaction_tags.transaction_id
        and t.household_id = public.current_household_id()
    )
  );

create policy transaction_tags_insert on public.transaction_tags
  for insert to authenticated
  with check (
    exists (
      select 1 from public.transactions t
      where t.id = transaction_tags.transaction_id
        and t.household_id = public.current_household_id()
    )
  );

create policy transaction_tags_delete on public.transaction_tags
  for delete to authenticated
  using (
    exists (
      select 1 from public.transactions t
      where t.id = transaction_tags.transaction_id
        and t.household_id = public.current_household_id()
    )
  );
-- UPDATE: no aplica (es solo PK transaction_id+tag_id; mutación = delete + insert).

-- -----------------------------------------------------------------------------
-- recurrences — household-scoped
-- -----------------------------------------------------------------------------
drop policy if exists recurrences_select on public.recurrences;
drop policy if exists recurrences_insert on public.recurrences;
drop policy if exists recurrences_update on public.recurrences;
drop policy if exists recurrences_delete on public.recurrences;

create policy recurrences_select on public.recurrences
  for select to authenticated
  using (household_id = public.current_household_id());

create policy recurrences_insert on public.recurrences
  for insert to authenticated
  with check (household_id = public.current_household_id());

create policy recurrences_update on public.recurrences
  for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

create policy recurrences_delete on public.recurrences
  for delete to authenticated
  using (household_id = public.current_household_id());

-- -----------------------------------------------------------------------------
-- forecasts — derivado via recurrence.household_id
-- -----------------------------------------------------------------------------
drop policy if exists forecasts_select on public.forecasts;
drop policy if exists forecasts_insert on public.forecasts;
drop policy if exists forecasts_update on public.forecasts;
drop policy if exists forecasts_delete on public.forecasts;

create policy forecasts_select on public.forecasts
  for select to authenticated
  using (
    exists (
      select 1 from public.recurrences r
      where r.id = forecasts.recurrence_id
        and r.household_id = public.current_household_id()
    )
  );

create policy forecasts_insert on public.forecasts
  for insert to authenticated
  with check (
    exists (
      select 1 from public.recurrences r
      where r.id = forecasts.recurrence_id
        and r.household_id = public.current_household_id()
    )
  );

create policy forecasts_update on public.forecasts
  for update to authenticated
  using (
    exists (
      select 1 from public.recurrences r
      where r.id = forecasts.recurrence_id
        and r.household_id = public.current_household_id()
    )
  )
  with check (
    exists (
      select 1 from public.recurrences r
      where r.id = forecasts.recurrence_id
        and r.household_id = public.current_household_id()
    )
  );

create policy forecasts_delete on public.forecasts
  for delete to authenticated
  using (
    exists (
      select 1 from public.recurrences r
      where r.id = forecasts.recurrence_id
        and r.household_id = public.current_household_id()
    )
  );

-- -----------------------------------------------------------------------------
-- budgets — household-scoped
-- -----------------------------------------------------------------------------
drop policy if exists budgets_select on public.budgets;
drop policy if exists budgets_insert on public.budgets;
drop policy if exists budgets_update on public.budgets;
drop policy if exists budgets_delete on public.budgets;

create policy budgets_select on public.budgets
  for select to authenticated
  using (household_id = public.current_household_id());

create policy budgets_insert on public.budgets
  for insert to authenticated
  with check (household_id = public.current_household_id());

create policy budgets_update on public.budgets
  for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

create policy budgets_delete on public.budgets
  for delete to authenticated
  using (household_id = public.current_household_id());

-- -----------------------------------------------------------------------------
-- imports — household-scoped
-- -----------------------------------------------------------------------------
drop policy if exists imports_select on public.imports;
drop policy if exists imports_insert on public.imports;
drop policy if exists imports_update on public.imports;
drop policy if exists imports_delete on public.imports;

create policy imports_select on public.imports
  for select to authenticated
  using (household_id = public.current_household_id());

create policy imports_insert on public.imports
  for insert to authenticated
  with check (household_id = public.current_household_id());

create policy imports_update on public.imports
  for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());

create policy imports_delete on public.imports
  for delete to authenticated
  using (household_id = public.current_household_id());

-- -----------------------------------------------------------------------------
-- import_lines — derivado via imports.household_id
-- -----------------------------------------------------------------------------
drop policy if exists import_lines_select on public.import_lines;
drop policy if exists import_lines_insert on public.import_lines;
drop policy if exists import_lines_update on public.import_lines;
drop policy if exists import_lines_delete on public.import_lines;

create policy import_lines_select on public.import_lines
  for select to authenticated
  using (
    exists (
      select 1 from public.imports i
      where i.id = import_lines.import_id
        and i.household_id = public.current_household_id()
    )
  );

create policy import_lines_insert on public.import_lines
  for insert to authenticated
  with check (
    exists (
      select 1 from public.imports i
      where i.id = import_lines.import_id
        and i.household_id = public.current_household_id()
    )
  );

create policy import_lines_update on public.import_lines
  for update to authenticated
  using (
    exists (
      select 1 from public.imports i
      where i.id = import_lines.import_id
        and i.household_id = public.current_household_id()
    )
  )
  with check (
    exists (
      select 1 from public.imports i
      where i.id = import_lines.import_id
        and i.household_id = public.current_household_id()
    )
  );

create policy import_lines_delete on public.import_lines
  for delete to authenticated
  using (
    exists (
      select 1 from public.imports i
      where i.id = import_lines.import_id
        and i.household_id = public.current_household_id()
    )
  );

-- -----------------------------------------------------------------------------
-- financial_goals — household-scoped (UNIQUE(household_id) garantiza 1 fila)
-- -----------------------------------------------------------------------------
drop policy if exists financial_goals_select on public.financial_goals;
drop policy if exists financial_goals_insert on public.financial_goals;
drop policy if exists financial_goals_update on public.financial_goals;

create policy financial_goals_select on public.financial_goals
  for select to authenticated
  using (household_id = public.current_household_id());

create policy financial_goals_insert on public.financial_goals
  for insert to authenticated
  with check (household_id = public.current_household_id());

create policy financial_goals_update on public.financial_goals
  for update to authenticated
  using (household_id = public.current_household_id())
  with check (household_id = public.current_household_id());
-- DELETE: no aplica (siempre debe existir 1 fila por household tras setup inicial).

-- -----------------------------------------------------------------------------
-- Triggers updated_at
-- -----------------------------------------------------------------------------
drop trigger if exists accounts_set_updated_at        on public.accounts;
drop trigger if exists categories_set_updated_at      on public.categories;
drop trigger if exists recurrences_set_updated_at     on public.recurrences;
drop trigger if exists transactions_set_updated_at    on public.transactions;
drop trigger if exists financial_goals_set_updated_at on public.financial_goals;

create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.set_updated_at();

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

create trigger recurrences_set_updated_at
  before update on public.recurrences
  for each row execute function public.set_updated_at();

create trigger transactions_set_updated_at
  before update on public.transactions
  for each row execute function public.set_updated_at();

create trigger financial_goals_set_updated_at
  before update on public.financial_goals
  for each row execute function public.set_updated_at();
