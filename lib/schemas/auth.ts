import { z } from 'zod';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email({ message: 'Email inválido' });

export function getAllowedEmails(): readonly string[] {
  const raw = process.env.ALLOWED_EMAILS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function isAllowedEmail(email: string): boolean {
  return getAllowedEmails().includes(email.toLowerCase());
}
