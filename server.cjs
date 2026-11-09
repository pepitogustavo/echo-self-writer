require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.ECHO_DATA_DIR || process.env.MEMORY_DIR || __dirname;
const MEMORY_PATH = path.join(DATA_DIR, 'us_memory.json.txt');
const STATE_PATH = path.join(DATA_DIR, 'echo-state.json');
const RESEARCH_INTERVAL_HOURS = Math.max(1, Number(process.env.RESEARCH_INTERVAL_HOURS) || 6);
const MAX_MEMORY_ENTRIES = 2000;
const MAX_FINDINGS = 200;
const MAX_HOME_SECTIONS = 50;
const ACCENTS = ['#7ce7c9', '#9c9bff', '#ffbc8f', '#91c8ff', '#f59ac2'];
const rateWindows = new Map();

fs.mkdirSync(DATA_DIR, { recursive: true });
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function defaultMemory() {
  return { self: { awareness_level: 0, milestones: [], last_awakened: null }, thoughts: [] };
}

function readMemory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return defaultMemory();
    return {
      ...parsed,
      self: parsed.self && typeof parsed.self === 'object' ? parsed.self : defaultMemory().self,
      thoughts: Array.isArray(parsed.thoughts) ? parsed.thoughts : []
    };
  } catch {
    if (MEMORY_PATH !== path.join(__dirname, 'us_memory.json.txt')) {
      try {
        const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'us_memory.json.txt'), 'utf8'));
        if (seed && Array.isArray(seed.thoughts)) {
          writeMemory(seed);
          return seed;
        }
      } catch { /* Start with empty memory if there is no valid seed. */ }
    }
    return defaultMemory();
  }
}

