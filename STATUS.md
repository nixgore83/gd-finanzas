# STATUS.md — gd-finanzas

> Estado vivo. Se actualiza al cierre de cada hito.
> Sesión nueva: leer `CLAUDE.md`, leer este archivo, leer el PRD V1.1 (Notion) si la sesión toca un módulo nuevo.

**Última actualización:** 2026-06-26 por Claude

---

## Hito en curso
**PRD V1.1 completo + en producción. Mejoras UX: panel de pendientes + pantalla de imports.**

### Sesión 2026-06-26 — Módulo Calendario de Licitaciones (feature de Pau, Opción A)

Nuevo módulo `/licitaciones`: Pau sube PDFs de avisos de licitaciones primarias, se procesan con
Claude y se descarga el Excel del calendario semanal. **Dominio ajeno a finanzas** — reusa infra
(auth, RLS, Storage, patrón de jobs de `imports`) pero queda autocontenido/extraíble.

- [x] **Decisión arquitectónica: Opción A** (microservicio Python, no reescritura TS). Confirmado
  leyendo `procesar.py`: la generación del Excel está calibrada a quirks de openpyxl (reset de estilos
  por celda, round-trip del `template.xlsx`); ExcelJS round-trippea distinto → riesgo de fidelidad. Se
  reusa el script entero envuelto en FastAPI.
- [x] **DB:** tabla `licitaciones_jobs` (estados uploaded→processing→done→error + `processing_started_at`
  para el reaper), enum `licitaciones_job_status`, **migración `0018`** idempotente + RLS household-scoped
  (hand-written, estilo 0013–0017). **Falta aplicar a prod (Nico/MCP).**
- [x] **Lado gd-finanzas** (branch `feat/licitaciones-calendario`): schemas Zod, `lib/licitaciones`
  (storage bucket `licitaciones`, client del microservicio con auth Bearer + timeout 280s, process-internal
  async, stale 10 min), 3 server actions (create/process/get-download-url), UI completa (lista + historial +
  upload + detalle con polling 4s + descarga/reintentar), cron reaper `reap-stale-licitaciones` (`30 12 * * *`),
  sección en el sidebar. Bucket agregado a `setup-storage.ts`.
- [x] **Microservicio** (repo aparte `../licitaciones-service`): FastAPI `POST /procesar` + `/health`,
  `procesar.py` con refactor mínimo (modelo por env, extracción desde bytes, `procesar_en_memoria`),
  Dockerfile + requirements + README. Devuelve el xlsx binario; **Next lo sube a Storage** (el
  `SUPABASE_SECRET_KEY` nunca sale de Vercel). Modelo default `claude-sonnet-4-5` (parametrizable).
- [x] **Verificación:** typecheck + lint + **434 tests** verdes; `py_compile` OK.
- **Pendientes (Nico):** aplicar migración `0018`; crear bucket `licitaciones` (`npm run storage:setup`);
  deployar microservicio (Railway/Render) + setear `LICITACIONES_SERVICE_URL` / `LICITACIONES_SERVICE_SECRET`
  en Vercel; sumar email de Pau a `ALLOWED_EMAILS` + household; PR + merge.
- **PRD:** sincronizado (changelog + módulo agregado como implementado, pendiente de deploy).

### Sesión 2026-06-13 — Limpieza de duplicados por imports solapados (ICBC CC + caja de ahorro 0926)

Nico reportó movimientos duplicados en la **cuenta corriente ICBC** (`0905/02100757/27`, `fb46fa8e`)
y meses "pendientes" fantasma. Diagnóstico: la misma cuenta entró por **varios imports que se solapan**.

- [x] **Causa raíz CC:** la CC se importó por 2 PDFs angostos (`EXT (3/2).DE.MOVIMIENTOS-5727`, ene/feb)
  + el **CSV consolidado** `347a6ae9` (atado a la caja de ahorro, confirmado después) que al confirmar
  creó las patas CA↔CC en la CC. El match-al-confirmar no dedupeó porque las copias PDF eran `expense`
  o transfer con fecha corrida 1 día. Resultado: 4 movimientos ×2.
- [x] **Limpieza CC (SQL vía MCP, transacción atómica):** borradas **8 transacciones** (4 copias PDF +
  1 pata dup en la 0926 + 2 patas de marzo mal-ruteadas que en realidad eran del extracto USD 0413);
  desvinculadas+`rejected` 4 líneas de import; las 2 contrapartes del 0413 quedaron como transfer suelto;
  agregado el `IMP 0,33` del 09/06 que faltaba (manual). **Verificado: la CC quedó EXACTA a la captura del
  banco — 12 movimientos, débitos 166,31 / créditos 185,00.** `transaction_count` recomputado en los imports tocados.
- [x] **Dedup caja de ahorro ICBC 0926 (`de1a10b2`) — RESUELTO (reconciliación quirúrgica contra verdad externa).**
  Nico bajó el **listado completo del homebanking** (`0926.csv`, 380 movimientos todo 2026, débitos
  217.997.247,39 / créditos 217.915.207,18). Se cargó a una tabla de staging y se reconcilió la app (que tenía
  **423** txns de 7 imports solapados + estaba **incompleta**) contra esa verdad por `(fecha, monto, D/C)`:
  354 calzaban, 69 sobraban (duplicados de los PDFs AV/Galicia/parciales + 6 fechas corridas), **20 faltaban
  de verdad** (13 de jun 9–12, posteriores a los imports viejos). **Decisión Nico: método quirúrgico** (no rebuild,
  porque el rebuild orfanaba **182 contra-patas en 6 cuentas** — broker/Galicia/MP/tarjetas/cash/CC). Operación
  atómica (SQL vía MCP, con backup previo): borradas las 69 excedentes (conservando la copia **con contraparte**),
  desapareadas las 14 contra-patas same-import en otras cuentas (sin borrarlas, como el 0413), insertados los 26
  faltantes categorizados con las reglas reales del parser (`classifyIcbcConcept` + `detectTransfers` + fx BCRA del día).
  **Verificado: la 0926 quedó EXACTA al banco — 380 movimientos, 0 sobran / 0 faltan, totales idénticos.** Estado:
  192 transfers, 47 ingresos, 141 gastos, 4 sin categorizar, 84 con contraparte.
  - **Pendientes menores de esta limpieza:** (a) ~150 "TRANSF. MOBILE/E-BCOS" a personas quedan como `transfer`
    (comportamiento del `detectTransfers`); si alguno es gasto real, reclasificar en la UI. (b) 14 contra-patas
    desapareadas en Galicia/broker/MP/tarjetas/cash quedaron como transfer suelto → se limpian en la reconciliación
    propia de cada cuenta. (c) 3 `TR.xxx A 0905…` entraron como gasto (fiel al parser) pero son transfers a la caja
    USD → revisar. (d) 6 movimientos con fecha corrida perdieron su nombre de contraparte al reubicarse.
- [x] **Feature — marcar meses "sin movimientos" (gaps fantasma) — IMPLEMENTADO** (branch `feat/skip-no-movement-months`).
  La queja original de Nico: la CC marcaba mar/abr/may como pendientes aunque no hubo movimientos. **Migración `0017`**
  (tabla `account_skipped_months` = household+account+`year_month`, PK account+mes, **RLS household-scoped**, aplicada a
  prod vía MCP, `.sql` versionado). `detectImportGaps` carga los meses marcados (1 query/household) y los excluye de
  `missingMonths`; `computeMissingMonths` toma un set `skipped` (testeado). Server actions `markMonthNoMovements` /
  `unmarkMonthNoMovements` (Zod + household scoping). UI: en "Resúmenes faltantes" de `/imports`, cada mes faltante es
  un chip con botón "sin mov." (`GapMonthChip` cliente) que lo marca y lo saca del aviso. `/pendientes` y el badge del
  sidebar usan el mismo helper → se arreglan solos. typecheck + lint + **407 tests** verdes. **Falta: PR + merge (Nico).**
- [x] **Caja de ahorro USD 0413 (`f627454d`) — RECONCILIADA contra verdad externa.** Nico bajó el listado del
  homebanking (`0413.csv`, 27 movimientos USD). Aclaró 2 cosas: el `TR.7620783 -25 USD` **no era mal-parseo** (es
  un traspaso **cross-moneda** real: 25 USD salieron del 0413 ↔ 34.000 ARS entraron al 0926); y el 558,60 estaba
  **triplicado** (3 imports). Reconciliación quirúrgica: borrados 6 excedentes (558,60 ×2, 1043,36 dup, 3 fechas
  corridas), insertados 10 faltantes (may/jun no importados + las 3 fechas corregidas) categorizados (transfers,
  fx USD→ARS). **Verificado: 27 USD reales = la verdad, 0 sobran / 0 faltan.**
  - **Nota de proceso:** un filtro `imp <> '93f28c1e'` trató `NULL` como excluido → el insert se re-ejecutó 3×
    (30 filas); se dedupeó dejando 1 set de 10. Lección: usar `IS DISTINCT FROM` con columnas nullable.
  - [x] **8 consumos de tarjeta mal-ruteados → movidos a Master Galicia · Nico (decisión Nico).** El import `93f28c1e`
    estaba mal atado a la caja USD (y mal etiquetado como ICBC); sus 8 consumos (MERPAGO/SODIMAC/MOVISTAR/GOOGLE,
    con cuotas, ya categorizados) se re-apuntaron a la **Master Galicia de Nico** (`c65ddc18`) — txns + el import
    (institución corregida a Galicia). El 0413 quedó limpio en 27 USD. Quedan los 2 transfers del 0413
    que se desaparearon en la limpieza de la CC (`e87e5bcd` MEP 558,60, `c982792a` TR -25): el MEP era una de las
    copias del 558,60 triplicado (ya resuelto); el TR -25 es real (cross-moneda) y quedó como transfer suelto, OK.
- [ ] **PENDIENTE — Gaps fantasma (feature):** la CC marca mar/abr/may como pendientes aunque no hubo
  movimientos. Decisión Nico: **marcar a mano un mes/cuenta como "sin movimientos"** (esquema + UI + cableado
  en `detect-gaps`). El fix del item-2 (consolidado tapa meses vacíos) no cubre cuentas importadas como PDFs
  mensuales angostos. Plan Mode antes de implementar.

### Sesión 2026-06-11 — Backlog de feedback completo (items 1–14, branch `feat/imports-backlog`)

Implementación de TODO el backlog levantado del feedback de Nico (sesión 2026-06-10,
items 1–13 reconstruidos del transcript + item 14 pedido hoy). Decisiones de negocio
confirmadas con Nico al inicio: gaps por período de imports / doméstico en la review +
deducible aprende por contraparte con fallback categoría / candidatos de previsión
siempre visibles (el toggle solo gobierna el auto-match al confirmar) / en transfers
el TAG es el clasificador.

- [x] **Items 1/5/6/7/12 — quick wins review:** borrar import desde el detalle + acciones
  de lista siempre visibles; motivo de rechazo por línea (auto-dup vs manual); rechazadas
  solo "Des-rechazar" (sin editar); "Volver a pendiente" en lote (rechazadas seleccionables);
  selector de categoría oculto en transfers; rename "Sin contraparte"→"Cuenta destino sin asignar".
- [x] **Item 2 — gaps:** cobertura = período de imports confirmados ∪ meses con líneas
  (helpers puros + 10 tests). Un consolidado ene–jun ya no marca "faltante" un mes sin
  movimientos. Aplica retroactivo.
- [x] **Item 9 — lista estable:** al primer cambio se congela el set visible; ediciones
  in-place sin refiltrar/reordenar (filas que dejan de matchear quedan atenuadas);
  "Recargar lista" / cambiar filtro / reordenar recomputan.
- [x] **Transversal + item 13 — identidad de contraparte:** helper canónico único
  `lib/imports/counterparty-identity.ts` (CUIT/CBU/cuenta/alias, fallback nombre
  normalizado). Propagación intra-import: tras categorizar/etiquetar, toast ofrece
  aplicar a las hermanas pending de la misma contraparte (`bulkSetCounterpartyLabel` nueva).
- [x] **Items 3+10 — EPIC captura fiscal:** deducible + tags + servicio doméstico
  capturables en la review (panel de edición + bulk + badges); `confirm.ts` los persiste
  (antes hardcodeaba false/[]/standard → el export contador salía vacío). Sugerencia
  aprendida por contraparte (`lookupCounterpartyHistory` extendido + `enrichLineWithHistory`
  puro). **Tags también en transfers** (ahí son el clasificador).
- [x] **Item 4 — previsiones en review:** candidatos por línea (cuenta+kind+±5d+±10% USD)
  al abrir el editor, badge "Previsión"; `confirm.ts` linkea el forecast elegido si sigue
  pending (ignora si otra tx lo matcheó).
