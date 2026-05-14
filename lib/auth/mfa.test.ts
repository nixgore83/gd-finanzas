import { describe, it, expect } from 'vitest';
import { getMfaState, type MfaCapableClient } from './mfa';

function fakeClient(
  data: { currentLevel: 'aal1' | 'aal2' | null; nextLevel: 'aal1' | 'aal2' | null } | null,
  error: { message: string } | null = null,
): MfaCapableClient {
  return {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data, error }),
      },
    },
  };
}

describe('getMfaState', () => {
  it('returns "enroll" when the user has no verified factor', async () => {
    const client = fakeClient({ currentLevel: 'aal1', nextLevel: 'aal1' });
    expect(await getMfaState(client)).toBe('enroll');
  });

  it('returns "challenge" when the user has a verified factor but session is AAL1', async () => {
    const client = fakeClient({ currentLevel: 'aal1', nextLevel: 'aal2' });
    expect(await getMfaState(client)).toBe('challenge');
  });

  it('returns "ok" when the session is AAL2', async () => {
    const client = fakeClient({ currentLevel: 'aal2', nextLevel: 'aal2' });
    expect(await getMfaState(client)).toBe('ok');
  });

  it('throws when the API returns an error', async () => {
    const client = fakeClient(null, { message: 'boom' });
    await expect(getMfaState(client)).rejects.toThrow(/boom/);
  });
});
