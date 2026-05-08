import { createBrowserClient } from '@supabase/ssr';
import { getClientEnv } from '@/lib/env';

export function createClient() {
  const env = getClientEnv();
  return createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}
