import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTripStore } from '../src/trip-store.js';

const editor = { id: 'feng', name: 'Feng' };

function createRouteStore() {
  const store = createTripStore();
  const blocks = ['A', 'B', 'C'].map(name => store.createTravelBlock({ name, image: `/${name}.jpg` }));
  const items = blocks.map((block, index) => store.scheduleBlock({
    blockId: block.id,
    day: 1,
    time: `${String(9 + index * 2).padStart(2, '0')}:00`,
    editor,
  }));
  return { store, items };
}

describe('下一站连线', () => {
  it('A 可以同时连接到 B 和 C，且不改变行程项', () => {
    const { store, items: [a, b, c] } = createRouteStore();

    store.connectTimelineItems({ fromTimelineId: a.id, toTimelineId: b.id, editor });
    store.connectTimelineItems({ fromTimelineId: a.id, toTimelineId: c.id, editor });

    const snapshot = store.snapshot();
    assert.equal(snapshot.timeline.length, 3);
    assert.deepEqual(snapshot.connections.map(connection => [
      connection.fromTimelineId,
      connection.toTimelineId,
    ]), [
      [a.id, b.id],
      [a.id, c.id],
    ]);
  });

  it('拒绝重复连线和形成环路的连线', () => {
    const { store, items: [a, b, c] } = createRouteStore();
    store.connectTimelineItems({ fromTimelineId: a.id, toTimelineId: b.id, editor });
    store.connectTimelineItems({ fromTimelineId: b.id, toTimelineId: c.id, editor });

    assert.throws(
      () => store.connectTimelineItems({ fromTimelineId: a.id, toTimelineId: b.id, editor }),
      /already exists/,
    );
    assert.throws(
      () => store.connectTimelineItems({ fromTimelineId: c.id, toTimelineId: a.id, editor }),
      /create a cycle/,
    );
  });

  it('删除行程项时同步清理关联连线', () => {
    const { store, items: [a, b, c] } = createRouteStore();
    store.connectTimelineItems({ fromTimelineId: a.id, toTimelineId: b.id, editor });
    store.connectTimelineItems({ fromTimelineId: a.id, toTimelineId: c.id, editor });

    store.removeTimelineItem({ timelineId: b.id, editor });

    assert.deepEqual(store.snapshot().connections.map(connection => connection.toTimelineId), [c.id]);
  });

  it('可以单独移除一条出线而保留同一起点的其他出线', () => {
    const { store, items: [a, b, c] } = createRouteStore();
    const toB = store.connectTimelineItems({ fromTimelineId: a.id, toTimelineId: b.id, editor });
    store.connectTimelineItems({ fromTimelineId: a.id, toTimelineId: c.id, editor });

    store.disconnectTimelineItems({ connectionId: toB.id, editor });

    assert.deepEqual(store.snapshot().connections.map(connection => connection.toTimelineId), [c.id]);
  });

  it('同一人对同一起点只能投一条出线，并保留投票人姓名', () => {
    const { store, items: [a, b, c] } = createRouteStore();
    const toB = store.connectTimelineItems({ fromTimelineId: a.id, toTimelineId: b.id, editor });
    const toC = store.connectTimelineItems({ fromTimelineId: a.id, toTimelineId: c.id, editor });

    store.voteConnection({ connectionId: toB.id, voter: { id: 'lin', name: '林' } });
    store.voteConnection({ connectionId: toC.id, voter: { id: 'lin', name: '林' } });
    store.voteConnection({ connectionId: toB.id, voter: { id: 'an', name: '安' } });

    let connections = store.snapshot().connections;
    assert.deepEqual(connections.find(connection => connection.id === toB.id).votes, {
      an: { id: 'an', name: '安' },
    });
    assert.deepEqual(connections.find(connection => connection.id === toC.id).votes, {
      lin: { id: 'lin', name: '林' },
    });

    store.voteConnection({ connectionId: toC.id, voter: { id: 'lin', name: '林' } });
    connections = store.snapshot().connections;
    assert.deepEqual(connections.find(connection => connection.id === toC.id).votes, {});
  });
});
