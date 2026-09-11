// 高德地图视图模块
// 提供地图初始化、标记管理、视图切换等功能

let map = null;
let markers = [];
let infoWindows = [];
let routeLines = [];
let AMap = null;
const drivingRouteCache = new Map();
const walkingRouteCache = new Map();

function getMapSdk() {
  if (!AMap && typeof window !== 'undefined') AMap = window.AMap;
  return AMap;
}

function hasCoordinates(item) {
  return item?.lat != null && item?.lng != null;
}

function drivingCacheKey(source, target) {
  return [source.lng, source.lat, target.lng, target.lat]
    .map(value => Number(value).toFixed(6))
    .join(',');
}

function routePath(route) {
  return (route.steps || []).flatMap(step => step.path || []);
}

/**
 * 初始化高德地图
 * @param {string} containerId - 地图容器 DOM id
 * @param {object} options - 可选配置
 * @returns {object} 地图实例
 */
export function initMap(containerId, options = {}) {
  // eslint-disable-next-line no-undef
  AMap = getMapSdk();
  if (!AMap) {
    console.error('高德地图 SDK 未加载');
    return null;
  }

  // 销毁旧实例防止泄漏
  if (map) {
    destroyMap();
  }

  const center = options.center || [102.8, 23.4]; // 默认滇南中心
  const zoom = options.zoom || 9;

  map = new AMap.Map(containerId, {
    zoom,
    center,
    viewMode: '2D',
    resizeEnable: true,
  });

  return map;
}

/**
 * 查询两处地点之间的驾车路线。结果会按坐标缓存，供白板和地图复用。
 * @returns {Promise<{distance: number, duration: number, path: Array}|null>}
 */
export function getDrivingRoute(source, target) {
  if (!hasCoordinates(source) || !hasCoordinates(target)) return Promise.resolve(null);
  const key = drivingCacheKey(source, target);
  if (drivingRouteCache.has(key)) return drivingRouteCache.get(key);

  const request = new Promise((resolve) => {
    const sdk = getMapSdk();
    const search = () => {
      if (!AMap?.Driving) {
        drivingRouteCache.delete(key);
        resolve(null);
        return;
      }
      const driving = new AMap.Driving({
        policy: AMap.DrivingPolicy?.LEAST_TIME,
      });
      driving.search(
        new AMap.LngLat(source.lng, source.lat),
        new AMap.LngLat(target.lng, target.lat),
        (status, result) => {
          const route = status === 'complete' ? result?.routes?.[0] : null;
          if (!route || !Number.isFinite(Number(route.distance)) || !Number.isFinite(Number(route.time))) {
            drivingRouteCache.delete(key);
            resolve(null);
            return;
          }
          resolve({
            distance: Number(route.distance),
            duration: Number(route.time),
            path: routePath(route),
          });
        },
      );
    };

    if (sdk?.Driving) {
      search();
    } else if (sdk?.plugin) {
      sdk.plugin('AMap.Driving', search);
    } else {
      drivingRouteCache.delete(key);
      resolve(null);
    }
  });
  drivingRouteCache.set(key, request);
  return request;
}

/**
 * 查询一条徒步路线。它与驾车路线分开缓存，避免徒步项目意外显示为驾车导航。
 * @returns {Promise<{distance: number, duration: number, path: Array}|null>}
 */
export function getWalkingRoute(source, target) {
  if (!hasCoordinates(source) || !hasCoordinates(target)) return Promise.resolve(null);
  const key = drivingCacheKey(source, target);
  if (walkingRouteCache.has(key)) return walkingRouteCache.get(key);

  const request = new Promise((resolve) => {
    const sdk = getMapSdk();
    const search = () => {
      if (!AMap?.Walking) {
        walkingRouteCache.delete(key);
        resolve(null);
        return;
      }
      const walking = new AMap.Walking();
      walking.search(
        new AMap.LngLat(source.lng, source.lat),
        new AMap.LngLat(target.lng, target.lat),
        (status, result) => {
          const route = status === 'complete' ? result?.routes?.[0] : null;
          if (!route || !Number.isFinite(Number(route.distance)) || !Number.isFinite(Number(route.time))) {
            walkingRouteCache.delete(key);
            resolve(null);
            return;
          }
          resolve({
            distance: Number(route.distance),
            duration: Number(route.time),
            path: routePath(route),
          });
        },
      );
    };

    if (sdk?.Walking) {
      search();
    } else if (sdk?.plugin) {
      sdk.plugin('AMap.Walking', search);
    } else {
      walkingRouteCache.delete(key);
      resolve(null);
    }
  });
  walkingRouteCache.set(key, request);
  return request;
}