- [x] **Items 8+14 — cuenta destino por refs + match con tx existente:** **migración `0016`**
  (`accounts.transfer_refs` jsonb, aditiva, **aplicada a prod vía MCP**, journal registrado);
  las refs se APRENDEN al confirmar transfers y el parse auto-resuelve la cuenta destino
  cuando matchea exactamente una. En la review, una línea transfer muestra si matchea una
  transacción ya existente (regla de #44) con banner + pre-carga de cuenta destino.
- [x] **Transversal — "↻ Re-sugerir pendientes":** pase no-destructivo que re-aplica todo
  el aprendizaje SOLO sobre líneas pending (no pisa ediciones) → los imports en curso
  (ICBC `347a6ae9`, Galicia `e36d50d2`) se benefician sin re-parsear.
- **Validación:** typecheck + lint + build + **375 tests** verdes (345→375).
- [x] **Cierre (2026-06-11):** PR **#50** mergeado a `main` (commit `0db0dcd`) y deployado a
  prod (READY). **Sync PRD Notion hecho como changelog v1.11** — reglas de negocio nuevas:
  captura fiscal en review, tag-clasificador en transfers, cobertura de gaps por período,
  link de previsión en review.
- [ ] **Pendiente (Nico):** smoke en prod (revisar un import en curso end-to-end con los
  campos fiscales nuevos).

### Sesión 2026-06-11 (bis) — Bulk de contraparte en la review (branch `feat/bulk-counterparty`)

- [x] Barra azul: bloque "Contraparte" — combobox con etiquetas conocidas (historial de
  transacciones + las del import) con texto libre, aplica `counterparty.label` a las
  seleccionadas. **Crea `{label}` en líneas sin counterparty parseado** (decisión Nico:
  sin inventar identificadores — solo-label no entra al matching, test que lo fija).
  `bulkSetCounterpartyLabel` ahora hace coalesce-create; no cambia status (metadata).
- [x] Editor inline: campo "Etiqueta contraparte" siempre visible (antes oculto si el
  parser no extrajo contraparte); el preprocess del schema ya limpiaba el caso vacío.
- [x] Helper puro `mergeCounterpartyLabels` + 5 tests (381 verdes). Typecheck + lint OK.
- [x] **Cierre (2026-06-11):** PR **#53** mergeado a `main` (commit `d698672`, reemplazó al
  #51 que GitHub cerró al borrarse su base tras el merge de #50) y deployado a prod (READY,
  suite 412 sobre `main`). **Sync PRD Notion hecho como changelog v1.12** (bulk de
  contraparte + counterparty solo-etiqueta sin identidad; categoría "Donaciones" PR #48).
- [ ] **Pendiente (Nico):** smoke manual en prod: bulk sobre líneas sin contraparte de un
  resumen TC.

### Sesión 2026-06-11 — Multi-sort acumulativo en los listados (branch `feat/multi-sort-listados`)

Pedido de Nico: poder ordenar por varios criterios a la vez (ej. nombre primario + fecha
secundaria). Decidido: **click reemplaza** (la "limpieza" es automática), **Shift+click
acumula** (orden de click = prioridad, máx. 3), click en columna activa invierte su
dirección. Indicador: flecha + superíndice de prioridad. Aplica a las **4 tablas**.

- [x] **Núcleo compartido `lib/sorting/`** (nuevo): `criteria.ts` (`SortCriterion`,
  `applySortClick` puro), `url.ts` (`sort=date:desc,amount:asc` en un solo param, con
  retrocompat de links viejos `?sort=x&dir=y`), `compare.ts` (comparador encadenado con
  factories por campo — permite reglas que no se invierten con la dirección). 22 tests.
- [x] **`SortableHeader` v2** (firma nueva `criteria`/`onSort(field, additive)`, genérico,
  shift detection, superíndices, `select-none`). Migrados los 4 call sites de una.
- [x] **Server-side** (`/transactions`, `/imports`): `parseSortParam` reemplaza los `z.enum`,
  `orderBy` por mapa de columnas + spread (tiebreaker `createdAt desc` se mantiene al final),
  `sort-config.ts` por ruta. El param `dir` legacy se lee pero ya no se escribe.
- [x] **Client-side**: review de import → `lib/imports/review-sort.ts` (conserva la regla
  "sin categoría siempre arriba" en ambas direcciones); budget → `lib/budgets/sort.ts`
  (multi-sort dentro de cada nivel, jerarquía padre/hijos intacta, des-duplica el sort viejo).
- **Suite 346→375** (+29). Typecheck, lint y `next build` verdes. Sin migraciones.
- PRD: no se toca (mejora de UX de implementación, no regla de negocio).

### Sesión 2026-06-11 — Transfers no detectados en import ICBC manual + regla DEBIN→MP (PR #47)

Nico reportó que "TRANSF. ACC.B." (transfer a Galicia) no venía marcada como transfer en el
import `347a6ae9`. Causa: ese import fue la **carga manual ad-hoc por SQL** (sesión
2026-06-10), que nunca pasó por `parse-internal` → `detectTransfers()` no corrió (el pipeline
real sí la habría marcado: `\bTRANSF\b` matchea).

- [x] **Corrección de datos (SQL vía MCP):** 80 líneas `pending` del import marcadas
  `isTransfer: true` aplicando los mismos patrones de `detect-transfers.ts` (TRANSF. MOBILE
  ×30, E/BCOS-ONLINE ×22, DEBIN ×13, ACC.B. ×11, PUSH ×3, TRF.DATANET ×1). Las `edited`
  (marcas manuales de Nico) no se tocaron.
- [x] **Regla de negocio nueva (confirmada con Nico):** `DEB PREA DEBIN 30703088534` (CUIT
  Mercado Libre) = fondeo de la billetera propia → transfer a **Mercado Pago**. Las 13 líneas
  ya tienen `transferAccountId` asignado por SQL; **PR #47** codifica la regla en
  `classifyIcbcConcept` (hint `transferAccountName: 'Mercado Pago'`) + test. Suite 346 verde.
- **Pendiente (Nico, en la UI de review):** asignar cuenta destino a las otras 67 líneas
  transfer (ACC.B. → Galicia, etc.) con filtro Transfers + bulk, y confirmar.

### Sesión 2026-06-10 — Naming/display de cuentas estructurado + helper único (branch `feat/account-naming`)

El campo `accounts.name` venía metiendo a mano institución + tipo + dueño (ya campos
estructurados aparte) → nombres redundantes e inconsistentes ("Caja Ahorro" vs "Caja de
Ahorro" vs "CA", "CC", "TC"), duplicados por dueño indistinguibles, y **cada vista armaba el
label distinto** (no había un formateador único). Rearmado completo, decidido con Nico.

- [x] **Modelo nuevo.** Display canónico **`Institución Producto · Dueño · Moneda`**
  (ej. `Galicia Visa · Nico · ARS`). Producto = marca para TC / "Caja de ahorro" /
  "Cuenta corriente" / "Inversiones" (broker) / "Efectivo" (cash) / nada (ewallet). `name`
  se repurposea a **"rótulo"** opcional (casi siempre vacío; solo distinciones que ningún
  campo captura, ej. Balanz "Argentina"/"Internacional").
- [x] **Migración `0015`** — enum `card_brand` (`visa`/`master`/`amex`) + columna nullable
  `accounts.card_brand` (solo TC). Aditiva. **Aplicada a prod vía Supabase MCP** (idempotente,
  `CREATE TYPE`/`ADD COLUMN IF NOT EXISTS`); el `.sql` queda versionado en `db/migrations/`.
  Como 0013/0014, el journal de Drizzle no la registra (un `db:migrate` futuro es no-op).
- [x] **Helper único `lib/accounts/format.ts`** (`formatAccount`, puro, 10 tests con las 28
  cuentas reales + colisiones). Opciones `withInstitution`/`withOwner`/`withCurrency` para
  contextos donde una parte es redundante (lista agrupada por institución, etc.).
- [x] **Zod + form.** `card_brand` opcional con `superRefine` (solo `credit_card`); `name`
  pasa a opcional (default `''`). Form de cuenta: campo "Marca" condicional a TC + label
  "Rótulo (opcional)" con helper text.
- [x] **Cableado en TODOS los call sites** (antes improvisaban): forms de transacción /
  transferencia / recurrencia, sus loaders (`+ institutionName/type/cardBrand`, join
  `institutions`), filtros y tabla de `/transactions` (búsqueda ahora también por institución),
  filtro de `/imports`, review de import (selector de cuenta + contraparte), upload multi-archivo,
  snapshot de patrimonio (saldos + dropdown broker), `/settings/gmail`, detalle de transacción.
- [x] **Consumidores no-UI blindados** (se romperían al vaciar `name`): el matcher de
  `transferAccountName` en `parse-internal` ahora keya por `formatAccount(...,{sin dueño/moneda})`
  (= "ICBC Inversiones"/"Galicia Visa", la forma que emiten los parsers); routing multi-cuenta
  del cron Gmail (`attachment-router`) desambigua por `card_brand` en vez de `name`; export
  Ganancias y `detect-gaps` componen el nombre con `formatAccount`; `_transfer-candidates` y
  `load-snapshot-detail` idem.
- [x] **Limpieza de datos (SQL vía MCP):** 10 TC con su `card_brand` (incl. **HSBC US TC =
  Master**, decisión Nico), `name=''` en 26 cuentas, rótulo conservado en las 2 Balanz Hogar USD.
  **Verificado: las 28 cuentas dan display único.** Decisiones Nico: brokers muestran
  "Inversiones" (no chocan con CA/CC); Master Meli → `Mercado Pago Master`.
- **Validación:** typecheck + lint + **345 tests** verdes. **Sin migraciones nuevas además de 0015.**
- [x] **Cierre (2026-06-11):** PR **#45** mergeado y deployado a prod (commit `c31833c`, deploy
  READY). Smoke HTTP OK (login 200, rutas protegidas 307→/login, sin 5xx). **Sync PRD Notion
  hecho como changelog v1.10** (v1.9 ya lo había tomado la sesión de transferencias): §4.1
  con `card_brand` + `name`=rótulo opcional + nota de la convención de display.
- [ ] **Pendiente (Nico):** smoke visual en prod con sesión (ver `Galicia Visa · Nico · ARS`
  en listas/forms/imports).

### Sesión 2026-06-10 — Transferencias de doble lado: match-al-confirmar + linkeo manual + UI de review

Trabajo en worktree aislado (`feat/transfers-match-confirm`), en paralelo con otro agente
(branch galicia-xlsx). Dos features + una corrección de datos.

- [x] **Review de imports usable con cientos de filas** (PR #41, branch `feat/imports-review-filter-bulk`):
  filtros client-side (texto + chips categoría/tipo/estado), "seleccionar todo lo filtrado",
  paginación (50/pág) y categoría inline por fila. Disparado por el import ICBC CA ARS (367 líneas).
- [x] **Pre-categorización del import ICBC CA ARS (`347a6ae9`)** por SQL: 94 líneas FCI/pago-TC
  marcadas transfer con contraparte (FCI→ICBC Inversiones, pagos→ICBC Visa/Master); ICBC CC
  (`0905/02100757/27`) reconocida (era cuenta existente) y 6 traspasos CA↔CC marcados transfer.
- [x] **Match-al-confirmar (transferencias de doble lado).** Problema: `confirmImport` creaba
  **siempre las 2 patas**, pero casi todas las cuentas se importan → la misma transferencia
  quedaba 2 veces (infla saldo/net worth). Nuevo flujo en `confirm.ts` (rama transfer):
  crea solo la pata propia y, si la contraparte ya tiene una pata-transfer sin parear
  same-currency (monto+fecha, 1 sola) → **parea** en vez de duplicar; same-ccy sin match →
  crea ambas (FCI/cash/pago-TC, el otro lado no se importa); **cross-currency** → pata propia
  sin parear (no se puede matchear por monto). Helpers puros nuevos en `_build-transfer.ts`
  (`buildSingleTransferLeg`, `transferDirection`, `resignAmount`, `selectSameCurrencyTransferMatch`).
- [x] **Linkeo manual** (`linkAsTransfer` + `_transfer-candidates` + `TransferLinker` en el
  detalle de transacción): para cross-currency/ambiguos, lista candidatos de otra cuenta en
  sentido opuesto (±7 días) y los parea conservando moneda/monto de cada pata (compra de USD).
  El detalle de una pata sin parear ya no redirige: ofrece linkearla.
- [x] **Limpieza one-time:** 5 transferencias USD que ya estaban duplicadas en `transactions`
  confirmadas (cada una en 2 pares idénticos) → borrado 1 par por grupo (10 patas). Saldos
  corregidos y verificados (ej. Galicia CA USD 952,16→476,08). 0 duplicados restantes.
- **Sin migraciones.** Suite 309→**318** (tests puros del matcher/dirección/re-signo).
- [x] **Sync PRD Notion:** changelog **v1.8** + regla de conciliación de transferencias en §4.3.

### Sesión 2026-06-10 — CSV completo de ICBC: carga manual + parser determinístico

El CSV de **movimientos completos** de ICBC homebanking (caja de ahorro ARS, todo 2026)
nunca entraba: se mandaba al LLM y un archivo grande se pasaba del límite de la función /
truncaba por `max_tokens`. Los PDFs de movimientos (`EXT.DE.MOVIMIENTOS`) parseaban a 0
líneas → al usuario le faltaban movimientos (impuestos, comisiones, FCI, pagos de tarjeta).

- [x] **Carga manual del CSV (import `347a6ae9`)** — Parseo determinístico ad-hoc por script
  local (sin secretos: solo lee el archivo) + carga por SQL (MCP). 367 movimientos
  2026-01-02→06-09, verificados por checksum de montos (suma abs `428.777.231,16`). Dedup
  contra transferencias ya importadas (110 marcadas duplicadas; **falso positivo** de un dedup
  por date+monto sobre montos redondos → se corrigió recuperando 5 líneas FCI/QR). Pase de
  **categorización/transferencia** (yo como LLM, sin API): FCI→transferencia a `ICBC
  Inversiones`, pago tarjeta→transferencia a la tarjeta, + categorías sistemáticas (Gastos
  bancarios / Intereses / Otros ingresos / Sueldo / Supermercado). Todo como **sugerencia** en
  `pending` (revisión humana intacta). Decisiones de negocio confirmadas con Nico (FCI y pago
  de tarjeta = transferencias, no gasto).
- [x] **#37 — Notación científica en montos del parser.** ICBC exporta montos grandes como
  `1.4090103E7`; el regex de `amountOriginal` los rechazaba → fallaba el parseo entero. El
  preprocess de `parsedTxLineSchema` ahora los expande a decimal plano. +2 tests.
- [x] **#38 — Parser determinístico de CSV (ICBC banco).** Campo opcional `parseCsv?` en el
  tipo `Parser`; implementado para ICBC banco (`MM/DD/YY`→ISO, débito/crédito→kind, expande
  científica, + inteligencia de conceptos FCI/tarjeta→transferencia y categorías). `parse-internal`
  lo usa si existe y el formato matchea; si no (`CsvFormatError`) cae al LLM. Hint transitorio
  `transferAccountName`→`transferAccountId` resuelto por nombre de cuenta. **A partir de ahora
  el CSV de ICBC se parsea solo, sin LLM, sin timeout, sin costo.** Nuevo `icbc-banco.test.ts`
  (9 casos, filas sintéticas). Suite 300→**309**.
- **Confirmado:** el "fix #2 async parse" que se iba a hacer **ya estaba en `main`** (parseo en
  `after()`, `drainUploadedImports`, reaper, `reparseable` con `'parsing'`); el checkout local
  estaba viejo. El gap real era el timeout del LLM en archivos grandes, que el parser
  determinístico de CSV resuelve para bancos conocidos.
- [x] **Galicia: carga manual del xlsx + parser determinístico (#42).** Galicia exporta la caja
  de ahorro como **`.xlsx`** (el importador no lo aceptaba). (1) **Carga manual** (import
  `e36d50d2`, cuenta `Galicia Caja de Ahorro` de Nico): 104 movimientos feb–jun 2026, checksum
  `44.694.540,60`, contraparte (CUIT/CBU/nombre) extraída del campo Movimiento multilínea, 6
  duplicados auto-rechazados. **Regla nueva confirmada con Nico**: transferencias hacia/desde
  cuentas de **Nico Y Pau** (por CUIT, DNIs `30555106`/`28864311`) = transfer; FIMA = transfer a
  inversión; pago de tarjeta = transfer. (2) Se **creó cuenta `Galicia Inversiones · Nico`**
  (`72fb8a5a`) y se asociaron los 8 movimientos FIMA. (3) **#42**: el importador acepta `.xlsx`
  (helper `lib/imports/xlsx.ts` con `jszip`, sin paquete nuevo); hook `Parser.parseXlsx`; parser
  Galicia banco; `parse-internal` con rama xlsx + resolución `transferAccountName` **owner-aware**
  (cuentas con nombre duplicado por dueño Nico/Pau → se elige la del mismo `owner_tag`). Suite
  309→**324**. **A partir de ahora el xlsx de Galicia entra solo, sin LLM.**
- **Cuentas Galicia duplicadas = OK** (no son dups): una de Nico y otra de Pau (Caja Ahorro,
  Visa, Master). **No tocar.**
- **Limitación conocida:** los DNIs del household están como constante en el parser Galicia
  (`HOUSEHOLD_DNIS`); mejora futura = moverlos a config/DB.
- **Sin migraciones.** Todo jsonb / columnas existentes.
- [x] **Sync PRD Notion:** changelog **v1.7** (CSV ICBC) + **v1.8** (xlsx + Galicia banco) + notas
  en §5.2 + bump de "Última actualización".

### Sesión 2026-06-09 — Contrapartes editables + UX de revisión de imports (en paralelo con otro agente)

Sesión de soporte/UX sobre imports, **con otro(s) agente(s) trabajando en paralelo** sobre `main` (de ahí los PRs intercalados #17/#19/async-parsing de la otra tanda). Todo el trabajo de esta sesión salió en worktrees aislados + PRs propios, ya **mergeados y en producción**.

- [x] **#16** — Sección "Trabajo en paralelo — varios agentes" agregada a `CLAUDE.md`: branch propio obligatorio, git acotado por path (prohibido `stash`/`reset --hard`/`add -A`), cómo interpretar fallos de typecheck en árbol compartido, archivos calientes, cierre vía PR. Disparado por un `git stash` que casi se lleva el WIP ajeno.
- [x] **#18** — **Contrapartes: etiqueta + categoría auto por contraparte.** (1) Campo `label` editable en el counterparty (jsonb, sin migración), editable en revisión y visible (solo-lectura) en lista y detalle de transacciones (componente compartido `CounterpartyTag`). (2) Nuevo `lib/imports/counterparty-suggest.ts` (`lookupCounterpartyHistory`): matchea la misma contraparte entre meses por CUIL/CBU/cuenta/alias o nombre normalizado y precarga la **categoría más frecuente** (desempate: más reciente) + la etiqueta. Cableado en el parse con prioridad sobre la sugerencia por descripción para líneas no-transfer. **Backfill** de `imports.account_id` para imports viejos que mostraban la cuenta del header en vez de la real (vía MCP SQL).
- [x] **#21/#18** — **UX revisión:** (a) asignar categoría a una línea marcada como transfer la **desmarca** automáticamente (inline, en edición y en lote) — categoría y "cuenta contraparte" mutuamente excluyentes. (b) **Type-ahead** en los selectores inline de categoría y contraparte (`CategoryCombobox` generalizado a `Combobox` reutilizable). (c) Barra de selección masiva **sticky** arriba (movida a hija directa de la `section` para que el `sticky` no se despegue; un intento previo con scroll interno de la tabla se revirtió por feedback).
- [x] **#22** — **Lista de imports:** (a) entra por default a la vista **"Para revisar"** = todos los estados accionables, no solo `parsed`+`reviewing` → ahora incluye `uploaded`/`parsing` (todo lo que no es `confirmed` ni `error`, derivado de `IMPORT_STATUSES`). (b) "Resúmenes faltantes" (`detect-gaps`) no reporta meses **previos a 2026** (`EARLIEST_TRACKED_MONTH='2026-01'`); el tracking del household arranca en 2026.
- [x] **#23** — **Marcar/desmarcar transferencia en lote** (`bulkSetTransfer`, jsonb_set): la detección automática marca como transfer muchos pagos a terceros que son gastos; botones "Marcar transfer"/"No es transfer" en la barra de selección. Marcar limpia la categoría; desmarcar limpia `transferAccountId`. SQL jsonb validado contra Postgres.
#### Endurecimiento del parseo + auto-parse (continuación, misma sesión, PRs #25–#32)

Tras subir más extractos aparecieron imports trabados en `parsing` y 504/500. Se diagnosticó y arregló la cadena completa del parseo:

- [x] **#25** — **504 en la lista `/imports`**: la ruta no tenía `maxDuration` (sí `/imports/new` 60s y `/imports/[id]` 300s) → en cold start podía dar 504. `maxDuration=60` (luego 300, ver #29) + `detectImportGaps` paralelizado (`Promise.all` en vez de una query secuencial por cuenta).
- [x] **#26** — **Reaper de parseos colgados**: cron diario (`/api/cron/reap-stale-parses`, 12:00 UTC) que marca `error` los imports en `parsing` > 6 min (`PARSE_STALE_AFTER_MS`, fallback `created_at`). Saca los trabados de "Para revisar" sin reset manual por SQL.
- [x] **#27** — **Timeout explícito al LLM**: la llamada Anthropic era no-streaming **sin timeout** (default SDK 10 min) > 300s de la función → Vercel mataba la función a mitad y el import quedaba colgado en `parsing` (el `catch` que marca `error` no corría). Fix: `timeout: 220s` + `maxRetries: 0` en `messages.create` → falla limpio a `error` reintentable.
- [x] **#29** — **Drenado: presupuesto + concurrencia**: `/imports` `maxDuration` 60→300; intento de `parseImportSync` (síncrono, pool acotado). **Revertido en #31** (ver abajo).
- [x] **#30** — **🐛 CAUSA RAÍZ del "stuck parsing"** (bug de la refactorización async ajena): `parseImport`/`parseImportSync` marcan `status='parsing'` ANTES de llamar a `parseImportInternal`, pero `parseImportInternal` solo aceptaba reparsear `['uploaded','error','parsed','reviewing']` — **sin `'parsing'`** → devolvía `invalid_state` y **no hacía nada** (no descarga, no LLM, no toca estado) → colgado en `parsing` con `parser_model='pending'`. **Todo** parse manual/auto era un no-op silencioso; el cron de Gmail no, porque llama a `parseImportInternal` directo. Fix: agregar `'parsing'` a la lista `reparseable`.
- [x] **#28 + #31** — **Auto-parse al subir + drenado del backlog en segundo plano.** (#28) `createImport` dispara `parseImport` al subir (`/imports/new` maxDuration 60→300); botón "Parsear N subidos" en la lista. (#31) el botón pasó a **`drainUploadedImports`**: una server action que selecciona los `uploaded` y agenda con `after()` un único job que los parsea **secuencialmente en segundo plano** → la request del cliente vuelve al instante (no más "This page couldn't load" por request larga) y el job **sobrevive a que el usuario navegue**. (El intento previo `parseImportSync` colgaba la request síncrona.) Se eliminó `parseImportSync`.
- [x] **#32** — **Marcar devolución/reembolso en la revisión del import**: flag `isRefund` en `parsedTxLineSchema` (+ alias/coerce); checkbox "Es una devolución / reembolso recibido" en el editor de línea (solo gasto, no-transfer) + badge "Devolución"; al confirmar, si `isRefund`+gasto el monto se persiste **negado** (`confirm.ts`). El `parsed_data` guarda el positivo. Mismo modelo que el form manual (regla §4.3). Caso disparador: recupero de ARBA que venía como Ingreso.

- **Sin migraciones nuevas** en toda la sesión (todo jsonb / columnas existentes). Validación por PR: typecheck + lint + suite (281 → **298 tests**, sumando tests de la otra tanda + `isRefund`).
- **Incidentes prod (resueltos):** (a) 500/504 transitorios "This page couldn't load" = función colgada (statement timeout + EOF mid-transaction en logs Postgres) por las requests síncronas largas del drenado viejo y el parse sin timeout — resueltos con #27/#31. (b) El "stuck parsing" recurrente NO era timeout sino el bug `invalid_state` de #30. Debug siempre vía logs Postgres de Supabase (Hobby no persiste runtime logs).
- **Resuelto — NO hace falta Haiku/troceo:** la sospecha de que los extractos ICBC pesados ("TRANSF.MINORISTAS"/"MOVIMIENTOS") caían por timeout > 220s era un **fantasma del bug no-op de #30** (nunca llegaban a correr el LLM). Confirmado en prod: parsean bien con **Sonnet** (`claude-sonnet-4-6`) — p. ej. `AV.TRANSF.MINORISTAS-9430` con 47 líneas, `AV (4)` con 31, varios `EXT.DE.MOVIMIENTOS` confirmados, todos sin `error`. Construir Haiku/troceo sería complejidad + pérdida de precisión para un problema inexistente.
- **Limitación menor conocida (drenado en lote):** `drainUploadedImports` procesa lo que entra en una sola función de 300s; un backlog grande puede dejar el último parse colgado al tope (lo barre el **reaper** diario #26, o se re-clickea el botón). En uso normal (pocos extractos + auto-parse al subir de a uno) no se nota. Mejora futura si molesta: drenado auto-continuado o por chunks.
- [x] **Sync PRD Notion:** changelog v1.5 (sugerencia por contraparte, §5.2.1) + **v1.6** (auto-parse al subir, drenado en segundo plano, reaper, timeout LLM, reembolso marcable en revisión).

### Sesión 2026-06-08 (cont.) — Reembolsos / devoluciones de gastos

Caso de Nico: transferencias recibidas que no son ingresos sino **devoluciones de un gasto** (ej. paga el 100% de la cuota del cole y le devuelven la mitad → quiere que el gasto neto sea 50%). Decisión de modelado: un reembolso es un **gasto con monto negativo en la misma categoría** (no un ingreso). El mecanismo ya existía parcialmente (la tabla ya badgeaba "Devolución" por signo, schema y reportes ya neteaban); esta sesión agrega la UX guiada + blinda el donut.

**Decisiones de negocio (Nico, 2026-06-08):**
- Reembolso = **gasto negativo suelto contra la categoría** (sin vincular a la transacción original). Más simple; netea igual en todos los reportes.
- Si el gasto era deducible Ganancias, el reembolso lleva `deducible_ganancias=true` → el deducible baja al **neto** (el export ya suma `monto_usd` con signo, sale solo).
- Atribución al **mes en que se recibe** la plata (consistente con flujo de caja; puede dejar una categoría en neto negativo ese mes).

**Cambios:**
- [x] `transaction-form.tsx`: checkbox "Es una devolución / reembolso recibido" (solo en gasto). El usuario tipea el monto en positivo; al enviar se persiste negado (flip de signo sobre el string, sin float). Label "Monto recuperado", helper text, reset al cambiar a ingreso, y detección en modo edición (gasto con monto negativo → pre-tilda + muestra en positivo).
- [x] `reports/breakdown/donut.tsx`: excluye del Pie las categorías con neto ≤ 0 (Recharts rompe con porciones negativas); alinea los `Cell` con las filas visibles; fallback si no queda ninguna positiva.
- [x] `reports/breakdown/page.tsx`: clamp del ancho de la barra del detalle a ≥ 0.
- [x] `lib/reports/breakdown.test.ts`: +4 tests de netting con montos negativos (netea, neto negativo se mantiene, neto 0 se omite, netting al parent).
- **Sin migración de DB** (reusa la convención de signo ya existente). **No se tocó** `_build.ts` (kind sigue `expense`, `category.kind===input.kind` se respeta) ni el export contador (ya neta solo).
- Validación: `typecheck` ✅, suite full **278 tests / 29 files** ✅, `eslint .` ✅, build implícito.
- [x] **Higiene de entorno:** vitest y eslint estaban escaneando `node_modules` de worktrees viejos en `.claude/worktrees/` (inflaba el run a ~1996 tests y tiraba el lint por OOM). Agregado `.claude/**` a `vitest.config.ts` (exclude, + `node_modules` ahora `**/node_modules/**`) y a `globalIgnores` de `eslint.config.mjs`.
- [x] **Sync PRD Notion:** regla de reembolsos agregada en §4.3 + changelog v1.4 (2026-06-08).

### Sesión 2026-06-08 — Fixes de imports en producción + contraparte de transferencias

Sesión de soporte sobre imports en prod (Vercel Hobby). PRs #10–#14 + feature de contraparte.

- [x] **#10** — PDF sin encriptar: `decryptPDF` tiraba "not encrypted" y mataba el parseo; ahora ese caso se ignora y se sigue con bytes originales (solo falla ante contraseña genuinamente incorrecta).
- [x] **#11** — Editor de línea de import como **panel expandible** (colSpan full-width) en vez de inline por celda → elimina scroll horizontal y botones escondidos.
- [x] **#12** — `maxDuration` explícito en rutas de imports (`/imports/new` 60s, `/imports/[id]` 300s). Resolvía 504 `FUNCTION_INVOCATION_TIMEOUT` al subir (default de Hobby bajo).
- [x] **#13** — Estado `parsing` huérfano (parse síncrono que muere por timeout deja el import pegado): ahora muestra botón "Reintentar parseo". Fix de fondo (parseo async) sigue pendiente para V1.2.
- [x] **#14** — **Edición masiva de moneda** en revisión (`bulkSetCurrency`): el LLM a veces asume USD en cuenta ARS. Selector + "Aplicar moneda" en la barra de selección.
- [x] **Contraparte de transferencias (decisión Nico):** se PERSISTEN identificadores de contraparte (name, accountRef, CUIL/CUIT, CBU, alias) en `import_lines.parsed_data.counterparty` y `transactions.meta.counterparty`. Cambios: `counterparty` en `parsedTxLineSchema` (+ aliases tolerantes), prompt ICBC banco invertido (extrae a `counterparty`, deja `description` limpia), mapeo en `confirm.ts`, display en revisión (`CounterpartyTag`), tests (274). **Excepción documentada en CLAUDE.md** (reemplaza "nunca almacenar CBU/CUIT"). Sin migración (todo jsonb). Otros parsers (TC/broker) quedan pendientes de sumar el mismo patrón.
- **Debugging prod:** Hobby NO persiste runtime logs → se usaron logs de Supabase (MCP: storage/postgres/auth) + `execute_sql`.
- [x] **Sync PRD Notion:** §7 Seguridad actualizada (excepción de datos de contraparte) + changelog v1.3 (2026-06-08).
- [x] **Auto-sugerir cuenta destino por nº de extracto (decisión Nico):** el parser extrae el nº de cuenta propia del encabezado (`statementAccount.number`) → `imports.statement_account_ref`. En la revisión, si matchea `accounts.account_number` se preselecciona la cuenta ("sugerida por Nº X"); si no, banner pidiendo elegir la cuenta y se **aprende** el nº (`learnAccountNumber`, solo si la cuenta no tiene número) — red de seguridad también al confirmar. **Migración `0013`** (aditiva: `accounts.account_number`, `imports.statement_account_ref`) **aplicada a prod vía MCP de Supabase** (idempotente, `ADD COLUMN IF NOT EXISTS`). Trabajado en git worktree aislado. typecheck + lint + 278 tests + build OK.
  - **Nota:** `0013` se aplicó por MCP, no por `db:migrate`. El journal de Drizzle no la registra; el `.sql` es idempotente, así que un `db:migrate` futuro es no-op seguro.
- [x] **Parseo async con `after()` (resuelve el pendiente V1.2 de #13):** `parseImport` ahora marca `status='parsing'` + `parsing_started_at` sincrónico y agenda el trabajo pesado (descarga + LLM + persistencia) con `after()` de `next/server` — responde al instante, no deja la request del usuario colgada esperando al LLM. Sigue acotado a `maxDuration` (300s); si se pasa, queda en `parsing` y la UI lo detecta como "cortado" vía `isParseStale(parsing_started_at)` ofreciendo reintentar (en vez de "en curso" para siempre). El cron de Gmail sigue síncrono (batch). **Migración `0014`** (`imports.parsing_started_at`, aditiva) aplicada a prod vía MCP. Helper puro `lib/imports/parse-stale.ts` con tests. typecheck + lint + 284 tests + build OK.
  - **Follow-up opcional:** un *reaper* (cron) que marque `error` los `parsing` stale para que la lista `/imports` y los contadores no los muestren colgados. Hoy se resuelve con el reintento + el mensaje de "cortado".

### Sesión 2026-05-29 (cont.) — Password PDF manual + ownerTag en dropdowns (branch `feat/manual-pdf-password`, hecho con Antigravity)

- [x] **Password de PDF manual al parsear:** `ParseButton` ahora permite ingresar la contraseña de desencriptación al reparsear (con placeholder según si hay una guardada) + checkbox "guardar para futuras importaciones". `parse`/`parse-internal` reciben `customPassword`/`persistPassword`; al desencriptar OK con password manual, se persiste en `accounts.pdf_password` (o `institutions.pdf_password` si el import no tiene cuenta).
- [x] **ownerTag (Nico/Pau/Hogar) en todos los dropdowns de cuentas:** transactions (form + transfer + lista), recurrences (form + páginas), imports (review + lista). Queries de cuentas ampliadas con `ownerTag`.
- [x] Revisado, validado (`typecheck && test 270 && lint && build`), retoque cosmético de indentación. Observaciones menores no bloqueantes: el persist corre dentro del `try` de decrypt; persistir en `institutions` escribe en tabla global (inocuo para 1 household).

### Sesión 2026-05-29 (cont.) — Sync del PRD de Notion + convención (branch `docs/sync-prd-convention`)

- [x] PRD de Notion estaba sin tocar desde 2026-05-05; corregido inline (patrimonio, MFA obligatoria, Gmail import, región us-west-2, Next 16 + Drizzle, FX promedio vendedor) + changelog v1.2. PR #8 mergeado.
- [x] CLAUDE.md: convención de mantener el PRD sincronizado al cerrar cada hito.

### Sesión 2026-05-29 (cont.) — Mejora de la pantalla `/imports` (branch `feat/imports-screen`)

- [x] **Filtros + orden + paginación (P0):** reescritura de `/imports` con el patrón de `/transactions` (URL search params + Zod, WHERE dinámico, `SortableHeader`, paginación con contador, chips de filtros activos). Filtros: tipo, institución, cuenta, rango de período, búsqueda por nombre de archivo. Orden por fecha/cuenta/período/estado/txns.
- [x] **Tabs por estado (P1):** segmentos Todos · Para revisar · Confirmados · Error con contadores. Reemplaza el `animate-pulse` global.
- [x] **Acciones (P2):** reintentar parse en filas con error (reusa `parseImport`), borrar import + bulk delete (`app/actions/imports/delete.ts`, solo estados sin transacciones creadas).
- [x] **Período como columnas (P3):** `imports.period_start` / `period_end` (migración `0012` + backfill SQL). Helper `lib/imports/period.ts` (`computeImportPeriod`), invocado al parsear (`parse-internal`) y al editar línea (`update-line`). La lista ordena/filtra por período en SQL.
- [x] Helpers puros en `lib/imports/list-filters.ts` (`viewToStatuses`, `isDeletableStatus`) con tests. `typecheck && test (270) && lint && build` limpios.
- [ ] **PENDIENTE (bloqueante para deploy):** aplicar migración `0012` con `npm run db:migrate` (requiere `DIRECT_URL`). Aditiva/backward-compatible → aplicar ANTES de deployar el código nuevo.

### Sesión 2026-05-29 — Acciones pendientes (dashboard + página `/pendientes`)

**Merge + deploy de `optimizaciones`:**
- [x] PR #5 (`optimizaciones → main`) mergeado y deployado a producción en Vercel. Incluyó el namespacing de `globalThis.__gdFinanzasDb` (fix de code review).

**Feature: Acciones pendientes (branch `feat/pending-actions`):**
- [x] Data layer `lib/reports/pending-actions.ts` — `loadPendingActions` + `classifyOverdue` (puro, testeado) + `countPendingActions`. Agrega: imports para revisar (`parsed`/`reviewing`), imports con error, previsiones vencidas (`missed` + `pending` vencida en gracia), resúmenes mensuales faltantes (reusa `detectImportGaps`), y presupuesto del mes sin definir.
- [x] Página dedicada `/pendientes` con secciones agrupadas y links de acción a `/imports/[id]`, `/imports/new`, `/forecasts`, `/budget`.
- [x] Bloque-resumen en el dashboard (`PendingActionsSummary`) arriba del HERO; estado "Todo al día" cuando no hay pendientes.
- [x] Link "Pendientes" en sidebar (sección Operar) con badge de contador (alimentado por `countPendingActions` desde el layout protegido).
- [x] Test nuevo de `classifyOverdue`. `typecheck && test (263) && lint && build` limpios.
- [ ] Pendiente: verificación visual con datos reales en dev/prod; abrir PR + deploy.

---

### Sesión 2026-05-28 — Code Review y Optimizaciones

**Revisión y Refactorización del Codebase (Branch `optimizaciones`):**
- [x] **Savings Rate (Reporte D):** Se corrigió la fórmula del ratio de ahorro acumulado `savingsRateYtdPct` para usar `savingsYtd` en vez de `netYtd`, permitiendo que los egresos en categorías `isInvestment` sumen correctamente como ahorro. Test de regresión agregado.
- [x] **Cron de Gmail:** Se eliminó el riesgo de crash del driver Postgres (conversión errónea de UUID) al pasar un `userId` nulo válido en lugar de un string vacío `''` en `createImportInternal`.
- [x] **Paralelización de Cotizaciones:** Se optimizó `fetchQuotes` para solicitar cotizaciones de Yahoo Finance concurrentemente usando `Promise.all`, evitando la latencia secuencial en el formulario de patrimonio.
- [x] **Pool de Conexiones DB:** Se cacheó el cliente Drizzle en `globalThis` para evitar fugas de conexiones en desarrollo (Fast Refresh) y se redujo el tamaño del pool en entornos serverless (`max: 2`).
- [x] **Pruning de Backups:** Se modificó la nomenclatura de backups (`gd-finanzas-backup-${householdId}-${date}.zip`) y el pruning de Google Drive para filtrar por `householdId` y evitar borrar copias de seguridad de otros inquilinos (defensa multi-tenancy).
- [x] **Import multi-archivo cross-institución:** Verificado y marcado como completo. El formulario `import-upload-form.tsx` permite configurar y enviar independientemente la institución y cuenta de destino de cada archivo.
- [x] Cambios confirmados: `typecheck && lint && test` limpios. Branch `optimizaciones` creada y pusheada a GitHub.

**Pendiente próxima sesión:**
- [ ] Test E2E Gmail import ICBC banco (subir 4 PDFs reales en el correo de Nico, verificar routing + parsing en prod/dev)

---

### Sesión 2026-05-26 — Gap analysis PRD + Export general

### Sesión 2026-05-25 — ICBC Banco Parser + Multi-Attachment Gmail

**ICBC banco — parser + routing multi-adjunto:**
- [x] Migración 0010: `pdf_password` en tabla `accounts` (override de `institutions.pdf_password`)
- [x] UI: campo "Contraseña PDF" en form de crear/editar cuenta
- [x] `parse-internal.ts`: prioriza password de cuenta sobre institución
- [x] Attachment router (`lib/gmail/attachment-router.ts`): decripta PDF, extrae texto con `pdf-parse`, identifica cuenta por patrones (CAJA DE AHORRO PESOS/DOLARES, CUENTA CORRIENTE), skipea CARATULA y SIN MOVIMIENTOS
- [x] Gmail cron refactoreado: agrupa cuentas por label; labels compartidos usan content-based routing; labels únicos mantienen flujo original
- [x] Parser `icbc-banco-v1` actualizado para 2 formatos: AV.TRANSF.MINORISTAS (transferencias, todas isTransfer=true) y EXT.DE.MOVIMIENTOS (extracto general)
- [x] Nueva dependencia: `pdf-parse` (text extraction para routing)
- [x] Typecheck + lint + 255 tests verdes

---

### Sesión 2026-05-24 — Patrimonio V2

**Patrimonio implementado:**
- [x] Schema DB: enum `asset_type`, tablas `net_worth_snapshots`, `account_balances`, `holdings`
- [x] Migración 0006 aplicada + RLS policies (0003_patrimonio_rls.sql)
- [x] Yahoo Finance helper (`yahoo-finance2`) para precios de mercado (US stocks, CEDEARs, bonos AR)
- [x] Zod schemas para balances, holdings, snapshot form
- [x] 3 data loaders (load-snapshots, load-snapshot-detail, net-worth-series)
- [x] 4 server actions (create/update/delete snapshot + fetch-prices)
- [x] `/patrimonio` — página principal con KPIs (net worth, target, progreso, distancia), barra de progreso vs USD 2.45M, chart de evolución, tabla de snapshots
- [x] `/patrimonio/nuevo` — formulario con saldos agrupados por tipo de cuenta + holdings con ticker/precio/cantidad + botón "Actualizar precios" (Yahoo Finance) + net worth en vivo
- [x] `/patrimonio/[id]` — detalle read-only + modo edición (`?edit=true`) + botón eliminar
- [x] Pre-fill desde snapshot anterior al crear uno nuevo
- [x] Reporte D: nueva sección "Patrimonio acumulado" con net worth vs target + barra de progreso
- [x] Sidebar nav: nueva sección "Patrimonio"
- [x] Typecheck + lint + 255 tests verdes

**Transfers en imports bancarios:**
- [x] Campo `isTransfer` + `transferAccountId` en `parsedTxLineSchema` (con alias handling)
- [x] Auto-detección post-parse (`lib/imports/detect-transfers.ts`) con patrones TRANSF/TRF/DEBIN/etc.
- [x] Integración en `parse.ts`: detectTransfers se ejecuta para imports tipo "banco"
- [x] Prompts de parsers banco actualizados (ICBC + HSBC US) con instrucción `isTransfer`
- [x] `update-line.ts`: soporta isTransfer (limpia categoría, skip validación de kind/categoría)
- [x] `confirm.ts`: branch de transfers usa `buildTransferFields()` → crea par de txns con `transfer_pair_id`
- [x] UI: badge "Transfer" en líneas detectadas, botón "⇄ Transfer" para marcar manual, select de cuenta contraparte, botón "No transfer" para desmarcar
- [x] Typecheck + lint + 255 tests verdes

**Validación de imports — subtotales + link al PDF:**
- [x] Columnas `summary` (JSONB) y `fileName` (text) en tabla imports + migración 0007
- [x] `generateSignedUrl()` en `lib/imports/storage.ts` para URLs firmadas de Supabase Storage
- [x] `parserOutputSchema` ampliado con campo `summary` opcional (totalExpense, totalIncome, currency) + alias handling
- [x] Los 7 parsers (5 TC + 2 banco) actualizados con instrucción de extraer subtotales del resumen
- [x] `parse.ts` guarda `summary` del LLM en el import record
- [x] `create.ts` guarda `fileName` (nombre original del archivo subido)
- [x] Botón "Ver PDF ↗" en header de import detail (abre signed URL en nueva pestaña)
- [x] Nombre de archivo visible en header de import detail
- [x] Bloque de validación de totales: compara suma de líneas extraídas vs subtotales del PDF
- [x] Semáforo verde/rojo con delta cuando hay diferencia significativa (>1%)
- [x] Link "Abrir PDF para verificar ↗" en bloque de totales extraídos
- [x] Parser ICBC Mastercard: ya funciona bien (78, 60, 40 líneas en últimos imports; el issue de 8 líneas era un caso aislado)
- [x] Typecheck + lint + 255 tests verdes

**Sorting en /budget y /forecasts:**
- [x] Budget grid: headers sortables por nombre de categoría y total anual (client-side, respeta jerarquía padre/hijo)
- [x] Forecasts: sort por fecha/nombre/monto dentro de cada mes (server-side via URL params)

**Alertas de información no cargada:**
- [x] Columna `expects_monthly_import` en accounts + migración 0008
- [x] Checkbox en account form + badge "Import mensual" en lista de cuentas
- [x] `lib/imports/detect-gaps.ts`: detecta meses sin import confirmado para cuentas con flag
- [x] Bloque de alertas en `/imports` con meses faltantes + links directos a `/imports/new`

**Import desde Gmail:**
- [x] Gmail API client (`lib/gmail/client.ts`) — listMessages, getAttachments, moveToProcessed, findOrCreateLabel, listUserLabels
- [x] OAuth script (`npm run oauth:google-token`) con scopes Drive + Gmail combinados
- [x] Columna `gmail_label_id` en accounts (migración 0009) — mapeo label ↔ cuenta
- [x] Refactor parse/create a funciones internas sin sesión (para cron)
- [x] Cron `/api/cron/gmail-import` (diario 11:00 UTC / 8:00 AR) — pollea labels, descarga PDFs, auto-import + auto-parse, mueve a "gd-procesados"
- [x] Settings UI `/settings/gmail` — cargar labels, mapear a cuentas, badge "Configurado"
- [x] Sidebar nav: link "Gmail" en Settings

**Pendiente próxima sesión:**
- [ ] Import multi-archivo cross-institución (seleccionar institución/cuenta por archivo)
- [ ] Activar Gmail import: correr `oauth:google-token`, crear labels en Gmail, configurar filtros, mapear en `/settings/gmail`

---

### Sesión 2026-05-22/23 — Operacional + mejoras de imports

**Data real cargada:**
- [x] Taxonomía de categorías cerrada con Nico (Alquiler income, Autónomos, sin Delivery, Personales con children Regalos/Suscripciones streaming/Suscripciones IA/Varios, Seguros, Gastos bancarios, Impresión 3D, Mario)
- [x] 19 cuentas reales seedeadas (Nico + Pau + Hogar)
- [x] Budget 2026 cargado desde Excel (188 entradas, 18 categorías × 12 meses)
- [x] 7 recurrencias fijas (sueldos, alquiler, expensas, colegios, Nahir)
- [x] FX backfill desde 2026-01-01 (93 cotizaciones) + parciales 2024-2025 para cuotas
- [x] Múltiples resúmenes de TC importados (ICBC Visa, Galicia Amex/Visa/Master, BNA Visa, HSBC US)

**Mejoras de imports implementadas:**
- [x] Redirect post-confirm con opciones (ver txns / importar otro)
- [x] Sugerencia de categoría normalizada (quita cuotas C.XX/XX y montos entre paréntesis)
- [x] Sugerencia desde import_lines históricas (no solo transactions)
- [x] Fix regex Postgres con String.raw para matching normalizado
- [x] LLM sugiere categorías durante parsing (prompt enriquecido con árbol de categorías)
- [x] Combobox con búsqueda para asignación bulk de categorías
- [x] max_tokens subido de 8k a 16k + detección de truncamiento
- [x] Re-parse de imports ya parseados/reviewing (limpia lines sin tx)
- [x] Script `imports:reparse` para re-parseo masivo con --dry-run/--id/--model
- [x] Account-aware parser resolution (accountMatch en Parser, accountId en imports)
- [x] Parser ICBC Mastercard TC separado del Visa
- [x] Parser BNA Visa TC
- [x] Upload multi-archivo (misma institución/tipo/cuenta)
- [x] Auto-unlock de PDFs protegidos (pdf_password en institutions, @pdfsmaller/pdf-decrypt)
- [x] Cross-import content dedup (auto-rechaza líneas ya existentes como transacciones)
- [x] Filas clickeables para selección en import review
- [x] Botón rechazar directo en líneas editadas/aceptadas
- [x] Aceptar/rechazar pending duplicado al pie con el confirm
- [x] Cierre de import cuando todas las líneas están confirmadas o rechazadas
- [x] Fix cuotas: fecha de cierre del resumen, no fecha original de compra (todos los parsers TC)
- [x] Parser HSBC US TC v2 con formato JSON explícito + alias de campos
- [x] Parsers ignoran filas de pago ("SU PAGO", etc.)

**Mejoras UI:**
- [x] Headers sortables en /transactions (server-side via URL params) y /imports/[id] review (client-side)
- [x] Account default por institución en confirm + por accountId si viene del upload
- [x] Owner tag en dropdown de cuentas (distingue Nico/Pau)
- [x] Lista de imports muestra cuenta + período en vez de hash de archivo
- [x] Sin-categoría primero en import review

**Pendiente próxima sesión:**
- [ ] **Patrimonio V2** — valuación de inversiones, saldos de cuentas, trayectoria a IF completa
- [ ] Transfers en imports bancarios (depende de patrimonio)
- [ ] Parser ICBC Mastercard — sigue extrayendo solo 8 líneas (problema de lectura del PDF, no del prompt)
- [ ] Sorting en /budget y /forecasts
- [ ] Import multi-archivo cross-institución (seleccionar institución/cuenta por archivo)

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

### 🟢 Hito 5 — Dashboard + Reporte A (V1.0 funcional 🎉)

**5.A — Budgets grilla editable categoría × mes (2026-05-18, hecho):**
- [x] `lib/schemas/budget.ts`: `budgetInputSchema` (year 2020-2100, month 1-12, categoryId, amountUsd vía moneySchema permite 0 y negativos); 8 tests
- [x] `lib/budgets/leaves.ts`: `isLeafCategory` + `leafIdsOf` (parent es hoja si nadie lo referencia como parent); 5 tests
- [x] `lib/categories/tree.ts` ampliado: `CategoryNode` incluye `parentId: string | null`
- [x] Server actions `set.ts` (UPSERT vía Drizzle `.onConflictDoUpdate` con `revision_at=now()`) + `clear.ts` (DELETE WHERE household+year+month+category). Set valida que la category sea hoja
- [x] UI: `/budget` redirect a `/budget/{año actual}`. `/budget/[year]/page.tsx` carga tree + budgets del año. `budget-grid.tsx` (client) con state local `Map<catId-month, string>`, optimistic UI, blur dispara setBudget o clearBudget según vacío, parents read-only con subtotal calculado, meses pasados disabled, mes en curso resaltado, columna Total año y filas Subtotal Ingresos / Gastos / Neto
- [x] Nav link "Presupuesto" en layout protegido
- [x] Validación verde: typecheck + lint + 130 tests + build + `db:smoke-rls` 8/8

**5.B — Reporte A: cashflow real vs budget (2026-05-18, hecho):**
- [x] `lib/reports/cashflow.ts`: `buildCashflowReport(tree, budgets, reals)` puro. Agrega children en parents recursivamente, calcula Δ USD y Δ % (null si budget=0). Helper `deltaTone(kind, delta)` para colorear: income+ = good, expense− = good. 11 tests
- [x] `lib/reports/cashflow-data.ts`: `loadCashflowData(householdId, year, month)` carga tree + budgets + agrega `SUM(amount_usd) GROUP BY category_id` con WHERE date BETWEEN month range + kind IN income/expense + category_id NOT NULL (transfers fuera). `monthRange(y,m)` exportable
- [x] `/reports/cashflow` server page con selector ◀ prev / next ▶, tabla con orden de árbol (parents arriba con subtotales calculados, children indentados), tfoot con Total Ingresos / Gastos / Neto. Drill-down: click en categoría hoja → `/transactions?categoryId=X&from=YYYY-MM-01&to=YYYY-MM-DD`
- [x] Nav link "Reportes" (apunta a `/reports/cashflow`; cuando entren reportes B/C/D se vuelve menú)
- [x] Validación verde: typecheck + lint + 141 tests + build + `db:smoke-rls` 8/8

### 🟢 Hito 6 — Reportes B + C

**6.A — Reporte B: breakdown gastos por categoría (2026-05-18, hecho):**
- [x] `npm install recharts` (3.8.1, compatible con React 19)
- [x] `lib/reports/breakdown.ts`: `rollupBuckets` puro que agrupa por hoja o por parent según `level`. Buckets con amount=0 se omiten; ordena por amount desc; calcula pct. 6 tests
- [x] `lib/reports/breakdown-data.ts`: SQL SUM agrupado JOIN categories (con self-alias para parents) WHERE kind='expense' AND mes range → buckets crudos → `rollupBuckets`
- [x] `/reports/breakdown` page server con selector ◀ prev / next ▶ + toggle Parent/Leaf (links GET con query params). Grid 2 cols: donut a la izquierda, tabla a la derecha. Tabla con color swatch + nombre + monto + %. Drill-down solo en filas leaf → `/transactions?categoryId=...&from=...&to=...` (parents agregados no linkean)
- [x] `donut.tsx` (client recharts): Pie chart con paleta fallback cíclica para cats sin color; centro muestra total
- [x] `reports-nav.tsx`: mini-nav reusable (Cashflow · Breakdown) arriba de cada reporte
- [x] Validación verde: typecheck + lint + 147 tests + build + `db:smoke-rls` 8/8

**6.B — Reporte C: evolución 12 meses (2026-05-18, hecho):**
- [x] `lib/reports/evolution.ts`: `rollingMonths(endY, endM, count)` para llenar gaps + `buildEvolutionSeries` puro que ordena, calcula net y arma labels "MMM YY"; 7 tests
- [x] `lib/reports/evolution-data.ts`: SQL GROUP BY `EXTRACT(year/month FROM date), kind` SUM en USD o ARS según param + WHERE household + kind IN income/expense + opcional categoryId; llena meses sin data con `{0, 0}`
- [x] `/reports/evolution` page con: navegador "Mover ventana atrás/adelante", form GET con selector moneda + selector categoría (tree indentado), totales 12m abajo (Ingresos / Gastos / Neto coloreado)
- [x] `evolution/chart.tsx` (client): Recharts `ComposedChart` con 2 Bars (Ingresos verde, Gastos rojo) + Line (Neto violeta), tooltip formateado por moneda, axis compact (k/M)
- [x] `ReportsNav` ampliado con tercer link "Evolución"
- [x] Validación verde: typecheck + lint + 154 tests + build + `db:smoke-rls` 8/8

**Hito 6 cerrado.**

### 🟡 Hito 7 — Reporte D + Settings metas

**7.A — /settings/metas con financial_goals CRUD (2026-05-18, hecho):**
- [x] `lib/schemas/financial-goals.ts`: `financialGoalsInputSchema` (targetAhorroMensualUsd, edades 18-120 ints, retiro/educación/buffer positivos, notas ≤2000); 8 tests
- [x] `lib/financial-goals/defaults.ts`: constantes del PRD validadas con Pau 2026-05-05 (USD 5.700 ahorro, edades 58/60, retiro 2.23M, educación 150k, buffer 72k). Sirven solo para "primer guardado" del household — no se siembran en DB
- [x] `app/actions/financial-goals/upsert.ts`: UPSERT por UNIQUE(household_id) con `updated_at=now(), updated_by=session.userId`
- [x] `/settings` → redirect a `/settings/metas`. `/settings/metas` page server lee fila o aplica defaults; el form (client) muestra inputs por monto/edades/notas + total target calculado en vivo + último updated (timestamp + displayName del autor desde profiles)
- [x] Nav link "Metas" en layout protegido
- [x] Validación verde: typecheck + lint + 162 tests + build + `db:smoke-rls` 8/8

**7.B — Reporte D: año económico + trayectoria a IF (2026-05-20, hecho):**

Sub-hito 7.B.1 (flag `is_investment` + UI minimal):
- [x] Migración `0002_marvelous_jocasta.sql`: `categories.is_investment boolean default false`
- [x] `lib/categories/tree.ts`: `CategoryNode` incluye `isInvestment`; `loadCategoryTree` lo selecciona
- [x] `app/actions/categories/set-investment.ts`: server action UPDATE con WHERE doble (id + householdId), Zod inline, `revalidatePath` para `/settings/categorias` y `/reports/year-economy`
- [x] `app/(protected)/settings/categorias/page.tsx`: lista de gastos (solo expense, solo hojas) con checkbox por fila
- [x] `app/(protected)/settings/categorias/investment-toggle.tsx`: client component con `useTransition` + toast de error
- [x] `app/(protected)/settings/settings-nav.tsx`: sub-nav reusable (Metas · Categorías), patrón hermano de `reports-nav.tsx`
- [x] Layout nav: link "Metas" renombrado a "Settings" apuntando a `/settings` (redirect a `/settings/metas`)

Sub-hito 7.B.2 (lógica pura + tests):
- [x] `lib/reports/year-economy.ts`: `buildYearEconomyReport` puro. Computa KPIs YTD (income/expense/net/investment/savings + savingsRate), serie monthly de 12 cols con `isProjected`, trayectoria con semáforo (green ≥100% / yellow ≥80% / red <80% / neutral si expected=0), categoryRows agregando children en parents con realYtd vs projectedDec vs budget
- [x] `lib/reports/year-economy.test.ts`: 14 tests cubriendo `computeMonthsElapsed` (pasado/futuro/actual), buckets vacíos, savingsRate edge income=0, semáforo green/yellow/red/neutral, investment categories sumando al savings, año pasado/futuro, categoryRows con parent agregando children, forecast con categoryId=null contado en KPIs pero no en categoryRows, proyección dic = real YTD + forecasts

Sub-hito 7.B.3 (data loader):
- [x] `lib/reports/year-economy-data.ts`: 4 queries — (1) SUM amountUsd GROUP BY extract(month), kind, categoryId WHERE household + kind IN income/expense + date BETWEEN year-01-01 y year-12-31; (2) forecasts pending JOIN recurrences (kind + categoryId) WHERE status='pending' + matched IS NULL + expectedDate BETWEEN max(today, year-01-01) y year-12-31, con conversión a USD via `getFxRate` row-by-row; (3) budgets SUM por categoryId del año; (4) financial_goals row con fallback a defaults

Sub-hito 7.B.4 (página + charts + nav):
- [x] `/reports/year-economy/page.tsx` (server): header con prev/next year, KPI cards row (4), bloque Trayectoria con badge de semáforo coloreado + 4 stats + Δ vs target, tabla categorías separada por kind (Income/Expense) con drill-down a `/transactions?categoryId=X&from=year-01-01&to=year-12-31` para hojas y badge "Inversión" para `isInvestment=true`
- [x] `/reports/year-economy/charts.tsx` (client): `SavingsChart` con `ReferenceLine` horizontal en target + barras coloreadas distinto si `isProjected`; `MonthlyChart` con stacked bars income/expense + line del neto, similar a `evolution/chart.tsx` pero año calendario
- [x] `reports-nav.tsx`: agregado 4to link "Año económico"
- [x] Validación verde: typecheck + lint + 176 tests + build (`/reports/year-economy` y `/settings/categorias` registradas) + `db:smoke-rls` 8/8

**Hito 7 cerrado.**

### 🟢 Hito 8 — Imports con AI parser

**8.A — Infra: storage, upload, hash dedup, lista (2026-05-20, hecho):**
- [x] Migración `0003_crazy_iron_man.sql`: `imports.file_hash text not null default ''` + idx `imports_household_hash_idx`
- [x] `scripts/setup-storage.ts` + `npm run storage:setup`: crea bucket privado `imports` (Supabase Storage), file size limit 20MB, allowed mime types PDF/CSV/XLSX. Idempotente
- [x] `lib/imports/storage.ts`: cliente Supabase service-role cacheado + `uploadImportFile` / `downloadImportFile` / `buildImportPath` / `hashBytes` (SHA-256 via `crypto.subtle`)
- [x] `lib/schemas/import.ts`: `importCreateMetaSchema` + helpers `parseImportCreateMeta`, `extractExtension` (PDF/CSV), `contentTypeForExt`; 11 tests
- [x] `app/actions/imports/create.ts`: server action que valida session + meta + file, hashea, dedup contra confirmed con mismo hash (warning + flag `force=1` para override), insert imports row con status=uploaded, upload a Storage. Rollback de row si falla el upload
- [x] UI: `/imports/page.tsx` (lista con status badge tonado), `/imports/new/page.tsx` + `import-upload-form.tsx` (Select institución + Select type + file input, manejo del estado duplicate con botón "Re-importar igual"), `/imports/[id]/page.tsx` (detalle metadata + hash + status)
- [x] Nav link "Imports" en layout protegido
- [x] Validación verde: typecheck + lint + 192 tests + build + `db:smoke-rls` 8/8

**8.B — Parser Galicia TC (Amex/Visa/Master) + revisión + confirm (2026-05-20, hecho):**
- [x] `npm i @anthropic-ai/sdk` (0.97.x)
- [x] `lib/env.ts` + `.env.example`: `ANTHROPIC_API_KEY` + `IMPORT_PARSER_MODEL_DEFAULT='claude-sonnet-4-6'` + `IMPORT_PARSER_MODEL_CHEAP='claude-haiku-4-5-20251001'`
- [x] `lib/imports/llm.ts`: `runParser({modelId, systemPrompt, userPrompt, file: pdf|text, outputSchema})` con `LlmError` tipado y reintento 1 vez si JSON inválido / schema mismatch. Extrae JSON puro defensivamente del output (busca `{...}` outer). Soporta content blocks PDF (base64 document) y CSV (text)
- [x] `lib/imports/parsers/types.ts`: `Parser` interface + `parsedTxLineSchema` (date YYYY-MM-DD, description, amountOriginal numérico, currencyOriginal ARS|USD, kind income|expense, merchant?, notes?) + `parserOutputSchema = { lines: [...] }`; 6 tests
- [x] `lib/imports/parsers/galicia-tc.ts`: prompt ES con reglas estrictas (no PAN/CBU/credenciales, ignorar totales/subtotales, una línea por tx, cuotas como una sola línea con monto del mes)
- [x] `lib/imports/parsers/registry.ts`: `resolveParser(institutionName, importType)` por match de regex + tipo; 4 tests
- [x] `lib/imports/category-suggest.ts`: match exacto case-insensitive contra histórico de `transactions.description` agrupado por categoría, devuelve la más frecuente o null. V1 sin match parcial
- [x] `app/actions/imports/parse.ts`: server action que valida session + status, baja archivo de Storage, llama LLM, inserta `import_lines` con `proposed_category_id` sugerida, actualiza `imports.status` a `parsed`. Loggea solo IDs + counts, jamás contenido
- [x] `app/actions/imports/set-line-status.ts`: server action para accept/reject/pending por línea o bulk con `inArray`
- [x] `app/actions/imports/update-line.ts`: server action para edit inline; valida que la category nueva matchee el `kind`; persiste `parsed_data` actualizada + status='edited'
- [x] `app/actions/imports/confirm.ts`: server action que reusa `buildTransactionFields` del Hito 3.B; recibe `accountId` común a todas las líneas; itera accepted+edited; crea txns con `source='import'` + `importBatchId`; linkea `import_lines.transaction_id`; transacción atómica con `db.transaction`; reporta `lineErrors` para casos individuales fallidos pero no aborta el batch entero
- [x] UI ampliada en `/imports/[id]/page.tsx`: botón "Parsear con LLM" si status uploaded/error, mensaje de parsing, `<ImportReview>` con tabla editable
- [x] `parse-button.tsx`: client component dispara `parseImport` con `useTransition` + toast
- [x] `import-review.tsx`: tabla con badges de status, edit inline por fila (date/description/kind/amount/currency/category via shadcn Select), bulk accept/reject pending, summary counts (pending/accepted/edited/rejected), Select de cuenta destino + botón Confirmar deshabilitado si no hay aceptadas
- [x] Validación verde: typecheck + lint + 202 tests + build + `db:smoke-rls` 8/8

**8.C — Parser ICBC TC + Caja Ahorro (2026-05-20, hecho):**
- [x] `lib/imports/parsers/icbc-tc.ts`: prompt para resúmenes TC ICBC (Visa). Separación por moneda, cuotas como línea del mes
- [x] `lib/imports/parsers/icbc-banco.ts`: prompt para caja de ahorro ICBC. Trata transferencias como movimientos (el usuario decide si reclassificar en revisión); ignora saldos y filas resumen
- [x] Sumados al registry; tests actualizados (5 tests del registry: galicia/icbc-tc/icbc-banco/desconocida)
- [x] Validación verde: typecheck + lint + 203 tests + build

**8.D — Parser HSBC US (TC + Cuenta, PDF + CSV) (2026-05-20, hecho):**
- [x] `lib/imports/parsers/hsbc-us-tc.ts`: prompt EN para resúmenes TC HSBC US (USD-only, sin separación de moneda)
- [x] `lib/imports/parsers/hsbc-us-banco.ts`: prompt EN para statement de cuenta HSBC US (acepta tanto PDF como CSV)
- [x] **Refactor del dispatch**: el `mimeKind` del Parser se eliminó. El runner del server action decide pdf vs text por la **extensión del archivo** (`fileUrl.endsWith('.csv')`), no por el parser. Permite que un mismo parser acepte ambos formatos sin duplicar
- [x] Match institución HSBC US: regex `/^hsbc(\s|-)?us$/i` cubre "HSBC US" (con espacio, como en seed) y "hsbc-us"
- [x] Tests del registry sumados (los 5 parsers listados); 204 tests totales
- [x] Validación verde: typecheck + lint + 204 tests + build

**8.E — Cierre Hito 8 (2026-05-20, hecho):**
- [x] CLAUDE.md actualizado: `claude-sonnet-4-6` / `claude-haiku-4-5-20251001` como defaults
- [x] STATUS.md actualizado con cierre
- [x] Validación verde final: typecheck + lint + 204 tests + build + `db:smoke-rls` 8/8

**Hito 8 cerrado — Imports end-to-end para Galicia + ICBC + HSBC US.**

**Acción operacional manual pendiente del usuario:**
- Setear `ANTHROPIC_API_KEY` en `.env.local` y en Vercel Production.
- Correr `npm run storage:setup` para crear el bucket privado `imports` en Supabase (o crearlo desde Supabase Studio: bucket "imports", privado, file size limit 20MB).

### 🟢 Hito 9 — Export contador

**9.A — Schema/form: subtype, meta domestic_service, deducible (2026-05-20, hecho):**
- [x] `lib/schemas/transaction.ts`: agregados `transactionSubtype` enum ('standard'|'domestic_service'), `deducibleGanancias` boolean, `meta` jsonb con `domesticServiceMetaSchema` (empleado_nombre, empleado_cuil regex `##-########-#`, concepto enum sueldo/aporte/aguinaldo, periodo YYYY-MM). `superRefine`: domestic_service exige meta + solo aplica a expense
- [x] `parseTransactionFormData` lee los nuevos campos del FormData (incluye prefijo `meta_` para los 4 fields condicionales)
- [x] `app/(protected)/transactions/transaction-form.tsx`: bloque nuevo con checkbox Deducible + Select Subtipo (solo visible si kind=expense) + render condicional de los 4 inputs domestic_service
- [x] `app/actions/transactions/_build.ts`: `BuiltTransactionFields` extendido con los 3 nuevos campos; se propaga a `create.ts` y `update.ts` (este último ya usaba `set(built.fields)` así que sin cambios)
- [x] `app/actions/imports/confirm.ts`: actualizado para pasar defaults (`'standard'`, `false`, `null`) al `buildTransactionFields` desde el flow de imports
- [x] `app/(protected)/transactions/[id]/page.tsx`: edit page carga `transactionSubtype`, `deducibleGanancias` y `meta` desde el row y los pasa al form
- [x] Tests Zod: +9 (defaults, validación CUIL/periodo, mismatch kind, parseFormData con nuevos campos)

**9.B — CSV utility + 5 builders + README puros (2026-05-20, hecho):**
- [x] `npm i jszip` (3.10.x)
- [x] `lib/exports/csv.ts`: `toCsv(rows, headers)` con BOM UTF-8, CRLF, escape de comillas/comas/newlines; 7 tests
- [x] `lib/exports/types.ts`: types compartidos `ExportTx`, `ExportAccount`, `ExportCategory` + helpers `monthOf`, `yearOf`
- [x] `lib/exports/ingresos.ts`: filtra kind='income', sorted by date, columnas multi-moneda (original + USD + ARS)
- [x] `lib/exports/consumos-tc.ts`: filtra account.type='credit_card' + kind='expense'; agrupa por (account, mes, moneda) con totales y count
- [x] `lib/exports/servicio-domestico.ts`: filtra subtype='domestic_service'; expande meta jsonb a columnas (parsea con `domesticServiceMetaSchema`, skipea si meta inválida)
- [x] `lib/exports/gastos-deducibles.ts`: filtra `deducibleGanancias=true`
- [x] `lib/exports/otros-ingresos.ts`: filtra income con categoria.name que NO matchea `/sueldo/i`. Heurística simple; V1.2 reemplaza por flag explícito
- [x] `lib/exports/readme.ts`: README con disclaimer del PRD §5.7 + lista de archivos + alcance + items patrimoniales V2
- [x] Tests builders: +10 (filter por tipo, sort, agregación TC, expand meta, skip meta inválida, deducible filter, sin sueldo)

**9.C — Zip + route handler (2026-05-20, hecho):**
- [x] `lib/exports/ganancias-data.ts`: loader que carga txns del año (WHERE date BETWEEN year-01-01 y year-12-31, household scoped) + accounts + categorías + nombre household. Devuelve `GananciasData`
- [x] `lib/exports/ganancias-zip.ts`: usa JSZip, llama a los 5 builders + README, genera Uint8Array con compression DEFLATE
- [x] `app/api/exports/ganancias/route.ts`: GET handler con `requireHouseholdSession()` (cookie auth), validación de `?year=` con Zod (rango 2020-2100), default año actual. Devuelve `Response` con `Content-Type: application/zip` + `Content-Disposition: attachment; filename=ganancias-{year}-{household-slug}.zip` + `Cache-Control: no-store`. No persiste — cumple PRD §7

**9.D — UI /exports + nav (2026-05-20, hecho):**
- [x] `app/(protected)/exports/page.tsx` (server): header + card con descripción del Ganancias export + selector año + botón descarga + bloque amber con disclaimer "cubre ~30% del checklist, patrimoniales V2"
- [x] `app/(protected)/exports/exports-client.tsx`: client component con Select de año (6 años hacia atrás) + Button asChild con `<a href download>` que apunta al route handler. Sin fetch ni transición — el browser descarga directo
- [x] Nav link "Exports" en layout protegido entre "Imports" y "Etiquetas"

**9.E — Validación + cierre (2026-05-20, hecho):**
- [x] Validación verde: typecheck + lint + 236 tests + build (`/exports` y `/api/exports/ganancias` registradas) + `db:smoke-rls` 8/8

**Hito 9 cerrado.**

### 🟢 Hito 10 — Backups Drive (V1.1 funcional 🎉)

**10.A — Deps + helper Drive + env vars (2026-05-20, hecho):**
- [x] `npm i googleapis` (oficial; JWT auth refresh automático)
- [x] `lib/env.ts` + `.env.example`: `GOOGLE_SERVICE_ACCOUNT_KEY_B64` (optional; key del service account base64-encoded para sobrevivir al multi-line JSON) y `GOOGLE_DRIVE_BACKUP_FOLDER_ID` (optional)
- [x] `lib/backups/drive.ts`: cliente cacheado con `google.auth.JWT` (scope `drive.file`); helpers `uploadBackup` (POST multipart con stream), `listBackups` (orderBy createdTime desc), `deleteFile`, `getBackupFolderId`. `DriveConfigError` tipado para distinguir fallos de setup vs runtime

**10.B — Snapshot DB puro (2026-05-20, hecho):**
- [x] `lib/backups/snapshot.ts`: `loadHouseholdSnapshot(householdId)` carga 16 tablas en paralelo via `Promise.all`. Tablas household-scoped filtran por `household_id`; `fx_rates` e `institutions` van enteras (sin filter). `auth.users` ignorada. `transaction_tags`, `forecasts` e `import_lines` se cargan en pasos separados via `inArray` sobre los ids ya filtrados

**10.C — Zip builder + tests (2026-05-20, hecho):**
- [x] `lib/backups/build-zip.ts`: usa JSZip (ya instalado en Hito 9). Genera `snapshot.json` (dump JSON formateado) + `tables/{name}.csv` por cada tabla (reusa `toCsv` de `lib/exports/csv.ts`) + `README.txt` con conteo de filas + procedimiento manual de restore
- [x] Tests: 5 (shape del zip, contenido JSON, CSVs vacíos con marker, headers UTF-8 BOM, README con contadores)

**10.D — Cron route + prune + vercel.json (2026-05-20, hecho):**
- [x] `lib/backups/prune.ts`: `pruneOldBackups(files, keep)` pura, devuelve los archivos a borrar para mantener los `keep` más recientes. Constante `BACKUP_RETENTION = 12`. 5 tests
- [x] `lib/backups/run.ts`: orquesta `loadHouseholdSnapshot` → `buildBackupZip` → `uploadBackup` (filename `gd-finanzas-backup-YYYY-MM-DD.zip`, con sufijo `-1`/`-2` si colisiona el mismo día) → `listBackups` + `pruneOldBackups` → `deleteFile` los excedentes. Compartido entre cron y server action
- [x] `app/api/cron/backup-drive/route.ts`: GET con `Authorization: Bearer ${CRON_SECRET}`, resuelve household (asume 1 — V1), llama `runBackup`. Loggea solo nombres + size + counts, nunca contenido. Devuelve 500 si DriveConfigError, 500 si backup_failed
- [x] `vercel.json`: schedule `0 2 * * 1` (lunes 02:00 UTC ≈ domingo 23:00 AR)

**10.E — UI /settings/backups + sub-nav (2026-05-20, hecho):**
- [x] `app/actions/backups/run-now.ts`: server action `runBackupNow()` con cookie auth via `requireHouseholdSession`. Llama al mismo `runBackup` que el cron. Returns filename + sizeBytes + deleted count
- [x] `/settings/backups/page.tsx` (server): lista `listBackups()` con tabla (Nombre, Creado, Tamaño, Link a Drive). Empty state + banner amber si `DriveConfigError` (setup pendiente). Card con botón "Backup ahora"
- [x] `run-now-button.tsx` (client): `useTransition` + toast del resultado + `router.refresh()`
- [x] `SettingsNav` ampliado con 3er link "Backups"
- [x] Validación verde: typecheck + lint + 246 tests + build + db:smoke-rls 8/8

**Hito 10 cerrado — V1.1 funcional COMPLETO. 🎉**

**Setup operacional (completado 2026-05-21 vía PR #2):** el plan original de
SA + JSON key no funciona en gmail.com (sin storage quota). Migramos a OAuth
user creds. Pasos archivados en la sección "Operacional pendiente al cierre
de V1.1" abajo y en `.env.example`.

### 🟢 Hito UI — Polish V1.1 (2026-05-20)

Post-V1.1 funcional, antes de cargar info real:

**UI.A — Theme foundation (Geist + emerald + dark mode):**
- [x] `npm i geist` — package oficial Vercel
- [x] `app/layout.tsx`: aplica `GeistSans.variable` + `GeistMono.variable` al `<html>`; script anti-flash inline en `<head>` que lee `localStorage` antes del hydrate y aplica class `dark` (evita flicker)
- [x] `app/globals.css` reescrito con Tailwind v4 `@theme` + `@custom-variant dark`. Paleta nueva basada en neutrals + emerald accent. Variables CSS en `:root` (light) y `.dark` (dark). `--color-sidebar` separada para el sidebar
- [x] `components/theme/theme-toggle.tsx`: usa `useSyncExternalStore` para leer localStorage (evita el lint `react-hooks/set-state-in-effect`). 3 estados: light/dark/system; cicla en click. Lucide icons Sun/Moon/Monitor
- [x] Suscripción a `(prefers-color-scheme: dark)` cuando theme='system' para responder a cambios del OS en vivo

**UI.B — Sidebar nav + responsive:**
- [x] `components/nav/sidebar-sections.ts`: definición declarativa de las 5 secciones (Operar/Planificar/Reportes/Tools/Settings) + `isActiveLink(pathname, link)` helper con soporte de `matchPrefix` para que `/transactions/[id]` también marque activo el item "Transacciones"
- [x] `components/nav/sidebar.tsx` (client): sidebar 256px con header (logo) + scrollable middle (5 secciones con sub-headers small-caps) + footer (user + ThemeToggle + Salir). Highlight con `bg-primary/10 text-primary` para active
- [x] `components/nav/mobile-nav.tsx` (client): hamburguesa + drawer custom sin Radix Dialog (50 líneas vs ~80KB de dep). Backdrop con blur, lock scroll del body mientras abierto
- [x] `app/(protected)/layout.tsx` reescrito: grid 2 cols (sidebar fija desktop, main fluido). Top bar mobile-only con hamburguesa + brand + theme toggle. Eliminado el old top-nav de 11 links flat
- [x] `SettingsNav` eliminado (sidebar reemplaza la navegación entre Metas/Categorías/Backups). `ReportsNav` se mantiene como breadcrumb interno de reportes (patrón complementario válido)

**UI.C — Dashboard polish:**
- [x] `lib/reports/dashboard-data.ts` ampliado: nuevo campo `monthly: DashboardMonthPoint[]` con últimos 6 meses (income/expense/net por mes). Query agrupa por `extract(year/month from date)` + kind. Gaps se llenan con 0
- [x] `components/dashboard/sparkline-kpi-card.tsx` (client): card con label + value + delta tinted (good/bad/neutral) + mini area chart (recharts) con gradient stop. 4 colors: emerald/rose/violet/sky
- [x] `app/(protected)/dashboard/page.tsx` re-layout: header con título prominente y mes, grid 4 KPIs (Ingresos / Gastos / Neto / Tasa de ahorro) cada uno con sparkline + Δ vs mes anterior. Top 5 gastos con barras horizontales (rose-500/70 sobre muted). Próximas previsiones cap 8 en lugar de unlimited. Recent txns con badges tinted dark-aware

**UI.D — /transactions polish + bulk actions:**
- [x] Filtros wrapped en `<details>` collapsible, default cerrado cuando no hay filtros activos, abierto si alguno seteado
- [x] Chips de filtros activos arriba del details cuando hay alguno (Tipo / Cuenta / Categoría / Tag / Desde / Hasta / Texto) + link "Limpiar"
- [x] `app/(protected)/transactions/transactions-table.tsx` (client): wrapper que recibe rows + categorías del server. State de `Set<string>` para selected ids
- [x] Agrupación visual por día: filas-separador con la fecha formateada (`dd MMM yyyy`)
- [x] Bulk panel: aparece cuando hay >=1 seleccionada. Muestra count + Select de categoría (filtrado por kind uniforme; deshabilitado si selección con kinds mixtos) + botones "Aplicar" / "Borrar N" / "Limpiar"
- [x] `app/actions/transactions/bulk-delete.ts`: server action que borra batch + extiende a transfer_pair_id (mismo helper que delete individual, scopeado a household)
- [x] `app/actions/transactions/bulk-set-category.ts`: filtra mismatches de kind y reporta `skipped`; igual patrón que el bulk de imports

**UI.E — Validación + cierre:**
- [x] typecheck + lint + 246 tests + build + `db:smoke-rls` 8/8

**Sub-Hito UI cerrado.**

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

## Decisiones tomadas en Hito UI

- **Sidebar lateral fija (no top-nav)** decidido por el usuario. Patrón clásico para apps con muchas rutas (Linear/Notion). Mejor uso del espacio vertical en mobile y más espacio para el contenido principal.
- **Geist (Vercel) como tipografía** vs Inter porque suma identidad visual sin costo. Cargada via `geist/font` package que Next 16 inyecta como CSS var.
- **Accent emerald** coherente con "cashflow positivo" y el verde que ya había en reportes. La paleta entera se reorganizó alrededor del emerald-600 como primary.
- **Dark mode con 3 estados (light/dark/system)** y class-based, no media-query-based. Permite override manual independiente del OS. localStorage `gd-theme` + script anti-flash inline en `<head>` para evitar flicker en SSR hydration.
- **`useSyncExternalStore` para leer el theme del localStorage** en lugar de `useEffect + useState`, para satisfacer el lint `react-hooks/set-state-in-effect` que recién apareció en eslint-plugin-react-hooks 5. Es el patrón oficial recomendado por React docs para state externo.
- **Mobile drawer custom sin Radix Dialog**: `useState` + Tailwind transforms + portal-less. 50 líneas vs ~80KB de dep. Si en V2 emerge necesidad de modales complejos, migramos a Radix.
- **No persistencia del state "drawer open" entre navegaciones**: cuando user clickea un link en el drawer, `onNavigate` lo cierra; si navega por back-button del browser, el drawer queda abierto (edge case aceptable, X button siempre sirve). Eliminé el `useEffect(() => setOpen(false), [pathname])` por conflicto con `set-state-in-effect`.
- **`SettingsNav` eliminado** porque el sidebar lista Metas/Categorías/Backups directo. **`ReportsNav` se mantiene** porque es patrón complementario (breadcrumb interno entre reportes hermanos) y costo cero de mantener.
- **CSS vars `--background`, `--foreground`, etc. + `--color-*` derivados** patrón shadcn-compatible. Las vars base viven en `:root` / `.dark`; las `--color-*` las consume Tailwind v4 via `@theme`. Permite cambiar paleta entera tocando solo 2 bloques.
- **Sparklines con `recharts.AreaChart` + gradient stop**, no librería separada (sparkline.js, etc.). Recharts ya está, y el costo de un mini-chart es bajo. `isAnimationActive={false}` para que carguen instantáneo (mini-charts no merecen animación).
- **Tasa de ahorro como 4to KPI** en el dashboard. Calculada en el server: `(income - expense) / income * 100`. Sin investment categories (eso es Reporte D); el dashboard mantiene la versión simple. Δ vs mes anterior expresado en "pp" (percentage points) para diferenciar de cambio porcentual relativo.
- **Top 5 gastos con mini-bars** (`bg-rose-500/70` sobre `bg-muted`) en lugar de bar chart con recharts. Más liviano y suficiente. La proporción es relativa al máximo del top 5 (no al gasto total) — destaca el delta entre las primeras.
- **Bulk actions en `/transactions` solo delete + recategorize**: bulk-set-deducible postergado a iteración posterior. Cada bulk action es ~80 líneas (server action) + UI. Las dos elegidas son las que más friction tenían en el day-to-day.
- **Bulk delete extiende a transfer_pair_id**: si selecciono solo la pata "out" de una transfer, también borra la "in". Mismo patrón que el delete individual de Hito 3.C.
- **Bulk recategorize filtra mismatches de kind**: idéntico patrón al bulk de imports. Si selecciono una income y una expense y aplico una cat de expense, la income se skipea y se reporta `skipped: 1`. Transfers se ignoran completamente (no tienen categoría).
- **Agrupación visual por día en la tabla**: row-separador con la fecha formateada (`dd MMM yyyy`) cuando cambia. Más fácil escanear que ver 50 filas planas con la columna fecha repitiéndose.
- **Filtros activos como chips** arriba del details. UX inspirado en Gmail/Linear: los chips dicen lo que se está filtrando sin tener que abrir el panel.

## Decisiones tomadas en Hito 10

- **Service Account, no OAuth user-flow**. Razón: el cron necesita identidad estable que no expire ni requiera re-auth. Setup operacional one-time (compartir carpeta de Drive con el SA email). La carpeta queda owned por la cuenta personal (tuya/Pau) que la creó, no por el SA — eso es OK porque ustedes la comparten.
- **Service account key en env var base64-encoded**, no como path a archivo. Razón: Vercel no soporta archivos en runtime, y el JSON multi-line de Google rompe parsers de `.env`. Base64 lo aplana a una sola línea. Decode + JSON.parse en runtime.
- **Scope drive.file** (no `drive` completo). Suficiente porque el SA solo accede a archivos que él mismo crea o que le fueron compartidos. Si la carpeta destino le fue compartida con rol Editor, puede listar + upload + delete ahí. Mínimo privilegio.
- **Backup solo de DB**, sin PDFs del bucket Storage (decisión user-side esta conversación). Razón PRD literal §5.8 dice "CSV de todas las tablas + dump JSON" — no menciona Storage. Los PDFs originales son data del banco, re-descargables.
- **16 tablas en el snapshot**, incluyendo `households`, `household_members`, `profiles` (las 3 de identity/tenancy) + `fx_rates` e `institutions` globales sin filter. Si en V2 hay restore, el zip por sí solo basta para hidratar la DB sin necesitar otros recursos.
- **`auth.users` queda fuera** del backup. No es nuestra tabla — Supabase la maneja, y en un restore eventual los users se re-crean por su lado (los `profiles.id = auth.users.id`).
- **README dentro del zip** con conteo de filas + procedimiento manual de restore. Importante porque V1 no tiene restore automático; si en algún momento hay que restaurar, el README guía. Cuando V2 sume restore endpoint, este README se simplifica.
- **Filename `gd-finanzas-backup-YYYY-MM-DD.zip` con sufijo `-1`, `-2` si colisiona**. Importante para "Backup ahora" disparado el mismo día que el cron — no pisa el del cron, suma un siguiente.
- **Retención 12 backups (no "12 semanas estrictas")**: si por algún motivo se acumulan 14 (ej. dos manuales en un día), el prune se aplica a los 12 más recientes igual. Garantiza límite duro de archivos.
- **Re-list después del upload** para incluir el recién subido en el orden por `createdTime desc`. Defensa contra race conditions teóricas (en V1 con 2 users no debería importar).
- **Cron schedule `0 2 * * 1`**: lunes 02:00 UTC = domingo 23:00 AR. PRD dice "domingo 23:00" en local time, traducido a UTC con UTC-3.
- **`runBackup(householdId)` compartido** entre cron route y server action. Único path para hacer un backup. El caller hace su propia auth (Bearer para cron, cookie para UI).
- **DriveConfigError tipado** vs errores genéricos. Permite al UI mostrar "setup pendiente" con instrucciones específicas en lugar de un toast genérico. El cron también lo distingue para responder 500 con razón clara.
- **Env vars Google `optional()`** en `lib/env.ts`. Razón: el resto de la app debe poder correr sin Drive configurado (dev local, primer deploy a Vercel antes del setup). El `DriveConfigError` se levanta solo si alguien llama a `getDriveClient()` sin las vars.
- **Sin notificación post-cron** (mail / Slack / Sentry). PRD V1 no lo pide; si falla, Vercel logs muestran el error y `/settings/backups` mostraría una caída en la lista. Sumar en V2 si surge necesidad.

## Decisiones tomadas en Hito 9

- **Sumamos UI mínimo para `transaction_subtype` y `deducible_ganancias` en el form de tx** en este mismo hito. Razón: sin esos campos el CSV 03 (servicio doméstico) y el 04 (deducibles) salen vacíos. Postergarlos a V1.2 dejaba el export a medias. Costo: ~80 líneas adicionales al form.
- **`domesticServiceMetaSchema` con regex CUIL `##-########-#` y periodo `YYYY-MM`**: el contador necesita CUIL bien formado para procesar. Validación strict en Zod; el form usa `<input type="month">` para el periodo, lo que evita errores de formato.
- **Servicio doméstico solo aplica a expense** (refine en el schema). Si el user setea kind=income con subtype=domestic_service, falla la validación. Decisión: no se modela "income" de servicio doméstico (esa plata no entra al household). El form también auto-resetea el subtype a 'standard' si el kind cambia a income.
- **05_otros_ingresos heurística por nombre** (`/sueldo/i NOT IN categoria.name`). V1 simple, sin schema change. Cuando se cierre la taxonomía con Nico, se reemplaza por flag explícito o lista hardcoded de category IDs. Heurística cubre los 2 categorías del seed real ("Sueldo Nico", "Sueldo Pau" → quedan en 01, no en 05).
- **Zip on-the-fly, sin Storage**. Route handler genera Uint8Array en memoria y responde directo con `Content-Type: application/zip`. Cumple PRD §7 "no persistir >24h" por default. Sin retención que gestionar, sin cron de cleanup, sin signed URLs. Cuando V2 quiera historial de exports, se mueve a Storage.
- **CSV format: UTF-8 con BOM + CRLF + comillas dobles condicionales** (solo si el valor contiene `,`, `"`, `\n` o `\r`). Excel-friendly. CRLF (no LF) porque algunos parsers contables AR esperan ese line ending. BOM para que Excel detecte UTF-8 (sino lee como Latin-1).
- **Money en 3 columnas separadas** (`amount_original` + `monto_usd` + `monto_ars`) — el contador elige cuál usar. Triple ancho del CSV pero ahorra que pregunte "che, ¿esto era USD o ARS?".
- **Consumos TC agrupados por (account, mes, moneda)** con count + totales, no fila por consumo individual. Ahorra ruido al contador; si quiere detalle por consumo va al 01_ingresos o a `/transactions`. Decisión basada en PRD §5.7 "totales por tarjeta y moneda".
- **Servicio doméstico saltea silenciosamente filas con meta inválida** (sin meta o meta corrupta). Defensa: si por bug se persistió una tx con subtype='domestic_service' sin meta, no rompe el export — solo desaparece esa fila del CSV. Si surge un caso así, se ve en `/transactions` y se corrige.
- **Sin cron de FX backfill en este hito**: el export usa `amount_usd` y `amount_ars` que ya están persistidos por la transacción al momento de crearla. No requiere ningún recálculo de FX.
- **Categoría 'Alquileres' NO se suma al seed**: se confía en que cuando Nico cierre la taxonomía la creará. Mientras tanto la heurística `/sueldo/i NOT IN` agarra cualquier income que no sea sueldo y la mete en 05.
- **`requireHouseholdSession()` funciona en route handlers** porque internamente usa `createClient()` de `@supabase/ssr` que lee cookies del request. Sin necesidad de Bearer auth especial — la cookie está presente porque el browser la envía en el `<a href download>`.
- **Filename del zip incluye slug del household**: `ganancias-2026-garaglio-dasso.zip`. Permite tener exports de múltiples households (si en V2 hubiera más) en una sola carpeta sin colisión.

## Decisiones tomadas en Hito 8

- **Alcance V1.1 expandido a Galicia + ICBC + HSBC US** (las 3 prioridad alta del PRD §12). Balanz/Cocos/BNA/MP postergan a V1.2.
- **Modelos Anthropic actualizados**: el PRD/CLAUDE.md originales hablaban de Sonnet 4-5, que está deprecated. Se actualiza a `claude-sonnet-4-6` (default) y `claude-haiku-4-5-20251001` (modo barato). Ambos IDs viven en env vars (`IMPORT_PARSER_MODEL_DEFAULT`, `IMPORT_PARSER_MODEL_CHEAP`) para poder rotar sin redeploy.
- **Dedup por hash SHA-256 del archivo, no por filename**: nueva columna `imports.file_hash` + idx `(household, hash)`. Si re-subo el mismo PDF y ya hay un import `confirmed` con ese hash, se muestra warning bloqueante con botón "Re-importar igual" (flag `force=1`). Hash se calcula con `crypto.subtle.digest`, no requiere lib externa.
- **Bucket Storage privado, sin policies, acceso solo service-role server-side**. Path convention `{householdId}/{importId}.{ext}`. El bucket no tiene RLS — la separación por household la enforce el server action verificando `householdId` antes de cualquier download/insert.
- **Sync, no async, para el parsing LLM**. Server action `parseImport` espera la respuesta de Anthropic (5-15s típicos). En Vercel Hobby el timeout es 60s; un PDF muy grande podría acercarse al límite — mitigación: el prompt pide JSON conciso y se acepta cap de 8000 max_tokens. Si emerge timeout en producción, migrar a job async (V1.2).
- **Status `parsing` se setea ANTES del LLM call, no después**, para que el botón refleje el estado intermedio si el user refresca durante la corrida. Si falla → status='error' con `error_message` legible.
- **Reintento 1 vez si JSON inválido o schema mismatch**, no retry para `api_failure`. Si la API de Anthropic falla, error de infra → no tiene sentido reintentar inmediatamente. El usuario aprieta de nuevo "Parsear" si quiere.
- **Defensa contra credenciales en prompt, no en post-procesamiento regex**. El system prompt es explícito ("NUNCA incluyas números de tarjeta, CBU, alias, claves"). Confiar en el modelo es aceptable para V1; un regex post-LLM se suma en V1.2 si emerge un caso concreto.
- **`raw_data` y `parsed_data` ambos guardan la línea como devuelta por el LLM**. En este hito no hay diff entre las dos — sería distinto si el parser hiciera pre-procesamiento (ej. masking) sobre `raw` para producir `parsed`. Queda igual estructura para mantener flexibilidad.
- **Sugerencia de categoría V1 solo match exacto**, case-insensitive, agrupado por count desc para "más frecuente cuando hay múltiples categorías históricas". Match parcial (tokens, substring) queda para V1.2 — necesita más data histórica para tunear.
- **`accountId` se pasa una sola vez al confirm, no por línea**. Cada import es de una cuenta (resumen Galicia Amex = account Galicia Amex). Forzar al user a elegir 1 vez antes de confirmar es más rápido que setearlo por fila. Si en V2 emerge un import multi-cuenta (raro), se agrega selector por línea.
- **El parser ya NO declara `mimeKind`** después del refactor en 8.D. El runner del server action elige PDF (document block base64) o text (CSV crudo) según la extensión real del archivo en Storage. Permite que un mismo parser acepte ambos formatos sin duplicar (caso HSBC US Cuenta).
- **Confirm es batch atómico (`db.transaction`) pero tolera errores por fila**: si una línea individual falla la validación de buildTransactionFields (ej. FX no disponible para esa fecha), se reporta en `lineErrors` y se sigue con las demás. Solo aborta el batch entero si hay un error de DB unexpected.
- **Linkeo bidireccional**: `import_lines.transaction_id` apunta a la tx creada; `transactions.import_batch_id` apunta al import. Permite drill-down en ambas direcciones para auditoría.
- **`source='import'` en cada tx creada** distingue de manual/recurring_match en el filtro de transacciones futuro.
- **Editing inline marca status='edited'** (PRD §5.2 enum). El UI distingue accepted vs edited con badges separados pero el confirm los trata igual (ambos generan tx).
- **Sub-nav del Hito 7.A (`/settings/categorias`) no se modifica acá** — el flag `is_investment` no se sugiere desde imports.

## Decisiones tomadas en Hito 7.B

- **"Ahorro mensual" = neto + categorías de inversión**. Razón: pagos a Rabbit Hole / Tijeritas (y futuras inversiones fuera del household) hoy caen como `expense`; restarlos del neto haría que el target USD 5.700/mes nunca cierre para alguien que invierte. Las inversiones via broker accounts (Balanz, Cocos, ICBC broker) ya son invisibles al cashflow (transfers entre cuentas), no requieren tratamiento especial.
- **Flag `is_investment` se modela en `categories` table, no en config hardcoded**. Migración `0002_marvelous_jocasta.sql` agrega `boolean default false`. UX minimal `/settings/categorias` (toggle por fila, sólo expense leaves) — sin alta/edit/baja porque eso espera la sesión taxonomy con Nico. Match por id, no por nombre — sobrevive renames.
- **Sub-nav settings reutilizable** (`settings-nav.tsx`) en lugar de convertir `/settings` en hub con cards. Nav link único del layout ("Settings" → `/settings` → redirect a metas); el sub-nav cubre la navegación entre sub-páginas. Patrón hermano de `reports-nav.tsx`.
- **Proyección a dic = real YTD + suma de forecasts pending hasta dic 31**. Incluye income+expense forecasts (no solo expense), reflejando lo que el plan dice que va a pasar. Forecasts ya matched o cancelled no se cuentan. Forecasts del año pasado ya quedaron como `missed` por el cron de 4.B y no entran.
- **`monthsElapsed` clamp**: año pasado → 12; año futuro → 0; año actual → `today.month`. Mes en curso cuenta como "transcurrido" para la trayectoria, aunque puede ser parcial. Sobreestima ligeramente el "expected" del mes en curso vs lo real ahorrado hasta hoy; aceptable porque la app es semestral, no diaria.
- **Semáforo thresholds: ≥100% green / ≥80% yellow / <80% red / `expected=0` neutral**. Hardcoded en la función pura, no configurables. Si Pau quiere ajustar la sensibilidad del semáforo, se cambia en código.
- **Conversión USD de forecasts row-by-row con `getFxRate`**, sin batch. Mismo patrón que `_candidates.ts`. A esta escala (decenas de forecasts en un año) es invisible. Si en V2 hay miles, batch.
- **Per-categoría: parent agrega children, parent no recibe budget propio**. Consistente con Hito 5.A. `realYtdUsd` y `projectedDecUsd` de parent = suma de children. Si una categoría tiene budget cargado pero también children con budgets, los dos se suman (no se valida porque es input UX del Hito 5.A — leaf-only).
- **forecasts con `categoryId=null` (recurrence sin categoría)**: se cuentan en KPIs y en monthly buckets, pero no aparecen en categoryRows (no tienen home). Caso raro porque las recurrences income/expense típicas tienen categoría.
- **Real para meses futuros del año actual**: si el usuario carga una transacción manual con fecha futura (PRD lo permite), aporta a `projectedDec` pero no a `realYtd` (clamp por `monthsElapsed`). Evita inflar el "real YTD" con datos no realizados.
- **Charts en un solo archivo `charts.tsx`** que exporta `SavingsChart` + `MonthlyChart`. Comparten formatters de USD y axisCompact; separar en dos archivos era duplicación inútil. Recharts ya estaba (Hito 6.A).
- **`SavingsChart` con `Cell` por barra** para colorear meses proyectados con un indigo más claro (`#a5b4fc`) vs reales (`#4f46e5`). `ReferenceLine` horizontal en el target con label encima.
- **Tabla categorías separada en Income/Expense** (no en una sola con sección colapsable). Más simple y refleja la mental model.
- **Badge "Inversión"** como texto tinted (indigo), sin emoji. Mantiene el estilo del resto.
- **`/reports/year-economy` accepta `?year=YYYY` parsed con regex `^\\d{4}$` + rango [2020, 2100]**, default = año actual. Sin estado del backend; la navegación es por links GET con prev/next.

## Decisiones tomadas en Hito 7.A

- **Defaults en código (no en DB seed)**: `lib/financial-goals/defaults.ts` evita SQL manual para households nuevos. La primera vez que alguien entra a `/settings/metas`, ve los defaults; al guardar, se persisten. Si Pau cambia el plan en el futuro, lo edita desde la UI.
- **UPSERT por UNIQUE(household_id)** con `revisionAt` reset en cada save. PRD §5.9: "cada revisión sobrescribe; sin auditoría de cambios en V1". 2 users editan → last-write-wins.
- **`total_target_usd` NO se persiste**: lo calculo en vivo en el form (retiro + educación + buffer). El PRD lo lista como "calculado". Mantiene la fila lean y evita inconsistencia entre componentes y total.
- **`updated_by` muestra displayName** (de `profiles`, no de `auth.users`). El schema `auth.users` re-exportado por Drizzle solo expone `id` — sin email/etc. Para mostrar quien editó, joinear con `profiles.display_name`. Si display_name es null, queda como timestamp solo.
- **Edades 18-120 sanity bounds**: el plan financiero se piensa desde edad adulta y a futuro. Si alguien quiere edad <18 (ej. plan para hijo recién nacido), se replantea como objetivo separado en V2.
- **Notas hasta 2000 chars**: suficiente para resumir supuestos y próxima review. No es un diario de planning; ese viaja por fuera de la app.
- **`/settings` como hub** con redirect a `/settings/metas` por ahora. En V2 si hay más settings (moneda preferida, time zone, notifications), se vuelve un index.

## Decisiones tomadas en Hito 6.B

- **Ventana rolling de 12 meses**, no año calendario. PRD §5.6 dice "Evolución 12 meses"; lo interpreto como trailing 12 (intuitivo para trayectoria). Para ver año calendario, el user navega hasta dic.
- **Filtro de categoría exacto**, no incluye descendants. Si el user elige "Vivienda", solo cuenta movimientos asignados directamente a "Vivienda" (poco habitual: nuestra UX no permite presupuestar/contabilizar en parents porque las hojas son lo natural). Para "todo Vivienda" → ir al breakdown del mes. Si surge necesidad, recursive CTE en V2.
- **Gap-filling en JS, no SQL**: cargo el array de 12 meses con `rollingMonths`, agrupo los rows agregados y completo con 0 los meses sin data. Más simple que CTE de generate_series.
- **`extract(year/month FROM date)` en SQL** + GROUP BY: una sola query devuelve todos los buckets agregados. Drizzle no tiene helper nativo, uso `sql` template.
- **Eje Y compact** (k/M): para que números grandes en ARS no rompan el layout. `axisCompact` ad-hoc.
- **Línea de Neto en violeta** para no chocar con verde/rojo de las bars. Recharts `ComposedChart` permite mezclar `Bar` y `Line` sin issues.
- **Sin tabla auxiliar**: el chart es el reporte. Cards de totales 12m al pie cubren el quick glance numérico. Si Pau quiere CSV, lo agarra del export contador (Hito 9).
- **Form GET con hidden endYear/endMonth**: al "Aplicar" filtros, mantiene la ventana actual; mover ventana ◀/▶ preserva moneda + categoría via `buildHref`.

## Decisiones tomadas en Hito 6.A

- **Recharts 3.x para React 19**: instalación nueva. Bundle adicional ~80KB gz acotado a los reportes (client component split del donut). Aceptable.
- **Función pura `rollupBuckets`** separada del loader. Permite testear el agrupado parent/leaf sin DB. El input incluye `parentName`/`parentColor` para que el rollup pueda materializar la row del parent sin lookups extras.
- **`level='parent'` no permite drill-down** porque no hay un único `categoryId` (los parents agregan N children). Sólo filas leaf linkean a `/transactions`. Helper text explica.
- **Self-join en categories** via `alias(categories, 'parents')` para obtener nombre y color del parent en una sola query. Drizzle lo soporta nativamente.
- **Paleta fallback cíclica** para categorías sin color (`null` en DB). Determinista por índice; no por hash, pero suficiente para que dos categorías adyacentes no compartan tono.
- **`ReportsNav` componente compartido** en `app/(protected)/reports/reports-nav.tsx`. Cuando entre 6.B se agrega "Evolución" ahí.
- **Total en el centro del donut** absoluto, sin decimales. Empty state si no hay gastos.

## Decisiones tomadas en Hito 5.C

- **Sin selector de mes en V1**: el dashboard es "home" del mes en curso. Para ver otros meses, ir al reporte A. Mantiene la home pulcra.
- **4 queries en `Promise.all`**: totales (reusa cashflow data) + top 5 + forecasts 14d + recent 10. Latencia agregada ~150ms para 1 household; no merece caching.
- **Top 5 muestra hojas tal cual** (no agrupa parents en el dashboard). Consistente con cómo se cargan los gastos en la lista de transacciones; cuando se quiere ver agregado por parent, el reporte A lo hace.
- **Reuso de `deltaTone`** entre `/reports/cashflow` y `/dashboard` para colorear Δ consistentemente. Income+/Expense− = good (verde); el resto rojo o neutral.
- **Sin client components nuevos**: todo SSR. Las cards son shadcn `Card`/`CardHeader`/`CardContent`. Helpers de format duplicados (formatUsd, formatAmount) por ahora — refactor a `lib/format` queda para cuando duela.
- **Empty states por card** ("Sin gastos este mes", "Sin previsiones próximas", "Sin transacciones todavía"). Reduce confusión en mes nuevo o tras un wipe.

## Decisiones tomadas en Hito 5.B

- **Función pura `buildCashflowReport`** separada del loader. Permite testear la agregación + el ranking de signos sin DB. El loader server-side (`loadCashflowData`) hace los SUMs en SQL y pasa al pure builder.
- **SUM agrupado por `category_id` en SQL**, no en JS. Drizzle `sum(...).mapWith(String)` devuelve `numeric` como string ya canonicalizado.
- **Transfers excluidas via `kind IN ('income','expense')` + `category_id IS NOT NULL`** (defensa en profundidad — los transfers tienen `category_id = null` siempre).
- **`deltaPct = null` cuando budget=0**: la división por cero se muestra como "—" en UI, evita Infinity/NaN.
- **`deltaTone` encapsula la convención**: income+ = good, expense− = good. Net delta se trata como income (positivo bueno).
- **Drill-down via filtros existentes**: en lugar de una página `/reports/cashflow/transactions/X`, linkeo a `/transactions?categoryId=X&from=...&to=...`. Reusa el filtro de Hito 3.D.1 sin duplicar código.
- **Selector mes/año con prev/next links, sin form**. Más simple que un dropdown para 2026 V1 (1-2 años de historia). Si crece, hacer dropdown.
- **Cálculos en `Decimal`** (no `Number`) para evitar drift en SUMs grandes y porcentajes. Costo cero a esta escala.
- **Sin filtros account/tag en 5.B.** El PRD los menciona pero no son críticos para el primer reporte. Si surgen, 5.B.2.

## Decisiones tomadas en Hito 5.A

- **Budget solo en hojas** (PRD: granularidad categoría×mes, sin nivel). Parents con children muestran subtotal calculado read-only. La taxonomía actual deja a Vacaciones/Personales/Otros como leaves directos editables. Si en V2 hay 3 niveles, replantear.
- **`set 0` ≠ `clear`**: input vacío borra la fila (no presupuestado), `0` la deja con amount=0 (presupuesté cero explícito). Distinción útil para reportes que distinguen "no medido" vs "medido cero".
- **UPSERT por UNIQUE(household, year, month, category)** con `revision_at=now()` en cada save. PRD §5.5: "cada revisión sobrescribe". 2 users editando la misma cell → last-write-wins, sin warning.
- **Optimistic UI con `useTransition`**: actualizo el state local primero, dispara el server action en background, revierto si falla. Render sin spinner por cell (un único isPending compartido).
- **1 server action por cell, sin batch**: pegar valores masivos puede generar 50+ actions. Aceptable a esta escala (492 cells máx, <100ms cada). Si molesta, batch en 5.A.2.
- **`loadCategoryTree` ahora incluye `parentId`** para que el cliente sepa qué cat es hoja sin otra query. Costo cero (un campo más en el SELECT).
- **Past months disabled visual**: input `disabled` + `bg-muted/20`. Sin toggle de override en V1; si hace falta, lo agregamos en 5.A.2.
- **Mes en curso resaltado** con bg-sky-50 en el header. Identificable a primera vista cuál es el mes a actualizar.

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

## Operacional pendiente al cierre de V1.1

**1. Setup Google Drive (Hito 10): ✅ HECHO (2026-05-21)** vía OAuth user creds.

El plan original (service account + JSON key) **no funciona** contra cuentas
personales gmail.com: las SAs no tienen storage quota propia, así que el
upload falla con `Service Accounts do not have storage quota`. Las salidas
oficiales (Shared Drives, domain-wide delegation) son solo Workspace pago.

Migración (PR #2): JWT/SA → `OAuth2Client` con refresh token. El cron sube
los `.zip` "como el usuario" contra su quota de Drive (15 GB free).

Env vars en Vercel Production (todas Sensitive):
- `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REFRESH_TOKEN`
- `GOOGLE_DRIVE_BACKUP_FOLDER_ID`

Bootstrap del refresh token: `npm run oauth:drive-token` (abre browser,
autorizás, captura el token vía callback localhost y lo escribe a `.env.local`).
Re-correrlo solo si se revoca acceso o se cambia el OAuth Client.

OAuth consent screen está en estado **"In production"** (no "Testing"), por lo
que el refresh token no expira a los 7 días. El scope `drive.file` es
no-sensitive: Google muestra un warning "unverified app" al autorizar (lo
aceptamos manualmente) pero no exige verificación.

**Limpieza pendiente (no bloquea, hacer cuando convenga):**
- Borrar la JSON key del SA viejo de `~/Downloads/`.
- Borrar la service account `gd-finanzas-backup@...iam.gserviceaccount.com` en GCP (sin uso).
- Re-habilitar la org policy `iam.disableServiceAccountKeyCreation` (heredada de la org) que desactivamos para crear la SA key. Ya no necesitamos crear keys de SA — defensivamente conviene re-aplicar la restricción.

**2. Wipe smoke data + cargar info real:**

Toda la data acumulada en prod durante hitos 0-10 es **smoke**, no real. Ahora que V1.1 está cerrado:

```bash
npm run db:wipe-smoke -- --all
```

Preserva: `categories`, `tags`, `fx_rates`, `institutions`, `financial_goals`, `profiles`, `auth`. Borra: transactions, imports + archivos del bucket Storage, recurrences (+ forecasts), budgets, accounts.

Después cargar info real:
- Accounts definitivas (Galicia Amex, ICBC Caja, etc.) con sus nombres reales.
- Recurrences reales (sueldos, expensas, suscripciones).
- Sesión taxonomía de categorías con Nico → re-seedear si hace falta.
- Re-importar resúmenes reales (Galicia / ICBC / HSBC US).
- Cargar budgets reales para el resto de 2026.

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

### `statement_timeout` por rol (aplicado 2026-06-09)
Para mitigar los errores intermitentes "This page couldn't load" (timeouts en cold-start
del free tier, no en queries lentas reales — todas miden <70ms en los logs), se subió el
`statement_timeout` de los roles de Postgres por encima del default de Supabase. **Es config
aplicada por `ALTER ROLE`, no por migración Drizzle**: si Supabase resetea la config de roles
(pausa del proyecto, upgrade de plan, soporte), hay que re-aplicarla a mano. SQL:

```sql
ALTER ROLE authenticated  SET statement_timeout = '15s';
ALTER ROLE authenticator  SET statement_timeout = '15s';
ALTER ROLE anon           SET statement_timeout = '10s';
NOTIFY pgrst, 'reload config';
```

Verificar con:
```sql
SELECT rolname, rolconfig FROM pg_roles
WHERE rolname IN ('authenticated','authenticator','anon');
```

Defaults previos de Supabase eran anon=3s, authenticated/authenticator=8s. La app se conecta
como `postgres` (sin timeout), así que esto afecta sobre todo a PostgREST/Supabase SDK.

## Notas
- Vercel deploy: https://gd-finanzas-z4dl.vercel.app
- Repo GitHub: https://github.com/nixgore83/gd-finanzas (privado)
- Supabase project ref: `kezrkqbubupdnlhhhwdi` (us-west-2)
