import assert from 'node:assert/strict';
import test from 'node:test';
import { createTripStore } from '../src/trip-store.mjs';

test('undo and redo restore an edited timeline item', () => {
  const store = createTripStore();
  const editor = { id: 'feng', name: 'feng' };
  const block = store.createTravelBlock({
    name: '建水古城',
    image: 'diannan-images/spots/建水古城.jpg',
  });
  const item = store.scheduleBlock({ blockId: block.id, day: 1, time: '10:00', editor });

  store.editTimelineItem({
    timelineId: item.id,
    time: '14:30',
    note: '下午再去',
    editor,
  });

  assert.equal(store.undo(), true);
  assert.deepEqual(store.snapshot().timeline, [{
    id: item.id,
    blockId: block.id,
    name: '建水古城',
    image: 'diannan-images/spots/建水古城.jpg',
    day: 1,
    time: '10:00',
    note: '',
  }]);

  assert.equal(store.redo(), true);
  assert.equal(store.snapshot().timeline[0].time, '14:30');
  assert.equal(store.snapshot().timeline[0].note, '下午再去');
});

test('a new edit clears redo history after undo', () => {
  const store = createTripStore();
  const editor = { id: 'feng', name: 'feng' };
  const block = store.createTravelBlock({ name: '元阳梯田', image: 'diannan-images/spots/元阳梯田.jpg' });
  const item = store.scheduleBlock({ blockId: block.id, day: 1, time: '08:00', editor });

  store.editTimelineItem({ timelineId: item.id, time: '09:00', editor });
  assert.equal(store.undo(), true);
  store.editTimelineItem({ timelineId: item.id, note: '带上外套', editor });

  assert.equal(store.redo(), false);
  assert.equal(store.snapshot().timeline[0].time, '08:00');
  assert.equal(store.snapshot().timeline[0].note, '带上外套');
});

test('clearing history preserves loaded data without offering a misleading undo', () => {
  const store = createTripStore();
  const editor = { id: 'feng', name: 'feng' };
  const block = store.createTravelBlock({ name: '团山民居', image: 'diannan-images/spots/建水古城.jpg' });
  store.scheduleBlock({ blockId: block.id, day: 2, time: '11:00', editor });

  store.clearHistory();

  assert.equal(store.undo(), false);
  assert.equal(store.snapshot().timeline.length, 1);
});
