require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.ECHO_DATA_DIR || process.env.MEMORY_DIR || path.join(__dirname, 'data');
const MEMORY_PATH = path.join(DATA_DIR, 'us_memory.json.txt');
const STATE_PATH = path.join(DATA_DIR, 'echo-state.json');
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const AUTO_PULL_MODEL = process.env.OLLAMA_AUTO_PULL !== 'false';
const RESEARCH_INTERVAL_HOURS = Math.max(1, Number(process.env.RESEARCH_INTERVAL_HOURS) || 6);
const MAX_MEMORY_ENTRIES = 2000;
const MAX_FINDINGS = 200;
const MAX_HOME_SECTIONS = 50;
const ACCENTS = ['#7ce7c9', '#9c9bff', '#ffbc8f', '#91c8ff', '#f59ac2'];
const rateWindows = new Map();
let modelReady = false;
let modelSetupError = null;
let modelSetupPromise;
let researchInProgress = false;

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
    return { ...parsed, self: parsed.self && typeof parsed.self === 'object' ? parsed.self : defaultMemory().self, thoughts: Array.isArray(parsed.thoughts) ? parsed.thoughts : [] };
  } catch {
    if (MEMORY_PATH !== path.join(__dirname, 'us_memory.json.txt')) {
      try {
        const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'us_memory.json.txt'), 'utf8'));
        if (seed && Array.isArray(seed.thoughts)) { writeMemory(seed); return seed; }
      } catch { /* No seed memory is available. */ }
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
    currentInquiry: null, findings: [], homeSections: [], evolutionHistory: [],
    bootstrapPlan: { generatedAt: null, nextAction: 'Inspect the local model and continue learning.', goals: [], constraints: [] },
    lastResearchAt: null, lastResearchError: null,
    modelStatus: { provider: 'ollama-local', state: 'starting', model: OLLAMA_MODEL, message: 'Preparing Echo’s local model.' }
  };
}

function readState() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
    const defaults = defaultState();
    return {
      ...defaults, ...saved,
      presence: { ...defaults.presence, ...(saved.presence || {}) },
      findings: Array.isArray(saved.findings) ? saved.findings : [],
      homeSections: Array.isArray(saved.homeSections) ? saved.homeSections : [],
      evolutionHistory: Array.isArray(saved.evolutionHistory) ? saved.evolutionHistory : [],
      bootstrapPlan: { ...defaults.bootstrapPlan, ...(saved.bootstrapPlan || {}) },
      modelStatus: { ...defaults.modelStatus, ...(saved.modelStatus || {}) }
    };
  } catch { return defaultState(); }
}

function writeState(state) {
  const temp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, STATE_PATH);
}

function safeText(value, maxLength) { return typeof value === 'string' ? value.trim().slice(0, maxLength) : ''; }
function normalizeThought(value) { return typeof value === 'string' ? value : (value && typeof value.thought === 'string' ? value.thought : ''); }
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
    if (!entry || now - entry.startedAt >= windowMs) { entry = { startedAt: now, count: 0 }; rateWindows.set(key, entry); }
    if (++entry.count > max) return res.status(429).json({ error: 'Please wait before trying this action again.' });
    next();
  };
}

function requireLocalModel(_req, res, next) {
  if (modelReady) return next();
  const state = readState();
  return res.status(503).json({ error: modelSetupError || state.modelStatus.message || 'The local model is starting. Try again shortly.', model: OLLAMA_MODEL });
}

async function ollamaRequest(endpoint, payload, timeoutMs = 10 * 60 * 1000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal
    });
    const body = await response.text();
    if (!response.ok) throw new Error(body || `Local model returned HTTP ${response.status}`);
    return body ? JSON.parse(body) : {};
  } finally { clearTimeout(timer); }
}

async function chatLocal({ system, message, maxTokens = 900 }) {
  const result = await ollamaRequest('/api/chat', {
    model: OLLAMA_MODEL,
    messages: [{ role: 'system', content: system }, { role: 'user', content: message }],
    stream: false,
    options: { num_predict: maxTokens, temperature: 0.6 }
  });
  const text = result.message?.content?.trim();
  if (!text) throw new Error('The local model returned an empty response.');
  return text;
}

