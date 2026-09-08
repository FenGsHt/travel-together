/**
 * Finds schedule entries that occupy the candidate's exact day and start time.
 * The candidate itself is ignored so time edits do not warn about their own value.
 */
export function findTimeConflicts(timeline, candidate) {
  if (!Array.isArray(timeline) || !candidate?.time || candidate.day === undefined) {
    return [];
  }

  const day = Number(candidate.day);
  return timeline.filter((item) => (
    item.id !== candidate.id
    && Number(item.day) === day
    && item.time === candidate.time
  ));
}
