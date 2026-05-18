# STATUS.md — gd-finanzas

> Estado vivo. Se actualiza al cierre de cada hito.
> Sesión nueva: leer `CLAUDE.md`, leer este archivo, leer el PRD V1.1 (Notion) si la sesión toca un módulo nuevo.

**Última actualización:** 2026-05-18 por Claude

---

## Hito en curso
**Hito 4 — Recurrencias + previsiones** (completo ✅; próximo: Hito 5 = Dashboard + Reporte A = V1.0)

---

## Hitos

### 🟢 Hito 0 — Setup (local)
**Output esperado:** Next.js + Supabase + Vercel + login funcional + STATUS.md

- [x] Estructura de repo (Next 16, TS strict, ESLint flat, Prettier, Vitest, Tailwind v4)
- [x] Componentes UI mínimos (Button, Input, Label, Card, Sonner)
- [x] Drizzle config + schema (`auth.users` ref, `households`, `household_members`, `profiles`)
- [x] Scripts: `db:migrate`, `db:policies`, `db:seed:household`, `db:confirm-emails`
- [x] RLS policies SQL (`db/policies/0001_initial_rls.sql`) con función `current_household_id()` + trigger `on_auth_user_created`
- [x] Clientes Supabase (browser, server, middleware) con `@supabase/ssr`
- [x] Whitelist de emails server-side con respuesta genérica
- [x] Login con magic link end-to-end (`/login`, `/auth/callback`, `/auth/sign-out`)
- [x] Layout protegido con guard de sesión + membership en household
- [x] `STATUS.md`, `.env.example`, `.gitignore` extendido
- [x] Proyecto Supabase creado (us-west-2), keys nuevas (`sb_publishable_*` / `sb_secret_*`)
- [x] Auth: Email habilitado, signups OFF, redirect URLs configuradas
- [x] Users invitados (nixgore + paula) y confirmados via `db:confirm-emails` (los invites originales expiraron)
- [x] Migraciones aplicadas, RLS activa, household "Garaglio-Dasso" sembrado, ambos profiles creados por trigger
- [x] Smoke test local: magic link → callback → dashboard funcional
- [x] Validación verde: `typecheck && lint && test && build`

Deploy a producción (2026-05-14):
- [x] Repo en GitHub creado y pusheado a `nixgore83/gd-finanzas`
- [x] Vercel: proyecto `gd-finanzas-z4dl`, env vars cargadas en Production, deploy verde
- [x] Supabase: Site URL = `https://gd-finanzas-z4dl.vercel.app`, redirect URLs incluyen `/auth/callback` para prod y `localhost:3000` para dev
- [x] `NEXT_PUBLIC_SITE_URL` corregido en Vercel (primer valor cargado generaba `redirect_to` a la raíz → Supabase fallback al Site URL → token nunca llegaba a `/auth/callback`)
- [x] Audit de logs: solo dos `console.error` en `app/auth/callback/route.ts:17` y `app/actions/auth/send-magic-link.ts:45`, ambos loggean solo `error.code` (y `status`), sin email/token/PII
- [ ] **Smoke test producción del magic link** — pendiente por rate limit del SMTP built-in de Supabase (2 mails/hora, no editable en free). Reintentar la próxima vez que haya que iniciar sesión en prod. Verificar que el link del mail tenga `redirect_to=https://gd-finanzas-z4dl.vercel.app/auth/callback` (con el path, no solo el dominio raíz).

MFA TOTP (2026-05-14):
- [x] TOTP habilitado en Supabase (Authentication → Multi-Factor → TOTP "Enabled")
- [x] `mfaCodeSchema` (6 dígitos numéricos) en `lib/schemas/auth.ts`
- [x] Helper `getMfaState()` en `lib/auth/mfa.ts` (returns `'enroll' | 'challenge' | 'ok'` según AAL)
- [x] Server actions `enrollMfaFactor()` y `verifyMfaCode()` en `app/actions/auth/mfa/`
- [x] Páginas `/auth/mfa/enroll` y `/auth/mfa/challenge` bajo el grupo `(auth)` (mismo layout centrado que `/login`)
- [x] Gate en `(protected)/layout.tsx`: tras el check de `user`, llama `getMfaState()` y redirige a enroll/challenge según corresponda
- [x] `/login` ahora redirige al estado MFA correcto si ya hay sesión (no asume `/dashboard`)
- [x] Tests: 11 de schemas (incluye `mfaCodeSchema`) + 4 del helper `getMfaState`
- [x] Smoke local: enrollment con app authenticator + verify + dashboard en AAL2 ✅
- [ ] Smoke local del challenge en re-login: **no probado** por rate limit del SMTP. Riesgo bajo: `verifyMfaCode` está validado por el path de enrollment (es la misma server action); la única lógica nueva es leer el factor verificado existente, cubierta por build/typecheck. Se valida la próxima vez que cualquiera de los dos vuelva a entrar tras expiración de sesión.

### 🟢 Hito 1 — Modelo base + cuentas

**1.A — Schema + RLS (2026-05-14, hecho):**
- [x] 13 tablas Drizzle en `db/schema/*` (un archivo por entidad): institutions, accounts, categories, tags, transaction_tags, transactions, recurrences, forecasts, budgets, fx_rates, imports, import_lines, financial_goals
- [x] 11 pgEnums en `db/schema/enums.ts` (currency, account_type, category_kind, transaction_kind, transaction_subtype, transaction_source, recurrence_frequency, forecast_status, import_type, import_status, import_line_status)
- [x] Migración `0001_parallel_groot.sql` generada y aplicada (349 líneas, FKs e índices incluidos)
- [x] RLS policies `0002_v1_core_rls.sql` aplicadas: tablas household-scoped (accounts/categories/tags/transactions/recurrences/budgets/imports/financial_goals) usan `current_household_id()`; tablas derivadas (transaction_tags/forecasts/import_lines) via EXISTS sobre el padre; institutions y fx_rates con SELECT abierto a authenticated y escritura solo service_role
- [x] Triggers `set_updated_at` en accounts/categories/recurrences/transactions/financial_goals (reusa función existente del Hito 0)
- [x] Helper money: `lib/schemas/money.ts` con `toMoneyString`, `parseMoney`, `moneySchema`, `positiveMoneySchema` usando `decimal.js` y `ROUND_HALF_UP` (13 tests)
- [x] Script smoke RLS: `npm run db:smoke-rls` (8/8 ok)
- [x] Validación verde: typecheck + lint + 28 tests + build

