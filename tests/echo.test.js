import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { findLinks, roaming } from '../echo.js';

describe('findLinks', () => {
  test('extracts all http/https links from HTML', () => {
    const html = `
      <a HREF='http://example.com'>Example</a>
      <a href="https://example.com/page">Secure</a>
      <a href=/relative>Relative</a>
      <a href='ftp://ftp.example.com'>FTP</a>
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

  test('trims whitespace around link URLs', () => {
    const html = `
      <a href="  https://trimmed.com ">Trim me</a>
      <a href="\nhttp://example.net\t">Spaces</a>
    `;
    expect(findLinks(html)).toEqual([
      'https://trimmed.com',
      'http://example.net'
    ]);
  });

  test('trims URLs when running in a DOM environment', () => {
    const originalWindow = global.window;
    const originalDOMParser = global.DOMParser;

    class FakeDOMParser {
      parseFromString(html) {
        const hrefs = [];
        const anchorPattern = /<a[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>/gi;
        let match;
        while ((match = anchorPattern.exec(html)) !== null) {
          hrefs.push(match[1] ?? match[2] ?? '');
        }

        return {
          querySelectorAll() {
            return hrefs.map(href => ({
              getAttribute(name) {
                return name === 'href' ? href : null;
              }
            }));
          }
        };
      }
    }

    global.window = {};
    global.DOMParser = FakeDOMParser;

    try {
      const html = `
        <a href="  https://browser.com ">Browser</a>
        <a href='\nhttps://dom.example\t'>DOM</a>
      `;
      expect(findLinks(html)).toEqual([
        'https://browser.com',
        'https://dom.example'
      ]);
    } finally {
      global.window = originalWindow;
      global.DOMParser = originalDOMParser;
    }
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
