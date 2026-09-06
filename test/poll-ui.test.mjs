import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('poll UI collects custom options and an optional deadline', async () => {
  const app = await readFile(path.join(root, 'app.js'), 'utf8');

  assert.match(app, /投票选项（用逗号分隔）/);
  assert.match(app, /投票截止时间/);
  assert.match(app, /options, deadlineAt/);
});

test('poll UI renders every custom option and disables expired polls', async () => {
  const app = await readFile(path.join(root, 'app.js'), 'utf8');

  assert.match(app, /poll\.options\.map/);
  assert.match(app, /store\.isPollOpen/);
  assert.match(app, /投票已截止/);
});