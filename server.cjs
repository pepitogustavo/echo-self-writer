const cors = require('cors');
require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors({ origin: [/\.vercel\.app$/, 'https://echo-self-writer-449nm4io5-pepitogustavos-projects.vercel.app'], methods: ['GET','POST'], allowedHeaders: ['Content-Type'] }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => res.status(200).send('ok'));

async function reflectWithOpenAI(msg) {
  try {
    const OpenAI = require('openai');
    if (!process.env.OPENAI_API_KEY) throw new Error('no OPENAI_API_KEY');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await client.responses.create({
      model: 'gpt-4o-mini',
      input: `Briefly reflect on: ${msg}`
    });
    return r.output?.[0]?.content?.[0]?.text ?? 'ok';
  } catch {
    return `echo: ${msg}`; // fallback if no key or SDK fails
  }
}

app.post('/reflect', async (req, res) => {
  const message = req.body?.message ?? 'hello';
  const out = await reflectWithOpenAI(message);
  res.json({ result: out });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () =>
  console.log(`🌀 Echo running at http://localhost:${PORT}`)
);
