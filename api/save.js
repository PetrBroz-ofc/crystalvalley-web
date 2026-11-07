// Ukládání z administrace do GitHubu (data/*.json, fotky, certifikáty, kniha Historie).
//
// Omezení zápisu (přihlášení do administrace zůstává jak bylo, heslo klienta se nemění):
//  - zapisovat jde jen na předem známé cesty, nikdy do kódu webu (index.html, admin.html, api/, vendor/),
//  - kontroluje se typ i obsah souboru (JSON musí být platný JSON, fotky a PDF musí opravdu být fotky a PDF),
//  - žádné CORS a požadavek musí přijít ze stránky z téhož webu (kontrola hlaviček Origin a Sec-Fetch-Site),
//  - chyby GitHubu se klientovi nevypisují.
//
// Vercel: proměnné prostředí GH_TOKEN, GH_OWNER a GH_REPO.

const MAX_B64_CHARS = 4_400_000;              // Vercel stejně pustí tělo jen do 4,5 MB
const MAX_JSON_CHARS = 1_000_000;
const JSON_FILES = new Set(['about', 'cats', 'toms', 'litters', 'gallery', 'certificates', 'history']);
const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i;
const FILE_NAME = '[A-Za-z0-9][A-Za-z0-9._-]{0,200}';
const RE_IMAGES = new RegExp(`^images/${FILE_NAME}$`);
const RE_CERTS = new RegExp(`^certificates/${FILE_NAME}$`);

// Vrací druh souboru, nebo null, když se na tu cestu zapisovat nesmí.
function classify(path) {
  if (typeof path !== 'string' || path.length > 255 || path.includes('..')) return null;
  const j = /^data\/([a-z]+)\.json$/.exec(path);
  if (j) return JSON_FILES.has(j[1]) ? 'json' : null;
  if (path === 'data/history.pdf') return 'pdf';
  if (RE_IMAGES.test(path)) return IMAGE_EXT.test(path) ? 'image' : null;
  if (RE_CERTS.test(path)) return IMAGE_EXT.test(path) ? 'image' : /\.pdf$/i.test(path) ? 'pdf' : null;
  return null;
}

// Podle prvních bajtů: je to opravdu PDF / JPEG / PNG / GIF / WebP? (přípona se nehlídá, ta bývá zaměněná)
function isPdf(buf) { return buf.subarray(0, 5).toString('latin1') === '%PDF-'; }
function isImage(buf) {
  const h = buf.subarray(0, 12);
  return (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) ||
    (h[0] === 0x89 && h.subarray(1, 4).toString('latin1') === 'PNG') ||
    h.subarray(0, 4).toString('latin1') === 'GIF8' ||
    (h.subarray(0, 4).toString('latin1') === 'RIFF' && h.subarray(8, 12).toString('latin1') === 'WEBP');
}

// Požadavek musí přijít ze stránky z téhož webu. Prohlížeč tyhle hlavičky posílá sám a stránka je změnit nemůže.
function sameSite(req) {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite && fetchSite !== 'same-origin') return false;
  const origin = req.headers.origin;
  if (origin) { try { return new URL(origin).host === req.headers.host; } catch (e) { return false; } }
  return true;
}

const fail = (res, status, message) => res.status(status).json({ message });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'PUT') { res.setHeader('Allow', 'PUT'); return fail(res, 405, 'Nepovolená metoda.'); }
  if (!sameSite(req)) return fail(res, 403, 'Požadavek nepřišel z administrace webu.');

  const ghToken = process.env.GH_TOKEN;
  const owner = process.env.GH_OWNER;
  const repo = process.env.GH_REPO;
  if (!ghToken || !owner || !repo) return fail(res, 500, 'Ukládání není na serveru nastavené.');

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const { path, content, sha, isBase64 } = body || {};
  if (typeof content !== 'string' || !content) return fail(res, 400, 'Chybí obsah souboru.');

  const kind = classify(path);
  if (!kind) return fail(res, 403, 'Na tohle místo se z administrace ukládat nesmí.');

  let encoded;
  if (kind === 'json') {
    if (isBase64 || content.length > MAX_JSON_CHARS) return fail(res, 400, 'Neplatná data.');
    try { JSON.parse(content); } catch (e) { return fail(res, 400, 'Data nejsou platný JSON.'); }
    encoded = Buffer.from(content, 'utf8').toString('base64');
  } else {
    if (!isBase64 || content.length > MAX_B64_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) return fail(res, 400, 'Neplatný soubor.');
    const buf = Buffer.from(content, 'base64');
    const ok = kind === 'pdf' ? isPdf(buf) : isImage(buf) || (path.startsWith('certificates/') && isPdf(buf));
    if (!ok) return fail(res, 415, kind === 'pdf' ? 'Soubor není platné PDF.' : 'Nepodporovaný typ souboru. Nahrajte fotku ve formátu JPG, PNG, WebP nebo GIF.');
    encoded = content;
  }

  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'crystalvalley-admin' };
  try {
    let currentSha = typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha : undefined;
    if (!currentSha) {
      const check = await fetch(url, { headers });
      if (check.ok) currentSha = (await check.json()).sha;
    }
    const put = { message: `Admin: update ${path}`, content: encoded };
    if (currentSha) put.sha = currentSha;
    const r = await fetch(url, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(put) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('GitHub save failed', r.status, path);
      return fail(res, r.status === 409 || r.status === 422 ? 409 : 502, 'Uložení na GitHub se nepovedlo. Zkuste to prosím znovu.');
    }
    return res.status(200).json({ content: { sha: d.content && d.content.sha, path } });
  } catch (e) {
    console.error('GitHub save error', e && e.message);
    return fail(res, 502, 'GitHub teď neodpovídá. Zkuste to prosím za chvíli.');
  }
}
