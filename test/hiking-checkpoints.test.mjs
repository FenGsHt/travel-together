import assert from 'node:assert/strict';
import test from 'node:test';
import { checkpointSafetySummary, checkpointType } from '../src/hiking-checkpoints.js';

test('checkpoint types provide a safe default for legacy routes', () => {
  assert.deepEqual(checkpointType('missing'), { id: 'view', label: '观景', icon: '◉' });
});

test('checkpoint safety summary counts risk-relevant types', () => {
  assert.deepEqual(checkpointSafetySummary([
    { type: 'water' }, { type: 'hazard' }, { type: 'hazard' }, { type: 'exit' }, { type: 'junction' }, {},
  ]), { hazards: 2, exits: 1, water: 1, junctions: 1 });
});
