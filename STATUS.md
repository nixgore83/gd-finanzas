# STATUS.md — gd-finanzas

> Estado vivo. Se actualiza al cierre de cada hito.
> Sesión nueva: leer `CLAUDE.md`, leer este archivo, leer el PRD V1.1 (Notion) si la sesión toca un módulo nuevo.

**Última actualización:** 2026-05-17 por Claude

---

## Hito en curso
**Hito 2 — FX feed BCRA** (código completo, API v4 validada, pendiente backfill + activación en Vercel)

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

### 🟡 Hito 2 — FX feed BCRA

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

**2.D — Pendiente (operacional, fuera de código):**
- [ ] Setear `BCRA_FX_MINORISTA_VARIABLE_ID=4` y `CRON_SECRET=$(openssl rand -hex 32)` en `.env.local` y en Vercel (Production scope, marcar Sensitive el secret)
- [ ] Backfill inicial: `npm run fx:backfill -- --variable 4 --from 2026-01-01 --to 2026-05-17`
- [ ] Smoke manual de `getFxRate` (USD día con cotización, USD sábado → fallback `BCRA_last_available`, ARS → identity rate=1)
- [ ] Push y deploy a Vercel para registrar el cron de `vercel.json`
- [ ] Primer disparo del cron: verificar response 200 + filas nuevas en `fx_rates` + log "[cron/fx] upserted N puntos"

### ⏳ Hito 3 — Transacciones manuales
Form alta + lista + edit + delete + transferencias.

### ⏳ (Sesión categorías con Nico antes de Hito 4)
Cerrar taxonomía.

### ⏳ Hito 4 — Recurrencias + previsiones

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
