-- Contraseñas de PDF de extractos: prohibir texto plano en DB.
--
-- El CIFRADO de los valores existentes NO se hace acá: es AES-256-GCM con IV por
-- registro (`node:crypto`), y hacerlo en SQL exigiría pgcrypto (sin GCM) y dejaría
-- la clave maestra en los logs de Postgres. Lo hace el backfill en Node:
--
--   1. setear PDF_PASSWORD_ENC_KEY (32 bytes en base64) en el entorno
--   2. npm run db:encrypt-pdf-passwords -- --apply
--   3. aplicar ESTA migración
--
-- Este paso 3 agrega el CHECK que garantiza, a nivel DB, que a futuro solo entren
-- payloads versionados (`v1:<iv_b64>:<tag_b64>:<ct_b64>`). Si quedó algún valor sin
-- cifrar, la migración FALLA — que es exactamente lo que queremos (mejor romper que
-- dejar un secreto en claro pasando por alto).
--
-- Idempotente: el DO/EXCEPTION deja pasar la segunda corrida.
-- (Aplicada a prod vía Supabase MCP; el journal de Drizzle no la registra, como 0013–0018.)

DO $$ BEGIN
  ALTER TABLE "accounts" ADD CONSTRAINT "accounts_pdf_password_encrypted_chk"
    CHECK ("pdf_password" IS NULL OR "pdf_password" LIKE 'v1:%');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "institutions" ADD CONSTRAINT "institutions_pdf_password_encrypted_chk"
    CHECK ("pdf_password" IS NULL OR "pdf_password" LIKE 'v1:%');
EXCEPTION WHEN duplicate_object THEN null; END $$;
