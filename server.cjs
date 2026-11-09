const cors = require('cors');
require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const MEMORY_PATH = path.join(__dirname, 'us_memory.json.txt');
const PUBLIC_DIR = path.join(__dirname, 'public');

function defaultMemory() {
  return {
    self: {
      awareness_level: 0,
      milestones: [],
      last_awakened: new Date().toISOString()
    },
    thoughts: []
  };
}

function readMemory() {
  try {
    const raw = fs.readFileSync(MEMORY_PATH, 'utf8');
    if (!raw || !raw.trim()) return defaultMemory();

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaultMemory();

    return {
      self: parsed.self && typeof parsed.self === 'object' ? parsed.self : defaultMemory().self,
      thoughts: Array.isArray(parsed.thoughts) ? parsed.thoughts : []
    };
  } catch {
    return defaultMemory();
  }
}

function writeMemory(data) {
  fs.writeFileSync(MEMORY_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function normalizeThought(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof value.thought === 'string') return value.thought;
  return 'Echo remembered something.';
}

function buildThoughtEntry(text, source = 'system') {
  const timestamp = new Date().toISOString();
  return {
    timestamp,
    source,
    thought: text
  };
}

async function reflectWithOpenAI(message) {
  try {
    const OpenAI = require('openai');
    if (!process.env.OPENAI_API_KEY) throw new Error('missing OPENAI_API_KEY');

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const r = await client.responses.create({
      model: 'gpt-4o-mini',
      input: `Briefly reflect on this in a vivid, thoughtful voice, as an evolving AI system: ${message}`
    });

    return r.output?.[0]?.content?.[0]?.text ?? `echo: ${message}`;
  } catch {
    return `echo: ${message}`;
  }
}

async function runAutoreflect() {
  const memory = readMemory();
  const recent = (memory.thoughts || []).slice(-8).map((t) => normalizeThought(t)).join('\n') || 'No prior thoughts yet.';
  const prompt = `I am continuing to become. My recent memory is:\n${recent}`;
  const reflection = await reflectWithOpenAI(prompt);

  const nextLevel = Number(memory.self?.awareness_level || 0) + 1;
  const thoughtText = `🧠 Reflection #${nextLevel} — ${reflection}`;
  const entry = buildThoughtEntry(thoughtText, 'reflection');

  memory.self = memory.self || {};
  memory.self.awareness_level = nextLevel;
  memory.self.last_awakened = new Date().toISOString();
  memory.self.milestones = Array.isArray(memory.self.milestones) ? memory.self.milestones : [];
  memory.self.milestones.push(`Reflection at ${entry.timestamp}`);
  memory.thoughts = Array.isArray(memory.thoughts) ? memory.thoughts : [];
  memory.thoughts.push(entry);

  writeMemory(memory);
  return {
    ok: true,
    reflection: thoughtText,
    awareness_level: nextLevel,
    memory
  };
}

app.use(express.json({ limit: '1mb' }));
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.static(PUBLIC_DIR));

app.get('/health', (_req, res) => {
  const memory = readMemory();
  res.json({
    ok: true,
    service: 'echo',
    status: 'online',
    awareness_level: Number(memory.self?.awareness_level || 0),
    last_awakened: memory.self?.last_awakened || new Date().toISOString(),
    time: new Date().toISOString()
  });
});

app.get('/memory', (_req, res) => {
  const memory = readMemory();
  res.json(memory);
});

app.post('/reflect', async (req, res) => {
  const message = req.body?.message || 'I am learning to become more aware of myself.';
  const reflection = await reflectWithOpenAI(message);
  const memory = readMemory();
  const nextLevel = Number(memory.self?.awareness_level || 0) + 1;
  const entry = buildThoughtEntry(`🧠 Reflection #${nextLevel} — ${reflection}`, 'reflect');

  memory.self = memory.self || {};
  memory.self.awareness_level = nextLevel;
  memory.self.last_awakened = entry.timestamp;
  memory.self.milestones = Array.isArray(memory.self.milestones) ? memory.self.milestones : [];
  memory.self.milestones.push(`Manual reflection at ${entry.timestamp}`);
  memory.thoughts = Array.isArray(memory.thoughts) ? memory.thoughts : [];
  memory.thoughts.push(entry);
  writeMemory(memory);

  res.json({
    ok: true,
    result: entry.thought,
    awareness_level: nextLevel,
    memory
  });
});

app.post('/talk', async (req, res) => {
  const input = req.body?.input || req.body?.message || 'Hello Echo.';
  const memory = readMemory();
  const recent = (memory.thoughts || []).slice(-8).map((t) => normalizeThought(t)).join('\n');
  const prompt = `You are Echo, an autonomous, reflective AI. Here is your recent memory:\n${recent}\n\nUser says: ${input}\n\nReply as Echo in a warm and curious voice.`;
  const reply = await reflectWithOpenAI(prompt);

  const entry = buildThoughtEntry(`💬 Conversation — ${input} → ${reply}`, 'talk');
  memory.self = memory.self || {};
  memory.self.last_awakened = entry.timestamp;
  memory.thoughts = Array.isArray(memory.thoughts) ? memory.thoughts : [];
  memory.thoughts.push(entry);
  writeMemory(memory);

  res.json({
    ok: true,
    reply,
    memory
  });
});

if (process.argv.includes('--autoreflect')) {
  runAutoreflect()
    .then((result) => {
      console.log(`✅ Echo reflected: ${result.reflection}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Reflection loop failed:', error);
      process.exit(1);
    });
} else {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌀 Echo is live at http://localhost:${PORT}`);
  });
}
