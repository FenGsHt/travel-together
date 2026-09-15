import assert from 'node:assert/strict';
import test from 'node:test';
import { createHikingShareCardSvg } from '../src/hiking-share-card.js';

const route = {
  name: '山谷晨雾环线', difficulty: '中等', distance: '6.8 km', duration: '3 小时',
  start: { name: '东门', lat: 25.01, lng: 102.01 },
  end: { name: '西门', lat: 25.04, lng: 102.05 },
  trackPoints: [{ lat: 25.01, lng: 102.01 }, { lat: 25.025, lng: 102.03 }, { lat: 25.04, lng: 102.05 }],
  checkpoints: [{ name: '云海观景台', lat: 25.025, lng: 102.03 }],
};

test('sharing card contains the route track, facts and safety reminder', () => {
  const svg = createHikingShareCardSvg(route);
  assert.match(svg, /width="1080" height="1350"/);
  assert.match(svg, /山谷晨雾环线/);
  assert.match(svg, /6\.8 km/);
  assert.match(svg, /云海观景台/);
  assert.match(svg, /观景 · 云海观景台/);
  assert.match(svg, /polyline points=/);
  assert.match(svg, /核对天气、封路和补给信息/);
});

test('sharing card requires a drawable route', () => {
  assert.throws(() => createHikingShareCardSvg({ start: { lat: 25, lng: 102 } }), /起点和终点/);
});