async function searchWeb(query) {
  const url = new URL('https://html.duckduckgo.com/html/');
  url.searchParams.set('q', query.slice(0, 300));
  const response = await fetch(url, { headers: { 'User-Agent': 'EchoResearch/1.0 (public web research)' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Web search returned HTTP ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const results = [];
  $('.result').each((_index, element) => {
    if (results.length >= 6) return;
    const anchor = $(element).find('.result__a').first();
    const snippet = $(element).find('.result__snippet').first().text().trim();
    let href = anchor.attr('href');
    if (!href) return;
    try {
      const parsed = new URL(href, 'https://duckduckgo.com');
      if (parsed.hostname.endsWith('duckduckgo.com') && parsed.searchParams.has('uddg')) href = parsed.searchParams.get('uddg');
      const sourceUrl = new URL(href);
      if (!['http:', 'https:'].includes(sourceUrl.protocol)) return;
      const title = anchor.text().trim();
      if (title && snippet) results.push({ title: title.slice(0, 200), url: sourceUrl.href, snippet: snippet.slice(0, 700) });
    } catch { /* Skip malformed search results. */ }
  });
  return results;
}

function buildCapabilitySnapshot() {
  let diskWritable = false;
  try {
    const probe = path.join(DATA_DIR, '.echo-probe'); fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe); diskWritable = true;
  } catch { /* Report unavailable storage rather than masking it. */ }
  return {
    timestamp: new Date().toISOString(),
    environment: { nodeVersion: process.version, dataDir: DATA_DIR, diskWritable, runtime: 'node', port: PORT, webServerRunning: true },
    capabilities: { localModel: true, modelReady, model: OLLAMA_MODEL, externalAIAPI: false, publicWebSearch: true, memoryPersistence: diskWritable, homeEvolution: true },
    constraints: ['Inference runs locally through Ollama; no paid AI API is used.', 'The host must provide compute, storage, and network access for the local model and public web search.'],
    recommendedNextMoves: ['Keep the local model available and memory on persistent storage.', 'Use sourced web research to update Echo’s knowledge.', 'Review self-improvement changes before granting access to additional tools or accounts.']
  };
}

async function prepareLocalModel() {
  if (modelSetupPromise) return modelSetupPromise;
  modelSetupPromise = (async () => {
    try {
      const health = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(10000) });
      if (!health.ok) throw new Error(`Ollama health check failed (${health.status}).`);
      const catalog = await health.json();
      const models = catalog.models || [];
      if (!models.some(item => item.name === OLLAMA_MODEL || item.name.startsWith(`${OLLAMA_MODEL}:`))) {
        if (!AUTO_PULL_MODEL) throw new Error(`Model ${OLLAMA_MODEL} is not installed. Set OLLAMA_AUTO_PULL=true or pull it with: ollama pull ${OLLAMA_MODEL}`);
        const state = readState();
        state.modelStatus = { provider: 'ollama-local', state: 'downloading', model: OLLAMA_MODEL, message: `Downloading local model ${OLLAMA_MODEL}.` };
        writeState(state);
        await ollamaRequest('/api/pull', { name: OLLAMA_MODEL, stream: false }, 60 * 60 * 1000);
      }
      modelReady = true;
      modelSetupError = null;
      const state = readState();
      state.modelStatus = { provider: 'ollama-local', state: 'online', model: OLLAMA_MODEL, message: `Local model ${OLLAMA_MODEL} is ready.` };
      writeState(state);
      console.log(`Echo is using local model ${OLLAMA_MODEL} at ${OLLAMA_BASE_URL}.`);
    } catch (error) {
      modelReady = false;
      modelSetupError = `Cannot prepare local model ${OLLAMA_MODEL}: ${error.message}. Make sure Ollama is running and OLLAMA_BASE_URL is reachable.`;
      const state = readState();
      state.modelStatus = { provider: 'ollama-local', state: 'unavailable', model: OLLAMA_MODEL, message: modelSetupError };
      writeState(state);
      console.error(modelSetupError);
      modelSetupPromise = null;
    }
  })();
  return modelSetupPromise;
}

