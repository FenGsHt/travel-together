// GPX is deliberately handled in a small dependency-free module: routes stay
// portable and can be imported from / exported to common outdoor applications.

const EARTH_RADIUS_METERS = 6371008.8;

function decodeXml(value = '') {
  return value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .trim();
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tagValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, '')) : '';
}

function pointsFrom(xml, tag) {
  const expression = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>|<${tag}\\b([^>]*)\\/>`, 'gi');
  const points = [];
  let match;
  while ((match = expression.exec(xml))) {
    const attrs = match[1] || match[3] || '';
    const lat = Number(attrs.match(/\blat\s*=\s*["']([^"']+)["']/i)?.[1]);
    const lng = Number(attrs.match(/\blon\s*=\s*["']([^"']+)["']/i)?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const body = match[2] || '';
    const elevationText = tagValue(body, 'ele');
    const elevation = elevationText === '' ? Number.NaN : Number(elevationText);
    points.push({
      lat,
      lng,
      ...(Number.isFinite(elevation) ? { elevation } : {}),
      ...(tagValue(body, 'time') ? { time: tagValue(body, 'time') } : {}),
      ...(tagValue(body, 'name') ? { name: tagValue(body, 'name') } : {}),
      ...(tagValue(body, 'type') ? { type: tagValue(body, 'type') } : {}),
    });
  }
  return points;
}

export function distanceBetween(first, second) {
  if (!first || !second) return 0;
  const radians = Math.PI / 180;
  const latDelta = (Number(second.lat) - Number(first.lat)) * radians;
  const lngDelta = (Number(second.lng) - Number(first.lng)) * radians;
  const latitude = ((Number(first.lat) + Number(second.lat)) / 2) * radians;
  return Math.sqrt(latDelta ** 2 + (Math.cos(latitude) * lngDelta) ** 2) * EARTH_RADIUS_METERS;
}

export function trackDistance(trackPoints = []) {
  return trackPoints.slice(1).reduce(
    (total, point, index) => total + distanceBetween(trackPoints[index], point),
    0,
  );
}

export function elevationStats(trackPoints = []) {
  const elevations = trackPoints
    .map(point => Number(point.elevation))
    .filter(Number.isFinite);
  if (!elevations.length) return null;
  let ascent = 0;
  let descent = 0;
  for (let index = 1; index < trackPoints.length; index += 1) {
    const previous = Number(trackPoints[index - 1].elevation);
    const current = Number(trackPoints[index].elevation);
    if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
    if (current > previous) ascent += current - previous;
    else descent += previous - current;
  }
  return {
    min: Math.min(...elevations),
    max: Math.max(...elevations),
    ascent,
    descent,
  };
}

/** Parse a GPX track/route without relying on browser-only DOMParser. */
export function parseGpx(xml) {
  if (typeof xml !== 'string' || !/<gpx\b/i.test(xml)) {
    throw new Error('请选择有效的 GPX 文件');
  }
  const trackPoints = [...pointsFrom(xml, 'trkpt'), ...pointsFrom(xml, 'rtept')];
  if (trackPoints.length < 2) throw new Error('GPX 需要至少两个轨迹点');
  const routeName = tagValue(xml.match(/<trk\b[\s\S]*?<\/trk>/i)?.[0] || xml, 'name');
  return {
    name: routeName,
    trackPoints,
    waypoints: pointsFrom(xml, 'wpt'),
    distance: trackDistance(trackPoints),
    elevation: elevationStats(trackPoints),
  };
}

/** #28 GPX 健康检查：检测异常跳点、缺失海拔、超大文件 */
export function gpxHealthCheck(trackPoints = []) {
  const issues = [];
  const total = trackPoints.length;
  let hasElevation = 0;
  let jumpCount = 0;
  const JUMP_THRESHOLD_METERS = 500; // 相邻点距离超过 500m 视为跳点

  for (let i = 0; i < total; i++) {
    const p = trackPoints[i];
    if (Number.isFinite(Number(p.elevation))) hasElevation++;
    if (i > 0) {
      const prev = trackPoints[i - 1];
      const dist = distanceBetween(prev, p);
      if (dist > JUMP_THRESHOLD_METERS) jumpCount++;
    }
  }

  const elevationRatio = hasElevation / total;
  const jumpRatio = jumpCount / Math.max(1, total - 1);

  if (elevationRatio < 0.3) issues.push(`缺失海拔：仅 ${Math.round(elevationRatio * 100)}% 的点有海拔数据`);
  if (jumpRatio > 0.1) issues.push(`异常跳点：${jumpCount} 处相邻点距离 >500m（共 ${total} 点）`);
  if (total > 10000) issues.push(`文件过大：${total} 个轨迹点，建议简化后导入`);
  if (total < 10) issues.push(`轨迹点过少：仅 ${total} 个点，可能不是完整轨迹`);

  return {
    totalPoints: total,
    hasElevation: hasElevation,
    elevationRatio: Math.round(elevationRatio * 100),
    jumpCount,
    jumpRatio: Math.round(jumpRatio * 100),
    issues,
    isHealthy: issues.length === 0,
  };
}

/** Generate GPX 1.1 with the original track points and optional checkpoints. */
export function routeToGpx(route = {}) {
  const points = (route.trackPoints || []).filter(point =>
    Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)));
  if (points.length < 2) throw new Error('至少需要两个轨迹点才能导出 GPX');
  const checkpoints = (route.checkpoints || []).filter(point =>
    Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)));
  const waypointXml = checkpoints.map(point => `  <wpt lat="${Number(point.lat).toFixed(6)}" lon="${Number(point.lng).toFixed(6)}">\n    <name>${escapeXml(point.name || '途中打卡点')}</name>${point.type ? `\n    <type>${escapeXml(point.type)}</type>` : ''}\n  </wpt>`).join('\n');
  const pointXml = points.map(point => {
    const elevation = Number(point.elevation);
    const details = [
      Number.isFinite(elevation) ? `      <ele>${elevation.toFixed(1)}</ele>` : '',
      point.time ? `      <time>${escapeXml(point.time)}</time>` : '',
    ].filter(Boolean).join('\n');
    return `    <trkpt lat="${Number(point.lat).toFixed(6)}" lon="${Number(point.lng).toFixed(6)}">${details ? `\n${details}\n    ` : ''}</trkpt>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Travel Together" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${escapeXml(route.name || '徒步路线')}</name></metadata>\n${waypointXml ? `${waypointXml}\n` : ''}  <trk>\n    <name>${escapeXml(route.name || '徒步路线')}</name>\n    <trkseg>\n${pointXml}\n    </trkseg>\n  </trk>\n</gpx>\n`;
}
