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
  assert.match(app, /options, deadlineAt/);
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

test('route votes render voter names directly on the connection line', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

  assert.match(app, /store\.voteConnection/);
  assert.match(app, /connectionVoterNames/);
  assert.match(app, /route-voter-badge/);
  assert.match(app, /route-line-hit/);
  assert.match(app, /route-remove-control/);
  assert.match(app, /removeTimelineConnection/);
});

test('route arrows leave the previous card bottom and enter the next card top', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');

  assert.match(app, /const startY = \(sourceRect\.bottom - timelineRect\.top\) \/ canvasZoom/);
  assert.match(app, /const endY = \(targetRect\.top - timelineRect\.top\) \/ canvasZoom/);
  assert.match(app, /sourceRect\.left \+ sourceRect\.width \/ 2/);
  assert.match(app, /targetRect\.left \+ targetRect\.width \/ 2/);
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
  assert.match(app, /viewport\.scrollLeft = panState\.scrollLeft/);
  assert.match(app, /isInteractiveTarget\(event\.target\)/);
  assert.match(app, /canvasX: Number\(card\.dataset\.canvasX\)/);
  assert.match(app, /function openTravelDetail/);
  assert.match(app, /openTimelineItemDetail\(item\.id\)/);
  assert.match(html, /id="travel-detail-dialog"/);
  assert.match(styles, /grid-template-columns: 64px minmax\(0, 1fr\)/);
});
