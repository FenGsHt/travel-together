// 地图选点弹窗模块
// 在 dialog 中嵌入高德地图，用户点击地图选择坐标

let pickerMap = null;
let pickerMarker = null;
let selectedLocation = null;
let resolvePicker = null;

const DIALOG_ID = 'location-picker-dialog';
const MAP_CONTAINER_ID = 'location-picker-map';
const INFO_ID = 'location-picker-info';
const CONFIRM_ID = 'location-picker-confirm';
const CLEAR_ID = 'location-picker-clear';

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
    const info = document.getElementById(INFO_ID);
    const confirmBtn = document.getElementById(CONFIRM_ID);
    const clearBtn = document.getElementById(CLEAR_ID);

    if (!dialog) {
      console.error('Location picker dialog not found');
      resolve(null);
      return;
    }

    // 打开弹窗
    dialog.showModal();

    // 等 DOM 渲染后初始化地图
    requestAnimationFrame(() => {
      initPickerMap(existingLat, existingLng);
    });

    // 绑定按钮事件
    confirmBtn.onclick = () => {
      dialog.close();
      cleanupPicker();
      resolve(selectedLocation);
    };

    clearBtn.onclick = () => {
      selectedLocation = null;
      if (pickerMarker) {
        pickerMarker.setMap(null);
        pickerMarker = null;
      }
      info.textContent = '点击地图选择位置';
      confirmBtn.disabled = true;
    };

    // 关闭弹窗时清理
    dialog.addEventListener('close', function onClose() {
      dialog.removeEventListener('close', onClose);
      cleanupPicker();
      resolve(null);
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

  // 如果有已有坐标，放置标记
  if (existingLat && existingLng) {
    placeMarker(existingLat, existingLng);
    updateInfo(existingLat, existingLng);
    document.getElementById(CONFIRM_ID).disabled = false;
  }

  // 地图点击事件
  pickerMap.on('click', (e) => {
    const lat = e.lnglat.getLat();
    const lng = e.lnglat.getLng();
    placeMarker(lat, lng);
    updateInfo(lat, lng);
    document.getElementById(CONFIRM_ID).disabled = false;
  });
}

function placeMarker(lat, lng) {
  // eslint-disable-next-line no-undef
  const AMap = window.AMap;
  if (!pickerMap || !AMap) return;

  // 移除旧标记
  if (pickerMarker) {
    pickerMarker.setMap(null);
  }

  // 创建新标记
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

function updateInfo(lat, lng) {
  const info = document.getElementById(INFO_ID);
  if (info) {
    info.textContent = `纬度: ${lat.toFixed(6)}, 经度: ${lng.toFixed(6)}`;
  }
}

function cleanupPicker() {
  if (pickerMap) {
    pickerMap.destroy();
    pickerMap = null;
  }
  pickerMarker = null;
  selectedLocation = null;
  resolvePicker = null;
}
