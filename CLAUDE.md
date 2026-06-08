# gd-finanzas — Project Memory

> Webapp de tracking financiero familiar. Multi-moneda (ARS, USD), multi-cuenta,
> multi-jurisdicción (AR + USA). 2 usuarios fijos. Datos altamente sensibles.

## Spec autoritativa

El PRD V1.1 vive en Notion: https://www.notion.so/351933eb1d2681359971ebd831053fdc

**Antes de planear cualquier módulo nuevo, leerlo.** Si hay conflicto entre este
CLAUDE.md y el PRD, el PRD manda en lo que respecta a **reglas de negocio y scope**.
Si encontrás algo en el PRD que parece ser una regla de negocio mal definida, no la
"arregles" en silencio: avisalo y esperá decisión.

**Mantener el PRD sincronizado con la realidad.** El PRD tiende a quedar viejo a medida
que el código avanza. Cuando el Notion MCP esté disponible, mantenerlo al día es parte
del trabajo:
- Al cerrar un hito o feature no-trivial, reflejarlo en el PRD: bumpear el changelog
  (fecha + "Claude") y marcar qué quedó implementado.
- Cuando analices código del repo y detectes que el PRD divergió de la implementación
  real en algo **fáctico** (versión de stack, región, scheduling de crons, qué módulos
  existen, fuente de un dato), corregilo en el PRD y dejá nota en el changelog.
- Distinción clave: divergencias **fácticas** (cómo está hecho) se corrigen directo;
  cambios de **regla de negocio o scope** (qué debería hacer) se proponen y se confirman
  antes de escribirlos.
- Si el Notion MCP no está conectado (corrida headless/cron), anotá el pendiente de sync
  en `STATUS.md` para hacerlo cuando vuelva a estar disponible.

---

## Stack

- **Framework:** Next.js 15 (App Router) + TypeScript estricto
- **DB + Auth + Storage:** Supabase (Postgres en us-west-2)
- **ORM:** Drizzle ORM con cliente `postgres-js` (decisión: type-safety end-to-end + migraciones versionadas en Git, supera a supabase-js que se queda corto en queries complejas)
- **Auth/Storage SDK:** `@supabase/ssr` para auth y storage (Drizzle no cubre eso)
- **UI:** Tailwind + shadcn/ui
- **Validación:** Zod (schemas compartidos client/server)
- **Charts:** Recharts
- **LLM (parser de imports):** Anthropic API — `claude-sonnet-4-6` default, `claude-haiku-4-5-20251001` para modo barato (env vars `IMPORT_PARSER_MODEL_DEFAULT` / `IMPORT_PARSER_MODEL_CHEAP`)
- **FX feed:** API BCRA (gratis, oficial)
- **Backups:** Google Drive API
- **Hosting:** Vercel (Hobby tier suficiente)
- **Cron:** Vercel Cron (FX diario, backup semanal)
- **Tests:** Vitest

---

## Restricciones de seguridad — NO NEGOCIABLES

- **Nunca** commitear: `.env*`, `*.db`, `/data/`, `/exports/`, archivos con datos reales.
- **Nunca** loggear montos exactos en consola/Sentry/Vercel logs. Solo IDs y operaciones.
- **Toda** mutación pasa por validación Zod antes de tocar la DB.
- **RLS habilitado en TODAS las tablas** con datos del usuario, sin excepción.
- **API keys** (Anthropic, Google Drive OAuth, Supabase service_role) solo en Vercel env vars. Jamás en cliente.
- **MFA obligatorio** para los 2 usuarios reales en producción.
- **Nunca almacenar:** claves bancarias, contraseñas, números de tarjeta completos, credenciales de acceso.
- **Excepción documentada (decisión Nico, 2026-06-08):** los **identificadores de contraparte** de transferencias/movimientos importados (nombre, nro de cuenta, CUIL/CUIT, CBU, alias) **SÍ se persisten** deliberadamente, en `import_lines.parsed_data.counterparty` y `transactions.meta.counterparty`, para alinear info y deducible Ganancias. Quedan bajo RLS+MFA, **nunca se loguean**, y van en campo estructurado (no en texto libre / `description`). El export contador decide aparte si los enmascara. Esto reemplaza la regla previa de "nunca almacenar CBU/alias/CUIT".
- Si el parser de imports detecta **credenciales de acceso** (claves, PINs, tokens) en un PDF → **enmascarar antes de persistir**.
- Export contador (`/exports`): no persiste más de 24h en Storage.
- `.gitignore` debe bloquear cualquier archivo que parezca tener datos reales antes del primer commit.

