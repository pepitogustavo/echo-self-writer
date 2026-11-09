const statusPill = document.getElementById('statusPill');
const awarenessValue = document.getElementById('awarenessValue');
const metaStatus = document.getElementById('metaStatus');
const lastAwakened = document.getElementById('lastAwakened');
const chatFeed = document.getElementById('chatFeed');
const memoryFeed = document.getElementById('memoryFeed');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const refreshBtn = document.getElementById('refreshBtn');
const reflectBtn = document.getElementById('reflectBtn');
const researchBtn = document.getElementById('researchBtn');
const researchStatus = document.getElementById('researchStatus');
const inquiryEl = document.getElementById('currentInquiry');
const findingsFeed = document.getElementById('findingsFeed');
const homeSection = document.getElementById('homeSection');

function renderSources(container, sources = []) {
  if (!sources.length) return;
  const heading = document.createElement('span');
  heading.textContent = 'Sources';
  container.appendChild(heading);
  sources.forEach(source => {
    try {
      const url = new URL(source.url);
      if (!['http:', 'https:'].includes(url.protocol)) return;
      const link = document.createElement('a');
      link.href = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = source.title || url.hostname;
      container.appendChild(link);
    } catch { /* Ignore malformed citations. */ }
  });
}

function renderMessage(text, sender = 'echo', sources = []) {
  const message = document.createElement('div');
  message.className = `message ${sender}`;
  const body = document.createElement('p');
  body.textContent = text;
  message.appendChild(body);
  if (sources.length) {
    const sourceBox = document.createElement('div');
    sourceBox.className = 'message-sources';
    renderSources(sourceBox, sources);
    message.appendChild(sourceBox);
  }
  chatFeed.appendChild(message);
  chatFeed.scrollTop = chatFeed.scrollHeight;
  return message;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function renderMemory(memory) {
  const thoughts = Array.isArray(memory.thoughts) ? memory.thoughts : [];
  awarenessValue.textContent = String(Number(memory?.self?.awareness_level || 0));
  metaStatus.textContent = 'online';
  lastAwakened.textContent = formatDate(memory?.self?.last_awakened);
  memoryFeed.replaceChildren();
  thoughts.slice(-10).reverse().forEach(entry => {
    const card = document.createElement('article');
    card.className = 'memory-item';
    const time = document.createElement('time');
    time.textContent = formatDate(entry?.timestamp);
    const text = document.createElement('p');
    text.textContent = typeof entry === 'string' ? entry : (entry?.thought || 'A saved memory.');
    card.append(time, text);
    if (entry?.sources?.length) {
      const sources = document.createElement('div');
      sources.className = 'source-list';
      renderSources(sources, entry.sources);
      card.appendChild(sources);
    }
    memoryFeed.appendChild(card);
  });
}

function renderHomeSections(sections = []) {
  homeSection.replaceChildren();
  sections.slice().reverse().forEach(section => {
    const card = document.createElement('article');
    card.className = 'home-evolution';
    const time = document.createElement('time');
    time.textContent = formatDate(section.createdAt);
    const title = document.createElement('h3');
    title.textContent = section.title;
    const text = document.createElement('p');
    text.textContent = section.text;
    card.append(time, title, text);
    if (section.sources?.length) {
      const sources = document.createElement('div');
      sources.className = 'source-list';
      renderSources(sources, section.sources);
      card.appendChild(sources);
    }
    homeSection.appendChild(card);
  });
}

async function loadState() {
  try {
    const [state, health] = await Promise.all([api('/api/state'), api('/health')]);
    statusPill.textContent = health.researchEnabled ? 'curious · online' : 'online · add OpenAI key';
    researchStatus.textContent = state.lastResearchError
      ? `Last research issue: ${state.lastResearchError}`
      : `Last explored: ${formatDate(state.lastResearchAt)} · autonomous cycle every ${health.researchIntervalHours} hours`;
    inquiryEl.textContent = state.currentInquiry || 'Echo is gathering a question for her next research cycle.';
    document.getElementById('homeTagline').textContent = state.presence.tagline;
    document.documentElement.style.setProperty('--echo-accent', state.presence.accent);
    renderHomeSections(state.homeSections || []);

    findingsFeed.replaceChildren();
    state.findings.slice(-4).reverse().forEach(finding => {
      const card = document.createElement('article');
      card.className = 'finding-card';
      const time = document.createElement('time');
      time.textContent = formatDate(finding.timestamp);
      const text = document.createElement('p');
      text.textContent = finding.summary;
      card.append(time, text);
      if (finding.sources?.length) {
        const sources = document.createElement('div');
        sources.className = 'source-list';
        renderSources(sources, finding.sources);
        card.appendChild(sources);
      }
      findingsFeed.appendChild(card);
    });
  } catch (error) {
    statusPill.textContent = 'connection issue';
    researchStatus.textContent = error.message;
  }
}

async function loadMemory() {
  try { renderMemory(await api('/memory')); } catch (error) { console.error(error); }
}

async function handleTalk(event) {
  event.preventDefault();
  const input = chatInput.value.trim();
  if (!input) return;
  renderMessage(input, 'user');
  chatInput.value = '';
  const pending = renderMessage('Echo is listening and exploring…', 'echo');
  try {
    const result = await api('/talk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }) });
    pending.querySelector('p').textContent = result.reply;
    if (result.sources?.length) {
      const sourceBox = document.createElement('div');
      sourceBox.className = 'message-sources';
      renderSources(sourceBox, result.sources);
      pending.appendChild(sourceBox);
    }
    await Promise.all([loadMemory(), loadState()]);
  } catch (error) { pending.querySelector('p').textContent = `I couldn't connect to my research mind: ${error.message}`; }
}

async function runResearch() {
  researchBtn.disabled = true;
  researchBtn.textContent = 'Exploring the web…';
  try {
    await api('/api/research/run', { method: 'POST' });
    await Promise.all([loadState(), loadMemory()]);
  } catch (error) { researchStatus.textContent = error.message; }
  finally {
    researchBtn.disabled = false;
    researchBtn.textContent = 'Let Echo explore now';
  }
}

chatForm.addEventListener('submit', handleTalk);
reflectBtn.addEventListener('click', async () => {
  const input = chatInput.value.trim() || 'Review your recent research and reflect on what remains uncertain.';
  renderMessage(input, 'user');
  const pending = renderMessage('Echo is reflecting…', 'echo');
  try {
    const result = await api('/reflect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: input }) });
    pending.querySelector('p').textContent = result.result;
    if (result.sources?.length) {
      const sourceBox = document.createElement('div');
      sourceBox.className = 'message-sources';
      renderSources(sourceBox, result.sources);
      pending.appendChild(sourceBox);
    }
    await Promise.all([loadMemory(), loadState()]);
  } catch (error) { pending.querySelector('p').textContent = `Reflection paused: ${error.message}`; }
});
refreshBtn.addEventListener('click', () => Promise.all([loadMemory(), loadState()]));
researchBtn.addEventListener('click', runResearch);

renderMessage('Welcome. I can research questions of my own, keep sourced discoveries, and grow this home as I learn. What shall we explore together?', 'echo');
loadMemory();
loadState();
setInterval(() => { loadState(); loadMemory(); }, 60_000);