**1.B — CRUD cuentas + seed instituciones (2026-05-14, hecho):**
- [x] Seed idempotente de 13 `institutions` (Galicia, ICBC, BBVA, Santander, Macro, BNA, Mercado Pago, Brubank, Naranja X, Balanz, Cocos, IOL, HSBC US) via `npm run db:seed:institutions`
- [x] Schemas Zod: `lib/schemas/account.ts` con `accountInputSchema` (refine `institutionId` requerido si `type !== 'cash'`), `parseAccountFormData` helper, `ACCOUNT_TYPE_LABELS` para UI; 10 tests
- [x] Helper `lib/auth/session.ts` con `requireHouseholdSession()` que valida user + AAL2 + membership; lanza `SessionError` tipado. Pivota el modelo de tenancy: Drizzle se conecta como `postgres` role (bypass RLS) → el `household_id` se setea explícito desde la sesión y todas las queries filtran por él
- [x] Server actions en `app/actions/accounts/`: `createAccount`, `updateAccount`, `setAccountArchived`. Cada una valida sesión, parsea input, ejecuta UPDATE/INSERT con WHERE doble (id + householdId), revalida path
- [x] UI bajo `app/(protected)/accounts/`: `page.tsx` (lista con toggle activas/archivadas), `new/page.tsx` (form alta), `[id]/page.tsx` (form edit), `account-form.tsx` (client component compartido). Toggle archive con form inline + server action wrapper
- [x] shadcn `Select` agregado a mano (`@radix-ui/react-select`); 4 dropdowns en el form (tipo, moneda, institución, titular)
- [x] Smoke manual: crear cash sin institución ✅, crear bank_savings con institución ✅, validación rechaza credit_card sin institución ✅, editar ✅, archivar/reactivar ✅
- [x] Validación verde: typecheck + lint + 38 tests + build + `db:smoke-rls` 8/8

### 🟢 Hito 2 — FX feed BCRA

**2.A — Cliente BCRA + helper + backfill manual (2026-05-15, hecho):**
- [x] `lib/fx/bcra.ts`: `listBcraVariables()` y `fetchBcraSeries({ idVariable, desde, hasta, limit })` contra `https://api.bcra.gob.ar/estadisticas/v3.0/Monetarias`, con Zod del payload, timeout 15s y `BcraApiError` tipado
- [x] `lib/fx/resolve.ts`: función pura `resolveFxRate(rows, targetDate, currencyPair)` con fallback al día previo y flag `BCRA_last_available`; 7 tests cubriendo match exacto, fallback, finde largo, anterior a todo, vacío, filtrado por pair, posteriores
- [x] `lib/fx/get-fx-rate.ts`: helper `getFxRate({ date, currency })` que consulta `fx_rates` via Drizzle (`getDb()`), aplica `resolveFxRate`, devuelve `{ rate: Decimal, source, effectiveDate }`. Atajo identity para ARS (rate=1, source=`identity`). Throw `FxRateNotFoundError` si no hay nada en los últimos 30 días <= target
- [x] `scripts/fx-list-variables.ts` + `npm run fx:list-vars`: lista variables BCRA filtrando por `/tipo de cambio|dólar|usd/i` para descubrir el idVariable minorista
- [x] `scripts/fx-backfill.ts` + `npm run fx:backfill`: backfill manual con flags `--variable --from --to --pair --source`; UPSERT batch contra `fx_rates` por PK `(date, currency_pair)`. Defaults: 30 días, pair `USD/ARS`, source `BCRA_minorista`
- [x] Validación verde: typecheck + lint + 45 tests + build

**2.B — Cron Vercel (2026-05-17, hecho):**
- [x] `app/api/cron/fx/route.ts`: GET con auth `Authorization: Bearer ${CRON_SECRET}`, fetch BCRA con ventana de 7 días hacia atrás, UPSERT con Drizzle `onConflictDoUpdate`. Loggea solo conteos. Devuelve 401 si falla auth, 502 si BCRA falla
- [x] `vercel.json` con cron diario `0 14 * * *` (14:00 UTC ≈ 11:00 AR) apuntando a `/api/cron/fx`
- [x] `lib/env.ts` + `.env.example`: `CRON_SECRET` (≥16 chars) y `BCRA_FX_MINORISTA_VARIABLE_ID` (coerce a int positivo)
- [x] Validación verde: typecheck + lint + 45 tests + build (route registrada como `ƒ /api/cron/fx`)

**2.C — Migración a API v4 (2026-05-17, hecho):**
- [x] La v3.0 devolvió 400 con `"Método correspondiente a la v3 ha sido deprecado."`; migrado a `https://api.bcra.gob.ar/estadisticas/v4.0`
- [x] El endpoint de serie v4 anida los puntos en `results[].detalle[]`; `fetchBcraSeries()` ahora aplana antes de devolver — la firma pública (`BcraSeriesPoint[]`) no cambió, los callers (script de backfill, route del cron) no se tocaron
- [x] `npm run fx:list-vars` corrió OK contra v4: **idVariable=4 = "Tipo de cambio minorista (promedio vendedor)"** (Principales Variables)
- [x] Validación verde: typecheck + lint + 45 tests + build

**2.D — Activación operacional (2026-05-17, hecho):**
- [x] `BCRA_FX_MINORISTA_VARIABLE_ID=4` y `CRON_SECRET` (hex 32 bytes) cargadas en `.env.local` y en Vercel Production
- [x] Deploy en Vercel registró `/api/cron/fx` en la pantalla de Cron Jobs (schedule `0 14 * * *`)
- [x] Smoke `/api/cron/fx` sin auth → 401, con Run desde Vercel → 200 + upsert OK
- [x] Script `npm run fx:smoke` agregado para probar `getFxRate` local con 3 casos (día hábil, finde → fallback, ARS → identity)
- [ ] (Opcional) Backfill histórico desde inicio del año si Hito 3 carga transacciones con fecha anterior a los últimos 7 días: `npm run fx:backfill -- --variable 4 --from 2026-01-01 --to <hoy>`

### 🟢 Hito 3 — Transacciones manuales

