import assert from 'node:assert/strict';
import test from 'node:test';
import { addRouteLines, destroyMap, getDrivingRoute, initMap } from '../src/map-view.js';

test('map route layer only draws connections whose two itinerary items have positions', async () => {
  const createdLines = [];
  const originalWindow = globalThis.window;

  class FakeMap {
    destroy() {}
  }
  class FakeLngLat {
    constructor(lng, lat) {
      this.lng = lng;
      this.lat = lat;
    }
  }
  class FakePolyline {
    constructor(options) {
      this.options = options;
      createdLines.push(this);
    }

    setMap(map) {
      this.map = map;
    }

    setPath(path) {
      this.path = path;
    }
  }
  class FakeDriving {
    search(source, target, callback) {
      callback('complete', {
        routes: [{
          distance: 12500,
          time: 1800,
          steps: [{ path: [source, target] }],
        }],
      });
    }
  }

  globalThis.window = {
    AMap: {
      Map: FakeMap,
      LngLat: FakeLngLat,
      Polyline: FakePolyline,
      Driving: FakeDriving,
      DrivingPolicy: { LEAST_TIME: 0 },
    },
  };

  try {
    initMap('test-map');
    addRouteLines([
      { id: 'route-visible', fromTimelineId: 'a', toTimelineId: 'b' },
      { id: 'route-hidden', fromTimelineId: 'a', toTimelineId: 'missing' },
    ], [
      { id: 'a', name: '建水古城', lng: 102.8, lat: 23.6 },
      { id: 'b', name: '元阳梯田', lng: 102.9, lat: 23.1 },
    ]);

    assert.equal(createdLines.length, 1);
    assert.deepEqual(
      createdLines[0].options.path.map(point => [point.lng, point.lat]),
      [[102.8, 23.6], [102.9, 23.1]],
    );
    assert.equal(createdLines[0].options.extData.connectionId, 'route-visible');
    assert.equal(createdLines[0].options.showDir, true);
    const drivingRoute = await getDrivingRoute(
      { id: 'a', lng: 102.8, lat: 23.6 },
      { id: 'b', lng: 102.9, lat: 23.1 },
    );
    assert.deepEqual(drivingRoute.distance, 12500);
    assert.deepEqual(drivingRoute.duration, 1800);
  } finally {
    destroyMap();
    globalThis.window = originalWindow;
  }
});
