// 高德地图视图模块
// 提供地图初始化、标记管理、视图切换等功能

let map = null;
let markers = [];
let infoWindows = [];
let AMap = null;

/**
 * 初始化高德地图
 * @param {string} containerId - 地图容器 DOM id
 * @param {object} options - 可选配置
 * @returns {object} 地图实例
 */
export function initMap(containerId, options = {}) {
  // eslint-disable-next-line no-undef
  AMap = window.AMap;
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
 * 清除所有标记
 */
export function clearMarkers() {
  markers.forEach(marker => marker.setMap(null));
  markers = [];
  infoWindows.forEach(w => w.close());
  infoWindows = [];
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
