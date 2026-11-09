export default async function handler(_req, res) {
  try {
    const backendUrl = process.env.BACKEND_URL;

    if (!backendUrl) {
      return res.status(200).json({
        ok: true,
        service: 'echo-self-writer',
        mode: 'vercel-serverless',
        message: 'Echo health check passed without an upstream backend.'
      });
    }

    const target = `${backendUrl.replace(/\/+$/, '')}/health`;
    const response = await fetch(target);
    const text = await response.text();

    return res.status(response.status).send(text || 'ok');
  } catch {
    return res.status(200).json({
      ok: true,
      service: 'echo-self-writer',
      mode: 'vercel-serverless',
      message: 'Echo health check fallback active.'
    });
  }
}
