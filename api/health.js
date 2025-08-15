export default async function handler(_req, res) {
  try {
    const r = await fetch(`${process.env.BACKEND_URL}/health`);
    const text = await r.text();
    res.status(r.status).send(text);
  } catch {
    res.status(500).send('health proxy error');
  }
}
