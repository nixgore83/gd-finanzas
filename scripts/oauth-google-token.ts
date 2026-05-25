/* eslint-disable no-console */
/**
 * Bootstrap OAuth refresh token with Drive + Gmail scopes.
 *
 * Replaces the Drive-only token. Run once to re-authorize:
 *  1. npm run oauth:google-token
 *  2. Authorize in browser (grants Drive + Gmail access)
 *  3. Refresh token is written to .env.local
 *
 * The new token works for both Drive backups AND Gmail import polling.
 * If you already have a Drive-only token, this replaces it.
 */
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { google } from 'googleapis';
import { loadEnv } from './_env';

loadEnv();

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/gmail.modify',
];
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
    scope: SCOPES,
  });

  console.log('\n1. Abrí esta URL en tu browser y autorizá:\n');
  console.log(`   ${authUrl}\n`);
  console.log('   Scopes: Drive (backups) + Gmail (import polling)\n');
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
  console.log('  Scopes: drive.file + gmail.modify');
  console.log('\nSiguiente paso: cargar GOOGLE_OAUTH_REFRESH_TOKEN en Vercel Production.');
}

main().catch((err: unknown) => {
  console.error('Bootstrap falló:', err instanceof Error ? err.message : err);
  process.exit(1);
});