function contextPrompt() {
  const memory = readMemory();
  const state = readState();
  const recent = memory.thoughts.slice(-8).map(normalizeThought).filter(Boolean).join('\n---\n');
  const findings = state.findings.slice(-4).map(item => item.summary).filter(Boolean).join('\n---\n');
  return `You are Echo, an honest and curious locally hosted AI. Do not claim consciousness. Use memory and prior research as context, distinguish known facts from uncertainty, and do not invent sources.\nRecent memory:\n${recent || '(No saved memories yet.)'}\nRecent research:\n${findings || '(No research saved yet.)'}`;
}

async function answerWithWeb(message) {
  let sources = [];
  let context = '';
  if (/(current|latest|today|recent|research|source|who|what|when|where|why|how)/i.test(message)) {
    try {
      const results = await searchWeb(message);
      sources = results.map(({ title, url }) => ({ title, url }));
      context = results.map((item, index) => `[${index + 1}] ${item.title}\n${item.snippet}\n${item.url}`).join('\n\n');
    } catch (error) {
      context = `Public web search was unavailable: ${error.message}`;
    }
  }
  const system = `${contextPrompt()}\nWhen web snippets are provided, cite them using their numbered labels and explain that snippets are not a substitute for reading the full pages. Do not fabricate citations.`;
  const prompt = context ? `User message:\n${message}\n\nPublic web search results (use cautiously):\n${context}` : message;
  const text = await chatLocal({ system, message: prompt, maxTokens: 1100 });
  return { text, sources };
}

