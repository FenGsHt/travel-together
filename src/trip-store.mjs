export function createTripStore() {
  let blockSequence = 0;
  let timelineSequence = 0;
  let pollSequence = 0;
  const state = {
    blocks: [],
    timeline: [],
    aiDrafts: [],
    polls: [],
    activity: [],
  };

  function requireMember(member) {
    if (!member?.id || !member?.name) {
      throw new Error('An editor needs an id and name');
    }
  }

  function record(type, editor, details) {
    state.activity.unshift({
      id: `activity-${state.activity.length + 1}`,
      type,
      editor: { id: editor.id, name: editor.name },
      details,
    });
  }

  function findBlock(blockId) {
    const block = state.blocks.find((item) => item.id === blockId);
    if (!block) throw new Error('Travel block not found');
    return block;
  }

  function findTimelineItem(timelineId) {
    const item = state.timeline.find((candidate) => candidate.id === timelineId);
    if (!item) throw new Error('Timeline item not found');
    return item;
  }

  return {
    createTravelBlock({ name, image }) {
      if (!name?.trim() || !image?.trim()) {
        throw new Error('A travel block needs a name and image');
      }
      const block = {
        id: `block-${++blockSequence}`,
        name: name.trim(),
        image: image.trim(),
      };
      state.blocks.push(block);
      return structuredClone(block);
    },

    createAiDraft({ name, image, source }) {
      if (!name?.trim() || !image?.trim() || !source?.trim()) {
        throw new Error('An AI draft needs a name, image, and source');
      }
      const draft = {
        id: `ai-draft-${state.aiDrafts.length + 1}`,
        name: name.trim(),
        image: image.trim(),
        source: source.trim(),
        status: 'draft',
      };
      state.aiDrafts.push(draft);
      return structuredClone(draft);
    },

    approveAiDraft({ draftId, editor }) {
      requireMember(editor);
      const draft = state.aiDrafts.find((item) => item.id === draftId);
      if (!draft) throw new Error('AI draft not found');
      if (draft.status !== 'draft') throw new Error('AI draft is no longer pending');
      const block = {
        id: `block-${++blockSequence}`,
        name: draft.name,
        image: draft.image,
      };
      state.blocks.push(block);
      draft.status = 'imported';
      record('ai.draft.imported', editor, { draftId: draft.id, blockId: block.id, source: draft.source });
      return structuredClone(block);
    },

    scheduleBlock({ blockId, day, time, editor }) {
      requireMember(editor);
      const block = findBlock(blockId);
      const item = {
        id: `timeline-${++timelineSequence}`,
        blockId: block.id,
        name: block.name,
        image: block.image,
        day: Number(day),
        time,
        note: '',
      };
      state.timeline.push(item);
      record('timeline.created', editor, { timelineId: item.id, blockId: block.id });
      return structuredClone(item);
    },

    moveTimelineItem({ timelineId, day, time, editor }) {
      requireMember(editor);
      const item = findTimelineItem(timelineId);
      item.day = Number(day);
      item.time = time;
      record('timeline.moved', editor, { timelineId: item.id, day: item.day, time: item.time });
      return structuredClone(item);
    },

    editTimelineItem({ timelineId, time, note, editor }) {
      requireMember(editor);
      const item = findTimelineItem(timelineId);
      if (time !== undefined) item.time = time;
      if (note !== undefined) item.note = note;
      record('timeline.edited', editor, { timelineId: item.id });
      return structuredClone(item);
    },

    moveTimelineItem({ timelineId, day, time, editor }) {
      requireMember(editor);
      const item = findTimelineItem(timelineId);
      if (day !== undefined) item.day = Number(day);
      if (time !== undefined) item.time = time;
      record('timeline.moved', editor, { timelineId: item.id, day: item.day, time: item.time });
      return structuredClone(item);
    },

    reorderTimeline({ timelineId, newIndex, day, editor }) {
      requireMember(editor);
      const item = findTimelineItem(timelineId);
      const dayItems = state.timeline.filter(i => i.day === day).sort((a, b) => a.time.localeCompare(b.time));
      const currentIndex = dayItems.findIndex(i => i.id === timelineId);
      
      if (currentIndex === -1) throw new Error('Item not in this day');
      
      // Remove from current position
      dayItems.splice(currentIndex, 1);
      // Insert at new position
      dayItems.splice(newIndex, 0, item);
      
      // Update times based on new order
      dayItems.forEach((i, idx) => {
        const hour = String(9 + idx * 2).padStart(2, '0');
        i.time = `${hour}:00`;
      });
      
      record('timeline.reordered', editor, { timelineId: item.id, day, newIndex });
      return structuredClone(item);
    },

    createPoll({ question, timelineItemId, creator }) {
      requireMember(creator);
      const poll = {
        id: `poll-${++pollSequence}`,
        question,
        timelineItemId,
        creator: { id: creator.id, name: creator.name },
        votes: {},
      };
      state.polls.push(poll);
      record('poll.created', creator, { pollId: poll.id, question });
      return structuredClone(poll);
    },

    vote({ pollId, voter, choice }) {
      requireMember(voter);
      const poll = state.polls.find((p) => p.id === pollId);
      if (!poll) throw new Error('Poll not found');
      poll.votes[voter.id] = choice;
      record('poll.voted', voter, { pollId, choice });
      return structuredClone(poll);
    },

    getPollResults(pollId) {
      const poll = state.polls.find((p) => p.id === pollId);
      if (!poll) throw new Error('Poll not found');
      const results = { yes: 0, no: 0, total: 0 };
      Object.values(poll.votes).forEach((choice) => {
        if (choice === 'yes') results.yes++;
        else if (choice === 'no') results.no++;
        results.total++;
      });
      return results;
    },

    snapshot() {
      return structuredClone(state);
    },
  };
}
