import { eq } from 'drizzle-orm';
import { createClient } from '@/lib/supabase/server';
import { getMfaState } from '@/lib/auth/mfa';
import { getDb } from '@/lib/db/client';
import { householdMembers } from '@/db/schema';

export type ResolvedSession = {
  userId: string;
  householdId: string;
};

export class SessionError extends Error {
  constructor(
    public readonly reason: 'unauthenticated' | 'mfa_required' | 'no_household',
  ) {
    super(reason);
    this.name = 'SessionError';
  }
}

/**
 * Lectura canónica de la sesión para server actions y server components que
 * operan sobre datos del usuario. Exige AAL2 (MFA verificada en la sesión
 * actual) y pertenencia a una household.
 *
 * Drizzle se conecta al pooler como `postgres` role, que bypasses RLS — por
 * eso la responsabilidad de "household propia" recae acá y en cada query
 * (con WHERE household_id = …). RLS queda como defensa en profundidad.
 */
export async function requireHouseholdSession(): Promise<ResolvedSession> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new SessionError('unauthenticated');

  const state = await getMfaState(supabase);
  if (state !== 'ok') throw new SessionError('mfa_required');

  const db = getDb();
  const [memb] = await db
    .select({ householdId: householdMembers.householdId })
    .from(householdMembers)
    .where(eq(householdMembers.userId, user.id))
    .limit(1);

  if (!memb) throw new SessionError('no_household');
  return { userId: user.id, householdId: memb.householdId };
}
