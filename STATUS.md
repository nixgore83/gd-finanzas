# STATUS.md — gd-finanzas

> Estado vivo. Se actualiza al cierre de cada hito.
> Sesión nueva: leer `CLAUDE.md`, leer este archivo, leer el PRD V1.1 (Notion) si la sesión toca un módulo nuevo.

**Última actualización:** 2026-05-14 por Claude

---

## Hito en curso
**Hito 0 — Setup** (🟡 deploy a Vercel hecho, falta confirmar smoke test del magic link en prod)

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
- [ ] **Smoke test producción del magic link** — pendiente por rate limit del SMTP built-in de Supabase (2 mails/hora). Reintentar después del 2026-05-14 ~13:00 ART. Verificar que el link del mail tenga `redirect_to=https://gd-finanzas-z4dl.vercel.app/auth/callback` (con el path, no solo el dominio raíz).

### ⏳ Hito 1 — Modelo base + cuentas
Schema completo (accounts, categories, tags, transactions, ...), CRUD de cuentas, seed de instituciones. **Bloqueante:** habilitar MFA TOTP antes de cargar datos reales.

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
- **MFA diferido a Hito 1** — bloqueante antes de cargar datos reales.
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
- (Pre-Hito 1) Habilitar MFA TOTP en Supabase + UI de enrollment.
- (Pre-Hito 4) Sesión con Nico para cerrar taxonomía de categorías.
- Region Supabase confirmada: **us-west-2** (Oregon). El PRD/CLAUDE.md original decía us-east-1; cambiamos a us-west-2 al crear el proyecto. Latencia +50ms desde AR, no relevante para uso doméstico.

## Notas
- Vercel deploy: https://gd-finanzas-z4dl.vercel.app
- Repo GitHub: https://github.com/nixgore83/gd-finanzas (privado)
- Supabase project ref: `kezrkqbubupdnlhhhwdi` (us-west-2)
