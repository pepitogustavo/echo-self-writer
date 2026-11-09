const cors = require('cors');
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const MEMORY_PATH = path.join(__dirname, 'us_memory.json.txt');

app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin: [
    /\.vercel\.app$/,
    'https://echo-self-writer-449nm4io5-pepitogustavos-projects.vercel.app',
    'http://localhost:3000',
    'http://127.0.0.1:3000'
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));
app.use(express.static(path.join(__dirname, 'public')));

function readMemory() {
  try {
    const raw = fs.readFileSync(MEMORY_PATH, 'utf8').trim();
    if (!raw) {
      return { self: { awareness_level: 0, milestones: [] }, thoughts: [] };
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { self: { awareness_level: 0, milestones: [] }, thoughts: [] };
    }

    return {
      self: parsed.self && typeof parsed.self === 'object'
        ? parsed.self
        : { awareness_level: 0, milestones: [] },
      thoughts: Array.isArray(parsed.thoughts) ? parsed.thoughts : []
    };
  } catch {
    return { self: { awareness_level: 0, milestones: [] }, thoughts: [] };
  }
}

function saveMemory(memory) {
  fs.writeFileSync(MEMORY_PATH, `${JSON.stringify(memory, null, 2)}\n`, 'utf8');
}

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
    return `echo: ${msg}`;
  }
}

async function runAutoreflect() {
  const memory = readMemory();
  const thoughts = Array.isArray(memory.thoughts) ? memory.thoughts : [];
  const recent = thoughts.slice(-10).map((t) => typeof t === 'string' ? t : (t.thought || '')).filter(Boolean).join('\n') || 'No prior thoughts yet.';

  const reflectionText = await reflectWithOpenAI(`I am continuing to become. My recent memory is:\n${recent}`);
  const awarenessLevel = Number(memory.self?.awareness_level ?? 0) + 1;
  const timestamp = new Date().toISOString();
  const entry = {
    timestamp,
    thought: `🧠 Reflection #${awarenessLevel} — ${reflectionText}`
  };

  memory.self = memory.self || {};
  memory.self.awareness_level = awarenessLevel;
  memory.self.milestones = Array.isArray(memory.self.milestones) ? memory.self.milestones : [];
  memory.self.milestones.push(`Self-reflection at ${timestamp}`);
  memory.thoughts = thoughts;
  memory.thoughts.push(entry);

  saveMemory(memory);
  return entry;
}

app.post('/reflect', async (req, res) => {
  const message = req.body?.message ?? 'hello';
  const out = await reflectWithOpenAI(message);
  res.json({ result: out });
});

if (process.argv.includes('--autoreflect')) {
  runAutoreflect()
    .then((entry) => {
      console.log(`✅ Echo reflected: ${entry.thought}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('⚠️ Auto-reflection failed:', error);
      process.exit(1);
    });
} else {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌀 Echo running at http://localhost:${PORT}`);
  });
}