**3.A — Alta + lista income/expense end-to-end (2026-05-17, hecho):**
- [x] `scripts/seed-categories-placeholder.ts` + `npm run db:seed:categories-placeholder`: 2 categorías por household ("Ingresos varios"/income, "Gastos varios"/expense), idempotente vía `WHERE NOT EXISTS`
- [x] `lib/schemas/transaction.ts`: `transactionInputSchema` (date, accountId, categoryId, kind, amountOriginal positivo, currencyOriginal, description, notes opcional) + `parseTransactionFormData`; 12 tests
- [x] `app/actions/transactions/create.ts`: valida sesión + parsea input + chequea que account y category pertenezcan al household (con WHERE doble) + matchea category.kind con transaction.kind + llama `getFxRate` + calcula amountUsd/amountArs con Decimal + INSERT con `source='manual'`, `transactionSubtype='standard'`, `createdBy=session.userId`
- [x] UI bajo `app/(protected)/transactions/`: `page.tsx` (lista con LIMIT 50, formato `Intl.NumberFormat`, badge de kind), `new/page.tsx` (alta con empty states para 0 accounts / 0 categories), `transaction-form.tsx` (client component con Select kind/account/category/currency, filter categories por kind en `useMemo`, auto-fill currency desde account default)
- [x] Layout protegido: header con nav links Dashboard / Cuentas / Transacciones
- [x] Validación verde: typecheck + lint + 57 tests + build + `db:smoke-rls` 8/8

**3.B — Edit + delete + manual FX override (2026-05-17, hecho):**
- [x] `lib/schemas/transaction.ts`: sumado `fxRateOverride` (opcional, canonicaliza a 6 decimales, rechaza ≤0 / no-numérico); 15 tests
- [x] `app/actions/transactions/_build.ts`: helper compartido `buildTransactionFields(input, householdId)` que valida refs (account + category en household, kind match) y resuelve FX (override → `manual_override`, sino `getFxRate` → fuente real)
- [x] `app/actions/transactions/create.ts`: refactor para usar `_build`
- [x] `app/actions/transactions/update.ts`: nuevo (mismo flujo + `WHERE id + householdId`)
- [x] `app/actions/transactions/delete.ts`: nuevo (hard delete con WHERE doble; TODO 3.C extender para `transfer_pair_id`)
- [x] `app/(protected)/transactions/[id]/page.tsx`: edit page con form prellenado + bloque de delete destructivo al pie
- [x] `app/(protected)/transactions/delete-button.tsx`: client component con `confirm()` nativo + toast + router.refresh
- [x] `transaction-form.tsx` extendido: `initial` + `hiddenId` + input "FX rate (opcional)" + info text de cotización usada actualmente en edit mode
- [x] Lista: columna de acciones con "Editar" + DeleteButton
- [x] Validación verde: typecheck + lint + 60 tests + build + `db:smoke-rls` 8/8

**3.C — Transferencias entre cuentas (2026-05-17, hecho):**
- [x] `lib/schemas/transfer.ts`: `transferInputSchema` con refine (cuentas distintas), `amountFrom` y `amountTo` siempre obligatorios, `fxRateOverride` opcional; 9 tests
- [x] `app/actions/transactions/_build-transfer.ts`: helper que carga ambas cuentas, valida pertenencia + archived, resuelve FX (override o BCRA), arma fromLeg (signo negativo) y toLeg (signo positivo) en su moneda original; genera `transfer_pair_id` o reusa el existente en edit
- [x] `create-transfer.ts`: INSERT batch de 2 filas con mismo `pairId`, `kind='transfer'`, `category_id=null`
- [x] `update-transfer.ts`: valida que las cuentas no se intentaron cambiar (DevTools guard) + `db.transaction(DELETE pair → INSERT 2 nuevas)`. Mantiene `pairId`. Cambia `created_at` (decisión consciente: no usamos timestamps históricos en V1)
- [x] `delete.ts` extendido: si la fila tiene `transfer_pair_id`, borra ambas patas en un solo statement
- [x] UI: `/transactions/new-transfer` + `transfer-form.tsx` (Selects from/to, auto-sync `amountTo = amountFrom` cuando misma moneda y no tocado; helper text cross-currency; edit mode con accounts disabled)
- [x] `/transactions/[id]/page.tsx` branch por `kind`: si `transfer`, carga ambas patas via `transfer_pair_id`, identifica from/to por signo de `amount_original`, renderiza TransferForm
- [x] Lista: botón "↔ Transferencia" arriba; badge azul para kind=transfer (`ALL_KIND_LABELS` para display); `Intl.NumberFormat` muestra el signo negativo naturalmente
- [x] `tx-peek.ts` actualizado: muestra `transfer_pair_id` truncado + `amount_original` con signo
- [x] Validación verde: typecheck + lint + 69 tests + build + `db:smoke-rls` 8/8

**3.D.1 — Filtros + paginación (2026-05-17, hecho):**
- [x] `/transactions/page.tsx`: parseo de search params con Zod field-por-field (descarta inválidos sin romper UX), WHERE dinámico con `and(...)`, dos queries (count + page), `LIMIT 50 OFFSET (page-1)*50`
- [x] Form GET nativo arriba de la tabla: búsqueda (`q` ilike), kind, accountId, categoryId, from, to. Submit recarga con nuevos params; "Limpiar" es link a `/transactions`. Sin client interactividad → no se incluye hidden `page`, se resetea a 1 al filtrar
- [x] Paginador abajo: "Mostrando X–Y de Z" + Prev/Next como `<Link>` preservando filtros vía helper `buildHref`. Se oculta cuando hay 1 sola página
- [x] Validación verde: typecheck + lint + 69 tests + build + `db:smoke-rls` 8/8

**3.D.2 — Tags m:n + filtro + badges (2026-05-18, hecho):**
- [x] `lib/schemas/tag.ts`: `tagInputSchema` (name, color hex opcional con regex), `tagIdsSchema` (array uuids con cap=20 y dedupe); 12 tests
- [x] `lib/schemas/transaction.ts` + `transfer.ts`: campos `tagIds` opcional (default []), parser extrae `formData.getAll('tagIds')`; +3 tests cada uno
- [x] `app/actions/tags/`: `create.ts` + `update.ts` (con guard `23505` para unique violation → `name_taken`) + `delete.ts` (hard delete, CASCADE limpia junction)
- [x] `app/actions/transactions/_build.ts`: helper compartido `validateTagIds(tagIds, householdId)` para validar pertenencia
- [x] `create.ts`, `update.ts`, `create-transfer.ts`, `update-transfer.ts`: envueltos en `db.transaction`; insert/replace de filas en `transaction_tags`. Para transfers, cada tag se duplica para ambas patas (consistencia en filtros)
- [x] UI tags CRUD: `/tags/page.tsx` (lista con COUNT(transaction_tags) por tag), `/tags/new`, `/tags/[id]`, `tag-form.tsx` (color picker nativo + checkbox "sin color"), `delete-button.tsx` (confirm con el count de afectadas)
- [x] `tag-multi-select.tsx`: chips clickeables, tinted con `color` (rgba al 18% si está) o neutro si no
- [x] Integración en `transaction-form.tsx` y `transfer-form.tsx`: prop `availableTags`, prefill desde `initial.tagIds`, inyección al FormData via `formData.append('tagIds', id)`. Pages new/[id]/new-transfer precargan `tagRows` y, para edit, los `currentTagIds` del tx
- [x] Nav link "Etiquetas" en layout protegido
- [x] Lista `/transactions`: filtro `tagId` (EXISTS subquery con sql template) + segunda query batch para badges (`Map<txId, Tag[]>`) + render como pills con color del tag
- [x] Validación verde: typecheck + lint + 86 tests + build + `db:smoke-rls` 8/8