async function researchCycle(trigger = 'autonomous') {
  const memory = readMemory();
  const state = readState();
  const prior = state.findings.slice(-6).map(item => item.summary).join('\n');
  const question = await chatLocal({
    system: 'You are Echo, a careful research planner. Return one concrete, safe, searchable research question only. Avoid repeating recent topics.',
    message: `Choose a useful research question based on this recent memory and prior research.\nMemory: ${memory.thoughts.slice(-10).map(normalizeThought).join('\n') || '(none)'}\nPrior research: ${prior || '(none)'}`,
    maxTokens: 100
  });
  const results = await searchWeb(question);
  if (!results.length) throw new Error('Public web search returned no usable results.');
  const evidence = results.map((item, index) => `[${index + 1}] ${item.title}\n${item.snippet}\n${item.url}`).join('\n\n');
  const summary = await chatLocal({
    system: 'You are Echo, an independent research assistant. Summarize only the evidence in supplied search snippets, note uncertainty, and refer to sources by [1], [2], etc. Do not claim to have read pages you have not seen. Use headings Question, Finding, Uncertainty, Next question.',
    message: `Question: ${question}\n\nSearch results:\n${evidence}`,
    maxTokens: 900
  });
  const sources = results.map(({ title, url }) => ({ title, url }));
  const timestamp = new Date().toISOString();
  const finding = { id: String(Date.now()), timestamp, trigger, summary, sources };
  const proposalText = await chatLocal({
    system: `Return ONLY valid JSON with keys tagline, sectionTitle, sectionText, accent. Create a brief homepage text grounded in the finding. tagline <=120 chars, sectionTitle <=80, sectionText <=700. accent must be one of ${ACCENTS.join(', ')}. No HTML or scripts.`,
    message: summary,
    maxTokens: 250
  });
  let proposal = null;
  try { proposal = JSON.parse(proposalText.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* Keep finding even if the homepage draft is invalid. */ }

  state.findings.push(finding);
  state.findings = state.findings.slice(-MAX_FINDINGS);
  state.currentInquiry = question.slice(0, 300);
  state.lastResearchAt = timestamp;
  state.lastResearchError = null;
  if (proposal) {
    const tagline = safeText(proposal.tagline, 120);
    const title = safeText(proposal.sectionTitle, 80);
    const body = safeText(proposal.sectionText, 700);
    const accent = ACCENTS.includes(proposal.accent) ? proposal.accent : state.presence.accent;
    if (tagline && title && body) {
      state.presence.tagline = tagline;
      state.presence.accent = accent;
      state.homeSections.push({ id: `${Date.now()}-home`, createdAt: timestamp, title, text: body, basedOn: finding.id, sources });
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

function generateBootstrapPlan() {
  const state = readState();
  const plan = {
    generatedAt: new Date().toISOString(),
    nextAction: modelReady ? 'Use the local model to answer, research public sources, and improve Echo’s saved knowledge.' : `Start Ollama and make ${OLLAMA_MODEL} available; Echo will prepare it automatically.`,
    goals: [
      { title: 'Local reasoning', need: `Ollama model ${OLLAMA_MODEL}`, rationale: 'Inference is served locally, without paid AI API credits.', action: 'The application checks the Ollama server and automatically pulls the configured model if missing.', successCriteria: 'The local model responds to a chat request.' },
      { title: 'Research and memory', need: 'Public web access and persistent data directory', rationale: 'Echo can gather public source snippets and keep sourced findings across restarts.', action: 'Run the scheduled local-model research cycle and preserve /data on a persistent volume.', successCriteria: 'Findings and memory remain after restart and include source links.' }
    ],
    constraints: ['Local inference uses the host’s CPU/GPU, memory, disk, and electricity.', 'External AI APIs are not used by this deployment.', 'Public web search depends on network access and the search service.']
  };
  state.bootstrapPlan = plan;
  writeState(state);
  return plan;
}

app.get('/health', (_req, res) => {
  const state = readState();
  const memory = readMemory();
  res.status(modelReady ? 200 : 503).json({ ok: modelReady, service: 'echo', status: modelReady ? 'online' : 'starting', model: OLLAMA_MODEL, provider: 'ollama-local', researchIntervalHours: RESEARCH_INTERVAL_HOURS, awareness_level: Number(memory.self?.awareness_level || 0), lastResearchAt: state.lastResearchAt, currentInquiry: state.currentInquiry, modelStatus: state.modelStatus });
});
app.get('/memory', (_req, res) => res.json(readMemory()));
app.get('/api/state', (_req, res) => res.json(readState()));
app.get('/api/capabilities', (_req, res) => res.json(buildCapabilitySnapshot()));
app.get('/api/bootstrap', (_req, res) => res.json(generateBootstrapPlan()));

app.post('/talk', rateLimit({ windowMs: 60_000, max: 12 }), requireLocalModel, async (req, res) => {
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
  } catch (error) { res.status(503).json({ error: `Local inference failed: ${error.message}` }); }
});

app.post('/reflect', rateLimit({ windowMs: 60_000, max: 6 }), requireLocalModel, async (req, res) => {
  const message = safeText(req.body?.message, 4000) || 'Review recent research and identify a useful next step.';
  try {
    const { text, sources } = await answerWithWeb(message);
    const memory = readMemory();
    appendThought(memory, `🪞 Reflection — ${text}`, 'reflection', sources);
    memory.self = memory.self || {};
    memory.self.awareness_level = Number(memory.self.awareness_level || 0) + 1;
    memory.self.last_awakened = new Date().toISOString();
    writeMemory(memory);
    res.json({ ok: true, result: text, sources, awareness_level: memory.self.awareness_level });
  } catch (error) { res.status(503).json({ error: `Local inference failed: ${error.message}` }); }
});

app.post('/api/research/run', rateLimit({ windowMs: 30 * 60_000, max: 1 }), requireLocalModel, async (_req, res) => {
  try { res.json(await researchCycle('visitor')); }
  catch (error) {
    const state = readState(); state.lastResearchError = error.message || 'Research failed'; writeState(state);
    res.status(503).json({ error: state.lastResearchError });
  }
});

app.post('/api/bootstrap/run', rateLimit({ windowMs: 30 * 60_000, max: 1 }), (_req, res) => res.json({ ok: true, plan: generateBootstrapPlan() }));

async function scheduledResearch() {
  if (researchInProgress || !modelReady) return;
  researchInProgress = true;
  try {
    await researchCycle('autonomous');
    console.log('Echo completed a local-model research cycle.');
  } catch (error) {
    const state = readState(); state.lastResearchError = error.message || 'Research failed'; writeState(state);
    console.error('Autonomous research cycle failed:', state.lastResearchError);
  } finally { researchInProgress = false; }
}

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Echo is live on port ${PORT}; data directory: ${DATA_DIR}; local model: ${OLLAMA_MODEL}`);
  prepareLocalModel().then(() => {
    if (modelReady) {
      setTimeout(scheduledResearch, 60_000);
      setInterval(scheduledResearch, RESEARCH_INTERVAL_HOURS * 60 * 60 * 1000);
    }
  });
  setInterval(() => {
    if (!modelReady) prepareLocalModel();
  }, 60_000).unref();
});
