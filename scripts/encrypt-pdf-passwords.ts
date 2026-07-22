import postgres from 'postgres';
import { loadEnv } from './_env';
import { encryptSecret, isEncryptedSecret, parseSecretKey } from '../lib/crypto/secret-box';

/**
 * Backfill: cifra in-place las contraseñas de PDF que quedaron en texto plano en
 * `accounts.pdf_password` e `institutions.pdf_password`.
 *
 * Por qué un script y no SQL puro: el cifrado es AES-256-GCM con IV por registro
 * (`node:crypto`). Hacerlo en SQL exigiría pgcrypto (que no ofrece GCM) y, peor,
 * mandaría la clave maestra dentro de la sentencia → quedaría en los logs de
 * Postgres. El script mantiene la clave en el proceso Node.
 *
 * Es IDEMPOTENTE: saltea todo valor que ya tenga el prefijo `v1:`.
 * NUNCA imprime contraseñas (ni en claro ni cifradas): solo ids y conteos.
 *
 * Uso:
 *   PDF_PASSWORD_ENC_KEY=<base64-32b> npm run db:encrypt-pdf-passwords          # dry-run
 *   PDF_PASSWORD_ENC_KEY=<base64-32b> npm run db:encrypt-pdf-passwords -- --apply
 *
 * Orden de ejecución en cada entorno:
 *   1. setear PDF_PASSWORD_ENC_KEY
 *   2. correr este script con --apply
 *   3. aplicar db/migrations/0019_encrypt_pdf_passwords.sql (agrega el CHECK que
 *      prohíbe texto plano a futuro; falla si quedó algo sin cifrar)
 */

type Row = { id: string; pdf_password: string };

async function main() {
  loadEnv();

  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) throw new Error('DIRECT_URL must be set');

  const key = parseSecretKey(process.env.PDF_PASSWORD_ENC_KEY);
  const apply = process.argv.includes('--apply');

  const sql = postgres(directUrl, { max: 1 });
  try {
    const stats = { accounts: 0, institutions: 0, skipped: 0 };

    const accountRows = await sql<Row[]>`
      select id::text, pdf_password from public.accounts where pdf_password is not null
    `;
    for (const row of accountRows) {
      if (isEncryptedSecret(row.pdf_password)) {
        stats.skipped++;
        continue;
      }
      stats.accounts++;
      if (apply) {
        const enc = encryptSecret(row.pdf_password, key);
        await sql`update public.accounts set pdf_password = ${enc} where id = ${row.id}::uuid`;
      }
      console.warn(`[encrypt-pdf-passwords] account ${row.id}`);
    }

    const institutionRows = await sql<Row[]>`
      select id::text, pdf_password from public.institutions where pdf_password is not null
    `;
    for (const row of institutionRows) {
      if (isEncryptedSecret(row.pdf_password)) {
        stats.skipped++;
        continue;
      }
      stats.institutions++;
      if (apply) {
        const enc = encryptSecret(row.pdf_password, key);
        await sql`update public.institutions set pdf_password = ${enc} where id = ${row.id}::uuid`;
      }
      console.warn(`[encrypt-pdf-passwords] institution ${row.id}`);
    }

    console.warn(
      `[encrypt-pdf-passwords] ${apply ? 'APLICADO' : 'DRY-RUN (usá --apply)'}: ` +
        `${stats.accounts} cuentas, ${stats.institutions} instituciones, ${stats.skipped} ya cifradas`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[encrypt-pdf-passwords] failed:', err);
  process.exit(1);
});
