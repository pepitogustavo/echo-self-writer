import test from 'node:test';
import assert from 'node:assert/strict';
import { findLinks } from '../echo.js';

test('extracts all http/https links from HTML', () => {
  const html = `
    <html><body>
      <a href="http://example.com">Example</a>
      <a href='https://example.org'>Secure</a>
      <a href="/relative">Relative</a>
    </body></html>
  `;
  const links = findLinks(html);
  assert.deepStrictEqual(links, ['http://example.com', 'https://example.org']);
});

test('removes duplicate links', () => {
  const html = `
    <a href="http://dup.com">One</a>
    <a href="http://dup.com">Two</a>
    <a href="https://unique.com">Unique</a>
  `;
  const links = findLinks(html);
  assert.deepStrictEqual(links, ['http://dup.com', 'https://unique.com']);
});
