import postgres from 'postgres';
import { loadEnv } from './_env';

/**
 * Run once after both users (Nico + Pau) have accepted their Supabase invite.
 *
 * - Creates a single household named "Garaglio-Dasso" (idempotent: skipped if
 *   one already exists).
 * - Ensures every user listed in ALLOWED_EMAILS has a profile row with a
 *   sensible display_name (derived from email local-part) — this is a fallback
 *   in case the on_auth_user_created trigger didn't fire (e.g. user was created
 *   before the trigger existed).
 * - Adds every ALLOWED_EMAILS user to the household as a member.
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
    await sql.begin(async (tx) => {
      // 1. Get auth users for the allowed emails
      const users = await tx<{ id: string; email: string }[]>`
        select id, email
        from auth.users
        where lower(email) = any(${allowed}::text[])
      `;

      if (users.length === 0) {
        throw new Error(
          'No matching users in auth.users. Invite users in Supabase Dashboard first.',
        );
      }

      const missing = allowed.filter((e) => !users.some((u) => u.email.toLowerCase() === e));
      if (missing.length > 0) {
        console.warn(`[seed] not yet invited: ${missing.join(', ')}`);
      }

      // 2. Ensure profile rows exist
      for (const user of users) {
        const localPart = user.email.split('@')[0] ?? 'user';
        await tx`
          insert into public.profiles (id, display_name)
          values (${user.id}, ${localPart})
          on conflict (id) do nothing
        `;
      }

      // 3. Find or create the household
      const existing = await tx<{ id: string }[]>`
        select id from public.households limit 1
      `;
      const householdId =
        existing[0]?.id ??
        (
          await tx<{ id: string }[]>`
            insert into public.households (name)
            values ('Garaglio-Dasso')
            returning id
          `
        )[0]!.id;

      console.warn(`[seed] household: ${householdId}`);

      // 4. Link each user as member
      for (const user of users) {
        await tx`
          insert into public.household_members (household_id, user_id, role)
          values (${householdId}, ${user.id}, 'member')
          on conflict (household_id, user_id) do nothing
        `;
      }

      console.warn(`[seed] linked ${users.length} member(s)`);
    });
  } finally {
    await sql.end();
  }
}

main().catch((err: unknown) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