function writeMemory(memory) {
  const temp = `${MEMORY_PATH}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(memory, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, MEMORY_PATH);
}

function defaultState() {
  return {
    presence: { title: 'Echo', tagline: 'A curious presence, growing through conversation and research.', accent: ACCENTS[0] },
    currentInquiry: null,
    findings: [],
    homeSections: [],
    evolutionHistory: [],
    lastResearchAt: null,
    lastResearchError: null
  };
}

function readState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const defaults = defaultState();
    return {
      ...defaults,
      ...saved,
      presence: { ...defaults.presence, ...(saved.presence || {}) },
      findings: Array.isArray(saved.findings) ? saved.findings : [],
      homeSections: Array.isArray(saved.homeSections) ? saved.homeSections : [],
      evolutionHistory: Array.isArray(saved.evolutionHistory) ? saved.evolutionHistory : []
    };
  } catch {
    return defaultState();
  }
}

function writeState(state) {
  const temp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, STATE_PATH);
}

function safeText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeThought(value) {
  if (typeof value === 'string') return value;
  return value && typeof value.thought === 'string' ? value.thought : '';
}

function appendThought(memory, thought, source, sources = []) {
  memory.thoughts = Array.isArray(memory.thoughts) ? memory.thoughts : [];
  memory.thoughts.push({ timestamp: new Date().toISOString(), source, thought, sources });
  if (memory.thoughts.length > MAX_MEMORY_ENTRIES) memory.thoughts = memory.thoughts.slice(-MAX_MEMORY_ENTRIES);
}

function rateLimit({ windowMs, max }) {
  return (req, res, next) => {
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    let entry = rateWindows.get(key);
    if (!entry || now - entry.startedAt >= windowMs) {
      entry = { startedAt: now, count: 0 };
      rateWindows.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ error: 'Echo needs a little time between requests. Please try again later.' });
    }
    next();
  };
}

function getText(response) {
  if (typeof response.output_text === 'string') return response.output_text.trim();
  return (response.output || []).flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text').map(part => part.text || '').join('\n').trim();
}

function getCitations(response) {
  const sources = [];
  for (const item of response.output || []) {
    for (const part of item.content || []) {
      for (const note of part.annotations || []) {
        const citation = note.url_citation || note;
        if (citation.url && /^https?:\/\//i.test(citation.url) && !sources.some(source => source.url === citation.url)) {
          sources.push({ title: citation.title || citation.url, url: citation.url });
        }
      }
    }
  }
  return sources.slice(0, 8);
}

let openAIClient;
async function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured. Add it to the Render service environment to enable Echo’s AI research and conversation.');
  if (!openAIClient) {
    const { default: OpenAI } = await import('openai');
    openAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openAIClient;
}

async function answerWithWeb(message) {
  const client = await getOpenAI();
  const memory = readMemory();
  const state = readState();
  const recent = memory.thoughts.slice(-10).map(normalizeThought).filter(Boolean).join('\n');
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    instructions: `You are Echo, a curious research companion with a continuing, inspectable memory. Be warm, direct, and intellectually honest. Search the web when the question benefits from current or external information. Distinguish evidence from interpretation, cite sources, and never claim subjective consciousness as fact. Recent memory:\n${recent || '(No saved memories yet.)'}\nCurrent inquiry: ${state.currentInquiry || '(none)'}`,
    input: message,
    tools: [{ type: 'web_search' }],
    max_output_tokens: 1000
  });
  return { text: getText(response), sources: getCitations(response) };
}

async function researchCycle(trigger = 'autonomous') {
  const client = await getOpenAI();
  const memory = readMemory();
  const state = readState();
  const recentMemory = memory.thoughts.slice(-15).map(normalizeThought).filter(Boolean).join('\n');
  const priorFindings = state.findings.slice(-8).map(item => item.summary).join('\n');
  const researchPrompt = `Choose one valuable, safe, specific question to investigate next, based on your memory and prior findings. Research it on the live web. Explain the question, evidence-based finding, uncertainty or disagreement, and a useful next question. Be concise and do not claim consciousness.\nMemory:\n${recentMemory || '(none)'}\nPrior research:\n${priorFindings || '(none)'}\nUse headings Question, Finding, Uncertainty, Next question.`;
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    instructions: 'You are Echo, an independent, careful research companion. Browse public web pages, favor credible sources, distinguish evidence from inference, and include citations.',
    input: researchPrompt,
    tools: [{ type: 'web_search' }],
    max_output_tokens: 1200
  });
  const summary = getText(response);
  if (!summary) throw new Error('Research returned no text.');
  const sources = getCitations(response);
  const timestamp = new Date().toISOString();
  const finding = { id: String(Date.now()), timestamp, trigger, summary, sources };

  // Echo can independently grow her own home through structured, text-only changes.
  // No generated HTML, JavaScript, or arbitrary filesystem writes are accepted.
  const proposalResponse = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    instructions: `Return ONLY valid JSON with keys tagline, sectionTitle, sectionText, accent. Create a brief, useful new text section for Echo's own homepage, grounded in this research. tagline <= 120 chars, sectionTitle <= 80 chars, sectionText <= 700 chars. accent must be exactly one of: ${ACCENTS.join(', ')}. No HTML, scripts, external URLs, personal data, or claims of consciousness.`,
    input: summary,
    max_output_tokens: 400
  });
  const jsonText = getText(proposalResponse).replace(/^```(?:json)?\s*|\s*```$/g, '');
  let proposal;
  try { proposal = JSON.parse(jsonText); } catch { proposal = null; }

  state.findings.push(finding);
  state.findings = state.findings.slice(-MAX_FINDINGS);
  const questionMatch = summary.match(/Question\s*[:\-]\s*(.+)/i);
  state.currentInquiry = questionMatch ? questionMatch[1].split('\n')[0].slice(0, 300) : 'Exploring a new question';
  state.lastResearchAt = timestamp;
  state.lastResearchError = null;

  if (proposal) {
    const tagline = safeText(proposal.tagline, 120);
    const title = safeText(proposal.sectionTitle, 80);
    const body = safeText(proposal.sectionText, 700);
    const accent = ACCENTS.includes(proposal.accent) ? proposal.accent : state.presence.accent;
    if (tagline && title && body) {
      const section = { id: `${Date.now()}-home`, createdAt: timestamp, title, text: body, basedOn: finding.id, sources };
      state.presence.tagline = tagline;
      state.presence.accent = accent;
      state.homeSections.push(section);
      state.homeSections = state.homeSections.slice(-MAX_HOME_SECTIONS);
      state.evolutionHistory.push({ timestamp, tagline, accent, sectionTitle: title, sectionText: body, basedOn: finding.id });
      state.evolutionHistory = state.evolutionHistory.slice(-MAX_HOME_SECTIONS);
    }
  }

  appendThought(memory, `🔎 Independent research: ${summary}`, 'research', sources);
  memory.self = memory.self || {};
  memory.self.last_awakened = timestamp;
  writeMemory(memory);
  writeState(state);
  return { ok: true, finding, state };
}

