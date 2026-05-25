export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PUT') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GH_TOKEN;
  const owner = process.env.GH_OWNER;
  const repo  = process.env.GH_REPO;

  if (!token) return res.status(500).json({ error: 'GH_TOKEN not configured' });

  const { path, content, sha, isBase64 } = req.body;
  if (!path || !content) return res.status(400).json({ error: 'Missing path or content' });

  // Pokud je to text (JSON), zakóduj do base64. Pokud už je base64 (obrázek), použij přímo.
  const encodedContent = isBase64
    ? content
    : Buffer.from(content).toString('base64');

  // Zjisti aktuální SHA pokud nebylo posláno
  let currentSha = sha;
  if (!currentSha) {
    const check = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' }
    });
    if (check.ok) {
      const existing = await check.json();
      currentSha = existing.sha;
    }
  }

  const body = { message: `Admin: update ${path}`, content: encodedContent };
  if (currentSha) body.sha = currentSha;

  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await r.json();
  return res.status(r.status).json(data);
}
