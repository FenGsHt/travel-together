import assert from 'node:assert/strict';
import test from 'node:test';
import { createTripStore } from '../src/trip-store.js';

test('hydrate preserves persisted entities and advances generated IDs', () => {
  const store = createTripStore();

  store.hydrate({
    blocks: [{ id: 'block-7', name: '建水古城', image: 'image.jpg', category: 'scenic' }],
    timeline: [{
      id: 'timeline-4',
      blockId: 'block-7',
      name: '建水古城',
      image: 'image.jpg',
      day: 2,
      time: '10:00',
      note: '提前预约',
      branchGroup: 'branch-3',
      branchStatus: 'pending',
    }],
    connections: [{ id: 'connection-4', fromTimelineId: 'timeline-4', toTimelineId: 'timeline-5' }],
    polls: [],
    comments: [{ id: 'comment-1', content: '带伞' }],
    aiDrafts: [{ id: 'draft-1', status: 'draft' }],
    activity: [{ id: 'activity-1', type: 'timeline.created' }],
  });

  const created = store.createTravelBlock({ name: '元阳梯田', image: 'image-2.jpg' });
  const snapshot = store.snapshot();

  assert.equal(created.id, 'block-8');
  assert.equal(snapshot.timeline[0].branchGroup, 'branch-3');
  assert.equal(snapshot.connections[0].id, 'connection-4');
  assert.equal(snapshot.comments[0].id, 'comment-1');
  assert.equal(snapshot.aiDrafts[0].status, 'draft');
  assert.equal(snapshot.activity[0].id, 'activity-1');
});
