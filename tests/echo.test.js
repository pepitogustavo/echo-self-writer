import { describe, test, expect } from '@jest/globals';
import { findLinks } from '../echo.js';

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
