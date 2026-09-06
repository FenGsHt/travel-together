import assert from 'node:assert/strict';
import test from 'node:test';
import { createTripStore } from '../src/trip-store.mjs';

test('a travel block only needs a name and image', () => {
  const store = createTripStore();

  const block = store.createTravelBlock({
    name: '多依树日出',
    image: 'diannan-images/spots/多依树.jpg',
  });

  assert.deepEqual(block, {
    id: 'block-1',
    name: '多依树日出',
    image: 'diannan-images/spots/多依树.jpg',
  });
});

test('dragging a travel block onto a day creates an editable timeline item', () => {
  const store = createTripStore();
  const block = store.createTravelBlock({
    name: '建水古城',
    image: 'diannan-images/spots/建水古城.jpg',
  });

  const item = store.scheduleBlock({
    blockId: block.id,
    day: 2,
    time: '14:30',
    editor: { id: 'feng', name: 'feng' },
  });

  assert.deepEqual(item, {
    id: 'timeline-1',
    blockId: 'block-1',
    name: '建水古城',
    image: 'diannan-images/spots/建水古城.jpg',
    day: 2,
    time: '14:30',
    note: '',
  });
  assert.equal(store.snapshot().timeline.length, 1);
});

test('moving a timeline item changes its day and time instead of duplicating it', () => {
  const store = createTripStore();
  const block = store.createTravelBlock({
    name: '元阳梯田',
    image: 'diannan-images/spots/元阳梯田.jpg',
  });
  const item = store.scheduleBlock({
    blockId: block.id,
    day: 1,
    time: '08:00',
    editor: { id: 'feng', name: 'feng' },
  });

  const moved = store.moveTimelineItem({
    timelineId: item.id,
    day: 3,
    time: '06:10',
    editor: { id: 'lin', name: '小林' },
  });

  assert.equal(store.snapshot().timeline.length, 1);
  assert.equal(moved.day, 3);
  assert.equal(moved.time, '06:10');
  assert.equal(store.snapshot().activity.at(0).type, 'timeline.moved');
});

test('a scheduled travel block keeps editable time and note details', () => {
  const store = createTripStore();
  const block = store.createTravelBlock({
    name: '过桥米线',
    image: 'diannan-images/food/过桥米线.jpg',
  });
  const item = store.scheduleBlock({
    blockId: block.id,
    day: 2,
    time: '12:00',
    editor: { id: 'feng', name: 'feng' },
  });

  const edited = store.editTimelineItem({
    timelineId: item.id,
    time: '12:30',
    note: '早点去，避开排队',
    editor: { id: 'lin', name: '小林' },
  });

  assert.equal(edited.time, '12:30');
  assert.equal(edited.note, '早点去，避开排队');
  assert.equal(store.snapshot().activity.at(0).type, 'timeline.edited');
});
