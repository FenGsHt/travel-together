import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('mobile navigation exposes itinerary, explore, decisions, and guide', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const css = await readFile(path.join(root, 'styles.css'), 'utf8');

  assert.match(html, /class="mobile-nav"/);
  assert.match(html, /href="#itinerary"[^>]*>.*行程/s);
  assert.match(html, /href="#explore"[^>]*>.*灵感/s);
  assert.match(html, /href="#decisions"[^>]*>.*决策/s);
  assert.match(html, /href="guide\.html"[^>]*>.*攻略/s);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.mobile-nav/);
});
