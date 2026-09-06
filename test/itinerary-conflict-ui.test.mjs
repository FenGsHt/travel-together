import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('itinerary displays a resolution dialog when a concurrent edit conflicts', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const app = await readFile(path.join(root, 'app.js'), 'utf8');

  assert.match(html, /<dialog id="edit-conflict-dialog">/);
  assert.match(html, /id="reload-conflict"/);
  assert.match(html, /id="overwrite-conflict"/);
  assert.match(app, /expectedRevision/);
  assert.match(app, /showEditConflict/);
  assert.match(app, /updatedProject\.conflict/);
});

test('itinerary renders an accessible warning for itinerary time collisions', async () => {
  const app = await readFile(path.join(root, 'app.js'), 'utf8');
  const css = await readFile(path.join(root, 'styles.css'), 'utf8');

  assert.match(app, /findTimeConflicts/);
  assert.match(app, /time-conflict/);
  assert.match(app, /role="alert"/);
  assert.match(css, /\.time-conflict/);
});
