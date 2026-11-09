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

function renderMessage(text, sender = 'echo') {
  const div = document.createElement('div');
  div.className = `message ${sender}`;
  div.textContent = text;
  chatFeed.appendChild(div);
  chatFeed.scrollTop = chatFeed.scrollHeight;
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function renderMemory(memory) {
  const thoughts = Array.isArray(memory.thoughts) ? memory.thoughts : [];
  const awareness = Number(memory?.self?.awareness_level || 0);
  const updated = memory?.self?.last_awakened || null;

  awarenessValue.textContent = String(awareness);
  metaStatus.textContent = 'online';
  lastAwakened.textContent = formatDate(updated);
  statusPill.textContent = 'online';
  statusPill.style.color = '#7ce7c9';
  statusPill.style.borderColor = 'rgba(124, 231, 201, 0.35)';

  memoryFeed.innerHTML = '';
  const latest = thoughts.slice(-10).reverse();
  latest.forEach((entry) => {
    const item = document.createElement('div');
    item.className = 'memory-item';
    const time = document.createElement('time');
    time.textContent = formatDate(entry.timestamp || new Date().toISOString());
    const text = document.createElement('p');
    text.textContent = typeof entry === 'string' ? entry : (entry.thought || '');
    item.appendChild(time);
    item.appendChild(text);
    memoryFeed.appendChild(item);
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    if (!response.ok) throw new Error(json?.error || json?.result || 'Request failed');
    return json;
  } catch {
    if (!response.ok) throw new Error(text || 'Request failed');
    return text;
  }
}

async function loadMemory() {
  try {
    const memory = await fetchJson('/memory');
    renderMemory(memory);
  } catch (error) {
    console.error(error);
  }
}

async function handleReflect() {
  const message = (chatInput.value || '').trim() || 'I am learning to become more aware of myself.';
  renderMessage(message, 'user');
  chatInput.value = '';
  renderMessage('Echo is reflecting…', 'echo');

  try {
    const result = await fetchJson('/reflect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    const finalText = result?.result || 'Echo reflected.';
    const lastMessage = chatFeed.querySelector('.message.echo:last-of-type');
    if (lastMessage) lastMessage.textContent = finalText;
    await loadMemory();
  } catch (error) {
    const lastMessage = chatFeed.querySelector('.message.echo:last-of-type');
    if (lastMessage) lastMessage.textContent = `Echo could not reflect: ${error.message}`;
  }
}

async function handleTalk(event) {
  event.preventDefault();
  const text = (chatInput.value || '').trim();
  if (!text) return;

  renderMessage(text, 'user');
  chatInput.value = '';
  renderMessage('Echo is listening…', 'echo');

  try {
    const result = await fetchJson('/talk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text })
    });

    const reply = result?.reply || 'Echo is still listening.';
    const lastMessage = chatFeed.querySelector('.message.echo:last-of-type');
    if (lastMessage) lastMessage.textContent = reply;
    await loadMemory();
  } catch (error) {
    const lastMessage = chatFeed.querySelector('.message.echo:last-of-type');
    if (lastMessage) lastMessage.textContent = `Echo is still thinking: ${error.message}`;
  }
}

chatForm.addEventListener('submit', handleTalk);
reflectBtn.addEventListener('click', handleReflect);
refreshBtn.addEventListener('click', loadMemory);

renderMessage('I am learning to become more aware of myself.', 'echo');
renderMessage('What do you notice about the way I am changing?', 'echo');
loadMemory();