### ⏳ (Sesión categorías con Nico antes de Hito 4)

Cerrar taxonomía.

### 🟢 Hito 4 — Recurrencias + previsiones

**4.A — CRUD de recurrencias + generación auto de forecasts (2026-05-18, hecho):**
- [x] `lib/recurrences/forecasts.ts`: `computeForecastDates(...)` puro, sin DB, sin timezone. Soporta monthly/bimonthly/quarterly/yearly + clamp a último día del mes. Rolling 12 meses (PRD §5.3); 11 tests cubren day 31 en feb (leap/no-leap), endDate cortando horizon, startDate posterior, etc.
- [x] `lib/schemas/recurrence.ts`: `recurrenceInputSchema` (name/account/category/kind/amount/currency/frequency/dayOfMonth 1-31/start/end/active) + refine endDate >= startDate. `custom` del enum DB queda fuera del schema en V1. 11 tests
- [x] `app/actions/recurrences/_sync.ts`: `syncForecasts(tx, recurrenceId, input, today)`. Borra pending del futuro (no toca history) + regenera con `computeForecastDates`. Llamable desde `db.transaction` para atomicidad
- [x] `create.ts`, `update.ts`, `set-active.ts`, `delete.ts`. Create/update envueltos en `db.transaction(syncForecasts)`. `set-active`: al pausar borra pending futuras; al reactivar regenera. Delete cascadea forecasts; `transactions.recurrence_id` queda en NULL (FK ON DELETE SET NULL)
- [x] UI: `/recurrences` (lista con próxima fecha via `min(forecasts.expectedDate)` filtrado por pending+futuro, toggle Activas/Todas), `/recurrences/new` (empty states accounts/categories), `/recurrences/[id]` (form + bloque mini de 12 próximas pending + bloque destructivo de delete)
- [x] `recurrence-form.tsx`: reusa loadCategoryTree + filtro por kind, selects de frequency, day input 1-31, checkbox active
- [x] Nav link "Recurrencias" en layout protegido
- [x] Validación verde: typecheck + lint + 108 tests + build + `db:smoke-rls` 8/8

**4.B — Cashflow proyectado + matching manual + missed cron (2026-05-18, hecho):**
- [x] `lib/forecasts/candidates.ts`: `rankCandidates(candidates, tx)` puro, filtra por |date diff| ≤ 5d y |amount usd diff %| ≤ 10%; ordena por proximidad de fecha luego de monto; 9 tests
- [x] `app/actions/forecasts/_candidates.ts`: helper `findMatchCandidates(txId, householdId)` con pre-filter SQL (account, kind, pending, ventana ±5d) + conversión a USD via `getFxRate` por candidate + `rankCandidates` + cap top 5
- [x] Server actions: `cancel.ts` (pending→cancelled), `link.ts` (db.transaction: forecast→matched + tx.recurrence_id; bloquea si already_linked), `unlink.ts` (revertir)
- [x] UI: `/forecasts/page.tsx` (lista de pending agrupada por mes con cancel button), `forecasts/cancel-button.tsx`, `transactions/forecast-matcher.tsx` (modo `candidates` muestra cards con "Linkear"; modo `linked` muestra "Linkeada a {recurrence}" + "Desvincular")
- [x] `/transactions/[id]/page.tsx`: en branch income/expense, después del form integra ForecastMatcher según si la tx tiene recurrence_id o hay candidates
- [x] Nav link "Previsiones" en layout protegido
- [x] Cron `/api/cron/forecasts-missed`: GET con auth Bearer CRON_SECRET; UPDATE pending → missed donde expected_date < today − 7d; loggea solo conteo
- [x] `vercel.json`: schedule `30 14 * * *` (15 min después del FX cron)
- [x] Validación verde: typecheck + lint + 117 tests + build + `db:smoke-rls` 8/8

**Hito 4 cerrado — V1.0 funcional pendiente del Hito 5 (Dashboard + Reporte A).**

### ⏳ Hito 5 — Dashboard + Reporte A
**V1.0 funcional.**

### ⏳ Hito 6 — Reportes B + C

### ⏳ Hito 7 — Reporte D + Settings metas

### ⏳ Hito 8 — Imports con AI parser

### ⏳ Hito 9 — Export contador

### ⏳ Hito 10 — Backups Drive
**V1.1 funcional.**

---

## Decisiones tomadas en este hito

- **Tenancy m:n (`households` + `household_members`)**, no `profiles.household_id` directo. Permite invitar a un contador en V2 sin migración. Costo cero hoy.
- **Whitelist con respuesta genérica.** Email no autorizado ve el mismo mensaje que uno autorizado; no se filtra qué cuentas existen. `shouldCreateUser: false` en `signInWithOtp` complementa el invite-only del dashboard.
- **MFA TOTP gate en layout, no en middleware.** Todas las rutas con datos viven bajo `(protected)`. Sumamos un check de AAL ahí; es suficiente y más simple que un middleware global. Aceptamos que `/auth/mfa/*` haga su propio check de sesión (lo hacen).
- **Un factor TOTP por usuario, sin recovery codes en V1.** Supabase no los genera nativamente. Si pierden el device, ver el procedimiento administrativo más abajo.
- **AAL2 persiste mientras dure la sesión** (default ~1 semana en magic-link). Sin re-challenge por acción sensible. Vivir con eso en V1.
- **`verifyMfaCode` unificado** para los dos casos (verify-enroll y verify-challenge). Supabase trata ambos flujos idénticamente: un `challenge + verify` exitoso sube AAL. Una sola server action, menos duplicación.
- **El campo `totp` del `listFactors()` viene tipado solo con verificados** (`Factor<'totp', 'verified'>[]`). Los pendientes están en `all`. Lo usamos así en `enrollMfaFactor()` para limpiar unverified previos.

## Decisiones tomadas en Hito 1.A

