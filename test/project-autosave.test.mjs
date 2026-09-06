import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectAutosave } from '../src/project-autosave.mjs';

test('autosave debounces rapid edits and persists only the latest snapshot', async () => {
  const saved = [];
  const autosave = createProjectAutosave({
    delay: 10,
    save: async (snapshot) => saved.push(snapshot),
  });

  autosave.schedule({ revision: 1 });
  autosave.schedule({ revision: 2 });
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.deepEqual(saved, [{ revision: 2 }]);
});

test('flush persists a pending edit immediately and leaves nothing scheduled', async () => {
  const saved = [];
  const autosave = createProjectAutosave({
    delay: 1_000,
    save: async (snapshot) => saved.push(snapshot),
  });

  autosave.schedule({ revision: 3 });
  await autosave.flush();
  await new Promise((resolve) => setTimeout(resolve, 15));

  assert.deepEqual(saved, [{ revision: 3 }]);
  assert.equal(autosave.pending(), false);
});

test('autosave serializes a later flush behind an active save', async () => {
  const started = [];
  const resolvers = [];
  const autosave = createProjectAutosave({
    delay: 1_000,
    save: (snapshot) => new Promise((resolve) => {
      started.push(snapshot.revision);
      resolvers.push(resolve);
    }),
  });

  autosave.schedule({ revision: 1 });
  const firstWrite = autosave.flush();
  await new Promise((resolve) => setTimeout(resolve, 0));

  autosave.schedule({ revision: 2 });
  const secondWrite = autosave.flush();
  assert.deepEqual(started, [1]);

  resolvers.shift()();
  await firstWrite;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, [1, 2]);

  resolvers.shift()();
  await secondWrite;
});