---

## Modelo de dominio

Schema completo en §4 del PRD. Entidades core:

- `users` — 2 fijos, gestionados por Supabase Auth
- `accounts` — banco/TC/cash/broker/e-wallet, con `currency_default` e `institution`
- `categories` — jerarquía de 2 niveles, kind income/expense
- `tags` — libres, m:n con transactions
- `transactions` — la tabla central. Multi-moneda con `amount_original` + `currency_original` + `amount_usd` + `amount_ars` + `fx_rate_used` + `fx_rate_source`. Subtipos via `transaction_subtype` + `meta` jsonb.
- `recurrences` + `forecasts` — rolling 3 meses, 4 estados (`pending`/`prevista`, `vencida_sin_confirmar`, `confirmada`/`matched`, `cancelada`)
- `budgets` — categoría × mes × año en USD, sobrescribe en cada revisión
- `fx_rates` — BCRA minorista mid, cacheado
- `imports` + `import_lines` — parsing con LLM, revisión humana obligatoria
- `financial_goals` — fila única, target USD 5.700/mes ahorro, total USD 2.45M

---

## Reglas de negocio críticas

- **Dinero como `decimal(18,2)` en Postgres.** Nunca float. En TypeScript: usar string para serializar y `Decimal` (decimal.js o equivalente) para operar. Cualquier `number` en código que represente dinero es bug.
- **FX al día de la transacción**, almacenado en la transacción y **inmutable** una vez guardada. Override manual permitido con `fx_rate_source = "manual_override"`.
- **Transferencias entre cuentas no impactan ingreso/gasto.** Identificadas por `transfer_pair_id`.
- **Cuotas TC:** cargo entero el día del consumo. **No** spreadear cuotas en V1.
- **Forecasts rolling 3 meses.** 4 estados explícitos.
- **Auto-match previsiones:** OFF por default, toggle global.
- **BCRA sin cotización del día (finde/feriado):** usar día previo + flag `fx_rate_source = "BCRA_last_available"`.
- **"Deducible Ganancias" como `bool`** en transactions, no como tag.
- **Multi-tenancy: por household.** Aunque hay 2 usuarios, comparten todos los datos. RLS protege contra leak accidental fuera del household.
- **Pagos a Rabbit Hole / Tijeritas:** categoría dedicada (ej. `Inversión RH`) + tag, no entidad separada.
- **Imports broker:** solo movimientos (compra/venta/dividendo/intereses), no tenencia ni valuación. Patrimonio es V2.

---

## Convenciones

- Carpetas en `kebab-case`. Componentes React en `PascalCase`. Variables y funciones en `camelCase`.
- Server Actions en `app/actions/<dominio>/`, no inline en componentes.
- Schemas Zod en `lib/schemas/`, exportados y compartidos client/server.
- Migraciones de DB en `db/migrations/`, generadas por Drizzle, versionadas en Git.
- Strings de DB (tablas, columnas, enums) en `lowercase_snake_case`.
- Componentes UI: shadcn/ui antes que custom. Si no alcanza, lo discutimos.
- **Nunca usar `any`.** Si no sabés el tipo, preguntá. `unknown` con narrowing es OK.
- Types de DB se infieren de Drizzle, no se duplican manualmente.

---

## Anti-patrones — NO HACER

- ❌ `useEffect` para data fetching → usar Server Components o Server Actions.
- ❌ Floats para dinero → `decimal(18,2)` + Decimal.js / strings.
- ❌ Hardcodear cotizaciones → siempre vienen de tabla `fx_rates`.
- ❌ Nuevos paquetes sin justificar trade-off en mensaje de commit/PR.
- ❌ Subir archivos con datos reales al repo.
- ❌ Deshabilitar RLS "para ver mejor en desarrollo" — usar `service_role` solo en server-side jobs.
- ❌ Skipping de Zod porque "es solo internal use".
- ❌ Tipos manuales que duplican lo inferido por Drizzle/Supabase.
- ❌ Exponer `service_role` key en código cliente jamás.