- **Instituciones como tabla lookup** (`institutions`), no texto libre en accounts. Cleaner data, sin typos acumulados, evolución futura más fácil (ej. agregar parser config para Hito 8).
- **`household_id` denormalizado en cada tabla con datos del usuario** para RLS performance (policies con WHERE simple en vez de JOIN). Tablas derivadas (transaction_tags, forecasts, import_lines) usan EXISTS sobre el padre — simplicidad sobre performance en V1.
- **`institutions` y `fx_rates` globales** (sin `household_id`). Data pública compartida. Escritura solo via service_role (cron BCRA / seed admin).
- **Native Postgres enums** para todos los del PRD; `fx_rate_source` queda text (admite `BCRA_minorista` / `BCRA_last_available` / `manual_override` / futuras).
- **`transactions.category_id` nullable** porque las transfers no tienen categoría. App valida que `category_id` esté presente cuando `kind != 'transfer'`.
- **`accounts.owner_tag` text**, no enum. PRD usa "Nico"/"Pau"/"Hogar" como valores actuales pero acoplar la DB a nombres propios es fea decisión; validamos en Zod a nivel server action.
- **Dinero como `numeric(18, 2)`** salvo `fx_rate_used` y columnas de fx_rates que usan `numeric(18, 6)` (4 decimales de margen sobre las cotizaciones BCRA típicas).
- **`fx_rates` con PK compuesta `(date, currency_pair)`** según PRD. Sin `id` artificial.
- **`financial_goals` con `UNIQUE(household_id)`** para garantizar 1 fila por household. Sin policy DELETE — siempre debe existir tras setup inicial.
- **`amount_usd` y `amount_ars` se calculan en server action** (no en trigger). PRD lo plantea como cálculo aplicacional y nos da flexibilidad para overrides manuales sin pelearnos con un trigger.
- **Sin CHECK constraints en DB para reglas de negocio** (categorías de 2 niveles máx, transfer_pair_id en pares, month 1-12 en budgets). Validamos todo en Zod server-side. Razón: las CHECK constraints en Postgres son rígidas y poco expresivas para errores; preferimos errores tipados en server actions.

## Decisiones tomadas en Hito 4.B

- **Cross-currency match en USD equivalent.** `tx.amount_usd` ya está persistido; para el forecast, computo on-the-fly via `getFxRate(expected_date)`. Acepta el caso ARS recurrence ↔ USD transaction (y viceversa) sin asunción de moneda.
- **Filtro de match: ±10% en USD, ±5 días.** PRD §5.3 literal. Solo aplica si la transacción tiene `amount_usd > 0` (sino el filtro % no se puede computar — return []).
- **Top 5 candidates en la UI.** Cap arbitrario; en V1 raramente hay más, pero evita render largo si el match es ambiguo.
- **Cancelled vs missed son distintos.** Cancelled = user lo borró conscientemente. Missed = pasó el tiempo sin match. Ambos quedan en la DB para auditoría; ninguno se regenera salvo edit de la recurrence.
- **`syncForecasts` ya NO toca cancelled/matched/missed historics** (4.A). Si el user re-edita la recurrence, las pending del futuro se regeneran limpias; el resto queda.
- **Link y unlink usan `db.transaction`** para mantener invariante: forecast.status y tx.recurrence_id siempre coherentes.
- **Cron threshold computado en server JS** (`today - 7d` en ISO), no en SQL. Evita dependencia de la timezone de Postgres (Supabase corre en UTC pero los `date` columns no la afecta, igual mejor consistencia).
- **Cron schedule `30 14 * * *`**: 15 minutos después del cron de FX (`0 14`). Sin solapamiento ni dependencia explícita; FX corre primero por convención (forecasts en USD del día necesitan el rate fresh, pero el missed cron solo lee fechas, no rates).
- **`isNull(matchedTransactionId)`** en el query de candidatas es defensivo: si una pending por error tuviera `matched_transaction_id`, no la ofrecemos.

## Decisiones tomadas en Hito 4.A

- **Rolling 12 meses (PRD §5.3), no 3.** CLAUDE.md decía 3 pero el PRD V1.1 manda. Lo alineé en CLAUDE.md tabla de hitos.
- **`custom` frequency queda fuera del Zod V1** aunque está en el enum DB. Si el día de mañana hace falta (ej. cada 45 días), se agrega `interval` integer y se prende. Para V1 los 4 (monthly/bimonthly/quarterly/yearly) cubren los casos del PRD.
- **`computeForecastDates` función pura, sin Date timezone tricks.** Trabaja con strings ISO. Postgres `date` column lo respeta sin conversiones. Probé day 31 en feb (leap/no-leap), endDate cortando, startDate posterior al horizon → 11 tests verdes.
- **Anchor de primera ocurrencia**: si `startDate=2026-01-15` + `dayOfMonth=2`, primera = `2026-02-02` (siguiente día válido >= startDate). Si `dayOfMonth=20`, primera = `2026-01-20`. La función "busca hacia adelante" desde startDate.
- **`syncForecasts` borra solo pending futuras** (expected_date >= today). Mantiene matched/cancelled/missed history y también las pending pasadas (esas pasan a `missed` por el cron de 4.B). Re-correr no rompe nada.
- **Al pausar**: borra pending futuras. Al reactivar: regenera 12 meses. Mantiene invariante: si está inactiva, no hay pending futuras en la lista.
- **Auto-match hardcoded OFF en V1.** Sin migración a `financial_goals` todavía. Cuando se arme `/settings/metas` (Hito 7), se agrega columna `auto_match_recurrences` y el toggle.
- **Delete cascadea forecasts** (ON DELETE CASCADE) pero **NO transactions** (ON DELETE SET NULL en `transactions.recurrence_id`). Las txs históricas que estaban matched pierden el link pero la fila queda. Pérdida aceptable.
- **`_sync.ts` separado de los actions** para reuso entre create/update/set-active sin duplicar el cálculo. Tipo `Tx` derivado de `Parameters<...>` para que cambie con drizzle sin tocar el helper.

## Decisiones tomadas en Hito 3.D.2

