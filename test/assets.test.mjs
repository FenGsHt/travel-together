import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('every local image referenced by the travel guide exists', async () => {
  const html = await readFile(path.join(root, 'index.html'), 'utf8');
  const imageSources = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((source) => !source.includes('${'));

  assert.ok(imageSources.length > 0, 'the guide should include local imagery');

  await Promise.all(
    imageSources.map((source) => access(path.join(root, source))),
  );
});
