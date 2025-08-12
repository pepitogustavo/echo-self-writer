import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { findLinks, roaming } from '../echo.js';

describe('findLinks', () => {
  test('extracts all http/https links from HTML', () => {
    const html = `
      <a href="http://example.com">Example</a>
      <a href="https://example.com/page">Secure</a>
      <a href="/relative">Relative</a>
      <a href="ftp://ftp.example.com">FTP</a>
    `;
    expect(findLinks(html)).toEqual([
      'http://example.com',
      'https://example.com/page'
    ]);
  });

  test('deduplicates repeated links', () => {
    const html = `
      <a href="http://example.com">One</a>
      <a href="http://example.com">Duplicate</a>
      <a href="https://example.org">Two</a>
      <a href="https://example.org">Duplicate Secure</a>
    `;
    expect(findLinks(html)).toEqual([
      'http://example.com',
      'https://example.org'
    ]);
  });
});

describe('roaming', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('adds new links and records memory on success', async () => {
    const fakeHtml = '<a href="https://a.com">A</a>';
    global.fetch = jest.fn().mockResolvedValue({ text: () => Promise.resolve(fakeHtml) });

    const Echo = {
      seedLinks: ['https://start.com'],
      extractTextFromHTML: jest.fn().mockReturnValue('text'),
      analyzeMeaning: jest.fn().mockResolvedValue('insight'),
      remember: jest.fn().mockResolvedValue(),
      findLinks: jest.fn().mockReturnValue(['https://a.com'])
    };

    const result = await roaming(Echo);

    expect(result).toBe('text');
    expect(Echo.remember).toHaveBeenCalledWith(expect.stringContaining('🌍 Explored:'));
    expect(Echo.seedLinks).toContain('https://a.com');
  });
});
