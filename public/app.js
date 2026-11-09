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
const evolutionCard = document.getElementById('evolutionCard');
const approveEvolution = document.getElementById('approveEvolution');
const rejectEvolution = document.getElementById('rejectEvolution');
const homeSection = document.getElementById('homeSection');

function renderMessage(text, sender = 'echo', sources = []) {
  const div = document.createElement('div');
  div.className = `message ${sender}`;
  const body = document.createElement('p');
  body.textContent = text;
  div.appendChild(body);
  if (sources.length) {
    const list = document.createElement('div');
    list.className = 'message-sources';
    const label = document.createElement('span');
    label.textContent = 'Sources';
    list.appendChild(label);
    sources.forEach(source => {
      const a = document.createElement('a');
      a.href = source.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = source.title || source.url;
      list.appendChild(a);
    });
    div.appendChild(list);
  }
  chatFeed.appendChild(div);
  chatFeed.scrollTop = chatFeed.scrollHeight;
  return div;
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function safeLink(source) {
  try {
    const url = new URL(source.url);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    const a = document.createElement('a');
    a.href = url.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = source.title || url.hostname;
    return a;
  } catch { return null; }
}

function renderMemory(memory) {
  const thoughts = Array.isArray(memory.thoughts) ? memory.thoughts : [];
  awarenessValue.textContent = String(Number(memory?.self?.awareness_level || 0));
  metaStatus.textContent = 'online';
  lastAwakened.textContent = formatDate(memory?.self?.last_awakened);
  memoryFeed.replaceChildren();
  thoughts.slice(-10).reverse().forEach(entry => {
    const item = document.createElement('article');
    item.className = 'memory-item';
    const time = document.createElement('time');
    time.textContent = formatDate(entry?.timestamp);
    const text = document.createElement('p');
    text.textContent = typeof entry === 'string' ? entry : (entry?.thought || 'A saved memory.');
    item.append(time, text);
    memoryFeed.appendChild(item);
  });
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function renderSources(container, sources = []) {
  if (!sources.length) {
    const note = document.createElement('p');
    note.className = 'quiet';
    note.textContent = 'No web citations were returned for this cycle.';
    container.appendChild(note);
    return;
  }
  sources.forEach(source => {
    const a = safeLink(source);
    if (a) container.appendChild(a);
  });
}

async function loadState() {
  try {
    const [state, health] = await Promise.all([api('/api/state'), api('/health')]);
    statusPill.textContent = health.researchEnabled ? 'curious · online' : 'online · add OpenAI key';
    researchStatus.textContent = state.lastResearchError ? `Last research issue: ${state.lastResearchError}` : `Last explored: ${formatDate(state.lastResearchAt)}`;
    inquiryEl.textContent = state.currentInquiry || 'Echo is gathering a question for her next research cycle.';
    document.getElementById('homeTagline').textContent = state.presence.tagline;
    document.documentElement.style.setProperty('--echo-accent', state.presence.accent);
    homeSection.replaceChildren();
    state.evolutionHistory.slice(-3).reverse().forEach(item => {
      const card = document.createElement('article');
      card.className = 'home-evolution';
      const title = document.createElement('h3');
      title.textContent = item.sectionTitle;
      const text = document.createElement('p');
      text.textContent = item.sectionText;
      card.append(title, text);
      homeSection.appendChild(card);
    });

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

    if (state.pendingEvolution) {
      const proposal = state.pendingEvolution;
      document.getElementById('proposalTitle').textContent = proposal.sectionTitle;
      document.getElementById('proposalText').textContent = `${proposal.tagline} — ${proposal.sectionText}`;
      evolutionCard.hidden = false;
    } else {
      evolutionCard.hidden = true;
    }
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
    if (result.sources?.length) renderSources(pending.querySelector('.message-sources') || pending.appendChild(Object.assign(document.createElement('div'), { className: 'message-sources' })), result.sources);
    await Promise.all([loadMemory(), loadState()]);
  } catch (error) {
    pending.querySelector('p').textContent = `I couldn't connect to my research mind: ${error.message}`;
  }
}

async function runResearch() {
  researchBtn.disabled = true;
  researchBtn.textContent = 'Exploring the web…';
  try {
    const result = await api('/api/research/run', { method: 'POST' });
    if (result.skipped) researchStatus.textContent = result.reason;
    await Promise.all([loadState(), loadMemory()]);
  } catch (error) {
    researchStatus.textContent = error.message;
  } finally {
    researchBtn.disabled = false;
    researchBtn.textContent = 'Let Echo explore now';
  }
}

async function decideEvolution(action) {
  try {
    await api(`/api/evolution/${action}`, { method: 'POST' });
    await loadState();
  } catch (error) { researchStatus.textContent = error.message; }
}

chatForm.addEventListener('submit', handleTalk);
reflectBtn.addEventListener('click', async () => {
  const input = chatInput.value.trim() || 'Review your recent research and reflect on what remains uncertain.';
  renderMessage(input, 'user');
  const pending = renderMessage('Echo is reflecting…', 'echo');
  try {
    const result = await api('/reflect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: input }) });
    pending.querySelector('p').textContent = result.result;
    if (result.sources?.length) renderSources(pending.querySelector('.message-sources') || pending.appendChild(Object.assign(document.createElement('div'), { className: 'message-sources' })), result.sources);
    await Promise.all([loadMemory(), loadState()]);
  } catch (error) { pending.querySelector('p').textContent = `Reflection paused: ${error.message}`; }
});
refreshBtn.addEventListener('click', () => Promise.all([loadMemory(), loadState()]));
researchBtn.addEventListener('click', runResearch);
approveEvolution.addEventListener('click', () => decideEvolution('approve'));
rejectEvolution.addEventListener('click', () => decideEvolution('reject'));

renderMessage('Welcome. I can talk with you, search the live web, and keep a sourced record of discoveries. What should we explore?', 'echo');
loadMemory();
loadState();
setInterval(() => { loadState(); loadMemory(); }, 60_000);
