-- Runway + control de gasto mensual (decisión Nico, 2026-10-06).
--
-- 1) `categories.excluded_from_household`: categorías cuyo gasto NO es gasto de la casa
--    (Mario, Rabbit Hole, Tijeritas). Se excluyen del gasto base del runway, del techo
--    mensual y de los reportes de cashflow / top del dashboard. Distinto de
--    `is_investment` (que sólo usa el Reporte D para sumar a ahorro).
-- 2) `financial_goals.tope_gasto_mensual_ars`: techo de gasto mensual de la casa (sin
--    cuotas de TC), para el semáforo del dashboard y el escenario "con tope" del runway.
--
-- Aditiva e idempotente. No crea tablas: las políticas RLS existentes cubren las columnas.
-- (Como 0013–0021, no se registra en el journal de Drizzle: el snapshot quedó en 0016 y
--  `drizzle-kit generate` emitiría un diff espurio.)

ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "excluded_from_household" boolean NOT NULL DEFAULT false;
ALTER TABLE "financial_goals" ADD COLUMN IF NOT EXISTS "tope_gasto_mensual_ars" numeric(18, 2);
