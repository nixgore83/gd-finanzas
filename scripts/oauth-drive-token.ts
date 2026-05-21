/* eslint-disable no-console */
/**
 * Bootstrap OAuth refresh token for the Drive backups uploader.
 *
 * Setup operacional one-shot:
 *  1. GCP Console → OAuth consent screen → External + Published.
 *  2. Credentials → OAuth Client ID (Desktop app) → copiar id + secret.
 *  3. Cargar GOOGLE_OAUTH_CLIENT_ID y GOOGLE_OAUTH_CLIENT_SECRET en .env.local.
 *  4. npm run oauth:drive-token → autorizás en browser → el script captura el
 *     refresh token vía localhost callback y lo escribe a .env.local.
 *
 * Re-correrlo solo si revocás el token o cambiás la app OAuth. El refresh
 * token no expira mientras la app esté "In production" (no Testing).
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { google } from 'googleapis';
import { loadEnv } from './_env';

loadEnv();

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const ENV_FILE = '.env.local';
const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;

async function upsertEnvLine(file: string, key: string, value: string): Promise<void> {
  let content = '';
  try {
    content = await fs.readFile(file, 'utf8');
  } catch {
    // file doesn't exist; we'll create it
  }
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  const next = re.test(content)
    ? content.replace(re, line)
    : (content.endsWith('\n') || content === '' ? content : `${content}\n`) + `${line}\n`;
  await fs.writeFile(file, next, 'utf8');
}

async function main() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      'Falta GOOGLE_OAUTH_CLIENT_ID o GOOGLE_OAUTH_CLIENT_SECRET en .env.local.\n' +
        'Cargá los dos valores del OAuth Client ID que creaste en GCP y volvé a correr.',
    );
    process.exit(1);
  }

  const oauth2 = new google.auth.OAuth2({
    clientId,
    clientSecret,
    redirectUri: REDIRECT_URI,
  });

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [SCOPE],
  });

  console.log('\n1. Abrí esta URL en tu browser y autorizá:\n');
  console.log(`   ${authUrl}\n`);
  console.log('2. Cuando termine, Google te redirige a localhost. Volvé acá.\n');

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', REDIRECT_URI);
      const c = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      if (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end(`OAuth error: ${err}`);
        server.close();
        reject(new Error(`OAuth denied: ${err}`));
        return;
      }
      if (!c) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('No code in callback');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<html><body style="font-family:system-ui;padding:2rem"><h1>OK</h1><p>Volvé a la terminal — el refresh token ya está capturado.</p></body></html>',
      );
      server.close();
      resolve(c);
    });
    server.listen(PORT, () => {
      // server is up; user is doing the browser flow
    });
    server.on('error', reject);
  });

  const { tokens } = await oauth2.getToken(code);
  if (!tokens.refresh_token) {
    console.error(
      'Google devolvió tokens pero sin refresh_token. Esto pasa si ya autorizaste\n' +
        'esta app antes con el mismo Client ID. Revocá el acceso en\n' +
        'https://myaccount.google.com/permissions y volvé a correr el script.',
    );
    process.exit(1);
  }

  await upsertEnvLine(ENV_FILE, 'GOOGLE_OAUTH_REFRESH_TOKEN', tokens.refresh_token);
  console.log(`\n✓ refresh token guardado en ${ENV_FILE} (${tokens.refresh_token.length} chars)`);
  console.log('\nSiguiente paso: cargar las 4 vars en Vercel Production:');
  console.log('  - GOOGLE_OAUTH_CLIENT_ID');
  console.log('  - GOOGLE_OAUTH_CLIENT_SECRET');
  console.log('  - GOOGLE_OAUTH_REFRESH_TOKEN');
  console.log('  - GOOGLE_DRIVE_BACKUP_FOLDER_ID');
}

main().catch((err: unknown) => {
  console.error('Bootstrap falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