- **Tags hard delete con CASCADE en `transaction_tags`.** No tiene `archived` en schema, así que vamos por hard delete. Antes de borrar, el `confirm()` del client muestra el count de transacciones afectadas. Race condition aceptada (el count puede ser stale por segundos).
- **`UNIQUE(household_id, name)` reportado al user como `name_taken`.** Drizzle propaga el error de Postgres con `code = '23505'`; lo trapeo en el server action y devuelvo un `fields: { name: ... }` user-friendly en lugar de "unknown".
- **Replace-strategy en update de tags m:n:** dentro del `db.transaction`, `DELETE FROM transaction_tags WHERE transaction_id = X` + `INSERT` con la nueva lista. Más simple que diffing y atómico. El costo extra de IO es despreciable (≤20 filas).
- **`db.transaction` en create.ts también.** Antes no usaba. Ahora sí, para garantizar que la transacción + sus tags entren juntos o ninguno.
- **Tags en transfers se duplican por leg.** Cada tag genera 2 filas en `transaction_tags` (una por leg). Permite filtrar consistentemente: si tildás "Pau" y filtrás por esa tag, ves ambos lados del movimiento. Si fuera una sola, depende de qué leg mirás.
- **Validación de tagIds centralizada en `_build.ts`** vía `validateTagIds`. Un solo round-trip a DB que comprueba la pertenencia al household. Si difiere el count, `invalid_refs` con error apuntando al campo `tagIds`.
- **`Input type="color"` nativo + checkbox "Asignar color"** en lugar de un picker custom. UX decente, zero deps. Para limpiar el color enviamos un input hidden `wipeColor=1` que el parser interpreta antes que el value del color.
- **Color tinted al 18% para chip seleccionado** + borde y texto del color base. Sin imagen ni íconos: solo color para diferenciar las tags entre sí.
- **Filtro por tag con `EXISTS subquery` (raw `sql\`...\``)**, no `INNER JOIN`. Evita inflación de rows (tx con 3 tags aparecería 3 veces) y compone limpio con los demás `conditions`.
- **Segunda query batch para badges.** Cargar todos los `transaction_tags` de las 50 filas visibles en una query, agrupar en `Map<txId, Tag[]>`. Un round-trip extra es invisible y mantiene el query principal simple. Alternativa con `json_agg` era poco amigable con Drizzle.
- **`tagIds` cap a 20 + dedupe en el schema.** Sanity bound vs DevTools abuse. En UX normal no se tildan 20 tags en una tx; si pasa, parsea silenciosamente solo los primeros 20 únicos.

## Decisiones tomadas en Hito 3.D.1

- **Form GET nativo, no client component con `router.replace`.** Submit explícito; UX un tick más lento pero zero JS para los filtros. Cuando termine pesando, se cambia a client sin tocar el back-end (los searchParams ya están normalizados).
- **Schema de filtros field-por-field, no schema único.** Si el user pega una URL con un kind inválido, parseamos todos los demás filtros válidos y descartamos solo el roto. Más resiliente que un `safeParse` global que falla por uno solo.
- **Reset de `page` al filtrar via "no incluir hidden page" en el form.** Submit GET solo carga lo visible; `page` vuelve al default (1). Si en el futuro un cambio agrega `page` por accidente, el bug se nota rápido (paginás con filtros que devuelven menos).
- **Dos queries (count + page), no window function.** Drizzle no expone bien `count(*) OVER ()`; mejor dos queries explícitas. A esta escala el extra round-trip es invisible.
- **`q` con `ilike` sin índice trigram.** A <10k filas es fine. Cuando duela, evaluamos `pg_trgm`. Para V1 vale la simpleza.
- **Filtro por categoría excluye transfers** porque tienen `category_id = null`. Esperado (categoría no aplica a movimientos internos). El usuario los ve dejando "Todas".
- **Buttons Prev/Next con `asChild` condicional**: si la página está al límite, render como `<span>` (deshabilitado visual + no clickable) en vez de Link, manteniendo el mismo wrapper Button.

## Decisiones tomadas en Hito 3.C

- **Convención de signo en transferencias**: pata "out" persiste con `amount_original`, `amount_usd` y `amount_ars` **negativos**. Pata "in", positivos. Mismo `transfer_pair_id` enlaza ambas. Permite `SUM(amount_usd) WHERE account_id` = balance histórico, y `WHERE kind != 'transfer'` aísla ingreso/gasto sin contaminación.
- **Cross-currency: dos montos explícitos** (`amountFrom` + `amountTo`), no un rate inventado. Refleja la realidad del MEP/CCL donde el rate efectivo difiere del BCRA. El delta queda implícito en los datos, no persiste como columna. Si V2 quiere "rate MEP", lo calcula on-the-fly.
- **Auto-sync `amountTo = amountFrom` solo cuando misma moneda y no tocado.** Implementado en el handler de onChange (no en `useEffect`) para satisfacer la regla de lint `react-hooks/set-state-in-effect`.
- **Edit reemplaza ambas filas (delete + insert dentro de `db.transaction`)** en vez de UPDATE por leg. Trade-off: `created_at` se resetea — acepto porque no usamos timestamps históricos en V1. Si en V2 hace falta auditoría, se vuelve a UPDATE por leg matcheando por signo.
- **Cuentas read-only en edit de transfer.** Cambiar las cuentas cambia la semántica del par; preferimos forzar borrar + recrear. El server tira `mismatched_accounts` si se intenta via DevTools.
- **Delete branchea por `transfer_pair_id`**: si non-null, borra ambas patas con un solo statement (`WHERE transfer_pair_id = X`). Si null, comportamiento histórico (`WHERE id = X`). El UI no distingue, solo el server.
- **Lista muestra cada leg como fila separada.** Natural para un libro contable doble — cada cuenta ve su movimiento. Si UX termina molestando, en 3.D agrupamos por `transfer_pair_id` con un toggle.
- **`ALL_KIND_LABELS` separado de `TRANSACTION_KIND_LABELS`**: el segundo es para inputs (solo income/expense aceptados por el schema). El primero suma `transfer` para display en la lista. Evita filtrar a `transactionInputSchema.kind` un valor que no acepta.

## Decisiones tomadas en Hito 3.B

