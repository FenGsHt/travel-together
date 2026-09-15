export const HIKING_CHECKPOINT_TYPES = Object.freeze([
  { id: 'view', label: '观景', icon: '◉' },
  { id: 'water', label: '补水', icon: '≈' },
  { id: 'junction', label: '岔路', icon: '⌘' },
  { id: 'hazard', label: '危险', icon: '!' },
  { id: 'exit', label: '撤离', icon: '↗' },
]);

export function checkpointType(type) {
  return HIKING_CHECKPOINT_TYPES.find(item => item.id === type) || HIKING_CHECKPOINT_TYPES[0];
}

export function checkpointSafetySummary(checkpoints = []) {
  const counts = checkpoints.reduce((summary, point) => {
    const type = checkpointType(point?.type).id;
    summary[type] = (summary[type] || 0) + 1;
    return summary;
  }, {});
  return {
    hazards: counts.hazard || 0,
    exits: counts.exit || 0,
    water: counts.water || 0,
    junctions: counts.junction || 0,
  };
}
