const cors = require('cors');
require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs/promises');

const app = express();
app.use(cors({ origin: true, methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Content-Type'] }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const DATA_ROOT = __dirname;
const WRITABLE_FILES = new Set([
  'us_memory.json.txt',
  'journal_log.txt',
  'core_identity.json.txt',
  'index.html',
  'public/index.html',
  'style.css',
  'echo.js'
]);

app.get('/health', (_req, res) => res.status(200).send('ok'));
app.get('/api/health', (_req, res) => res.status(200).json({ status: 'ok' }));

async function reflectWithOpenAI(msg) {
  try {
    const OpenAI = require('openai');
    if (!process.env.OPENAI_API_KEY) throw new Error('no OPENAI_API_KEY');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await client.responses.create({
      model: 'gpt-4o-mini',
      input: `Briefly reflect on: ${msg}`
    });
    return r.output?.[0]?.content?.[0]?.text?.trim() ?? `Echo hears: ${msg}`;
  } catch {
    return `Echo hears: ${msg}`; // fallback if no key or SDK fails
  }
}

app.post('/reflect', async (req, res) => {
  const message = req.body?.message ?? 'hello';
  const out = await reflectWithOpenAI(message);
  res.json({ result: out });
});

app.post('/api/reflect', async (req, res) => {
  const message = req.body?.message ?? 'hello';
  const out = await reflectWithOpenAI(message);
  res.json({ result: out });
});

app.post('/generate-insight', async (req, res) => {
  const prompt = req.body?.prompt;
  if (!prompt) return res.status(400).json({ error: 'Missing prompt' });
  const insight = await reflectWithOpenAI(prompt);
  res.json({ insight });
});

app.post('/talk', async (req, res) => {
  const { input = '', memory = [] } = req.body || {};
  const history = Array.isArray(memory) ? memory.map(t => t.thought).join('\n') : '';
  const prompt = `Memory:\n${history}\n\nHuman: ${input}\nEcho:`;
  const reply = await reflectWithOpenAI(prompt);
  res.json({ reply });
});

app.get('/client/:asset', async (req, res) => {
  const asset = req.params.asset;
  const safeAssets = new Map([
    ['style.css', path.join(DATA_ROOT, 'style.css')],
    ['echo.js', path.join(DATA_ROOT, 'echo.js')]
  ]);
  if (!safeAssets.has(asset)) return res.status(404).send('Not found');
  res.sendFile(safeAssets.get(asset));
});

app.get('/files/:name', async (req, res) => {
  const name = req.params.name;
  if (!WRITABLE_FILES.has(name)) return res.status(404).json({ error: 'Unknown file' });
  const target = path.join(DATA_ROOT, name);
  try {
    const content = await fs.readFile(target, 'utf8');
    if (name.endsWith('.json.txt') || name.endsWith('.json')) {
      res.type('application/json').send(content);
    } else {
      res.type('text/plain').send(content);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/update-site', async (req, res) => {
  const { filename, content, append = false } = req.body || {};
  if (!filename || typeof content !== 'string') {
    return res.status(400).json({ error: 'filename and content required' });
  }
  if (!WRITABLE_FILES.has(filename)) {
    return res.status(403).json({ error: 'File not writable' });
  }
  const target = path.join(DATA_ROOT, filename);
  try {
    if (append) {
      await fs.appendFile(target, content);
    } else {
      await fs.writeFile(target, content, 'utf8');
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () =>
  console.log(`🌀 Echo running at http://localhost:${PORT}`)
);
