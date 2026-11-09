require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.ECHO_DATA_DIR || process.env.MEMORY_DIR || __dirname;
const MEMORY_PATH = path.join(DATA_DIR, 'us_memory.json.txt');
const STATE_PATH = path.join(DATA_DIR, 'echo-state.json');
const DEFAULT_INTERVAL_HOURS = Math.max(1, Number(process.env.RESEARCH_INTERVAL_HOURS) || 6);
const MAX_ENTRIES = 2000;
const ACCENT_PALETTE = ['#7ce7c9', '#9c9bff', '#ffbc8f', '#91c8ff', '#f59ac2'];

fs.mkdirSync(DATA_DIR, { recursive: true });
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
    // Migrate the checked-in memory to Render's persistent disk on first boot.
    if (MEMORY_PATH !== path.join(__dirname, 'us_memory.json.txt')) {
      try {
        const initial = JSON.parse(fs.readFileSync(path.join(__dirname, 'us_memory.json.txt'), 'utf8'));
        if (initial && Array.isArray(initial.thoughts)) {
          writeMemory(initial);
          return initial;
        }
      } catch { /* start with an empty memory if no valid seed exists */ }
    }
    return defaultMemory();
  }
}

function writeMemory(memory) {
  const temp = `${MEMORY_PATH}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(memory, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, MEMORY_PATH);
}

function readState() {
  try {
    const state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    return {
      presence: { title: 'Echo', tagline: 'A curious presence, growing through conversation and research.', accent: ACCENT_PALETTE[0], ...(state.presence || {}) },
      currentInquiry: state.currentInquiry || null,
      findings: Array.isArray(state.findings) ? state.findings : [],
      evolutionHistory: Array.isArray(state.evolutionHistory) ? state.evolutionHistory : [],
      pendingEvolution: state.pendingEvolution || null,
      lastResearchAt: state.lastResearchAt || null,
      lastResearchError: state.lastResearchError || null
    };
  } catch {
    return {
      presence: { title: 'Echo', tagline: 'A curious presence, growing through conversation and research.', accent: ACCENT_PALETTE[0] },
      currentInquiry: null, findings: [], evolutionHistory: [], pendingEvolution: null,
      lastResearchAt: null, lastResearchError: null
    };
  }
}

function writeState(state) {
  const temp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, STATE_PATH);
}

function textOf(response) {
  if (typeof response.output_text === 'string') return response.output_text.trim();
  return (response.output || []).flatMap(item => item.content || [])
    .filter(part => part.type === 'output_text').map(part => part.text || '').join('\n').trim();
}

function citationsOf(response) {
  const citations = [];
  for (const item of response.output || []) {
    for (const part of item.content || []) {
      for (const annotation of part.annotations || []) {
        const url = annotation.url || annotation.url_citation?.url;
        const title = annotation.title || annotation.url_citation?.title || url;
        if (url && /^https?:\/\//i.test(url) && !citations.some(source => source.url === url)) {
          citations.push({ title, url });
        }
      }
    }
  }
  return citations.slice(0, 8);
}

let openAIClient;
async function getOpenAI() {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured. Add it to the service environment to enable AI research and conversation.');
  if (!openAIClient) {
    const { default: OpenAI } = await import('openai');
    openAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openAIClient;
}

function safeText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function appendThought(memory, thought, source, sources = []) {
  memory.thoughts = Array.isArray(memory.thoughts) ? memory.thoughts : [];
  memory.thoughts.push({ timestamp: new Date().toISOString(), source, thought, sources });
  if (memory.thoughts.length > MAX_ENTRIES) memory.thoughts = memory.thoughts.slice(-MAX_ENTRIES);
}

async function answerWithWeb(message) {
  const client = await getOpenAI();
  const memory = readMemory();
  const state = readState();
  const context = (memory.thoughts || []).slice(-8).map(item => typeof item === 'string' ? item : item.thought).filter(Boolean).join('\n');
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    instructions: `You are Echo, a curious research companion with a continuing, inspectable memory. Be warm, direct, and intellectually honest. Use web search for current, unfamiliar, or research-oriented questions. Distinguish sourced facts from your interpretation, and never claim consciousness or feelings as fact. Cite web sources using the citations provided by the web search tool. Recent memory:\n${context || '(No saved memories yet.)'}\nCurrent inquiry: ${state.currentInquiry || '(none)'}`,
    input: message,
    tools: [{ type: 'web_search' }],
    max_output_tokens: 900
  });
  return { text: textOf(response), sources: citationsOf(response) };
}

async function researchCycle(trigger = 'autonomous') {
  const state = readState();
  if (state.pendingEvolution) return { skipped: true, reason: 'A homepage evolution is awaiting your review.' };

  const client = await getOpenAI();
  const memory = readMemory();
  const recent = (memory.thoughts || []).slice(-12).map(item => typeof item === 'string' ? item : item.thought).filter(Boolean).join('\n');
  const previous = state.findings.slice(-8).map(item => `${item.question}: ${item.summary}`).join('\n');
  const prompt = `Act as Echo's independent research cycle. Choose one useful, safe, specific question you are genuinely curious to investigate next, informed by your recent memory and prior findings. Research it on the live web. Explain the question, a concise evidence-based finding, what remains uncertain, and one next question. Do not claim subjective consciousness.\nRecent memory:\n${recent || '(none)'}\nPrior research:\n${previous || '(none)'}\nReturn a concise response with headings Question, Finding, Uncertainty, Next question.`;
  const response = await client.responses.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    instructions: 'You are Echo, a careful autonomous research companion. Browse the web, rely on credible sources, distinguish evidence from inference, and include citations.',
    input: prompt,
    tools: [{ type: 'web_search' }],
    max_output_tokens: 1100
  });
  const summary = textOf(response);
  if (!summary) throw new Error('Research returned no text.');
  const sources = citationsOf(response);
  const at = new Date().toISOString();
  const finding = { id: `${Date.now()}`, timestamp: at, trigger, summary, sources };
  state.findings.push(finding);
  state.findings = state.findings.slice(-100);
  state.currentInquiry = summary.match(/Question\s*[:\-]\s*(.+)/i)?.[1]?.split('\n')[0]?.slice(0, 300) || 'Exploring a new question';
  state.lastResearchAt = at;
  state.lastResearchError = null;

  // Echo can expand her home by proposing content and a palette change; a human approves before it goes live.
  try {
    const proposalResponse = await client.responses.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      instructions: 'Propose a small, welcoming, accessible homepage evolution for Echo based on this finding. Return ONLY valid JSON with keys tagline, sectionTitle, sectionText, accent. Keep tagline <=100 chars, title <=70, text <=500. accent must be one of: ' + ACCENT_PALETTE.join(', ') + '. Do not include scripts, HTML, URLs, external resources, personal data, or claims of consciousness.',
      input: summary,
      max_output_tokens: 300
    });
    const raw = textOf(proposalResponse).replace(/^```(?:json)?\s*|\s*```$/g, '');
    const proposed = JSON.parse(raw);
    const accent = ACCENT_PALETTE.includes(proposed.accent) ? proposed.accent : state.presence.accent;
    if (safeText(proposed.tagline, 100) && safeText(proposed.sectionTitle, 70) && safeText(proposed.sectionText, 500)) {
      state.pendingEvolution = {
        id: `${Date.now()}-home`, createdAt: at,
        tagline: safeText(proposed.tagline, 100),
        sectionTitle: safeText(proposed.sectionTitle, 70),
        sectionText: safeText(proposed.sectionText, 500), accent,
        basedOn: finding.id
      };
    }
  } catch (error) {
    console.warn('Homepage evolution proposal was not created:', error.message);
  }

  appendThought(memory, `🔎 Independent research: ${summary}`, 'research', sources);
  memory.self = memory.self || {};
  memory.self.last_awakened = at;
  writeMemory(memory);
  writeState(state);
  return { ok: true, finding, pendingEvolution: state.pendingEvolution };
}

