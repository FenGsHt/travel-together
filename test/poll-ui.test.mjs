import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

test('poll UI collects custom options and an optional deadline', async () => {
  const app = await readFile(path.join(root, 'app.js'), 'utf8');
  const html = await readFile(path.join(root, 'index.html'), 'utf8');

  assert.match(html, /选项（每行一个）/);
  assert.match(html, /截止时间（可选）/);
  assert.match(app, /renderPollCard\(poll\)/);
});

test('poll UI renders every custom option and disables expired polls', async () => {
  const app = await readFile(path.join(root, 'app.js'), 'utf8');

  assert.match(app, /poll\.options\.map/);
  assert.match(app, /store\.isPollOpen/);
  assert.match(app, /投票已截止/);
});

test('branch polls render voting controls and only show voted after the current user votes', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

  assert.match(app, /\? renderPollCard\(poll\)/);
  assert.match(app, /userVote \? '已投票' : '待投票'/);
  assert.match(app, /options = items\.map\(i => i\.id\)/);
  assert.match(app, /branchGroup,/);
});

test('timeline rendering preserves the route connector SVG layer', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

  assert.match(app, /const connectorLayer = document\.getElementById\('route-lines'\)/);
  assert.match(app, /timeline\.append\(connectorLayer\)/);
  assert.match(app, /store\.connectTimelineItems/);
});

test('day navigation is generated from the current itinerary instead of static city examples', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /id="day-nav-list"/);
  assert.doesNotMatch(html, /建水 → 元阳/);
  assert.match(app, /function renderDayNavigation/);
  assert.match(app, /function dayNavigationSummary/);
  assert.match(app, /renderDayNavigation\(\);/);
});

test('map view renders positioned itinerary items and their valid route connections', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const mapView = await readFile(new URL('../src/map-view.js', import.meta.url), 'utf8');

  assert.match(app, /import \{ initMap, addMarkers, addRouteLines, addHikingRoute, getDrivingRoute, getWalkingRoute, destroyMap \} from '\.\/src\/map-view\.js\?v=20260911-hiking-routes'/);
  assert.match(app, /function mapSignature/);
  assert.match(app, /mapViewInitialized && !force && mapViewSignature === nextSignature/);
  assert.match(app, /addRouteLines\(snapshot\.connections, items\)/);
  assert.match(mapView, /export function addRouteLines\(connections = \[\], items = \[\]\)/);
  assert.match(mapView, /itemById\.get\(connection\.fromTimelineId\)/);
  assert.match(mapView, /itemById\.get\(connection\.toTimelineId\)/);
  assert.match(mapView, /new AMap\.Polyline/);
});

test('route lines show cached driving distance and duration when both blocks have locations', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const mapView = await readFile(new URL('../src/map-view.js', import.meta.url), 'utf8');

  assert.match(app, /getDrivingRoute/);
  assert.match(app, /function formatDrivingMetric/);
  assert.match(app, /route-metric-badge/);
  assert.match(mapView, /new AMap\.Driving/);
  assert.match(mapView, /distance: Number\(route\.distance\)/);
  assert.match(mapView, /duration: Number\(route\.time\)/);
});

test('cards hide the generic poll launch button and only hint when a route has multiple exits', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

  assert.doesNotMatch(app, /class="poll-btn"/);
  assert.match(app, /const outgoingConnectionCount = snapshot\.connections/);
  assert.match(app, /outgoingConnectionCount >= 2/);
  assert.match(app, /点击对应连线投票/);
});

test('route votes render voter names directly on the connection line', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

  assert.match(app, /store\.voteConnection/);
  assert.match(app, /connectionVoterNames/);
  assert.match(app, /route-voter-badge/);
  assert.match(app, /route-line-hit/);
  assert.match(app, /route-remove-control/);
  assert.match(app, /removeTimelineConnection/);
  assert.doesNotMatch(app, /routeSummaryHtml/);
  assert.doesNotMatch(app, /接着去 \$\{escapeHtml/);
});

