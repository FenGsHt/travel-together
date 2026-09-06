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

  it('应该支持自定义多个选项，并按选项统计结果', () => {
    const store = createTripStore();
    const poll = store.createPoll({
      question: '住哪里？',
      timelineItemId: 'timeline-1',
      creator: { id: 'feng', name: 'feng' },
      options: ['山上', '新县城', '建水古城'],
    });

    store.vote({ pollId: poll.id, voter: { id: 'lin', name: 'lin' }, choice: '山上' });
    store.vote({ pollId: poll.id, voter: { id: 'an', name: 'an' }, choice: '新县城' });

    assert.deepEqual(store.getPollResults(poll.id), {
      山上: 1,
      新县城: 1,
      建水古城: 0,
      total: 2,
    });
  });

  it('应该拒绝投给不在选项中的值', () => {
    const store = createTripStore();
    const poll = store.createPoll({
      question: '住哪里？',
      timelineItemId: 'timeline-1',
      creator: { id: 'feng', name: 'feng' },
      options: ['山上', '新县城'],
    });

    assert.throws(
      () => store.vote({ pollId: poll.id, voter: { id: 'lin', name: 'lin' }, choice: '不存在的选项' }),
      /Poll option not found/,
    );
  });

  it('截止后不允许投票，并能标记投票已结束', () => {
    const store = createTripStore();
    const poll = store.createPoll({
      question: '住哪里？',
      timelineItemId: 'timeline-1',
      creator: { id: 'feng', name: 'feng' },
      deadlineAt: '2020-01-01T00:00:00.000Z',
    });

    assert.equal(store.isPollOpen(poll.id), false);
    assert.throws(
      () => store.vote({ pollId: poll.id, voter: { id: 'lin', name: 'lin' }, choice: 'yes' }),
      /Poll has ended/,
    );
  });

  it('恢复已截止投票时保留已有票数，但仍拒绝新投票', () => {
    const store = createTripStore();
    const poll = store.createPoll({
      question: '住哪里？',
      timelineItemId: 'timeline-1',
      creator: { id: 'feng', name: 'feng' },
      options: ['山上', '新县城'],
      deadlineAt: '2020-01-01T00:00:00.000Z',
    });

    store.restorePollVotes({ pollId: poll.id, votes: { lin: '山上' } });

    assert.deepEqual(store.snapshot().polls[0].votes, { lin: '山上' });
    assert.throws(
      () => store.vote({ pollId: poll.id, voter: { id: 'an', name: 'an' }, choice: '新县城' }),
      /Poll has ended/,
    );
  });

  it('创建投票时拒绝少于两个有效选项或无效截止时间', () => {
    const store = createTripStore();
    const creator = { id: 'feng', name: 'feng' };

    assert.throws(
      () => store.createPoll({ question: '住哪里？', timelineItemId: 'timeline-1', creator, options: ['山上'] }),
      /at least two options/,
    );
    assert.throws(
      () => store.createPoll({ question: '住哪里？', timelineItemId: 'timeline-1', creator, deadlineAt: 'not-a-date' }),
      /deadline is invalid/,
    );
  });
});
