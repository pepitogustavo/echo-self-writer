export default async function handler(req, res) {
  try {
    if (!process.env.BACKEND_URL) return res.status(500).send('BACKEND_URL not set');
    const init = {
      method: req.method,
      headers: { 'content-type': 'application/json' },
      body: ['GET','HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {})
    };
    const r = await fetch(`${process.env.BACKEND_URL}/reflect`, init);
    const text = await r.text();
    res.status(r.status).send(text);
  } catch (e) {
    res.status(500).send('reflect proxy error');
  }
}