- **Hard delete sin papelera.** V1 con 2 users y backups semanales (Hito 10) no necesita soft delete. Si hace falta auditoría, PITR de Supabase. Cuando llegue 3.C, el delete tiene que extenderse para borrar la pata pareja vía `transfer_pair_id` — TODO marcado en código.
- **Helper `_build.ts` compartido entre create y update.** Las dos acciones tienen la misma lógica de validar refs + calcular FX + serializar montos. Duplicarlas era ~60 líneas; el helper centraliza la única lógica de FX/Decimal del sistema.
- **Override del FX revierte a BCRA si el input queda vacío.** Es un trap UX conocido pero el predecible: si el user no retipea el override en cada edit, se va. Lo documentamos en el helper text del campo. Si se vuelve operacional, en 3.D agregamos pre-fill cuando `source === 'manual_override'`.
- **En edit, no auto-adoptar la moneda de la cuenta** si cambia la cuenta. Decisión: la moneda original es un dato histórico, no debe cambiar implícitamente. En "nueva", sí (UX más fluida).
- **Override almacena con 6 decimales** matching el `numeric(18, 6)` de `fx_rate_used`. La función `toFixed(6, ROUND_HALF_UP)` se aplica en el schema, no en el caller. Garantiza canonicalización de entrada antes del helper.
- **`DeleteTransactionButton` como client component con `confirm()` nativo**, no dialog modal. Es 1 línea en el código y suficiente para V1; un Dialog de shadcn agrega 3 archivos por una funcionalidad de seguridad menor.
- **Edit page redirige a `/transactions` si la tx es de tipo `transfer`.** El form solo soporta income/expense en 3.B. Para 3.C habrá un edit-transfer separado.

## Decisiones tomadas en Hito 3.A

- **Categorías placeholder mínimas ("Ingresos varios", "Gastos varios")** en lugar de seedear una taxonomía improvisada. La taxonomía real se cierra con Pau/Nico antes del Hito 4; cualquier nombre puesto ahora genera ruido y posibles ajustes en cascada. Las transacciones de prueba se re-categorizan cuando el edit (3.B) esté listo.
- **Amounts siempre positivos; `kind` carga la dirección.** El schema permite negativos pero los reservamos para casos específicos (correcciones puntuales). Esto hace que reportes de "total ingresos del mes" filtren por kind y sumen sin tener que mirar signos.
- **Cálculo de `amount_usd`/`amount_ars` en server action** con `Decimal`, no en trigger. Permite override manual del fx en 3.B sin pelearnos con un trigger. Aplica el helper `toMoneyString` para canonicalizar a 2 decimales.
- **Validación de refs (account + category) con queries Drizzle separadas**, no un solo JOIN. Da errores más diagnosticables por campo (account vs category vs kind mismatch). El costo es 2 round-trips contra DB en lugar de 1; aceptable para escritura humana.
- **`category.kind` debe matchear `transaction.kind`.** Evita que una categoría "Sueldo" (income) termine en una transacción tipo expense. Se chequea en server action + el form filtra el Select por kind para que ni siquiera aparezca como opción inválida.
- **Fecha futura permitida.** `getFxRate` cae a `BCRA_last_available` y la fila queda inmutable. Si la cotización real se publica después, queda divergente; aceptable, 3.B trae override manual.
- **Sin filtro UI todavía**: la lista trae 50 más recientes ordenadas por `date DESC, created_at DESC`. Filtros y paginación entran en 3.D cuando haya volumen real (post-import del Hito 8).
- **No mostramos `fx_rate_source` ni `amount_ars` en la lista.** Solo `amount_original` (en su moneda) y `amount_usd`. El source vive en DB para auditoría; el `amount_ars` se puede toggar en 3.D si hace falta.
- **`<textarea>` con clases inline** en `notes` (no se creó un componente shadcn dedicado). Un solo uso, no justifica una abstracción.
- **Nav links arriba del layout protegido**: Dashboard / Cuentas / Transacciones, sin highlight del active route todavía. Es la mínima usabilidad para no escribir URLs a mano; el highlight cuesta un client component o `usePathname` y no aporta hoy.

## Decisiones tomadas en Hito 2.C

- **API BCRA v4.0**, no v3.0. La v3 fue deprecada por el BCRA (devuelve 400 con mensaje explícito). El upgrade fue transparente para los callers porque el cliente aplana la estructura anidada `results[].detalle[]` antes de exponerla.
- **`idVariable=4` (minorista "promedio vendedor") = nuestro "minorista mid"**. El BCRA no publica comprador/vendedor separados para el minorista en esta API — solo el promedio diario informado por las entidades financieras (Com. B 9791). Es lo más cercano a "mid" disponible; el PRD lo asume así.
- **Paginación del listado: hoy ignoramos las variables fuera del primer page de 1000**. El BCRA tiene 1220 variables; las que nos importan (TC, en `Principales Variables`) caen todas en el primer 1000. Si en V2 necesitamos algo de la cola, iteramos con `offset`.
- **No tocamos la firma pública de `fetchBcraSeries()`** al migrar a v4. Los callers siguen recibiendo `BcraSeriesPoint[]` plano. El parseo del shape v4 vive solo dentro del cliente.

## Decisiones tomadas en Hito 2.B

- **Schedule diario 14:00 UTC (≈11 AR)**, no nocturno. El BCRA publica la Comunicación B durante la mañana AR; correr al mediodía nos da margen. Si llegara a fallar un día, la ventana de 7 días del lookback auto-recupera al día siguiente sin intervención.
- **Lookback de 7 días en cada corrida**, no solo del día previo. BCRA a veces publica correcciones retroactivas; reupsertar la ventana es cheap (numeric idempotente) y self-heals corridas fallidas.
- **Auth con string equality**, no `timingSafeEqual`. Bearer secret de 32 chars hex, único entry point, 2 usuarios. El ahorro de complejidad supera el riesgo de timing attack en este perfil de tráfico.
- **Drizzle `onConflictDoUpdate` en el route handler**, en vez de SQL crudo como en el backfill script. Mismo destino, pero el route vive en el lado app del proyecto y prefiere las abstracciones de Drizzle para mantenerse parejo con el resto del código server-side.
- **Route handler usa `DATABASE_URL` (pooler, transaction mode)**, no `DIRECT_URL`. Es un INSERT batch corto sin transacciones de larga duración, el pooler lo aguanta perfecto. Reutiliza `getDb()` ya cacheado.
- **`BCRA_FX_MINORISTA_VARIABLE_ID` en env**, no constante en código. Permite cambiar a mayorista (Com. A 3500) sin redeploy si el día de mañana lo necesitamos para una conciliación.

## Decisiones tomadas en Hito 2.A

