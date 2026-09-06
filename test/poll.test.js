import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createTripStore } from '../src/trip-store.mjs';

describe('投票决策系统', () => {
  it('应该能为行程项创建投票', () => {
    const store = createTripStore();
    const block = store.createTravelBlock({
      name: '元阳梯田',
      image: '/images/yuanyang.jpg',
      city: '元阳',
    });
    const timelineItem = store.scheduleBlock({
      blockId: block.id,
      day: 1,
      time: '10:00',
      editor: { id: 'feng', name: 'feng' },
    });

    const poll = store.createPoll({
      question: '元阳梯田值得去吗？',
      timelineItemId: timelineItem.id,
      creator: { id: 'feng', name: 'feng' },
    });

    assert.equal(poll.question, '元阳梯田值得去吗？');
    assert.equal(poll.timelineItemId, timelineItem.id);
    assert.deepEqual(poll.votes, {});
  });

  it('成员应该能投票', () => {
    const store = createTripStore();
    const block = store.createTravelBlock({
      name: '元阳梯田',
      image: '/images/yuanyang.jpg',
      city: '元阳',
    });
    const timelineItem = store.scheduleBlock({
      blockId: block.id,
      day: 1,
      time: '10:00',
      editor: { id: 'feng', name: 'feng' },
    });
    const poll = store.createPoll({
      question: '元阳梯田值得去吗？',
      timelineItemId: timelineItem.id,
      creator: { id: 'feng', name: 'feng' },
    });

    store.vote({
      pollId: poll.id,
      voter: { id: 'lin', name: 'lin' },
      choice: 'yes',
    });

    const snapshot = store.snapshot();
    const updatedPoll = snapshot.polls.find((p) => p.id === poll.id);
    assert.deepEqual(updatedPoll.votes, { lin: 'yes' });
  });

  it('应该能统计投票结果', () => {
    const store = createTripStore();
    const block = store.createTravelBlock({
      name: '元阳梯田',
      image: '/images/yuanyang.jpg',
      city: '元阳',
    });
    const timelineItem = store.scheduleBlock({
      blockId: block.id,
      day: 1,
      time: '10:00',
      editor: { id: 'feng', name: 'feng' },
    });
    const poll = store.createPoll({
      question: '元阳梯田值得去吗？',
      timelineItemId: timelineItem.id,
      creator: { id: 'feng', name: 'feng' },
    });

    store.vote({ pollId: poll.id, voter: { id: 'lin', name: 'lin' }, choice: 'yes' });
    store.vote({ pollId: poll.id, voter: { id: 'an', name: 'an' }, choice: 'yes' });
    store.vote({ pollId: poll.id, voter: { id: 'feng', name: 'feng' }, choice: 'no' });

    const snapshot = store.snapshot();
    const updatedPoll = snapshot.polls.find((p) => p.id === poll.id);
    const results = store.getPollResults(poll.id);
    assert.equal(results.yes, 2);
    assert.equal(results.no, 1);
    assert.equal(results.total, 3);
  });

  it('应该能修改投票', () => {
    const store = createTripStore();
    const block = store.createTravelBlock({
      name: '元阳梯田',
      image: '/images/yuanyang.jpg',
      city: '元阳',
    });
    const timelineItem = store.scheduleBlock({
      blockId: block.id,
      day: 1,
      time: '10:00',
      editor: { id: 'feng', name: 'feng' },
    });
    const poll = store.createPoll({
      question: '元阳梯田值得去吗？',
      timelineItemId: timelineItem.id,
      creator: { id: 'feng', name: 'feng' },
    });

    store.vote({ pollId: poll.id, voter: { id: 'lin', name: 'lin' }, choice: 'yes' });
    store.vote({ pollId: poll.id, voter: { id: 'lin', name: 'lin' }, choice: 'no' });

    const snapshot = store.snapshot();
    const updatedPoll = snapshot.polls.find((p) => p.id === poll.id);
    assert.deepEqual(updatedPoll.votes, { lin: 'no' });
  });
});
