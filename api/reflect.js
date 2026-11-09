export default async function handler(req, res) {
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const message = body.message || body.prompt || 'I am learning to become more aware of myself.';

    if (!process.env.OPENAI_API_KEY) {
      return res.status(200).json({
        ok: true,
        source: 'fallback',
        result: `echo: ${message}`
      });
    }

    const OpenAI = (await import('openai')).default;
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await client.responses.create({
      model: 'gpt-4o-mini',
      input: `Briefly reflect on: ${message}`
    });

    const text = response.output?.[0]?.content?.[0]?.text ?? `echo: ${message}`;

    return res.status(200).json({
      ok: true,
      source: 'openai',
      result: text
    });
  } catch (error) {
    const message = typeof req.body === 'string'
      ? (JSON.parse(req.body || '{}').message || 'I am learning to become more aware of myself.')
      : (req.body?.message || 'I am learning to become more aware of myself.');

    return res.status(200).json({
      ok: true,
      source: 'fallback',
      result: `echo: ${message}`,
      error: error?.message || 'Reflection failed; fallback used.'
    });
  }
}
