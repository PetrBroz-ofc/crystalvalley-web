export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'PUT') return res.status(405).end();

  const { path, content, sha } = req.body;
  const token = process.env.GH_TOKEN;
  const owner = process.env.GH_OWNER;
  const repo = process.env.GH_REPO;

  const body = { message: `Admin update: ${path}`, content: Buffer.from(content).toString('base64') };
  if (sha) body.sha = sha;

  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await r.json();
  return res.status(r.status).json(data);
}
