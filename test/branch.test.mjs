import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTripStore } from '../src/trip-store.js';

const editor = { id: 'feng', name: 'Feng' };

function createScheduledPair() {
  const store = createTripStore();
  const firstBlock = store.createTravelBlock({ name: '建水古城', image: '/jianshui.jpg' });
  const secondBlock = store.createTravelBlock({ name: '元阳梯田', image: '/yuanyang.jpg' });
  const first = store.scheduleBlock({ blockId: firstBlock.id, day: 1, time: '09:00', editor });
  const second = store.scheduleBlock({ blockId: secondBlock.id, day: 1, time: '13:00', editor });
  return { store, firstBlock, secondBlock, first, second };
}

describe('行程分叉', () => {
  it('从现有行程项添加分叉时保留原行程项', () => {
    const { store, secondBlock, first } = createScheduledPair();

    store.createBranchFromTimelineItem({
      timelineId: first.id,
      blockId: secondBlock.id,
      editor,
    });

    const timeline = store.snapshot().timeline;
    assert.equal(timeline.length, 3);
    assert.equal(timeline.find(item => item.id === first.id)?.branchGroup != null, true);
  });

  it('拒绝用重复旅行块创建无意义的分叉', () => {
    const store = createTripStore();
    const block = store.createTravelBlock({ name: '建水古城', image: '/jianshui.jpg' });

    assert.throws(
      () => store.createBranch({
        day: 1,
        time: '09:00',
        blockIds: [block.id, block.id],
        editor,
      }),
      /at least two options/,
    );
    assert.equal(store.snapshot().timeline.length, 0);
  });
});
