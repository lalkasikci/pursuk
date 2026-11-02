import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
const derive = promisify(scrypt);
const credentialFile = new URL('./.admin-auth.json', import.meta.url);
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = (await derive(password, salt, 64)).toString('hex');
  return { salt, hash };
}
async function loadCredentials() {
  try { return JSON.parse(await readFile(credentialFile, 'utf8')); } catch { return null; }
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
async function readLogin(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2048) throw new Error('Too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function createAdmin({ credentialLoader = loadCredentials, telemetry, model }) {
  const sessions = new Map();
  let failures = [];
  const cookie = (token, age = 28800) => `pursuk_admin=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${age}`;
  return async function handle(req, res, path) {
    for (const [key, session] of sessions) if (session.expiry <= Date.now()) sessions.delete(key);
    if (req.method === 'POST' && path === '/api/admin/login') {
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: 'Geçersiz istek.' });
      failures = failures.filter(time => Date.now() - time < 60000);
      if (failures.length >= 5) return json(res, 429, { error: 'Çok fazla deneme. Bir dakika sonra tekrar dene.' });
      const credentials = await credentialLoader();
      if (!credentials) return json(res, 503, { error: 'Önce proje klasöründeki yonetici-sifre.cmd dosyasıyla yönetim şifresi belirle.' });
      try {
        const body = await readLogin(req);
        if (typeof body.password !== 'string' || body.password.length < 12 || body.password.length > 200 ||
          !/^[a-f0-9]{32}$/.test(credentials.salt) || !/^[a-f0-9]{128}$/.test(credentials.hash)) throw new Error('Invalid');
        const actual = await derive(body.password, credentials.salt, 64);
        if (!timingSafeEqual(actual, Buffer.from(credentials.hash, 'hex'))) throw new Error('Invalid');
      } catch {
        failures.push(Date.now());
        return json(res, 401, { error: 'Şifre kabul edilmedi.' });
      }
      const token = randomBytes(32).toString('hex');
      if (sessions.size >= 20) sessions.delete(sessions.keys().next().value);
      sessions.set(token, { expiry: Date.now() + 8 * 60 * 60 * 1000, credentialHash: credentials.hash });
      res.setHeader('Set-Cookie', cookie(token));
      return json(res, 200, { ok: true });
    }
    const token = (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith('pursuk_admin='))?.slice('pursuk_admin='.length);
    if (!token || !sessions.has(token)) return json(res, 401, { error: 'Yönetici girişi gerekli.' });
    const currentCredentials = await credentialLoader();
    if (!currentCredentials || currentCredentials.hash !== sessions.get(token).credentialHash) {
      sessions.delete(token);
      return json(res, 401, { error: 'Yönetici girişi gerekli.' });
    }
    if (req.method === 'POST' && path === '/api/admin/logout') {
      sessions.delete(token);
      res.setHeader('Set-Cookie', cookie('', 0));
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && path === '/api/admin/metrics') return json(res, 200, { model, ...telemetry.snapshot() });
    return json(res, 404, { error: 'Bulunamadı.' });
  };
}
