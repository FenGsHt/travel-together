export function createTripStore() {
  let blockSequence = 0;
  let timelineSequence = 0;
  let pollSequence = 0;
  const state = {
    blocks: [],
    timeline: [],
    aiDrafts: [],
    polls: [],
    comments: [],
    activity: [],
  };
  const undoStack = [];
  const redoStack = [];

  function requireMember(member) {
    if (!member?.id || !member?.name) {
      throw new Error('An editor needs an id and name');
    }
  }

  function capture() {
    return structuredClone({
      state,
      sequences: { blockSequence, timelineSequence, pollSequence },
    });
  }

  function restore(snapshot) {
    Object.assign(state, structuredClone(snapshot.state));
    ({ blockSequence, timelineSequence, pollSequence } = snapshot.sequences);
  }

  function checkpoint() {
    undoStack.push(capture());
    redoStack.length = 0;
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

  function findPoll(pollId) {
    const poll = state.polls.find((candidate) => candidate.id === pollId);
    if (!poll) throw new Error('Poll not found');
    return poll;
  }

  function normalizePollOptions(options) {
    const normalized = (options ?? ['yes', 'no'])
      .filter((option) => typeof option === 'string')
      .map((option) => option.trim())
      .filter(Boolean);
    const uniqueOptions = [...new Set(normalized)];
    if (uniqueOptions.length < 2) {
      throw new Error('A poll needs at least two options');
    }
    return uniqueOptions;
  }

  function normalizeDeadline(deadlineAt) {
    if (!deadlineAt) return null;
    const date = new Date(deadlineAt);
    if (Number.isNaN(date.getTime())) throw new Error('Poll deadline is invalid');
    return date.toISOString();
  }

  function pollIsOpen(poll, now = new Date()) {
    return !poll.deadlineAt || new Date(poll.deadlineAt) > now;
  }

  return {
    createTravelBlock({ name, image, lat, lng }) {
      if (!name?.trim() || !image?.trim()) {
        throw new Error('A travel block needs a name and image');
      }
      checkpoint();
      const block = {
        id: `block-${++blockSequence}`,
        name: name.trim(),
        image: image.trim(),
      };
      if (lat != null && lng != null) {
        block.lat = Number(lat);
        block.lng = Number(lng);
      }
      state.blocks.push(block);
      return structuredClone(block);
    },

    deleteTravelBlock({ blockId, editor }) {
      requireMember(editor);
      const index = state.blocks.findIndex(b => b.id === blockId);
      if (index === -1) throw new Error('Travel block not found');
      checkpoint();
      const [removed] = state.blocks.splice(index, 1);
      record('block.deleted', editor, { blockId, name: removed.name });
      return structuredClone(removed);
    },

    createAiDraft({ name, image, source }) {
      if (!name?.trim() || !image?.trim() || !source?.trim()) {
        throw new Error('An AI draft needs a name, image, and source');
      }
      checkpoint();
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
      checkpoint();
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
      checkpoint();
      const item = {
        id: `timeline-${++timelineSequence}`,
        blockId: block.id,
        name: block.name,
        image: block.image,
        day: Number(day),
        time,
        note: '',
      };
      // 如果旅行块有坐标，继承到行程项
      if (block.lat != null && block.lng != null) {
        item.lat = block.lat;
        item.lng = block.lng;
      }
      state.timeline.push(item);
      record('timeline.created', editor, { timelineId: item.id, blockId: block.id });
      return structuredClone(item);
    },

    moveTimelineItem({ timelineId, day, time, editor }) {
      requireMember(editor);
      const item = findTimelineItem(timelineId);
      checkpoint();
      if (day !== undefined) item.day = Number(day);
      if (time !== undefined) item.time = time;
      record('timeline.moved', editor, { timelineId: item.id, day: item.day, time: item.time });
      return structuredClone(item);
    },

    editTimelineItem({ timelineId, time, note, lat, lng, editor }) {
      requireMember(editor);
      const item = findTimelineItem(timelineId);
      checkpoint();
      if (time !== undefined) item.time = time;
      if (note !== undefined) item.note = note;
      if (lat !== undefined) {
        if (lat === null) { delete item.lat; } else { item.lat = Number(lat); }
      }
      if (lng !== undefined) {
        if (lng === null) { delete item.lng; } else { item.lng = Number(lng); }
      }
      record('timeline.edited', editor, { timelineId: item.id });
      return structuredClone(item);
    },

    reorderTimeline({ timelineId, newIndex, day, editor }) {
      requireMember(editor);
      const item = findTimelineItem(timelineId);
      const dayItems = state.timeline
        .filter((candidate) => candidate.day === day)
        .sort((a, b) => a.time.localeCompare(b.time));
      const currentIndex = dayItems.findIndex((candidate) => candidate.id === timelineId);
      if (currentIndex === -1) throw new Error('Item not in this day');
      if (!Number.isInteger(newIndex) || newIndex < 0 || newIndex >= dayItems.length) {
        throw new Error('New timeline position is invalid');
      }

      checkpoint();
      dayItems.splice(currentIndex, 1);
      dayItems.splice(newIndex, 0, item);
      dayItems.forEach((candidate, index) => {
        const hour = String(9 + index * 2).padStart(2, '0');
        candidate.time = `${hour}:00`;
      });
      record('timeline.reordered', editor, { timelineId: item.id, day, newIndex });
      return structuredClone(item);
    },

    createPoll({ question, timelineItemId, creator, options, deadlineAt }) {
      requireMember(creator);
      const normalizedOptions = normalizePollOptions(options);
      const normalizedDeadline = normalizeDeadline(deadlineAt);
      checkpoint();
      const poll = {
        id: `poll-${++pollSequence}`,
        question,
        timelineItemId,
        creator: { id: creator.id, name: creator.name },
        options: normalizedOptions,
        deadlineAt: normalizedDeadline,
        votes: {},
      };
      state.polls.push(poll);
      record('poll.created', creator, { pollId: poll.id, question });
      return structuredClone(poll);
    },

    vote({ pollId, voter, choice, comment }) {
      requireMember(voter);
      const poll = findPoll(pollId);
      if (!pollIsOpen(poll)) throw new Error('Poll has ended');
      if (!poll.options.includes(choice)) throw new Error('Poll option not found');
      checkpoint();
      poll.votes[voter.id] = choice;
      if (comment && typeof comment === 'string' && comment.trim()) {
        if (!poll.comments) poll.comments = [];
        poll.comments.push({
          voterId: voter.id,
          voterName: voter.name,
          comment: comment.trim(),
          timestamp: new Date().toISOString()
        });
      }
      record('poll.voted', voter, { pollId, choice });
      return structuredClone(poll);
    },

    restorePollVotes({ pollId, votes }) {
      const poll = findPoll(pollId);
      if (!votes || typeof votes !== 'object' || Array.isArray(votes)) {
        throw new Error('Poll votes must be an object');
      }
      const restoredVotes = {};
      Object.entries(votes).forEach(([voterId, choice]) => {
        if (!poll.options.includes(choice)) throw new Error('Poll option not found');
        restoredVotes[voterId] = choice;
      });
      poll.votes = restoredVotes;
      return structuredClone(poll);
    },

    isPollOpen(pollId, now) {
      return pollIsOpen(findPoll(pollId), now);
    },

    undo() {
      if (!undoStack.length) return false;
      redoStack.push(capture());
      restore(undoStack.pop());
      return true;
    },

    redo() {
      if (!redoStack.length) return false;
      undoStack.push(capture());
      restore(redoStack.pop());
      return true;
    },

    clearHistory() {
      undoStack.length = 0;
      redoStack.length = 0;
    },

    getPollResults(pollId) {
      const poll = findPoll(pollId);
      const results = Object.fromEntries(poll.options.map((option) => [option, 0]));
      results.total = 0;
      Object.values(poll.votes).forEach((choice) => {
        if (Object.hasOwn(results, choice)) results[choice]++;
        results.total++;
      });
      return results;
    },

    addComment({ timelineItemId, content, author }) {
      requireMember(author);
      if (!content?.trim()) throw new Error('Comment content cannot be empty');
      checkpoint();
      
      // 解析 @提及
      const mentions = [];
      const mentionRegex = /@(\w+)/g;
      let match;
      while ((match = mentionRegex.exec(content)) !== null) {
        mentions.push(match[1]);
      }
      
      const comment = {
        id: `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timelineItemId,
        content: content.trim(),
        author: { id: author.id, name: author.name },
        mentions,
        likes: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      state.comments.push(comment);
      record('comment.added', author, { commentId: comment.id, timelineItemId, mentions });
      return structuredClone(comment);
    },

    editComment({ commentId, content, editor }) {
      requireMember(editor);
      if (!content?.trim()) throw new Error('Comment content cannot be empty');
      const comment = state.comments.find(c => c.id === commentId);
      if (!comment) throw new Error('Comment not found');
      if (comment.author.id !== editor.id) throw new Error('Can only edit own comments');
      checkpoint();
      comment.content = content.trim();
      comment.updatedAt = new Date().toISOString();
      record('comment.edited', editor, { commentId });
      return structuredClone(comment);
    },

    deleteComment({ commentId, editor }) {
      requireMember(editor);
      const comment = state.comments.find(c => c.id === commentId);
      if (!comment) throw new Error('Comment not found');
      if (comment.author.id !== editor.id) throw new Error('Can only delete own comments');
      checkpoint();
      state.comments = state.comments.filter(c => c.id !== commentId);
      record('comment.deleted', editor, { commentId });
      return true;
    },

    likeComment({ commentId, user }) {
      requireMember(user);
      const comment = state.comments.find(c => c.id === commentId);
      if (!comment) throw new Error('Comment not found');
      checkpoint();
      const likeIndex = comment.likes.indexOf(user.id);
      if (likeIndex >= 0) {
        comment.likes.splice(likeIndex, 1);
      } else {
        comment.likes.push(user.id);
      }
      record('comment.liked', user, { commentId });
      return structuredClone(comment);
    },

    getCommentsForTimelineItem(timelineItemId) {
      return state.comments
        .filter(c => c.timelineItemId === timelineItemId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    snapshot() {
      return structuredClone(state);
    },
  };
}
