-- Titular del extracto (encabezado del PDF) en `imports`.
--
-- El parser ya lo devuelve (`statementAccount.holder`, ver lib/imports/parsers/types.ts)
-- pero hasta ahora se descartaba: sólo se persistía el nº de cuenta. Lo guardamos para
-- mostrarlo en el detalle del import junto al período y al nº de cuenta leídos del
-- archivo, y para poder detectar imports mal ruteados (titular/nº que no matchean la
-- cuenta destino elegida).
--
-- No es un dato sensible nuevo: es el nombre del titular de una cuenta propia del
-- household, del mismo tenor que los identificadores de contraparte ya persistidos
-- (excepción documentada 2026-06-08 en CLAUDE.md). Queda bajo RLS+MFA y no se loguea.
--
-- Aditiva, nullable e idempotente. PENDIENTE DE APLICAR A PROD.
-- (El journal de Drizzle no la registra, como 0013–0019: el snapshot quedó en 0016 y
--  `drizzle-kit generate` emitiría un diff espurio recreando tablas ya existentes.)

ALTER TABLE "imports" ADD COLUMN IF NOT EXISTS "statement_holder" text;
