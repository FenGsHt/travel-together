// 地图选点弹窗模块
// 在 dialog 中嵌入高德地图，支持地点搜索和点击选点

import { API_BASE } from './api-client.js';

let pickerMap = null;
let pickerMarker = null;
let searchMarkers = [];
let placeSearch = null;
let selectedLocation = null;
let resolvePicker = null;
let searchSequence = 0;

const DIALOG_ID = 'location-picker-dialog';
const MAP_CONTAINER_ID = 'location-picker-map';
const INFO_ID = 'location-picker-info';
const CONFIRM_ID = 'location-picker-confirm';
const CLEAR_ID = 'location-picker-clear';
const SEARCH_INPUT_ID = 'location-search-input';
const SEARCH_BTN_ID = 'location-search-btn';
const RESULTS_ID = 'location-search-results';

/**
 * 打开地图选点弹窗
 * @param {number|null} existingLat - 已有纬度
 * @param {number|null} existingLng - 已有经度
 * @returns {Promise<{lat: number, lng: number}|null>} 选中的坐标，null 表示取消
 */
export function openLocationPicker(existingLat = null, existingLng = null) {
  return new Promise((resolve) => {
    resolvePicker = resolve;
    selectedLocation = null;

    const dialog = document.getElementById(DIALOG_ID);
    const confirmBtn = document.getElementById(CONFIRM_ID);
    const clearBtn = document.getElementById(CLEAR_ID);
    const searchInput = document.getElementById(SEARCH_INPUT_ID);
    const searchBtn = document.getElementById(SEARCH_BTN_ID);
    const resultsContainer = document.getElementById(RESULTS_ID);

    if (!dialog) {
      console.error('Location picker dialog not found');
      resolve(null);
      return;
    }

    // 重置搜索框
    if (searchInput) searchInput.value = '';
    if (resultsContainer) resultsContainer.innerHTML = '';

    // 打开弹窗
    dialog.showModal();

    // 等 DOM 渲染后初始化地图
    requestAnimationFrame(() => {
      initPickerMap(existingLat, existingLng);
    });

    // 搜索按钮
    searchBtn.onclick = () => {
      const keyword = searchInput.value.trim();
      if (keyword) searchPlace(keyword);
    };

    // 回车搜索
    searchInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const keyword = searchInput.value.trim();
        if (keyword) searchPlace(keyword);
      }
    };

    // 确认按钮 — 必须在 dialog.close() 之前 resolve，否则 close 事件会同步清空 selectedLocation
    confirmBtn.onclick = () => {
      const result = selectedLocation;
      dialog.close();
      cleanupPicker();
      resolve(result);
    };

    // 清除按钮
    clearBtn.onclick = () => {
      selectedLocation = null;
      if (pickerMarker) {
        pickerMarker.setMap(null);
        pickerMarker = null;
      }
      const info = document.getElementById(INFO_ID);
      if (info) info.textContent = '点击地图选择位置';
      confirmBtn.disabled = true;
    };

    // 关闭弹窗时清理（仅 Escape/点击外部触发，confirm 路径已在上面处理）
    dialog.addEventListener('close', function onClose() {
      dialog.removeEventListener('close', onClose);
      cleanupPicker();
    }, { once: true });
  });
}

function initPickerMap(existingLat, existingLng) {
  // eslint-disable-next-line no-undef
  const AMap = window.AMap;
  if (!AMap) {
    console.error('高德地图 SDK 未加载');
    return;
  }

  const container = document.getElementById(MAP_CONTAINER_ID);
  if (!container) return;

  // 清除旧地图
  if (pickerMap) {
    pickerMap.destroy();
    pickerMap = null;
  }

  const center = existingLat && existingLng
    ? [existingLng, existingLat]
    : [102.8, 23.4]; // 默认滇南
  const zoom = existingLat ? 13 : 9;

  pickerMap = new AMap.Map(MAP_CONTAINER_ID, {
    zoom,
    center,
    viewMode: '2D',
    resizeEnable: true,
  });

  // 初始化地点搜索（不限制城市，搜索全国）
  placeSearch = new AMap.PlaceSearch({
    pageSize: 8,
    cityLimit: false,
    map: pickerMap,
  });

  // 如果有已有坐标，放置标记
  if (existingLat && existingLng) {
    placeMarker(existingLat, existingLng);
    updateInfo(existingLat, existingLng);
    document.getElementById(CONFIRM_ID).disabled = false;
  }

  // 地图点击事件
  pickerMap.on('click', (e) => {
    clearSearchResults();
    const lat = e.lnglat.getLat();
    const lng = e.lnglat.getLng();
    placeMarker(lat, lng);
    updateInfo(lat, lng);
    document.getElementById(CONFIRM_ID).disabled = false;
  });
}