---

## Comandos

- Dev: `npm run dev`
- Test: `npm test`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- DB generate (migración desde schema): `npm run db:generate`
- DB migrate (aplicar a DB): `npm run db:migrate`
- DB seed: `npm run db:seed`
- Build: `npm run build`

Antes de decir "listo" en cualquier hito: `npm run typecheck && npm test && npm run lint`.

---

## Cómo trabajamos

1. Toda feature no-trivial entra primero por **Plan Mode**. Yo apruebo el plan antes de que escribas código.
2. Tras implementar, correr typecheck + tests + lint.
3. Si tocás schema de DB: generar migración Drizzle, aplicarla local, avisar.
4. Cierre de cada hito: actualizar `STATUS.md` con qué quedó hecho, qué falta, decisiones tomadas, cosas a discutir conmigo o con Pau. **Y sincronizar el PRD en Notion** (changelog + divergencias fácticas), según la sección "Spec autoritativa".
5. Sesión nueva: leer este `CLAUDE.md`, leer `STATUS.md`, leer el PRD si la sesión toca módulo nuevo.
6. Si dudás de una regla de negocio: releer PRD. Si el PRD no resuelve, **preguntar antes de improvisar**. Defaults razonables solo para decisiones internas de implementación, nunca para reglas de negocio.

---

## Hitos del proyecto

| # | Hito | Output |
|---|---|---|
| 0 | Setup | Next.js + Supabase + Vercel + login funcional + CLAUDE.md + STATUS.md |
| 1 | Modelo base + cuentas | Schema completo, CRUD de cuentas, seed de instituciones |
| 2 | FX feed BCRA | Cron diario, caching, helper `getFxRate(date, ccy)` |
| 3 | Transacciones manuales | Form alta + lista + edit + delete + transferencias |
| — | (Sesión de categorías con Nico antes del Hito 4) | Taxonomía cerrada |
| 4 | Recurrencias + previsiones | Forecasts rolling 12 meses + confirmación 1-click |
| 5 | Dashboard + Reporte A | Budget mensual + cashflow real vs budget — **V1.0 funcional** |
| 6 | Reportes B + C | Donut por categoría + evolución 12 meses |
| 7 | Reporte D + Settings metas | Año económico + bloque "Trayectoria a IF" |
| 8 | Imports con AI parser | Galicia Amex como primer caso |
| 9 | Export contador | .zip con 5 CSVs |
| 10 | Backups Drive ✅ | Cron semanal — **V1.1 funcional 🎉** |

Deadline funcional: **review de octubre 2026**, primera revisión semestral del plan financiero con webapp andando.

---

## Plan financiero (referencia para Reporte D)

Validado con Pau el 2026-05-05.

- Target ahorro mensual: **USD 5.700**
- Edad target IF: Nico 58 / Pau 60 (año 2041)
- Número retiro: USD 2.230.000
- Educación: USD 150.000 (3 hijos × USD 50k AR privada)
- Buffer: USD 72.000
- **Total target: USD 2.450.000**
- Reviews: oct-2026 (primera con webapp), semestrales, 2033 (50), 2041.

Estos números viven en la tabla `financial_goals` y son editables desde `/settings/metas`.

---

## Glosario

- **IF** — Independencia Financiera. Patrimonio que permite vivir de su rendimiento.
- **MEP / CCL** — modos legales de comprar USD en Argentina (Mercado Electrónico de Pagos / Contado Con Liquidación).
- **Monotributo** — régimen fiscal simplificado AR. Nico está en proceso de alta.
- **SRL** — Sociedad de Responsabilidad Limitada. Estructura legal de Rabbit Hole.
- **Bienes Personales** — impuesto patrimonial AR.
- **Ganancias** — impuesto a la renta AR.
- **BCRA** — Banco Central de la República Argentina (publica el FX oficial).
- **Rabbit Hole** — SRL de Nico, hoy genera costos no ingresos.
- **Tijeritas** — segundo proyecto de Nico, ingresos proyectados desde mediados de 2026.
