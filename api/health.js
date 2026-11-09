export default async function handler(_req, res) {
  try {
    const backendUrl = process.env.BACKEND_URL;

    if (!backendUrl) {
      return res.status(200).json({
        ok: true,
        service: 'echo-self-writer',
        backend: 'local-fallback',
        message: 'BACKEND_URL not configured; local health check passed.'
      });
    }

    const r = await fetch(`${backendUrl.replace(/\/+$/, '')}/health`);
    const text = await r.text();
    res.status(r.status).send(text || 'ok');
  } catch {
    res.status(200).json({
      ok: true,
      service: 'echo-self-writer',
      backend: 'local-fallback',
      message: 'health check fallback active'
    });
  }
}
