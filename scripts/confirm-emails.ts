import postgres from 'postgres';
import { loadEnv } from './_env';

/**
 * Marks every user in ALLOWED_EMAILS as email_confirmed in auth.users.
 *
 * Used when invites expire before being clicked: equivalent to the user
 * clicking the invitation link, but without depending on email delivery.
 * Safe and idempotent — only updates rows where email_confirmed_at IS NULL.
 */
async function main() {
  loadEnv();

  const directUrl = process.env.DIRECT_URL;
  const allowed = (process.env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  if (!directUrl) throw new Error('DIRECT_URL must be set');
  if (allowed.length === 0) throw new Error('ALLOWED_EMAILS must list at least one email');

  const sql = postgres(directUrl, { max: 1 });

  try {
    const updated = await sql<{ email: string }[]>`
      update auth.users
      set email_confirmed_at = now()
      where lower(email) = any(${allowed}::text[])
        and email_confirmed_at is null
      returning email
    `;

    if (updated.length === 0) {
      console.warn('[confirm] no users needed confirmation (already confirmed or not invited)');
    } else {
      console.warn(`[confirm] confirmed ${updated.length} user(s):`);
      for (const u of updated) console.warn(`  - ${u.email}`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[confirm] failed:', err);
  process.exit(1);
});
