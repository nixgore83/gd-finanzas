# STATUS.md — gd-finanzas

> Estado vivo. Se actualiza al cierre de cada hito.
> Sesión nueva: leer `CLAUDE.md`, leer este archivo, leer el PRD V1.1 (Notion) si la sesión toca un módulo nuevo.

**Última actualización:** 2026-05-14 por Claude

---

## Hito en curso
**Hito 1 — Modelo base + cuentas** (🟡 schema + RLS aplicados ✅; falta CRUD de cuentas + seed instituciones — Hito 1.B)

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

### 🟡 Hito 1 — Modelo base + cuentas

**1.A — Schema + RLS (2026-05-14, hecho):**
- [x] 13 tablas Drizzle en `db/schema/*` (un archivo por entidad): institutions, accounts, categories, tags, transaction_tags, transactions, recurrences, forecasts, budgets, fx_rates, imports, import_lines, financial_goals
- [x] 11 pgEnums en `db/schema/enums.ts` (currency, account_type, category_kind, transaction_kind, transaction_subtype, transaction_source, recurrence_frequency, forecast_status, import_type, import_status, import_line_status)
- [x] Migración `0001_parallel_groot.sql` generada y aplicada (349 líneas, FKs e índices incluidos)
- [x] RLS policies `0002_v1_core_rls.sql` aplicadas: tablas household-scoped (accounts/categories/tags/transactions/recurrences/budgets/imports/financial_goals) usan `current_household_id()`; tablas derivadas (transaction_tags/forecasts/import_lines) via EXISTS sobre el padre; institutions y fx_rates con SELECT abierto a authenticated y escritura solo service_role
- [x] Triggers `set_updated_at` en accounts/categories/recurrences/transactions/financial_goals (reusa función existente del Hito 0)
- [x] Helper money: `lib/schemas/money.ts` con `toMoneyString`, `parseMoney`, `moneySchema`, `positiveMoneySchema` usando `decimal.js` y `ROUND_HALF_UP` (13 tests)
- [x] Script smoke RLS: `npm run db:smoke-rls` (8/8 ok)
- [x] Validación verde: typecheck + lint + 28 tests + build

**1.B — CRUD cuentas + seed instituciones (pendiente):**
- [ ] Seed inicial de `institutions` (Galicia, ICBC, HSBC US, Balanz, Cocos, BNA según PRD §12)
- [ ] Form alta/edit account (server action + Zod schema + UI shadcn)
- [ ] Lista de accounts con archive/unarchive
- [ ] Página `/accounts` bajo `(protected)`
- [ ] Smoke manual: crear cuenta con cada `account_type`, archivar, editar

### ⏳ Hito 2 — FX feed BCRA
Cron diario, caching, helper `getFxRate(date, ccy)`.

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
