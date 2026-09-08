import assert from 'node:assert/strict';
import test from 'node:test';
import { findTimeConflicts } from '../src/timeline-conflicts.js';

const timeline = [
  { id: 'breakfast', day: 1, time: '09:00', name: '米线' },
  { id: 'old-town', day: 1, time: '10:30', name: '建水古城' },
  { id: 'terraces', day: 2, time: '09:00', name: '元阳梯田' },
];

test('findTimeConflicts reports existing items at the same day and time', () => {
  assert.deepEqual(
    findTimeConflicts(timeline, { day: 1, time: '09:00' }),
    [timeline[0]],
  );
});

test('findTimeConflicts excludes the item being edited and other days', () => {
  assert.deepEqual(
    findTimeConflicts(timeline, { id: 'breakfast', day: 1, time: '09:00' }),
    [],
  );
  assert.deepEqual(
    findTimeConflicts(timeline, { day: 2, time: '09:00' }),
    [timeline[2]],
  );
});

test('findTimeConflicts returns no warning for incomplete or unmatched times', () => {
  assert.deepEqual(findTimeConflicts(timeline, { day: 1, time: '' }), []);
  assert.deepEqual(findTimeConflicts(timeline, { day: 3, time: '09:00' }), []);
});
