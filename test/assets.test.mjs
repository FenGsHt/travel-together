import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { travelBlocks } from '../src/travel-blocks.mjs';

const root = path.resolve(import.meta.dirname, '..');

test('each seed travel block has a name, image, and a real local asset', async () => {
  assert.ok(travelBlocks.length >= 6, 'the exploration library should have starter blocks');

  await Promise.all(
    travelBlocks.map(async (block) => {
      assert.ok(block.name);
      assert.ok(block.image);
      await access(path.join(root, block.image));
    }),
  );
});