function searchPlace(keyword) {
  clearSearchResults();
  clearSearchMarkers();

  const resultsContainer = document.getElementById(RESULTS_ID);
  const seq = ++searchSequence;

  if (!placeSearch) {
    searchPlaceFallback(keyword, seq);
    return;
  }

  placeSearch.search(keyword, (status, result) => {
    // 忽略过期请求的结果
    if (seq !== searchSequence) return;

    if (status !== 'complete' || !result.poiList || result.poiList.pois.length === 0) {
      searchPlaceFallback(keyword, seq);
      return;
    }

    const pois = result.poiList.pois;
    renderSearchResults(pois.map(poi => ({
      name: poi.name,
      address: poi.address || '',
      lat: parseFloat(poi.location.lat),
      lng: parseFloat(poi.location.lng),
    })));
  });
}

async function searchPlaceFallback(keyword, seq) {
  const resultsContainer = document.getElementById(RESULTS_ID);
  if (resultsContainer) {
    resultsContainer.innerHTML = '<p class="no-results">高德检索暂不可用，正在切换备用地点服务…</p>';
  }
  try {
    const response = await fetch(`${API_BASE}/api/geocoding/search?q=${encodeURIComponent(keyword)}`, {
      credentials: 'include',
    });
    const payload = await response.json();
    if (seq !== searchSequence) return;
    if (!response.ok) throw new Error(payload.error || '备用地点服务暂时不可用');
    renderSearchResults(payload.results || []);
  } catch (error) {
    if (seq !== searchSequence) return;
    if (resultsContainer) {
      resultsContainer.innerHTML = '<p class="no-results">地点搜索暂时不可用，请点击地图选择位置</p>';
    }
  }
}

function renderSearchResults(pois) {
  const resultsContainer = document.getElementById(RESULTS_ID);
  if (!resultsContainer) return;
  const validPois = pois.filter(poi => Number.isFinite(poi.lat) && Number.isFinite(poi.lng));
  if (validPois.length === 0) {
    resultsContainer.innerHTML = '<p class="no-results">未找到相关地点</p>';
    return;
  }

  resultsContainer.innerHTML = validPois.map((poi, index) => `
      <div class="search-result-item" data-index="${index}">
        <span class="result-name">${escapeHtml(poi.name)}</span>
        <span class="result-address">${escapeHtml(poi.address || '')}</span>
      </div>
    `).join('');

  // 绑定点击事件
  resultsContainer.querySelectorAll('.search-result-item').forEach((item) => {
    item.addEventListener('click', () => {
      const idx = parseInt(item.dataset.index);
      const poi = validPois[idx];
      const lng = Number(poi.lng);
      const lat = Number(poi.lat);

      placeMarker(lat, lng);
      updateInfo(lat, lng, poi.name);
      document.getElementById(CONFIRM_ID).disabled = false;

      // 高亮选中
      resultsContainer.querySelectorAll('.search-result-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');

      // 在地图上添加搜索标记
      addSearchMarker(lat, lng, poi.name);
    });
  });
}

function addSearchMarker(lat, lng, name) {
  // eslint-disable-next-line no-undef
  const AMap = window.AMap;
  if (!pickerMap || !AMap) return;

  const marker = new AMap.Marker({
    position: new AMap.LngLat(lng, lat),
    title: name,
  });
  marker.setMap(pickerMap);
  searchMarkers.push(marker);
}

function placeMarker(lat, lng) {
  // eslint-disable-next-line no-undef
  const AMap = window.AMap;
  if (!pickerMap || !AMap) return;

  // 移除旧标记
  if (pickerMarker) {
    pickerMarker.setMap(null);
  }

  const markerContent = document.createElement('div');
  markerContent.className = 'picker-marker';
  markerContent.innerHTML = '<div class="picker-pin">📍</div>';

  pickerMarker = new AMap.Marker({
    position: new AMap.LngLat(lng, lat),
    content: markerContent,
    offset: new AMap.Pixel(-16, -40),
  });

  pickerMarker.setMap(pickerMap);
  selectedLocation = { lat, lng };
}

function updateInfo(lat, lng, name) {
  const info = document.getElementById(INFO_ID);
  if (info) {
    info.textContent = name
      ? `${name} — ${lat.toFixed(5)}, ${lng.toFixed(5)}`
      : `纬度: ${lat.toFixed(6)}, 经度: ${lng.toFixed(6)}`;
  }
}

function clearSearchResults() {
  const container = document.getElementById(RESULTS_ID);
  if (container) container.innerHTML = '';
}

function clearSearchMarkers() {
  searchMarkers.forEach(m => m.setMap(null));
  searchMarkers = [];
}

function cleanupPicker() {
  if (pickerMap) {
    pickerMap.destroy();
    pickerMap = null;
  }
  pickerMarker = null;
  searchMarkers = [];
  placeSearch = null;
  selectedLocation = null;
  resolvePicker = null;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
