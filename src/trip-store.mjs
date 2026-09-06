export function createTripStore() {
  let blockSequence = 0;
  let timelineSequence = 0;
  const state = {
    blocks: [],
    timeline: [],
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

    snapshot() {
      return structuredClone(state);
    },
  };
}
