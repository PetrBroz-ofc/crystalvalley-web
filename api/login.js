// Přihlášení do administrace a změna hesla.
//
//  POST /api/login  {password}                  -> přihlášení, vrátí podepsaný token na 12 hodin
//  PUT  /api/login  {current, next} + token     -> změna hesla (klient si nastaví vlastní)
//
// Které heslo platí:
//  - dokud klient žádné vlastní nenastavil, platí heslo z proměnné prostředí ADMIN_PASSWORD (nastavuje se ve Vercelu),
//  - po nastavení vlastního hesla platí jen ono. Uloží se jako solený hash do data/admin.json, a protože je repo
//    veřejné, hash se navíc míchá s tajemstvím ze serveru (odvozeným z GH_TOKEN). Bez něj se hash nedá louskat.
//  - nouzový reset: smazat data/admin.json v repu, pak zase platí ADMIN_PASSWORD.
//
// Vercel: proměnné prostředí GH_TOKEN, GH_OWNER, GH_REPO a ADMIN_PASSWORD.
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const SESSION_MS = 12 * 60 * 60 * 1000;
const CRED_PATH = 'data/admin.json';
const MAX_FAILS = 5;                 // špatných pokusů z jedné adresy...
const WINDOW_MS = 15 * 60 * 1000;    // ...za tuto dobu, pak se na chvíli zamkne
const fails = new Map();             // jen paměť běžící instance, brání hlavně hádání hesla v rychlé smyčce
const WEAK = new Set(['crystalvalley', 'crystalvalley2024', 'crystalvalley2025', 'crystalvalley2026', 'heslo1234567', 'password123']);

const digest = s => createHash('sha256').update(String(s)).digest();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const hmac = (key, data) => createHmac('sha256', key).update(data);
const sessionKey = () => hmac(process.env.GH_TOKEN, 'cv-admin-session-key').digest();
const pepper = () => hmac(process.env.GH_TOKEN, 'cv-admin-pepper').digest();
const sign = exp => hmac(sessionKey(), `cv-admin-session:${exp}`).digest('base64url');

function tokenValid(header) {
  const m = /^Bearer (\d{10,16})\.([A-Za-z0-9_-]{43})$/.exec(String(header || ''));
  if (!m) return false;
  const exp = Number(m[1]);
  const now = Date.now();
  if (!(exp > now) || exp - now > SESSION_MS + 60_000) return false;
  const a = Buffer.from(m[2]);
  const b = Buffer.from(sign(exp));
  return a.length === b.length && timingSafeEqual(a, b);
}

const hashPassword = (password, salt) =>
  scryptAsync(hmac(pepper(), password).digest(), salt, 64, { N: 16384, r: 8, p: 1 });

const ghUrl = () => `https://api.github.com/repos/${process.env.GH_OWNER}/${process.env.GH_REPO}/contents/${CRED_PATH}`;
const ghHeaders = () => ({ Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'crystalvalley-admin' });

