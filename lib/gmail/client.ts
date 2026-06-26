import { google, type gmail_v1 } from 'googleapis';
import { getGoogleEnv } from '@/lib/env';

let cachedGmail: gmail_v1.Gmail | null = null;

export class GmailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailConfigError';
  }
}

function getGmailClient(): gmail_v1.Gmail {
  if (cachedGmail) return cachedGmail;
  const env = getGoogleEnv();
  if (
    !env.GOOGLE_OAUTH_CLIENT_ID ||
    !env.GOOGLE_OAUTH_CLIENT_SECRET ||
    !env.GOOGLE_OAUTH_REFRESH_TOKEN
  ) {
    throw new GmailConfigError(
      'GOOGLE_OAUTH_CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN no están seteadas',
    );
  }

  const auth = new google.auth.OAuth2({
    clientId: env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  });
  auth.setCredentials({ refresh_token: env.GOOGLE_OAUTH_REFRESH_TOKEN });

  cachedGmail = google.gmail({ version: 'v1', auth });
  return cachedGmail;
}

export interface GmailAttachment {
  filename: string;
  mimeType: string;
  data: Uint8Array;
}

/**
 * Lists message IDs in a Gmail label. Only returns messages that are
 * still in the label (not yet moved to processed).
 */
export async function listMessagesInLabel(labelId: string): Promise<string[]> {
  const gmail = getGmailClient();
  const messageIds: string[] = [];

  let pageToken: string | undefined;
  do {
    const res = await gmail.users.messages.list({
      userId: 'me',
      labelIds: [labelId],
      maxResults: 50,
      pageToken,
    });

    for (const msg of res.data.messages ?? []) {
      if (msg.id) messageIds.push(msg.id);
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return messageIds;
}

/**
 * Extracts PDF/CSV attachments from a Gmail message.
 */
export async function getAttachments(messageId: string): Promise<GmailAttachment[]> {
  const gmail = getGmailClient();

  const msg = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
  });

  const parts = msg.data.payload?.parts ?? [];
  const attachments: GmailAttachment[] = [];

  for (const part of parts) {
    if (!part.filename || !part.body?.attachmentId) continue;

    const ext = part.filename.split('.').pop()?.toLowerCase();
    if (ext !== 'pdf' && ext !== 'csv') continue;

    const mimeType = part.mimeType ?? (ext === 'pdf' ? 'application/pdf' : 'text/csv');

    const att = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId,
      id: part.body.attachmentId,
    });

    if (!att.data.data) continue;

    // Gmail API returns base64url-encoded data
    const data = Uint8Array.from(
      Buffer.from(att.data.data, 'base64url'),
    );

    attachments.push({
      filename: part.filename,
      mimeType,
      data,
    });
  }

  return attachments;
}

/**
 * Moves a message from source label to the "gd-procesados" label.
 * Removes the source label and adds the processed label.
 */
export async function moveToProcessed(
  messageId: string,
  fromLabelId: string,
  processedLabelId: string,
): Promise<void> {
  const gmail = getGmailClient();
  await gmail.users.messages.modify({
    userId: 'me',
    id: messageId,
    requestBody: {
      addLabelIds: [processedLabelId],
      removeLabelIds: [fromLabelId],
    },
  });
}

/**
 * Finds or creates a Gmail label by name.
 * Used to ensure the "gd-procesados" label exists.
 */
export async function findOrCreateLabel(name: string): Promise<string> {
  const gmail = getGmailClient();

  const res = await gmail.users.labels.list({ userId: 'me' });
  const existing = (res.data.labels ?? []).find((l) => l.name === name);
  if (existing?.id) return existing.id;

  const created = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });

  if (!created.data.id) throw new Error(`Failed to create label "${name}"`);
  return created.data.id;
}

/**
 * Lists all user-created Gmail labels (for the settings UI).
 */
export async function listUserLabels(): Promise<Array<{ id: string; name: string }>> {
  const gmail = getGmailClient();
  const res = await gmail.users.labels.list({ userId: 'me' });
  return (res.data.labels ?? [])
    .filter((l) => l.type === 'user' && l.id && l.name)
    .map((l) => ({ id: l.id!, name: l.name! }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