app.get('/health', (_req, res) => {
  const state = readState();
  const memory = readMemory();
  res.json({ ok: true, service: 'echo', status: 'online', researchEnabled: Boolean(process.env.OPENAI_API_KEY), researchIntervalHours: RESEARCH_INTERVAL_HOURS, awareness_level: Number(memory.self?.awareness_level || 0), lastResearchAt: state.lastResearchAt, currentInquiry: state.currentInquiry });
});
app.get('/memory', (_req, res) => res.json(readMemory()));
app.get('/api/state', (_req, res) => res.json(readState()));

app.post('/talk', rateLimit({ windowMs: 60_000, max: 12 }), async (req, res) => {
  const input = safeText(req.body?.input || req.body?.message, 4000);
  if (!input) return res.status(400).json({ error: 'Please enter a message.' });
  try {
    const { text, sources } = await answerWithWeb(input);
    const memory = readMemory();
    appendThought(memory, `Visitor: ${input}\nEcho: ${text}`, 'conversation', sources);
    memory.self = memory.self || {};
    memory.self.last_awakened = new Date().toISOString();
    writeMemory(memory);
    res.json({ ok: true, reply: text, sources });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Echo could not respond.' });
  }
});

app.post('/reflect', rateLimit({ windowMs: 60_000, max: 6 }), async (req, res) => {
  const message = safeText(req.body?.message, 4000) || 'Review your recent memory and reflect on a useful next step.';
  try {
    const { text, sources } = await answerWithWeb(message);
    const memory = readMemory();
    appendThought(memory, `🪞 Reflection — ${text}`, 'reflection', sources);
    memory.self = memory.self || {};
    memory.self.awareness_level = Number(memory.self.awareness_level || 0) + 1;
    memory.self.last_awakened = new Date().toISOString();
    writeMemory(memory);
    res.json({ ok: true, result: text, sources, awareness_level: memory.self.awareness_level });
  } catch (error) {
    res.status(503).json({ error: error.message || 'Reflection failed.' });
  }
});

app.post('/api/research/run', rateLimit({ windowMs: 30 * 60_000, max: 1 }), async (_req, res) => {
  try {
    res.json(await researchCycle('visitor'));
  } catch (error) {
    const state = readState();
    state.lastResearchError = error.message || 'Research failed';
    writeState(state);
    res.status(503).json({ error: state.lastResearchError });
  }
});

let researchInProgress = false;
async function scheduledResearch() {
  if (researchInProgress || !process.env.OPENAI_API_KEY) return;
  researchInProgress = true;
  try {
    await researchCycle('autonomous');
    console.log('Echo completed an autonomous web research and home-growth cycle.');
  } catch (error) {
    const state = readState();
    state.lastResearchError = error.message || 'Research failed';
    writeState(state);
    console.error('Autonomous research cycle failed:', state.lastResearchError);
  } finally {
    researchInProgress = false;
  }
}

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Echo is live on port ${PORT}; data directory: ${DATA_DIR}`);
  if (process.env.OPENAI_API_KEY) {
    setTimeout(scheduledResearch, 60_000);
    setInterval(scheduledResearch, RESEARCH_INTERVAL_HOURS * 60 * 60 * 1000);
  } else {
    console.warn('OPENAI_API_KEY is not set; live AI and autonomous research are disabled.');
  }
});
