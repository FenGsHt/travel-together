import { checkpointType } from './hiking-checkpoints.js';

// Standalone SVG generator so hiking route sharing does not depend on a map
// screenshot, third-party tiles, or cross-origin cover images.

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function validPoint(point) {
  return Number.isFinite(Number(point?.lat)) && Number.isFinite(Number(point?.lng));
}

function routePoints(route) {
  const track = (route.trackPoints || []).filter(validPoint);
  if (track.length >= 2) return track;
  return [route.start, ...(route.checkpoints || []), route.end].filter(validPoint);
}

function routePolyline(points, width, height, padding) {
  const lngs = points.map(point => Number(point.lng));
  const lats = points.map(point => Number(point.lat));
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngSpan = Math.max(0.00001, maxLng - minLng);
  const latSpan = Math.max(0.00001, maxLat - minLat);
  return points.map(point => {
    const x = padding + ((Number(point.lng) - minLng) / lngSpan) * (width - padding * 2);
    const y = height - padding - ((Number(point.lat) - minLat) / latSpan) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function stat(label, value, x) {
  return `<g transform="translate(${x} 0)">
    <rect width="280" height="124" rx="24" fill="#ffffff" fill-opacity=".16" />
    <text x="24" y="43" fill="#cfe1d6" font-size="22" font-family="sans-serif">${escapeXml(label)}</text>
    <text x="24" y="87" fill="#ffffff" font-size="33" font-weight="700" font-family="sans-serif">${escapeXml(value)}</text>
  </g>`;
}

/**
 * Create a 1080×1350 portrait route card, consumable by every browser and
 * social platform without needing a canvas or external image asset.
 */
export function createHikingShareCardSvg(route = {}) {
  const points = routePoints(route);
  if (points.length < 2) throw new Error('请先选择起点和终点，才能生成分享图');
  const track = routePolyline(points, 920, 490, 48);
  const checkpointNames = (route.checkpoints || [])
    .slice(0, 3)
    .map((point, index) => `0${index + 1}  ${checkpointType(point.type).label} · ${point.name || '途中打卡点'}`)
    .join('　');
  const source = route.start?.name || '起点';
  const destination = route.end?.name || '终点';
  const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date());
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-label="${escapeXml(route.name || '徒步路线')}分享卡">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#153f35"/><stop offset=".56" stop-color="#2a765e"/><stop offset="1" stop-color="#9bbd87"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#062a21" flood-opacity=".24"/></filter>
  </defs>
  <rect width="1080" height="1350" fill="url(#bg)"/>
  <circle cx="980" cy="112" r="280" fill="#e8d89a" fill-opacity=".15"/><circle cx="90" cy="1190" r="350" fill="#d7ecce" fill-opacity=".10"/>
  <text x="80" y="102" fill="#d9e9de" font-size="27" letter-spacing="7" font-family="sans-serif">TRAVEL TOGETHER · HIKING</text>
  <text x="80" y="190" fill="#ffffff" font-size="66" font-weight="700" font-family="serif">${escapeXml(route.name || '一条正在出发的路')}</text>
  <text x="80" y="242" fill="#d9e9de" font-size="29" font-family="sans-serif">${escapeXml(source)}　→　${escapeXml(destination)}</text>
  <g transform="translate(80 292)" filter="url(#shadow)">
    <rect width="920" height="490" rx="34" fill="#f8fbf5"/>
    <path d="M0 400 C210 352 280 485 470 416 S728 294 920 357 V490 H0Z" fill="#d8e7cf"/>
    <polyline points="${track}" fill="none" stroke="#e56b4f" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${track.split(' ')[0].split(',')[0]}" cy="${track.split(' ')[0].split(',')[1]}" r="16" fill="#245f4d" stroke="#ffffff" stroke-width="7"/>
    <circle cx="${track.split(' ').at(-1).split(',')[0]}" cy="${track.split(' ').at(-1).split(',')[1]}" r="16" fill="#e56b4f" stroke="#ffffff" stroke-width="7"/>
    <text x="48" y="72" fill="#376456" font-size="24" font-family="sans-serif">路线轨迹 · ${points.length} 个坐标点</text>
  </g>
  <g transform="translate(80 838)">
    ${stat('难度', route.difficulty || '待确认', 0)}
    ${stat('全程距离', route.distance || '待确认', 320)}
    ${stat('预计用时', route.duration || '待确认', 640)}
  </g>
  <line x1="80" x2="1000" y1="1046" y2="1046" stroke="#d2e4d8" stroke-opacity=".35"/>
  <text x="80" y="1102" fill="#d4e8db" font-size="23" font-family="sans-serif">途中标记</text>
  <text x="80" y="1153" fill="#ffffff" font-size="27" font-family="sans-serif">${escapeXml(checkpointNames || '起点 → 终点')}</text>
  <text x="80" y="1264" fill="#d4e8db" font-size="22" font-family="sans-serif">生成于 ${escapeXml(date)} · 出发前请核对天气、封路和补给信息</text>
  <text x="80" y="1314" fill="#ffffff" font-size="25" font-weight="700" letter-spacing="2" font-family="sans-serif">一起走，慢一点也没关系</text>
</svg>`;
}