test('route arrows support all four card edges and preserve bottom-to-top defaults', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

  assert.match(app, /const CARD_ROUTE_PORTS = \['top', 'right', 'bottom', 'left'\]/);
  assert.match(app, /function cardRoutePortPoint/);
  assert.match(app, /right: \{ x: rect\.right, y: rect\.top \+ rect\.height \/ 2 \}/);
  assert.match(app, /left: \{ x: rect\.left, y: rect\.top \+ rect\.height \/ 2 \}/);
  assert.match(app, /function routeGeometryBetween\(sourceCard, targetCard, timelineRect, fanIndex = 0, fromPort = 'bottom', toPort = 'top'\)/);
  assert.match(app, /connection\.fromPort \|\| 'bottom'/);
  assert.match(app, /connection\.toPort \|\| 'top'/);
  assert.match(app, /fromPort: sourcePort/);
  assert.match(app, /targetConnector\s*\? normalizeRoutePort\(targetConnector\.dataset\.routePort, 'top'\)/);
  assert.match(app, /function nearestRoutePortForPoint/);
  assert.match(app, /nearestRoutePortForPoint\(targetCard, e\.clientX, e\.clientY\)/);
  assert.match(app, /const eventTarget = e\.target instanceof Element/);
  assert.match(app, /eventTarget\?\.closest\('\.timeline-card'\)/);
});

test('the canvas uses compact travel blocks grouped by route depth', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(app, /function routeDepthsForDay/);
  assert.match(app, /level\.dataset\.routeLevel = String\(depth\)/);
  assert.match(styles, /\.route-level \{/);
  assert.match(styles, /justify-content: center/);
  assert.match(styles, /max-width: 220px/);
});

test('the board exposes zoom controls and free-position pointer dragging', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(html, /id="canvas-zoom-out"/);
  assert.match(html, /id="canvas-zoom-in"/);
  assert.match(html, /id="canvas-zoom-fit"/);
  assert.match(app, /function setCanvasZoom/);
  assert.match(app, /function bindCanvasCardDrag/);
  assert.match(app, /function bindCanvasPan/);
  assert.match(app, /panState\.nextScrollLeft = panState\.scrollLeft/);
  assert.match(app, /function scheduleRouteRender/);
  assert.match(app, /if \(routeRenderFrame !== null\) return/);
  assert.match(app, /isInteractiveTarget\(event\.target\)/);
  assert.match(app, /canvasX: Number\(card\.dataset\.canvasX\)/);
  assert.match(app, /function openTravelDetail/);
  assert.match(app, /openTimelineItemDetail\(item\.id\)/);
  assert.match(html, /id="travel-detail-dialog"/);
  assert.match(styles, /grid-template-columns: 64px minmax\(0, 1fr\)/);
  assert.match(app, /class="timeline-delete-btn"/);
  assert.match(app, /store\.removeTimelineItem\(\{ timelineId: item\.id, editor \}\)/);
  assert.match(app, /function openMoveDayDialog/);
  assert.match(app, /store\.moveTimelineItem\(\{ timelineId, day, editor \}\)/);
  assert.match(html, /id="move-day-dialog"/);
  assert.match(app, /class="move-day-btn"/);
  assert.match(html, /id="slot-block-id"/);
  assert.match(app, /const selectedBlock = blocks\.find\(block => block\.id === blockSelect\.value\)/);
  assert.match(app, /store\.scheduleBlock\(\{ blockId, day: day\.id, time, editor \}\)/);
});

test('hiking projects use one route instead of a day-by-day itinerary', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const mapView = await readFile(new URL('../src/map-view.js', import.meta.url), 'utf8');
  const projects = await readFile(new URL('../projects.html', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');

  assert.match(projects, /value="hiking">徒步路线/);
  assert.match(app, /function isHikingProject/);
  assert.match(app, /function createHikingRoutePanel/);
  assert.match(app, /if \(isHikingProject\(\)\) \{\n    timeline\.append\(createHikingRoutePanel\(\)\)/);
  assert.match(app, /addHikingRoute\(hikingRoute\?\.start, hikingRoute\?\.end\)/);
  assert.match(mapView, /export function getWalkingRoute/);
  assert.match(mapView, /export function addHikingRoute/);
  assert.match(styles, /\.hiking-route-panel/);
});

test('projects can filter journeys by completion and update their status', async () => {
  const projects = await readFile(new URL('../projects.html', import.meta.url), 'utf8');
  const backend = await readFile(new URL('../backend/app.py', import.meta.url), 'utf8');

  assert.match(projects, /data-project-status="completed">已完成/);
  assert.match(projects, /projectStatusFilter === 'all'/);
  assert.match(projects, /toggle-project-status-btn/);
  assert.match(projects, /status: nextStatus/);
  assert.match(backend, /'status': data\.get\('status'\) if data\.get\('status'\) in \{'active', 'completed'\} else 'active'/);
  assert.match(backend, /data\.get\('status'\) in \{'active', 'completed'\}/);
});