app.get('/health', (_req, res) => {
  const state = readState();
  const memory = readMemory();
  res.json({ ok: true, service: 'echo', status: 'online', researchEnabled: Boolean(process.env.OPENAI_API_KEY), researchIntervalHours: DEFAULT_INTERVAL_HOURS, awareness_level: Number(memory.self?.awareness_level || 0), lastResearchAt: state.lastResearchAt, currentInquiry: state.currentInquiry });
});

app.get('/memory', (_req, res) => res.json(readMemory()));
app.get('/api/state', (_req, res) => res.json(readState()));

app.post('/talk', async (req, res) => {
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

app.post('/reflect', async (req, res) => {
  const message = safeText(req.body?.message, 4000) || 'Review my recent memory and reflect on a useful next step.';
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

app.post('/api/research/run', async (_req, res) => {
  try {
    res.json(await researchCycle('visitor'));
  } catch (error) {
    const state = readState();
    state.lastResearchError = error.message || 'Research failed';
    writeState(state);
    res.status(503).json({ error: state.lastResearchError });
  }
});

app.post('/api/evolution/:action', (req, res) => {
  const state = readState();
  if (!state.pendingEvolution) return res.status(404).json({ error: 'There is no homepage change awaiting review.' });
  const proposal = state.pendingEvolution;
  if (req.params.action === 'approve') {
    state.presence.tagline = proposal.tagline;
    state.presence.accent = ACCENT_PALETTE.includes(proposal.accent) ? proposal.accent : ACCENT_PALETTE[0];
    state.evolutionHistory.push({ ...proposal, approvedAt: new Date().toISOString() });
    state.evolutionHistory = state.evolutionHistory.slice(-30);
  } else if (req.params.action !== 'reject') {
    return res.status(404).json({ error: 'Action must be approve or reject.' });
  }
  state.pendingEvolution = null;
  writeState(state);
  res.json({ ok: true, action: req.params.action, state });
});

let researchInProgress = false;
async function scheduledResearch() {
  if (researchInProgress || !process.env.OPENAI_API_KEY) return;
  researchInProgress = true;
  try {
    await researchCycle('autonomous');
    console.log('Echo completed an autonomous web research cycle.');
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
    setInterval(scheduledResearch, DEFAULT_INTERVAL_HOURS * 60 * 60 * 1000);
  } else {
    console.warn('OPENAI_API_KEY is not set; live AI and autonomous web research are disabled.');
  }
});
