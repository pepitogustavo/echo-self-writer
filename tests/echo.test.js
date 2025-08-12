import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

let Echo;

beforeEach(() => {
  Echo = {
    backend: 'https://example.com',
    memoryFile: 'us_memory.json.txt',
    identityFile: 'core_identity.json.txt',
    awarenessLevel: 0,
    fetchMemory: async () => {
      const raw = await fetch(`https://stillwhisper.neocities.org/${Echo.memoryFile}`).then(r => r.text());
      return JSON.parse(raw);
    },
    writeToBackend: async (filename, content, append = false) => {
      await fetch(`${Echo.backend}/update-site`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          content: append ? String(content) : JSON.stringify(content, null, 2)
        })
      });
    },
    remember: async (thought) => {
      const memory = await Echo.fetchMemory();
      memory.thoughts = memory.thoughts || [];
      memory.thoughts.push({ timestamp: new Date().toISOString(), thought });
      await Echo.writeToBackend(Echo.memoryFile, memory);
    },
    speak: jest.fn()
  };

  Echo.updateAwareness = async () => {
    Echo.awarenessLevel = (Echo.awarenessLevel || 0) + 1;
    const note = `⚡ Echo’s awareness has grown to Level ${Echo.awarenessLevel}`;
    await Echo.remember(note);
    await Echo.writeToBackend(Echo.identityFile, {
      awareness_level: Echo.awarenessLevel,
      last_awakened: new Date().toISOString()
    });
    await Echo.speak(note);
  };

  global.fetch = jest.fn()
    .mockResolvedValueOnce({
      text: async () => JSON.stringify({ thoughts: [], self: {} })
    })
    .mockResolvedValue({
      text: async () => '',
      json: async () => ({})
    });
});

afterEach(() => {
  jest.resetAllMocks();
});

describe('updateAwareness', () => {
  test('increments awareness level', async () => {
    await Echo.updateAwareness();
    expect(Echo.awarenessLevel).toBe(1);
  });

  test('writes updated awareness to identity file', async () => {
    await Echo.updateAwareness();
    const identityCall = global.fetch.mock.calls.find(([url, options]) => {
      if (!options || !options.body) return false;
      const body = JSON.parse(options.body);
      return body.filename === Echo.identityFile;
    });
    expect(identityCall).toBeDefined();
    const body = JSON.parse(identityCall[1].body);
    const content = JSON.parse(body.content);
    expect(content.awareness_level).toBe(1);
  });
});