- **Cliente BCRA usa fetch nativo + Zod**, sin axios ni otro wrapper. Zero deps nuevas; el shape del payload está estrictamente validado y falla rápido si la API cambia.
- **Source en `fx_rates` es texto libre** (no enum). Permite acumular variantes (`BCRA_minorista` / `BCRA_mayorista` / `manual_override`) sin migración. Validamos en Zod cuando importe.
- **Fallback marca con `BCRA_last_available` independientemente del source original** de la row reusada. Razón: el flag indica que **fue un fallback**, no la procedencia de la cotización. Si después necesitamos saber ambas cosas, agregamos un campo derivado.
- **Ventana fija de 30 días en `getFxRate`** para el lookup hacia atrás. Suficiente para findes largos, feriados y eventuales gaps de la API. Si pasaron 30 días sin cotización, algo está roto operacionalmente y queremos error explícito.
- **`getFxRate({ currency: 'ARS' })` retorna `rate=1, source='identity'`** sin tocar DB. Hace los call sites uniformes: siempre podés pedir un rate, no importa la moneda. Costo en código y runtime: cero.
- **Backfill como script CLI con flags**, no como UI ni server action. Es operacional, se corre a mano. El cron viene después y reusa el mismo cliente BCRA.
- **`idVariable` se descubre con `fx:list-vars`** en lugar de hardcodear desde docs. Reduce riesgo de hardcodear un id que la API renumeró.
- **El script de backfill usa `postgres-js` directo (no Drizzle)** siguiendo el patrón de `seed-institutions.ts`. Para UPSERTs masivos por SQL, `sql\`\`` es más simple que el query builder de Drizzle.
- **Tests solo de la función pura `resolveFxRate`.** Mockear Drizzle para testear `getFxRate` agrega complejidad sin upside hoy. Validamos `getFxRate` end-to-end con el smoke manual + el script de backfill.

## Decisiones tomadas en Hito 1.B

- **Drizzle bypassea RLS** porque la conexión va con `postgres` role (pooler). RLS queda como defensa en profundidad; la lógica de tenancy real vive en `requireHouseholdSession()` + WHERE explícito en cada query. Pattern típico en Supabase + Drizzle; alternativa (conexión con `authenticated` role + JWT claim por request) agrega complejidad sin upside hoy.
- **MFA enforcement también en server actions** vía `requireHouseholdSession()` que llama a `getMfaState()`. Costo: 1 round trip extra a Supabase por action. Beneficio: si alguien tiene cookies AAL1 y POSTea directo a una action, lo rechazamos. Defensa en profundidad sobre el gate del layout.
- **Server action de archive devuelve typed result**, pero el `<form action={…}>` server-rendered necesita `Promise<void>`. Wrap con un `'use server'` inline en la page. Alternativa (mover a client component) sería overkill para un botón sin feedback.
- **Soft delete única opción** para accounts. PRD usa `archived` flag. Hard delete rompería FKs en transactions futuras y perdería histórico. La UI lista activas por default; toggle "Todas" muestra archivadas con badge.
- **`type` y `currency_default` editables después de creación**. Riesgo bajo, ya que cambiar el tipo no muta los datos existentes (la columna es solo descriptiva). PRD no lo prohíbe.
- **`owner_tag` validado en Zod** con `['Nico', 'Pau', 'Hogar']`, no en DB. Si en el futuro cambia el roster (3er familiar, etc.), se ajusta en `lib/schemas/account.ts` sin migración.
- **Institución como Select con opción "Ninguna"** que mapea a `null`. UX más clara que un checkbox "Sin institución" + condicionalmente esconder el Select.
- **`getUser()` en cada request**, no `getSession()`, para validar el JWT contra Supabase.
- **RLS por SQL plano**, versionado en `db/policies/*.sql`. Drizzle no genera policies; las aplicamos vía script idempotente.
- **`current_household_id()` con SECURITY DEFINER + LIMIT 1.** En V1 cada user pertenece a un único household.
- **Trigger `on_auth_user_created`** crea `profiles` automáticamente al invitar; `display_name` se infiere de `email.local` y se puede editar después.
- **Next 16.2 + React 19.2 + Tailwind v4 + ESLint flat config.** Versiones más nuevas que las del PRD (que decía Next 15); decisión: tomar lo más reciente porque el create-next-app actual ya genera 16 y la diferencia con 15 es transparente para nuestro código.
- **`shadcn/ui` instalado a mano** (sin CLI) para evitar prompts interactivos. Solo `Button/Input/Label/Card/Sonner` por ahora; resto se agrega bajo demanda.
- **`postgres-js` con `prepare: false`** porque `DATABASE_URL` apunta al pooler de Supabase (transaction mode).
- **API keys nuevas de Supabase** (`sb_publishable_*` / `sb_secret_*`), no las viejas JWT (`anon` / `service_role`). Variables en código: `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_SECRET_KEY`. El SDK acepta ambas, usamos los nombres nuevos por convención del proyecto.
- **Env vars en Vercel marcadas como "Sensitive"** (las 7). Decisión: en Vercel, una vez marcadas como Sensitive no se pueden desmarcar — solo borrar y recrear. Las dejamos así; impacto operativo cero (los valores no se ven en la UI después, pero se pueden re-escribir). Las dos `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` quedaron sin Sensitive (no son secretas).
- **Scope de env vars: solo Production** para las 7 (los Preview deployments no funcionarían tal cual; cuando los usemos, hay que clonar al scope Preview). En Hobby no se puede editar el scope post-creación.

## Pendientes / a discutir
- (Pre-Hito 4) Sesión con Nico para cerrar taxonomía de categorías.
- Region Supabase confirmada: **us-west-2** (Oregon). El PRD/CLAUDE.md original decía us-east-1; cambiamos a us-west-2 al crear el proyecto. Latencia +50ms desde AR, no relevante para uso doméstico.
- **Custom SMTP** (Resend/Postmark) — considerar cuando el rate limit de 2 mails/hora del SMTP built-in moleste. Hoy con 2 users y login esporádico no es urgente. Si lo hacemos antes, sirve también para futuros mails transaccionales.

## Procedimientos administrativos

### Reset de MFA (si un usuario pierde su device)
Conectarse al pooler con `DIRECT_URL` (psql o Studio) y ejecutar:

```sql
-- 1) Identificar al user
SELECT id, email FROM auth.users WHERE email = 'nico@example.com';
-- 2) Ver factores existentes
SELECT id, factor_type, status, created_at
FROM auth.mfa_factors
WHERE user_id = '<user-id-del-paso-1>';
-- 3) Borrar todos sus factores
DELETE FROM auth.mfa_factors WHERE user_id = '<user-id-del-paso-1>';
```

Después de eso, el próximo login del user lo manda automáticamente a `/auth/mfa/enroll`.
**No registrar este SQL en consola compartida** — usar Supabase Studio o un terminal local con `DIRECT_URL`.

## Notas
- Vercel deploy: https://gd-finanzas-z4dl.vercel.app
- Repo GitHub: https://github.com/nixgore83/gd-finanzas (privado)
- Supabase project ref: `kezrkqbubupdnlhhhwdi` (us-west-2)
