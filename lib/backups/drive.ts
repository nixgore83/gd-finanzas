import { google, type drive_v3 } from 'googleapis';
import { Readable } from 'node:stream';
import { getServerEnv } from '@/lib/env';

let cachedDrive: drive_v3.Drive | null = null;

export class DriveConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriveConfigError';
  }
}

function getDriveClient(): drive_v3.Drive {
  if (cachedDrive) return cachedDrive;
  const env = getServerEnv();
  if (!env.GOOGLE_SERVICE_ACCOUNT_KEY_B64) {
    throw new DriveConfigError(
      'GOOGLE_SERVICE_ACCOUNT_KEY_B64 no está seteada (setup operacional en STATUS.md)',
    );
  }
  let parsed: {
    client_email?: string;
    private_key?: string;
  };
  try {
    const decoded = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_KEY_B64, 'base64').toString('utf8');
    parsed = JSON.parse(decoded);
  } catch (err) {
    throw new DriveConfigError(
      `No se pudo decodear la service account key: ${(err as Error).message}`,
    );
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new DriveConfigError('Service account key sin client_email o private_key');
  }

  const auth = new google.auth.JWT({
    email: parsed.client_email,
    key: parsed.private_key,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  });

  cachedDrive = google.drive({ version: 'v3', auth });
  return cachedDrive;
}

export function getBackupFolderId(): string {
  const env = getServerEnv();
  if (!env.GOOGLE_DRIVE_BACKUP_FOLDER_ID) {
    throw new DriveConfigError('GOOGLE_DRIVE_BACKUP_FOLDER_ID no está seteada');
  }
  return env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
}

export type BackupFile = {
  id: string;
  name: string;
  createdTime: string;
  sizeBytes: number;
};

export async function uploadBackup(input: {
  name: string;
  bytes: Uint8Array;
  folderId: string;
}): Promise<BackupFile> {
  const drive = getDriveClient();
  const body = Readable.from(Buffer.from(input.bytes));

  const response = await drive.files.create({
    requestBody: {
      name: input.name,
      parents: [input.folderId],
      mimeType: 'application/zip',
    },
    media: {
      mimeType: 'application/zip',
      body,
    },
    fields: 'id,name,createdTime,size',
    supportsAllDrives: false,
  });

  const f = response.data;
  return {
    id: f.id ?? '',
    name: f.name ?? input.name,
    createdTime: f.createdTime ?? new Date().toISOString(),
    sizeBytes: f.size ? Number(f.size) : input.bytes.byteLength,
  };
}

export async function listBackups(folderId: string): Promise<BackupFile[]> {
  const drive = getDriveClient();
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,createdTime,size)',
    orderBy: 'createdTime desc',
    pageSize: 100,
  });
  const files = response.data.files ?? [];
  return files.map((f) => ({
    id: f.id ?? '',
    name: f.name ?? '',
    createdTime: f.createdTime ?? '',
    sizeBytes: f.size ? Number(f.size) : 0,
  }));
}

export async function deleteFile(fileId: string): Promise<void> {
  const drive = getDriveClient();
  await drive.files.delete({ fileId });
}