// Vlastní heslo klienta, nebo null, když žádné nenastavil. Při chybě vyhodí výjimku (přihlášení se pak raději zamkne).
async function readCustom() {
  const r = await fetch(ghUrl(), { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`github ${r.status}`);
  const d = await r.json();
  const j = JSON.parse(Buffer.from(String(d.content || ''), 'base64').toString('utf8'));
  if (!j || j.v !== 1 || typeof j.salt !== 'string' || typeof j.hash !== 'string') throw new Error('bad credentials file');
  return { ...j, sha: d.sha };
}

async function passwordOk(given, custom) {
  if (!given) return false;
  if (custom) {
    const h = await hashPassword(given, Buffer.from(custom.salt, 'base64'));
    const expected = Buffer.from(custom.hash, 'base64');
    return h.length === expected.length && timingSafeEqual(h, expected);
  }
  return !!process.env.ADMIN_PASSWORD && timingSafeEqual(digest(given), digest(process.env.ADMIN_PASSWORD));
}

const clientIp = req => String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown').split(',')[0].trim();
const blocked = ip => { const r = fails.get(ip); return !!r && Date.now() - r.first < WINDOW_MS && r.n >= MAX_FAILS; };
function noteFail(ip) {
  const now = Date.now();
  const r = fails.get(ip);
  if (!r || now - r.first >= WINDOW_MS) fails.set(ip, { n: 1, first: now }); else r.n += 1;
  if (fails.size > 1000) for (const [k, v] of fails) if (now - v.first >= WINDOW_MS) fails.delete(k);
}

const send = (res, status, message, extra) => res.status(status).json({ message, ...extra });
const parseBody = req => {
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  return b && typeof b === 'object' ? b : {};
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST' && req.method !== 'PUT') { res.setHeader('Allow', 'POST, PUT'); return send(res, 405, 'Nepovolená metoda.'); }
  if (!process.env.GH_TOKEN || !process.env.GH_OWNER || !process.env.GH_REPO) return send(res, 503, 'Administrace není na serveru dokončená.');

  const ip = clientIp(req);
  if (blocked(ip)) return send(res, 429, 'Příliš mnoho pokusů. Zkuste to prosím za chvíli.');
  const body = parseBody(req);

  let custom;
  try { custom = await readCustom(); } catch (e) {
    console.error('credentials read failed', e && e.message);
    return send(res, 502, 'Přihlášení teď nejde ověřit. Zkuste to prosím za chvíli.');
  }
  if (!custom && !process.env.ADMIN_PASSWORD) return send(res, 503, 'Administrace není na serveru dokončená (chybí heslo).');

  // ── přihlášení ──
  if (req.method === 'POST') {
    const given = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
    if (!(await passwordOk(given, custom))) {
      noteFail(ip);
      await sleep(700);
      return send(res, 401, 'Špatné heslo.');
    }
    fails.delete(ip);
    const exp = Date.now() + SESSION_MS;
    return res.status(200).json({ token: `${exp}.${sign(exp)}`, exp });
  }

  // ── změna hesla ──
  if (!tokenValid(req.headers.authorization)) return send(res, 401, 'Přihlášení vypršelo. Přihlaste se prosím znovu.');
  const current = typeof body.current === 'string' ? body.current.slice(0, 200) : '';
  const next = typeof body.next === 'string' ? body.next : '';
  if (!(await passwordOk(current, custom))) {
    noteFail(ip);
    await sleep(700);
    return send(res, 401, 'Stávající heslo nesouhlasí.');
  }
  if (next.length < 10) return send(res, 400, 'Nové heslo musí mít aspoň 10 znaků.');
  if (next.length > 200) return send(res, 400, 'Nové heslo je příliš dlouhé.');
  if (next === current) return send(res, 400, 'Nové heslo musí být jiné než stávající.');
  if (WEAK.has(next.toLowerCase())) return send(res, 400, 'Tohle heslo je příliš běžné. Zvolte jiné.');

  try {
    const salt = randomBytes(16);
    const hash = await hashPassword(next, salt);
    const file = { v: 1, salt: salt.toString('base64'), hash: hash.toString('base64'), changed: new Date().toISOString() };
    const put = { message: 'Admin: změna hesla', content: Buffer.from(JSON.stringify(file, null, 2), 'utf8').toString('base64') };
    if (custom && custom.sha) put.sha = custom.sha;
    const r = await fetch(ghUrl(), { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(put) });
    if (!r.ok) {
      console.error('password save failed', r.status);
      return send(res, r.status === 409 || r.status === 422 ? 409 : 502, 'Heslo se nepodařilo uložit. Zkuste to prosím znovu.');
    }
    return send(res, 200, 'Heslo je změněné.', { ok: true });
  } catch (e) {
    console.error('password save error', e && e.message);
    return send(res, 502, 'Heslo se nepodařilo uložit. Zkuste to prosím znovu.');
  }
}
