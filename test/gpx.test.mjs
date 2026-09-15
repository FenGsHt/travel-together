import assert from 'node:assert/strict';
import test from 'node:test';
import { elevationStats, parseGpx, routeToGpx, trackDistance } from '../src/gpx.js';

const SAMPLE_GPX = `<?xml version="1.0"?>
<gpx version="1.1"><wpt lat="25.0005" lon="102.0005"><name>观景台</name></wpt>
<trk><name>山谷环线</name><trkseg>
  <trkpt lat="25.0000" lon="102.0000"><ele>1800</ele></trkpt>
  <trkpt lat="25.0010" lon="102.0010"><ele>1860</ele></trkpt>
  <trkpt lat="25.0020" lon="102.0020"><ele>1820</ele></trkpt>
</trkseg></trk></gpx>`;

test('GPX parser retains route name, track, waypoint and elevation facts', () => {
  const route = parseGpx(SAMPLE_GPX);
  assert.equal(route.name, '山谷环线');
  assert.equal(route.trackPoints.length, 3);
  assert.equal(route.waypoints[0].name, '观景台');
  assert.equal(Math.round(route.distance), Math.round(trackDistance(route.trackPoints)));
  assert.deepEqual(elevationStats(route.trackPoints), { min: 1800, max: 1860, ascent: 60, descent: 40 });
});

test('GPX exporter creates a portable track and checkpoint', () => {
  const xml = routeToGpx({
    name: '山谷 & 环线',
    trackPoints: parseGpx(SAMPLE_GPX).trackPoints,
    checkpoints: [{ name: '观景台', lat: 25.0005, lng: 102.0005, type: 'water' }],
  });
  assert.match(xml, /<trkpt lat="25\.000000" lon="102\.000000">/);
  assert.match(xml, /<wpt lat="25\.000500" lon="102\.000500">/);
  assert.match(xml, /<type>water<\/type>/);
  assert.match(xml, /山谷 &amp; 环线/);
  assert.equal(parseGpx(xml).trackPoints.length, 3);
});

test('GPX parser rejects non-track input', () => {
  assert.throws(() => parseGpx('<gpx></gpx>'), /至少两个轨迹点/);
});