/** 在地图上呈现徒步项目的一整条起终点路线。 */
export function addHikingRoute(start, end, onClick) {
  if (!map || !AMap) return;
  clearMarkers();
  clearRouteLines();
  if (!hasCoordinates(start) || !hasCoordinates(end)) return;

  const points = [
    { ...start, id: 'hiking-start', name: `起点 · ${start.name || '未命名'}` },
    { ...end, id: 'hiking-end', name: `终点 · ${end.name || '未命名'}` },
  ];
  addMarkers(points, onClick);

  const line = new AMap.Polyline({
    path: points.map(point => new AMap.LngLat(point.lng, point.lat)),
    strokeColor: '#255f4d',
    strokeOpacity: 0.82,
    strokeWeight: 5,
    strokeStyle: 'solid',
    lineJoin: 'round',
    showDir: true,
    zIndex: 20,
  });
  line.setMap(map);
  routeLines.push(line);
  getWalkingRoute(start, end).then((route) => {
    if (route?.path?.length && routeLines.includes(line)) line.setPath(route.path);
  });
}

/**
 * 在地图上添加标记点
 * @param {Array} items - 行程项数组，每项需有 lat, lng, name
 * @param {Function} onClick - 点击标记时的回调 (item) => void
 */
export function addMarkers(items, onClick) {
  if (!map || !AMap) return;

  // 清除旧标记
  clearMarkers();

  const validItems = items.filter(item => item.lat != null && item.lng != null);

  validItems.forEach((item, index) => {
    // 创建自定义标记内容
    const markerContent = document.createElement('div');
    markerContent.className = 'custom-map-marker';
    markerContent.innerHTML = `
      <div class="marker-number">${index + 1}</div>
      <div class="marker-label">${escapeHtml(item.name)}</div>
    `;

    const marker = new AMap.Marker({
      position: new AMap.LngLat(item.lng, item.lat),
      content: markerContent,
      offset: new AMap.Pixel(-16, -40),
      title: item.name,
    });

    // 信息窗口
    const infoWindow = new AMap.InfoWindow({
      content: `
        <div class="map-info-window">
          <strong>${escapeHtml(item.name)}</strong>
          ${item.time ? `<div class="info-time">⏰ ${escapeHtml(item.time)}</div>` : ''}
          <div class="info-coords">📍 ${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}</div>
        </div>
      `,
      offset: new AMap.Pixel(0, -44),
    });

    marker.on('click', () => {
      infoWindow.open(map, marker.getPosition());
      if (onClick) onClick(item);
    });

    marker.setMap(map);
    markers.push(marker);
    infoWindows.push(infoWindow);
  });

  // 自动缩放到所有标记点
  if (validItems.length > 0) {
    fitBounds(validItems);
  }
}

/**
 * 在地图上绘制行程块之间的连接线。
 * 仅渲染起点和终点都拥有坐标的连接，避免把未定位的行程误画到地图中心。
 * @param {Array} connections 白板中的下一站连接
 * @param {Array} items 已定位的行程项
 */
export function addRouteLines(connections = [], items = []) {
  if (!map || !AMap) return;

  clearRouteLines();
  const itemById = new Map(items.map(item => [item.id, item]));
  connections.forEach((connection) => {
    const source = itemById.get(connection.fromTimelineId);
    const target = itemById.get(connection.toTimelineId);
    if (!source || !target) return;

    const line = new AMap.Polyline({
      path: [
        new AMap.LngLat(source.lng, source.lat),
        new AMap.LngLat(target.lng, target.lat),
      ],
      strokeColor: '#255f4d',
      strokeOpacity: 0.78,
      strokeWeight: 4,
      strokeStyle: 'solid',
      lineJoin: 'round',
      showDir: true,
      zIndex: 20,
      extData: { connectionId: connection.id },
    });
    line.setMap(map);
    routeLines.push(line);
    getDrivingRoute(source, target).then((route) => {
      if (route?.path?.length && routeLines.includes(line)) line.setPath(route.path);
    });
  });
}

/**
 * 清除所有标记
 */
export function clearMarkers() {
  markers.forEach(marker => marker.setMap(null));
  markers = [];
  infoWindows.forEach(w => w.close());
  infoWindows = [];
}

/** 清除地图上的路线连线。 */
export function clearRouteLines() {
  routeLines.forEach(line => line.setMap(null));
  routeLines = [];
}

/**
 * 自动缩放地图以包含所有标记点
 * @param {Array} items - 有 lat/lng 的行程项
 */
export function fitBounds(items) {
  if (!map || !AMap || items.length === 0) return;

  const validItems = items.filter(item => item.lat != null && item.lng != null);
  if (validItems.length === 0) return;

  if (validItems.length === 1) {
    map.setZoomAndCenter(13, [validItems[0].lng, validItems[0].lat]);
    return;
  }

  const bounds = new AMap.Bounds(
    new AMap.LngLat(
      Math.min(...validItems.map(i => i.lng)),
      Math.min(...validItems.map(i => i.lat))
    ),
    new AMap.LngLat(
      Math.max(...validItems.map(i => i.lng)),
      Math.max(...validItems.map(i => i.lat))
    )
  );
  map.setBounds(bounds, false, [60, 60, 60, 60]);
}

/**
 * 销毁地图实例
 */
export function destroyMap() {
  clearMarkers();
  clearRouteLines();
  if (map) {
    map.destroy();
    map = null;
  }
}

/**
 * 获取地图实例
 */
export function getMap() {
  return map;
}

/**
 * 获取 AMap 构造函数
 */
export function getAMap() {
  return AMap;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
