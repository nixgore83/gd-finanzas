-- Resultado parcial de un job de licitaciones.
--
-- El microservicio no aborta la tanda cuando un PDF rompe: procesa el resto y
-- devuelve el Excel con lo que anduvo. Hasta ahora esos PDFs se descartaban en
-- silencio y el job quedaba `done` sin nada que lo delatara (caso real: 5 PDFs
-- subidos, 3 instrumentos en el Excel, cero señal en la UI).
--
-- Guardamos el detalle en columnas en vez de agregar un estado nuevo al enum
-- (`done_with_errors`): la descarga del Excel parcial tiene que seguir andando
-- (`get-download-url` exige `status = 'done'`) y "parcial" es una propiedad del
-- resultado, no un estado terminal distinto de la máquina de estados.
--
-- `pdfs_ok` nullable a propósito: los jobs anteriores no lo saben, y null es
-- "no informado" (≠ 0). La UI sólo avisa cuando hay un número y es < pdf_count.
--
-- Aditiva, nullable e idempotente. PENDIENTE DE APLICAR A PROD.
-- (El journal de Drizzle no la registra, como 0013–0020: el snapshot quedó en
--  0016 y `drizzle-kit generate` emitiría un diff espurio recreando tablas.)

ALTER TABLE "licitaciones_jobs" ADD COLUMN IF NOT EXISTS "pdfs_ok" integer;
ALTER TABLE "licitaciones_jobs" ADD COLUMN IF NOT EXISTS "pdf_errors" jsonb;
