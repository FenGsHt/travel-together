import { createTripStore } from './src/trip-store.js';
import { travelBlocks } from './src/travel-blocks.js';
import * as api from './src/api-client.js';
import { createProjectAutosave } from './src/project-autosave.js';
import { findTimeConflicts } from './src/timeline-conflicts.js';
import { realtimeClient } from './src/realtime-client.js';
import { initMap, addMarkers, addRouteLines, addHikingRoute, getDrivingRoute, getWalkingRoute, destroyMap } from './src/map-view.js?v=20260911-hiking-routes';
import { openLocationPicker } from './src/location-picker.js?v=20260909-geocoding-fallback';
import { escapeHtml } from './src/utils.js';
import { parseGpx, trackDistance, elevationStats, gpxHealthCheck } from './src/gpx.js?v=20260917-health';
import { createHikingShareCardSvg } from './src/hiking-share-card.js?v=20260915-share-card';
import { HIKING_CHECKPOINT_TYPES, checkpointSafetySummary, checkpointType } from './src/hiking-checkpoints.js?v=20260915-safety-points';

// 获取当前项目
const currentProjectId = localStorage.getItem('currentProjectId');

// 弹窗关闭缓动：重写 close() 让所有 dialog 自动带退出动画
const _origDialogClose = HTMLDialogElement.prototype.close;
HTMLDialogElement.prototype.close = function(returnValue) {
  if (this.classList.contains('closing')) {
    _origDialogClose.call(this, returnValue);
    return;
  }
  this.classList.add('closing');
  this.addEventListener('animationend', () => {
    _origDialogClose.call(this, returnValue);
  }, { once: true });
};

// 操作反馈 toast
let toastTimer = null;
function showToast(message, icon = '✓') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.innerHTML = `<span class="toast-icon">${icon}</span>${escapeHtml(message)}`;
  container.appendChild(toast);
  toast.offsetHeight;
  toast.classList.add('toast-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 200);
  }, 2000);
}

function removeFromTimeline(timelineId) {
  store.removeTimelineItem({ timelineId, editor });
  showToast('行程已删除', '');
  render();
}

// #13 移动端长按操作菜单
function openMobileActionMenu(timelineId, name) {
  let sheet = document.getElementById('mobile-action-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'mobile-action-sheet';
    sheet.innerHTML = `
      <div class="mobile-action-backdrop"></div>
      <div class="mobile-action-content">
        <div class="mobile-action-handle"></div>
        <h3 class="mobile-action-title"></h3>
        <div class="mobile-action-list"></div>
      </div>
    `;
    document.body.appendChild(sheet);
    sheet.querySelector('.mobile-action-backdrop').addEventListener('click', closeMobileActionMenu);
  }
  sheet.querySelector('.mobile-action-title').textContent = name;
  const list = sheet.querySelector('.mobile-action-list');
  const actions = [
    { label: '查看详情', icon: '📋', action: () => { closeMobileActionMenu(); openTimelineItemDetail(timelineId); } },
    { label: '删除行程', icon: '', action: () => { closeMobileActionMenu(); removeFromTimeline(timelineId); }, danger: true },
  ];
  list.innerHTML = actions.map(a =>
    `<button class="mobile-action-item${a.danger ? ' is-danger' : ''}" type="button"><span class="mobile-action-icon">${a.icon}</span>${a.label}</button>`
  ).join('');
  list.querySelectorAll('.mobile-action-item').forEach((btn, i) => {
    btn.addEventListener('click', actions[i].action);
  });
  sheet.classList.add('mobile-action-visible');
}

function closeMobileActionMenu() {
  const sheet = document.getElementById('mobile-action-sheet');
  if (sheet) sheet.classList.remove('mobile-action-visible');
}

// #40 离线路线卡（可打印）
function openOfflineRouteCard(route) {
  const dialog = document.createElement('dialog');
  dialog.className = 'share-card-dialog';
  const startName = route.start?.name || '未设置起点';
  const endName = route.end?.name || '未设置终点';
  const segments = (route.segments || []).map((s, i) =>
    `<div class="offline-segment"><span class="offline-seg-num">${i + 1}</span><span class="offline-seg-name">${escapeHtml(s.name || `路段 ${i + 1}`)}</span><span class="offline-seg-info">${escapeHtml(s.distance || '')}${s.duration ? ' · ' + escapeHtml(s.duration) : ''}</span></div>`
  ).join('');
  const arrivalTips = (route.arrivalTip || '').split('\n').filter(s => s.trim()).map(s => `<li>${escapeHtml(s.trim())}</li>`).join('');

  dialog.innerHTML = `
    <button class="dialog-close" type="button" aria-label="关闭">×</button>
    <div class="offline-route-card">
      <div class="offline-header">
        <h2>🥾 ${escapeHtml(route.name || '徒步路线')}</h2>
        <div class="offline-route-line"><span class="offline-start">起点 · ${escapeHtml(startName)}</span><span class="offline-arrow">→</span><span class="offline-end">终点 · ${escapeHtml(endName)}</span></div>
        <div class="offline-stats">${escapeHtml(route.difficulty || '')}${route.distance ? ' · ' + escapeHtml(route.distance) : ''}${route.duration ? ' · ' + escapeHtml(route.duration) : ''}</div>
      </div>
      ${segments ? `<div class="offline-segments"><h3>分段路线</h3>${segments}</div>` : ''}
      ${arrivalTips ? `<div class="offline-tips"><h3>出行提示</h3><ul>${arrivalTips}</ul></div>` : ''}
      ${route.retreatTime ? `<div class="offline-safety"><b>⚠ 最晚撤离时间：${escapeHtml(route.retreatTime)}</b>${route.turnaround?.name ? ` · 折返点：${escapeHtml(route.turnaround.name)}` : ''}</div>` : ''}
      <div class="offline-footer">一起去滇南 · 生成于 ${new Date().toLocaleDateString('zh-CN')}</div>
    </div>
    <div class="share-card-actions">
      <button class="button button-ghost" type="button" id="offline-print-btn">打印 / 保存 PDF</button>
      <button class="button button-ghost" type="button" id="offline-close-btn">关闭</button>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('#offline-close-btn').addEventListener('click', () => dialog.close());
  dialog.querySelector('#offline-print-btn').addEventListener('click', () => window.print());
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

// #29 离线出行包：打包 GPX + 路线信息为 JSON 下载
function downloadOfflinePackage(route) {
  const routePackage = {
    version: 1,
    generatedAt: new Date().toISOString(),
    route: {
      name: route.name || '未命名路线',
      start: route.start,
      end: route.end,
      difficulty: route.difficulty,
      distance: route.distance,
      duration: route.duration,
      retreatTime: route.retreatTime,
      turnaround: route.turnaround,
      segments: route.segments || [],
      checkpoints: route.checkpoints || [],
      arrivalTip: route.arrivalTip,
      summary: route.summary,
    },
    trackPoints: route.trackPoints || [],
    checklist: [
      '装备：登山鞋、雨衣、头灯',
      '补给：水 1.5L+、高能量零食',
      '天气：出发前查看当日天气预报',
      '紧急联系人：已告知同行人路线',
      '路线文件：GPX 已下载到手机',
    ],
  };
  const blob = new Blob([JSON.stringify(routePackage, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(route.name || '徒步路线').replace(/[\\/:*?"<>|]/g, '_')}_出行包.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('离线出行包已下载', '📦');
}

let currentProject = null;
let autosaveEnabled = false;
let pendingConflictSnapshot = null;
let editor = { id: 'site-access-user', name: '协作访客' };
let currentView = 'timeline'; // 'timeline' | 'map'
let mapViewInitialized = false;
let mapViewSignature = null;
let hikingRoute = null;
const CANVAS_ZOOM_MIN = 0.5;
const CANVAS_ZOOM_MAX = 1.6;
const CANVAS_ZOOM_STEP = 0.1;
const CARD_ROUTE_PORTS = ['top', 'right', 'bottom', 'left'];
const CARD_ROUTE_PORT_LABELS = {
  top: '上边',
  right: '右边',
  bottom: '下边',
  left: '左边',
};
let canvasZoom = Number(localStorage.getItem(`travel-canvas-zoom-${currentProjectId || 'default'}`)) || 0.75;
let routeRenderFrame = null;

// 拖拽、缩放和窗口尺寸变化都可能在一帧内触发多次；只保留最后一次连线计算，
// 避免重复读取卡片布局并重建整层 SVG，保持白板操作跟手。
function scheduleRouteRender() {
  if (routeRenderFrame !== null) return;
  routeRenderFrame = requestAnimationFrame(() => {
    routeRenderFrame = null;
    renderRouteLines();
  });
}

const projectAutosave = createProjectAutosave({
  delay: 500,
  save: async (data) => {
    if (!currentProjectId || !currentProject) return;
    const updatedProject = await api.updateProject(currentProjectId, {
      data,
      expectedRevision: currentProject.revision,
    });
    if (updatedProject && updatedProject.conflict) {
      pendingConflictSnapshot = data;
      currentProject = updatedProject.project;
      showEditConflict();
      return;
    }
    if (!updatedProject || updatedProject.error) {
      throw new Error('保存项目失败');
    }
    currentProject = updatedProject;
    broadcastEdit('project_updated', { revision: updatedProject.revision });
  },
  onError: (error) => console.error('Project autosave failed:', error),
});

// 从后端加载项目数据
async function loadProject() {
  if (!currentProjectId) {
    window.location.href = 'projects.html';
    return false;
  }
  
  currentProject = await api.getProject(currentProjectId);
  if (!currentProject) {
    window.location.href = 'projects.html';
    return false;
  }
  
  return true;
}

function hydrateProjectData() {
  store.hydrate(currentProject?.data || {});
  hikingRoute = currentProject?.data?.hikingRoute || createEmptyHikingRoute();
}

function isHikingProject() {
  return currentProject?.mode === 'hiking';
}

function createEmptyHikingRoute() {
  return {
    name: '',
    summary: '',
    coverImage: '',
    images: [],
    arrivalTip: '',
    difficulty: '',
    distance: '',
    duration: '',
    start: null,
    end: null,
    checkpoints: [],
    trackPoints: [],
    segments: [],
    turnaround: null,
    retreatTime: '',
  };
}

function projectDataSnapshot() {
  const snapshot = store.snapshot();
  return isHikingProject() ? { ...snapshot, hikingRoute } : snapshot;
}

// 更新页面标题和项目名称显示
function updateProjectUI() {
  if (!currentProject) return;
  
  document.title = `${currentProject.name} · 协作行程`;
  const projectNameEl = document.querySelector('.trip-switcher strong');
  if (projectNameEl) {
    projectNameEl.textContent = currentProject.name;
  }
  document.body.classList.toggle('hiking-project', isHikingProject());
  const dayNavLabel = document.querySelector('.day-nav > .eyebrow');
  const isHiking = isHikingProject();
  if (dayNavLabel) dayNavLabel.textContent = isHiking ? '徒步路线' : '行程树';
  const projectCard = document.querySelector('.sidebar .project-card');
  const projectCardText = projectCard?.querySelectorAll('p');
  if (projectCardText?.[0]) projectCardText[0].textContent = isHiking ? '徒步项目' : '旅行项目';
  if (projectCardText?.[1]) projectCardText[1].textContent = isHiking ? '一条路线 · 起点到终点' : '5 天 · 4 座城 · 慢一点也没关系';
  const projectCardTitle = projectCard?.querySelector('h1');
  if (projectCardTitle) projectCardTitle.textContent = currentProject.name;
  const itineraryEyebrow = document.querySelector('.itinerary .section-heading .eyebrow');
  const itineraryTitle = document.getElementById('itinerary-title');
  const helper = document.querySelector('.itinerary .helper');
  if (itineraryEyebrow) itineraryEyebrow.textContent = isHiking ? '共同记录的一条徒步路线' : '共同编辑的旅行画布';
  if (itineraryTitle) itineraryTitle.textContent = isHiking ? '把整条徒步路线记在一起' : '把整段旅程铺在同一张画布上';
  if (helper) helper.textContent = isHiking
    ? '记录路线说明、难度与补给信息；选择起终点后，在地图中查看整条徒步轨迹。'
    : '拖动白板空白处可移动画布；拖动旅行块可自由摆放，单击可查看详情；从卡片四边圆点拖到另一旅游块即可连接，终点会自动贴合最近边。画布支持缩放，点击箭头可为路线投票。';
}

// 添加返回按钮
const topbar = document.querySelector('.topbar');
const backBtn = document.createElement('button');
backBtn.className = 'button button-ghost';
backBtn.textContent = '← 返回项目列表';
backBtn.style.marginRight = '12px';
backBtn.addEventListener('click', () => {
  localStorage.removeItem('currentProjectId');
  window.location.href = 'projects.html';
});
topbar.insertBefore(backBtn, topbar.firstChild.nextSibling);

let days = [];
let selectedDayId = 1;

function generateDays(startDate, endDate) {
  const result = [];
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
  
  for (let i = 0; i < diffDays; i++) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    result.push({
      id: i + 1,
      label: `${month}.${day}`,
      title: `第 ${i + 1} 天`
    });
  }
  
  return result;
}

const store = createTripStore();
const timeline = document.querySelector('#timeline');
const library = document.querySelector('#block-library');
const activityList = document.querySelector('#activity-list');
const editConflictDialog = document.querySelector('#edit-conflict-dialog');
let draggedBlockId = null;

// 异步初始化
async function init() {
  try {
    const loaded = await loadProject();
    if (!loaded) return;

    const user = await api.getCurrentUser();
    if (user) {
      editor = {
        id: user.id,
        name: user.display_name || user.displayName || user.username || '协作访客',
      };
    }
  
    // 生成天数
    if (isHikingProject()) {
      days = [];
    } else if (currentProject.startDate && currentProject.endDate) {
      days = generateDays(currentProject.startDate, currentProject.endDate);
    } else {
      // 默认 5 天
      days = [
        { id: 1, label: '第 1 天', title: '第 1 天' },
        { id: 2, label: '第 2 天', title: '第 2 天' },
        { id: 3, label: '第 3 天', title: '第 3 天' },
        { id: 4, label: '第 4 天', title: '第 4 天' },
        { id: 5, label: '第 5 天', title: '第 5 天' },
      ];
    }

    updateProjectUI();

    // 从项目数据恢复完整快照，保留实体 ID 和扩展字段。
    if (currentProject.data) {
      hydrateProjectData();
    } else {
      // 初始化默认数据（仅首次）
      const storeIds = new Map();
      for (const block of travelBlocks) {
        const created = store.createTravelBlock(block);
        storeIds.set(block.id, created.id);
      }

      function initialBlock(sourceId, day, time) {
        store.scheduleBlock({ blockId: storeIds.get(sourceId), day, time, editor });
      }
      initialBlock('jianshui', 1, '10:30');
      initialBlock('barbecue', 1, '19:00');
      initialBlock('duoyi-tree', 3, '06:10');
      hikingRoute = createEmptyHikingRoute();
    }

    // 项目加载时调用的恢复方法不应进入用户可撤销的编辑历史。
    store.clearHistory();
    renderLibrary();
    render({ persist: false });
    autosaveEnabled = true;

    // 初始化通知系统
    initNotifications();

    // 数据恢复和 UI 就绪后再连接实时协作，避免远程事件覆盖未初始化状态。
    initRealtime();
  } catch (error) {
    console.error('Project initialization failed:', error);
    showNotification('项目加载失败，请刷新重试');
  }
}

// 启动初始化
init();

// #6 键盘快捷键
document.addEventListener('keydown', (event) => {
  // 忽略输入框内的按键
  if (event.target.closest('input, textarea, select')) return;
  // 忽略 dialog 打开时的按键
  if (document.querySelector('dialog[open]')) return;

  const key = event.key.toLowerCase();

  // Delete/Backspace: 删除选中的卡片
  if ((key === 'delete' || key === 'backspace') && selectedTimelineId) {
    event.preventDefault();
    removeFromTimeline(selectedTimelineId);
    selectedTimelineId = null;
    return;
  }

  // N: 新建行程
  if (key === 'n' && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    const firstDay = days[0]?.id || 1;
    openAddSlotDialog(firstDay);
    return;
  }

  // M: 切换地图/时间线
  if (key === 'm' && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    const nextView = currentView === 'timeline' ? 'map' : 'timeline';
    switchView(nextView);
    return;
  }

  // Escape: 关闭气泡/取消选中
  if (key === 'escape') {
    closeQuickAddPopover();
    if (selectedTimelineId) {
      selectedTimelineId = null;
      document.querySelectorAll('.timeline-card.selected').forEach(c => c.classList.remove('selected'));
    }
    return;
  }

  // 1-5: 滚动到对应天数
  if (/^[1-5]$/.test(key) && !event.ctrlKey && !event.metaKey) {
    const dayNum = parseInt(key);
    const dayEl = document.getElementById(`day-${dayNum}`);
    if (dayEl) {
      event.preventDefault();
      dayEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }

  // ↑↓: 在卡片间导航
  if ((key === 'arrowup' || key === 'arrowdown') && !event.ctrlKey && !event.metaKey) {
    const cards = [...document.querySelectorAll('.timeline-card')];
    if (cards.length === 0) return;
    event.preventDefault();
    const currentIdx = selectedTimelineId
      ? cards.findIndex(c => c.dataset.timelineId === selectedTimelineId)
      : -1;
    let nextIdx;
    if (key === 'arrowdown') {
      nextIdx = currentIdx < cards.length - 1 ? currentIdx + 1 : 0;
    } else {
      nextIdx = currentIdx > 0 ? currentIdx - 1 : cards.length - 1;
    }
    const nextCard = cards[nextIdx];
    // 取消旧选中
    cards.forEach(c => c.classList.remove('selected'));
    selectedTimelineId = nextCard.dataset.timelineId;
    nextCard.classList.add('selected');
    nextCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }
});

// 选中态管理
let selectedTimelineId = null;

// 初始化实时协作
function initRealtime() {
  if (!currentProjectId || !editor.id) return;
  
  // 连接 WebSocket
  realtimeClient.connect(currentProjectId, editor.id, editor.name);
  
  // 监听在线用户变化
  realtimeClient.on('online_users_changed', (users) => {
    console.log('在线用户更新:', users);
    updateOnlineUsersUI(users);
  });
  
  // 监听远程编辑（防抖避免快速连发时数据竞争）
  let remoteEditTimer = null;
  realtimeClient.on('remote_edit', (data) => {
    console.log('收到远程编辑:', data);
    clearTimeout(remoteEditTimer);
    remoteEditTimer = setTimeout(() => {
      // 本地仍有未保存/保存中的修改时，不要先覆盖 currentProject，
      // 让下一次保存使用旧 revision 触发乐观锁冲突。
      if (projectAutosave.pending() || pendingConflictSnapshot) {
        showNotification('检测到远程更新，本地修改将在保存时进行合并确认');
        return;
      }
      loadProject().then(() => {
        hydrateProjectData();
        store.clearHistory();
        updateProjectUI();
        render({ persist: false });
        showRemoteAction(data);
      }).catch((error) => {
        console.error('Remote project refresh failed:', error);
      });
    }, 300);
  });
  
  // 监听用户加入
  realtimeClient.on('user_joined', (data) => {
    console.log('用户加入:', data);
    showNotification(`${data.user_name} 加入了项目`);
  });
  
  // 监听用户离开
  realtimeClient.on('user_left', (data) => {
    console.log('用户离开:', data);
    showNotification(`${data.user_name} 离开了项目`);
  });
  
  // 监听断线重连
  realtimeClient.on('reconnect_failed', () => {
    showNotification('连接断开，请刷新页面');
  });
  
  // 监听光标位置更新
  realtimeClient.onCursorUpdate((data) => {
    updateRemoteCursor(data);
  });
  
  // 监听输入事件，广播光标位置
  setupCursorBroadcast();
}

// 设置光标位置广播
function setupCursorBroadcast() {
  const inputs = document.querySelectorAll('input, textarea');
  inputs.forEach(input => {
    input.addEventListener('focus', (e) => {
      const elementId = e.target.id || e.target.dataset.timelineId || e.target.dataset.commentId;
      if (elementId) {
        realtimeClient.broadcastCursor(elementId, { start: e.target.selectionStart, end: e.target.selectionEnd });
      }
    });
    
    input.addEventListener('click', (e) => {
      const elementId = e.target.id || e.target.dataset.timelineId || e.target.dataset.commentId;
      if (elementId) {
        realtimeClient.broadcastCursor(elementId, { start: e.target.selectionStart, end: e.target.selectionEnd });
      }
    });
    
    input.addEventListener('keyup', (e) => {
      const elementId = e.target.id || e.target.dataset.timelineId || e.target.dataset.commentId;
      if (elementId) {
        realtimeClient.broadcastCursor(elementId, { start: e.target.selectionStart, end: e.target.selectionEnd });
      }
    });
  });
}

// 更新远程光标显示
function updateRemoteCursor(data) {
  const { user_id, user_name, element_id, position } = data;
  
  // 移除旧的光标标记
  const oldCursors = document.querySelectorAll(`.remote-cursor[data-user-id="${user_id}"]`);
  oldCursors.forEach(cursor => cursor.remove());
  
  // 查找目标元素
  const targetElement = document.querySelector(`[data-timeline-id="${element_id}"], [data-comment-id="${element_id}"], #${element_id}`);
  if (!targetElement) return;
  
  // 创建光标标记
  const cursorMarker = document.createElement('div');
  cursorMarker.className = 'remote-cursor';
  cursorMarker.dataset.userId = user_id;
  cursorMarker.style.cssText = `
    position: absolute;
    background: rgba(37, 99, 235, 0.3);
    border-left: 2px solid rgb(37, 99, 235);
    pointer-events: none;
    z-index: 1000;
  `;
  
  // 添加用户名标签
  const label = document.createElement('div');
  label.className = 'remote-cursor-label';
  label.textContent = user_name;
  label.style.cssText = `
    position: absolute;
    top: -20px;
    left: 0;
    background: rgb(37, 99, 235);
    color: white;
    padding: 2px 6px;
    border-radius: 3px;
    font-size: 11px;
    white-space: nowrap;
  `;
  cursorMarker.appendChild(label);
  
  // 定位光标
  const rect = targetElement.getBoundingClientRect();
  const containerRect = targetElement.offsetParent.getBoundingClientRect();
  
  if (position && targetElement.setSelectionRange) {
    // 对于输入框，使用选区位置
    try {
      targetElement.setSelectionRange(position.start, position.end);
    } catch (e) {
      console.warn('无法设置选区:', e);
    }
  }
  
  // 在元素上添加光标标记
  targetElement.style.position = 'relative';
  targetElement.appendChild(cursorMarker);
  
  // 3秒后自动隐藏（如果没有新更新）
  setTimeout(() => {
    cursorMarker.style.opacity = '0';
    setTimeout(() => cursorMarker.remove(), 300);
  }, 3000);
}

// 更新在线用户 UI
function updateOnlineUsersUI(users) {
  const container = document.querySelector('.online-users');
  if (!container) return;
  
  if (users.length === 0) {
    container.innerHTML = '<span class="no-users">暂无其他用户</span>';
    return;
  }
  
  container.innerHTML = users.map(user => `
    <div class="online-user">
      <span class="user-avatar">${escapeHtml(user.name.charAt(0))}</span>
      <span class="user-name">${escapeHtml(user.name)}</span>
    </div>
  `).join('');
}

// 广播编辑操作
function broadcastEdit(action, data) {
  realtimeClient.broadcastEdit(action, data);
}

// 显示远程操作通知
function showRemoteAction(data) {
  const message = `${data.user_name} ${getActionText(data.action)}`;
  showNotification(message);
}

function getActionText(action) {
  const actionMap = {
    'add_block': '添加了旅行块',
    'remove_block': '删除了旅行块',
    'add_timeline': '添加了行程',
    'remove_timeline': '删除了行程',
    'move_timeline': '移动了行程',
    'edit_timeline': '编辑了行程',
    'add_poll': '创建了投票',
    'vote': '参与了投票',
    'add_comment': '添加了评论',
    'project_updated': '更新了项目'
  };
  return actionMap[action] || '进行了操作';
}

function showNotification(message) {
  // 创建通知元素
  const notification = document.createElement('div');
  notification.className = 'realtime-notification';
  notification.textContent = message;
  document.body.appendChild(notification);
  
  // 2秒后移除
  setTimeout(() => {
    notification.classList.add('fade-out');
    setTimeout(() => notification.remove(), 500);
  }, 2000);
}

function saveProjectData() {
  projectAutosave.schedule(projectDataSnapshot());
}

function showEditConflict() {
  if (!editConflictDialog.open) editConflictDialog.showModal();
}

async function overwriteRemoteProject() {
  if (!pendingConflictSnapshot || !currentProject) return;

  const updatedProject = await api.updateProject(currentProjectId, {
    data: pendingConflictSnapshot,
    expectedRevision: currentProject.revision,
  });
  if (updatedProject && updatedProject.conflict) {
    currentProject = updatedProject.project;
    return;
  }
  if (!updatedProject || updatedProject.error) {
    throw new Error('覆盖保存失败');
  }

  currentProject = updatedProject;
  pendingConflictSnapshot = null;
  editConflictDialog.close();
}

function timelineItemsFor(day) {
  return store.snapshot().timeline
    .filter((item) => item.day === day)
    .sort((a, b) => a.time.localeCompare(b.time));
}

function dayNavigationSummary(items) {
  const names = [...new Set(items.map(item => item.name).filter(Boolean))];
  if (!names.length) return '暂未安排';
  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(' · ');
  return `${names[0]} 等 ${names.length} 处`;
}

function renderDayNavigation() {
  const list = document.getElementById('day-nav-list');
  if (!list) return;
  if (isHikingProject()) {
    const startName = hikingRoute?.start?.name || '选择起点';
    const endName = hikingRoute?.end?.name || '选择终点';
    list.innerHTML = `<div class="hiking-nav-summary"><b>🥾 ${escapeHtml(hikingRoute?.name || currentProject?.name || '徒步路线')}</b><span>${escapeHtml(startName)} → ${escapeHtml(endName)}</span></div>`;
    return;
  }
  if (!days.some(day => day.id === selectedDayId)) selectedDayId = days[0]?.id || 1;

  list.replaceChildren(...days.map(day => {
    const items = timelineItemsFor(day.id);
    const summary = dayNavigationSummary(items);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day-nav-item';
    button.classList.toggle('selected', day.id === selectedDayId);
    button.classList.toggle('is-empty', items.length === 0);
    button.dataset.dayLink = String(day.id);
    button.title = `${day.title} · ${summary} · ${items.length} 项`;
    button.setAttribute('aria-label', `${day.title}，${summary}，${items.length} 项`);
    button.innerHTML = `<span>${String(day.id).padStart(2, '0')}</span><em>${escapeHtml(summary)}</em><i>${items.length} 项</i>`;
    button.addEventListener('click', () => {
      selectedDayId = day.id;
      list.querySelectorAll('.day-nav-item').forEach(item => {
        item.classList.toggle('selected', item === button);
      });
      document.querySelector(`#day-${day.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    return button;
  }));
}

function routeDepthsForDay(dayItems, connections) {
  const dayItemIds = new Set(dayItems.map(item => item.id));
  const parentsById = new Map(dayItems.map(item => [item.id, []]));

  connections.forEach(connection => {
    if (dayItemIds.has(connection.fromTimelineId) && dayItemIds.has(connection.toTimelineId)) {
      parentsById.get(connection.toTimelineId).push(connection.fromTimelineId);
    }
  });

  const depths = new Map();
  const depthFor = itemId => {
    if (depths.has(itemId)) return depths.get(itemId);
    const parents = parentsById.get(itemId) || [];
    const depth = parents.length ? Math.max(...parents.map(parentId => depthFor(parentId) + 1)) : 0;
    depths.set(itemId, depth);
    return depth;
  };

  dayItems.forEach(item => depthFor(item.id));
  return depths;
}

function clampCanvasZoom(value) {
  return Math.min(CANVAS_ZOOM_MAX, Math.max(CANVAS_ZOOM_MIN, Math.round(value * 100) / 100));
}

function setCanvasZoom(value, { preserveCenter = true } = {}) {
  const viewport = document.getElementById('board-viewport');
  const zoomValue = document.getElementById('canvas-zoom-value');
  const previousZoom = canvasZoom;
  canvasZoom = clampCanvasZoom(value);

  let centerX = 0;
  let centerY = 0;
  if (viewport && preserveCenter) {
    centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / previousZoom;
    centerY = (viewport.scrollTop + viewport.clientHeight / 2) / previousZoom;
  }

  // 使用 transform: scale() 替代非标准的 zoom 属性
  timeline.style.transform = `scale(${canvasZoom})`;
  timeline.style.transformOrigin = '0 0';
  // 调整容器尺寸以匹配缩放后的内容，确保滚动区域正确
  timeline.style.width = `${1100 / canvasZoom}px`;
  timeline.style.height = `${2000 / canvasZoom}px`;
  if (zoomValue) zoomValue.textContent = `${Math.round(canvasZoom * 100)}%`;
  localStorage.setItem(`travel-canvas-zoom-${currentProjectId || 'default'}`, String(canvasZoom));

  requestAnimationFrame(() => {
    if (viewport && preserveCenter) {
      viewport.scrollLeft = Math.max(0, centerX * canvasZoom - viewport.clientWidth / 2);
      viewport.scrollTop = Math.max(0, centerY * canvasZoom - viewport.clientHeight / 2);
    }
    renderRouteLines();
  });
}

function bindCanvasPan(viewport) {
  let panState = null;
  let panFrame = null;

  const isInteractiveTarget = target => target instanceof Element && Boolean(target.closest([
    '.timeline-card',
    'button',
    'input',
    'textarea',
    'select',
    'a',
    '[role="button"]',
    '.route-line',
    '.route-voter-badge',
    '.route-remove-control',
  ].join(', ')));

  viewport.addEventListener('pointerdown', event => {
    // 徒步路线是普通表单页，不应被白板平移手势截获，保证触控与滚动自然传递给页面。
    if (isHikingProject() || event.button !== 0 || isInteractiveTarget(event.target)) return;

    const viewportRect = viewport.getBoundingClientRect();
    const isOnScrollbar = event.clientX >= viewportRect.left + viewport.clientWidth
      || event.clientY >= viewportRect.top + viewport.clientHeight;
    if (isOnScrollbar) return;

    panState = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
    };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
    event.preventDefault();
  });

  viewport.addEventListener('pointermove', event => {
    if (!panState || event.pointerId !== panState.pointerId) return;
    panState.nextScrollLeft = panState.scrollLeft - (event.clientX - panState.clientX);
    panState.nextScrollTop = panState.scrollTop - (event.clientY - panState.clientY);
    if (panFrame !== null) return;
    panFrame = requestAnimationFrame(() => {
      panFrame = null;
      if (!panState) return;
      viewport.scrollLeft = panState.nextScrollLeft;
      viewport.scrollTop = panState.nextScrollTop;
    });
  });

  const finishPan = event => {
    if (!panState || event.pointerId !== panState.pointerId) return;
    if (panFrame !== null) {
      cancelAnimationFrame(panFrame);
      panFrame = null;
      viewport.scrollLeft = panState.nextScrollLeft;
      viewport.scrollTop = panState.nextScrollTop;
    }
    panState = null;
    viewport.classList.remove('is-panning');
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
  };

  viewport.addEventListener('pointerup', finishPan);
  viewport.addEventListener('pointercancel', finishPan);
  viewport.addEventListener('lostpointercapture', () => {
    if (panFrame !== null) cancelAnimationFrame(panFrame);
    panFrame = null;
    panState = null;
    viewport.classList.remove('is-panning');
  });
}

function initCanvasControls() {
  const viewport = document.getElementById('board-viewport');
  const zoomOut = document.getElementById('canvas-zoom-out');
  const zoomIn = document.getElementById('canvas-zoom-in');
  const zoomValue = document.getElementById('canvas-zoom-value');
  const zoomFit = document.getElementById('canvas-zoom-fit');
  if (!viewport || !zoomOut || !zoomIn || !zoomValue || !zoomFit) return;

  zoomOut.addEventListener('click', () => setCanvasZoom(canvasZoom - CANVAS_ZOOM_STEP));
  zoomIn.addEventListener('click', () => setCanvasZoom(canvasZoom + CANVAS_ZOOM_STEP));
  zoomValue.addEventListener('click', () => setCanvasZoom(1));
  zoomFit.addEventListener('click', () => {
    const fittedZoom = (viewport.clientWidth - 28) / timeline.clientWidth;
    setCanvasZoom(fittedZoom, { preserveCenter: false });
    requestAnimationFrame(() => {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    });
  });

  viewport.addEventListener('wheel', event => {
    if (isHikingProject()) return;
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setCanvasZoom(canvasZoom + (event.deltaY < 0 ? CANVAS_ZOOM_STEP : -CANVAS_ZOOM_STEP));
  }, { passive: false });

  viewport.addEventListener('keydown', event => {
    if (isHikingProject()) return;
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setCanvasZoom(canvasZoom + CANVAS_ZOOM_STEP);
    } else if (event.key === '-') {
      event.preventDefault();
      setCanvasZoom(canvasZoom - CANVAS_ZOOM_STEP);
    } else if (event.key === '0') {
      event.preventDefault();
      setCanvasZoom(1);
    }
  });

  bindCanvasPan(viewport);
  setCanvasZoom(canvasZoom, { preserveCenter: false });
}

function bindCanvasCardDrag(card, item) {
  card.draggable = false;
  const initialX = Number.isFinite(Number(item.canvasX)) ? Number(item.canvasX) : 0;
  const initialY = Number.isFinite(Number(item.canvasY)) ? Number(item.canvasY) : 0;
  card.dataset.canvasX = String(initialX);
  card.dataset.canvasY = String(initialY);
  card.style.setProperty('--canvas-x', `${initialX}px`);
  card.style.setProperty('--canvas-y', `${initialY}px`);
  card.querySelector('img')?.setAttribute('draggable', 'false');

  let dragState = null;
  let timeDragState = null;
  const TIME_DRAG_THRESHOLD = 12; // px before switching to time drag
  const PX_PER_15MIN = 20;
  const DELETE_ZONE_THRESHOLD = 60; // px below viewport bottom to trigger delete

  card.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button, input, textarea, a, [role="button"]')) return;
    const startX = Number(card.dataset.canvasX) || 0;
    const startY = Number(card.dataset.canvasY) || 0;
    const cardRect = card.getBoundingClientRect();
    const timelineRect = timeline.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      startX,
      startY,
      baseLeft: (cardRect.left - timelineRect.left) / canvasZoom - startX,
      baseTop: (cardRect.top - timelineRect.top) / canvasZoom - startY,
      moved: false,
      timeMode: false,
      timeDragStartY: event.clientY,
      origTime: item.time,
    };
    card.setPointerCapture(event.pointerId);
    card.classList.add('canvas-moving');
    event.preventDefault();
  });

  card.addEventListener('pointermove', event => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const deltaX = (event.clientX - dragState.clientX) / canvasZoom;
    const deltaY = (event.clientY - dragState.clientY) / canvasZoom;

    // 纵向超过阈值 → 切换为调时间模式
    if (!dragState.timeMode && Math.abs(deltaY) > TIME_DRAG_THRESHOLD && Math.abs(deltaY) > Math.abs(deltaX) * 1.5) {
      dragState.timeMode = true;
      dragState.timeDragStartY = event.clientY;
      card.classList.remove('canvas-moving');
      // 显示时间浮标
      showTimeDragIndicator(card, item);
      return;
    }

    if (dragState.timeMode) {
      const pixelDelta = event.clientY - dragState.timeDragStartY;
      const minutesDelta = Math.round((-pixelDelta / PX_PER_15MIN) * 15);
      const currentDragTime = adjustTime(dragState.origTime, minutesDelta);
      updateTimeDragIndicator(card, currentDragTime);
      return;
    }

    const maxX = timeline.clientWidth - card.offsetWidth - 16 - dragState.baseLeft;
    const maxY = timeline.clientHeight - card.offsetHeight - 16 - dragState.baseTop;
    const nextX = Math.min(maxX, Math.max(16 - dragState.baseLeft, dragState.startX + deltaX));
    const nextY = Math.min(maxY, Math.max(16 - dragState.baseTop, dragState.startY + deltaY));
    dragState.moved ||= Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2;
    card.dataset.canvasX = String(Math.round(nextX));
    card.dataset.canvasY = String(Math.round(nextY));
    card.style.setProperty('--canvas-x', `${nextX}px`);
    card.style.setProperty('--canvas-y', `${nextY}px`);
    scheduleRouteRender();

    // 拖拽删除：检查是否拖到视口底部以下
    const viewport = document.getElementById('board-viewport');
    if (viewport) {
      const vpRect = viewport.getBoundingClientRect();
      const cardBottom = event.clientY + 20; // 卡片底部估算
      const inDeleteZone = cardBottom > vpRect.bottom - DELETE_ZONE_THRESHOLD;
      card.classList.toggle('dragging-to-delete', inDeleteZone);
      dragState.inDeleteZone = inDeleteZone;
    }
  });

  const finishDrag = (event, { cancelled = false } = {}) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const { moved, startX, startY, timeMode, origTime } = dragState;
    dragState = null;
    card.classList.remove('canvas-moving', 'dragging-to-delete');
    hideTimeDragIndicator(card);
    if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);

    // 拖拽删除：在删除区域松开
    if (dragState?.inDeleteZone) {
      removeFromTimeline(item.id);
      return;
    }

    if (timeMode) {
      // 时间调整模式：取浮标当前显示的时间，吸附到 5 分钟
      const displayTime = timeDragIndicator?.textContent || origTime;
      const finalTime = snapTimeTo5Min(displayTime);
      if (finalTime !== origTime) {
        store.editTimelineItem({ timelineId: item.id, time: finalTime, editor });
        showToast(`时间改为 ${finalTime}`, '🕐');
      }
      render();
      return;
    }

    if (cancelled) {
      card.dataset.canvasX = String(startX);
      card.dataset.canvasY = String(startY);
      card.style.setProperty('--canvas-x', `${startX}px`);
      card.style.setProperty('--canvas-y', `${startY}px`);
      scheduleRouteRender();
    } else if (moved) {
      card.dataset.justDragged = 'true';
      store.editTimelineItem({
        timelineId: item.id,
        canvasX: Number(card.dataset.canvasX),
        canvasY: Number(card.dataset.canvasY),
        editor,
      });
      render();
    }
  };
  card.addEventListener('pointerup', finishDrag);
  card.addEventListener('pointercancel', event => finishDrag(event, { cancelled: true }));
}

// --- 时间拖拽浮标 ---
let timeDragIndicator = null;
function showTimeDragIndicator(card, item) {
  hideTimeDragIndicator(card);
  timeDragIndicator = document.createElement('div');
  timeDragIndicator.className = 'time-drag-indicator';
  timeDragIndicator.textContent = item.time;
  card.appendChild(timeDragIndicator);
}
function updateTimeDragIndicator(card, time) {
  if (timeDragIndicator) timeDragIndicator.textContent = time;
}
function hideTimeDragIndicator(card) {
  if (timeDragIndicator) {
    timeDragIndicator.remove();
    timeDragIndicator = null;
  }
}
function adjustTime(time, minutesDelta) {
  const [h, m] = time.split(':').map(Number);
  let totalMin = h * 60 + m + minutesDelta;
  totalMin = Math.max(0, Math.min(23 * 60 + 59, totalMin));
  const nh = Math.floor(totalMin / 60);
  const nm = totalMin % 60;
  return `${String(nh).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}
function snapTimeTo5Min(time) {
  const [h, m] = time.split(':').map(Number);
  const snapped = Math.round(m / 5) * 5;
  const nh = snapped >= 60 ? h + 1 : h;
  const nm = snapped % 60;
  return `${String(Math.min(23, nh)).padStart(2, '0')}:${String(nm).padStart(2, '0')}`;
}

function createTimelineCard(item) {
  const card = document.createElement('article');
  card.className = 'timeline-card';
  card.dataset.timelineId = item.id;
  card.dataset.category = item.category || 'default';
  card.draggable = false;
  card.tabIndex = 0;
  card.setAttribute('aria-label', `${item.name}，单击查看详情，拖动可移动`);

  const snapshot = store.snapshot();
  const poll = snapshot.polls.find(p => p.timelineItemId === item.id);
  const outgoingConnectionCount = snapshot.connections
    .filter(connection => connection.fromTimelineId === item.id)
    .length;
  const pollHtml = poll ? `<div class="poll-section">${renderPollCard(poll)}</div>` : '';
  const routeVoteHintHtml = outgoingConnectionCount >= 2
    ? `<p class="route-vote-hint">有 ${outgoingConnectionCount} 条下一站路线，点击对应连线投票</p>`
    : '';
  const timeConflicts = findTimeConflicts(snapshot.timeline, item);
  const timeConflictHtml = timeConflicts.length
    ? `<p class="time-conflict" role="alert">时间冲突：${timeConflicts.map((conflict) => conflict.name).join('、')} 也安排在 ${item.time}</p>`
    : '';
  
  const locationInfo = item.lat != null && item.lng != null
    ? `<div class="location-info" title="${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}">📍 ${item.lat.toFixed(3)}, ${item.lng.toFixed(3)}</div>`
    : '';

  const categoryIcons = { scenic: '️', food: '🍜', hotel: '🏨', transport: '🚗', shopping: '🛍️', activity: '' };
  const catIcon = categoryIcons[item.category] || '';
  const priceBadge = item.price ? `<span class="card-price">${escapeHtml(item.price)}</span>` : '';

  const safeName = escapeHtml(item.name);
  const safeNote = escapeHtml(item.note || '');
  const safeImage = escapeHtml(item.image || '');
  const safeTime = escapeHtml(item.time || '');
  const ariaLabel = `${safeName} 的时间`;
  const noteAriaLabel = `${safeName} 的备注`;
  const timelineDeleteHtml = item.branchGroup ? '' : `
    <button class="timeline-delete-btn" type="button" aria-label="删除行程中的 ${safeName}" title="删除这个行程卡片"></button>
  `;
  const routeConnectorHtml = item.branchGroup ? '' : CARD_ROUTE_PORTS.map((port) => `
    <span class="route-connector route-connector-${port}" data-route-port="${port}" role="button" aria-label="从 ${safeName} ${CARD_ROUTE_PORT_LABELS[port]}创建下一站连线" title="拖到另一张卡片的任意边，表示玩完这里接着去那里"></span>
  `).join('');
  const scheduleControlHtml = item.branchGroup
    ? `<input aria-label="${ariaLabel}" type="time" value="${safeTime}">`
    : `<span class="schedule-control">
        <button class="move-day-btn" type="button" aria-label="调整 ${safeName} 的天数" title="修改行程天数">第 ${item.day} 天</button>
        <input aria-label="${ariaLabel}" type="time" value="${safeTime}">
      </span>`;

  card.innerHTML = `
    <img src="${safeImage}" alt="${safeName}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2256%22 height=%2248%22><rect fill=%22%23eee%22 width=%22100%25%22 height=%22100%25%22/></svg>'">
    <div class="card-header">
      ${scheduleControlHtml}
      <div class="name">${catIcon} ${safeName}</div>
      ${priceBadge}
    </div>
    <div>
      <input class="note" aria-label="${noteAriaLabel}" value="${safeNote}" placeholder="添加同行备注">
      ${locationInfo}
      <button class="pick-location-btn" type="button">📍 选择位置</button>
      <button class="branch-btn" type="button" title="添加需要投票选择的备选项">备选分叉</button>
      ${timeConflictHtml}
      ${routeVoteHintHtml}
      ${pollHtml}
      <div class="comments-section" data-timeline-id="${escapeHtml(item.id)}">
        <div class="comments-list"></div>
        <button class="add-comment-btn" data-timeline-id="${escapeHtml(item.id)}">💬 添加评论</button>
      </div>
    </div>
    ${timelineDeleteHtml}
    <span class="drag-handle" aria-label="可拖动"></span>
    ${routeConnectorHtml}
  `;

  const [timeInput, noteInput] = card.querySelectorAll('input');
  timeInput.addEventListener('change', () => {
    store.editTimelineItem({ timelineId: item.id, time: timeInput.value, editor });
    render();
  });
  noteInput.addEventListener('change', () => {
    store.editTimelineItem({ timelineId: item.id, note: noteInput.value, editor });
    render();
  });

  const openDetailsFromCard = event => {
    if (card.dataset.justDragged === 'true') return;
    if (event.target.closest('button, input, textarea, select, a, [role="button"]')) return;
    // 单击选中，双击打开详情
    if (selectedTimelineId === item.id) {
      openTimelineItemDetail(item.id);
    } else {
      // 取消其他选中
      document.querySelectorAll('.timeline-card.selected').forEach(c => c.classList.remove('selected'));
      selectedTimelineId = item.id;
      card.classList.add('selected');
    }
  };
  card.addEventListener('click', openDetailsFromCard);
  card.addEventListener('keydown', event => {
    if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openTimelineItemDetail(item.id);
  });

  // 双击名称进入内联编辑
  card.querySelector('.name')?.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    const nameEl = e.currentTarget;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = item.name;
    input.className = 'name-edit-input';
    input.style.cssText = 'width:100%;border:0;border-bottom:2px solid var(--green);background:transparent;outline:none;font:inherit;font-size:inherit;font-weight:700;color:var(--ink);padding:0;';
    nameEl.replaceChildren(input);
    input.focus();
    input.select();
    const finish = (save) => {
      if (save) {
        const newName = input.value.trim();
        if (newName && newName !== item.name) {
          store.editTimelineItem({ timelineId: item.id, name: newName, editor });
          showToast('名称已更新', '✏️');
        }
      }
      render();
    };
    input.addEventListener('blur', () => finish(true), { once: true });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); input.removeEventListener('blur', finish); finish(false); }
    });
  });

  card.querySelector('.timeline-delete-btn')?.addEventListener('click', () => {
    const confirmed = confirm(`删除「${item.name}」这个行程卡片？\n灵感库会保留该地点，关联的路线、投票和评论会一并清理。`);
    if (!confirmed) return;
    store.removeTimelineItem({ timelineId: item.id, editor });
    render();
  });

  card.querySelector('.move-day-btn')?.addEventListener('click', () => openMoveDayDialog(item));

  // 地图选点
  card.querySelector('.pick-location-btn').addEventListener('click', async () => {
    const location = await openLocationPicker(item.lat || null, item.lng || null);
    if (location) {
      store.editTimelineItem({
        timelineId: item.id,
        lat: location.lat,
        lng: location.lng,
        editor,
      });
      render();
    }
  });

  // 分叉按钮
  const branchBtn = card.querySelector('.branch-btn');
  if (branchBtn) {
    branchBtn.addEventListener('click', () => {
      if (item.branchGroup) {
        if (confirm('确定移除此分支选项？')) {
          store.removeFromBranch({ timelineId: item.id, editor });
          render();
        }
        return;
      }
      // 打开分支选择对话框
      const dialog = document.getElementById('branch-dialog');
      const list = document.getElementById('branch-block-list');
      const blocks = store.snapshot().blocks.filter(b => b.id !== item.blockId);

      list.innerHTML = blocks.length === 0
        ? '<p style="color:var(--muted);text-align:center;padding:20px;">没有其他旅行块，请先添加</p>'
        : blocks.map((b, i) => `
          <div class="branch-block-option" data-block-id="${escapeHtml(b.id)}">
            <img src="${escapeHtml(b.image)}" alt="" style="width:36px;height:32px;object-fit:cover;border-radius:4px;">
            <div>
              <strong style="font-size:13px;">${escapeHtml(b.name)}</strong>
              ${b.category ? `<small style="color:var(--muted);font-size:10px;">${escapeHtml(b.category)}</small>` : ''}
              ${b.price ? `<small style="color:var(--terracotta);font-size:10px;">${escapeHtml(b.price)}</small>` : ''}
            </div>
          </div>
        `).join('');

      list.querySelectorAll('.branch-block-option').forEach(el => {
        el.addEventListener('click', () => {
          const blockId = el.dataset.blockId;
          try {
            store.createBranchFromTimelineItem({ timelineId: item.id, blockId, editor });
          } catch (error) {
            alert(error.message);
            return;
          }
          dialog.close();
          render();
        });
      });

      dialog.showModal();
    });
  }

  // 渲染评论
  const renderComments = () => {
    const commentsList = card.querySelector('.comments-list');
    const comments = store.getCommentsForTimelineItem(item.id);
    
    if (comments.length === 0) {
      commentsList.innerHTML = '<div class="no-comments">暂无评论</div>';
      return;
    }
    
    commentsList.innerHTML = comments.map(comment => {
      // 先转义再高亮 @提及，防止 XSS
      const safeContent = escapeHtml(comment.content);
      const highlightedContent = safeContent.replace(
        /@(\w+)/g,
        '<span class="mention">@$1</span>'
      );
      
      return `
      <div class="comment-item" data-comment-id="${comment.id}">
        <div class="comment-header">
          <span class="comment-author">${escapeHtml(comment.author.name)}</span>
          <span class="comment-time">${new Date(comment.createdAt).toLocaleString('zh-CN')}</span>
        </div>
        <div class="comment-content">${highlightedContent}</div>
        ${comment.mentions && comment.mentions.length > 0 ? `
          <div class="comment-mentions">
            提及: ${comment.mentions.map(m => `<span class="mention-tag">@${escapeHtml(m)}</span>`).join(' ')}
          </div>
        ` : ''}
        <div class="comment-actions">
          <button class="like-btn" data-comment-id="${comment.id}">
            👍 ${comment.likes.length > 0 ? comment.likes.length : ''}
          </button>
          ${comment.author.id === editor.id ? `
            <button class="edit-comment-btn" data-comment-id="${comment.id}">编辑</button>
            <button class="delete-comment-btn" data-comment-id="${comment.id}">删除</button>
          ` : ''}
        </div>
      </div>
    `}).join('');
    
    // 绑定评论操作事件
    commentsList.querySelectorAll('.like-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        store.likeComment({ commentId: btn.dataset.commentId, user: editor });
        renderComments();
      });
    });
    
    commentsList.querySelectorAll('.edit-comment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const comment = comments.find(c => c.id === btn.dataset.commentId);
        if (comment) {
          const newContent = prompt('编辑评论:', comment.content);
          if (newContent && newContent.trim()) {
            store.editComment({ commentId: btn.dataset.commentId, content: newContent.trim(), editor });
            renderComments();
          }
        }
      });
    });
    
    commentsList.querySelectorAll('.delete-comment-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('确定删除这条评论吗？')) {
          store.deleteComment({ commentId: btn.dataset.commentId, editor });
          renderComments();
        }
      });
    });
  };
  
  renderComments();
  
  // 添加评论按钮
  card.querySelector('.add-comment-btn').addEventListener('click', () => {
    const content = prompt('输入评论内容:');
    if (content && content.trim()) {
      store.addComment({ timelineItemId: item.id, content: content.trim(), author: editor });
      renderComments();
    }
  });

  bindCanvasCardDrag(card, item);
  
  bindPollVoteHandlers(card);
  
  // #13 移动端长按弹出操作菜单
  let longPressTimer = null;
  card.addEventListener('touchstart', (e) => {
    if (e.target.closest('button, input')) return;
    longPressTimer = setTimeout(() => {
      openMobileActionMenu(item.id, item.name);
    }, 500);
  }, { passive: true });
  card.addEventListener('touchend', () => clearTimeout(longPressTimer));
  card.addEventListener('touchmove', () => clearTimeout(longPressTimer));

  return card;
}

function renderPollCard(poll) {
  const results = store.getPollResults(poll.id);
  const userVote = poll.votes?.[editor.id];
  const total = results.total || 1;
  const pollIsOpen = store.isPollOpen(poll.id);
  const deadline = poll.deadlineAt
    ? `截止：${new Date(poll.deadlineAt).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })}`
    : '不限时';
  
  // 生成图表数据
  const maxCount = Math.max(...poll.options.map(opt => results[opt] || 0), 1);
  const chartHtml = poll.options.map((option) => {
    const count = results[option] || 0;
    const percent = Math.round((count / total) * 100);
    const barWidth = Math.round((count / maxCount) * 100);
    const voted = userVote === option ? 'voted' : '';
    const optionLabel = poll.optionLabels?.[option] || option;
    return `
      <div class="poll-option-row">
        <button class="vote-btn ${voted}" data-poll-id="${escapeHtml(poll.id)}" data-choice="${escapeHtml(option)}" aria-pressed="${userVote === option}" ${pollIsOpen ? '' : 'disabled'}>
          ${escapeHtml(optionLabel)}
        </button>
        <div class="poll-chart">
          <div class="poll-bar" style="width: ${barWidth}%"></div>
          <span class="poll-count">${count} (${percent}%)</span>
        </div>
      </div>
    `;
  }).join('');
  
  return `
    <div class="poll-card" data-poll-id="${poll.id}">
      <div class="poll-question">${escapeHtml(poll.question)}</div>
      <div class="poll-chart-container">
        ${chartHtml}
      </div>
      <div class="poll-total">${pollIsOpen ? deadline : `投票已截止 · ${deadline}`} · 共 ${results.total} 人投票</div>
      ${poll.comments && poll.comments.length ? `
        <div class="poll-comments">
          <div class="poll-comments-title">投票评论 (${poll.comments.length})</div>
          ${poll.comments.slice(-5).map(c => `
            <div class="poll-comment">
              <strong>${escapeHtml(c.voterName)}</strong>: ${escapeHtml(c.comment)}
            </div>
          `).join('')}
          ${poll.comments.length > 5 ? `<div class="poll-comments-more">还有 ${poll.comments.length - 5} 条评论</div>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

function bindPollVoteHandlers(root) {
  root.querySelectorAll('.vote-btn').forEach((button) => {
    button.addEventListener('click', () => {
      try {
        store.vote({
          pollId: button.dataset.pollId,
          voter: editor,
          choice: button.dataset.choice,
        });
        render();
      } catch (error) {
        alert(error.message);
      }
    });
  });
}

const travelCategoryLabels = {
  scenic: '景点',
  food: '美食',
  hotel: '住宿',
  transport: '交通',
  shopping: '购物',
  activity: '活动',
};

function openTravelDetail(item, { scheduled = false, city = '' } = {}) {
  const dialog = document.getElementById('travel-detail-dialog');
  const image = document.getElementById('travel-detail-image');
  const category = travelCategoryLabels[item.category] || '旅行灵感';
  const knownCity = city || travelBlocks.find(block => block.name === item.name)?.city || '';

  image.src = item.image || '';
  image.alt = `${item.name} 的图片`;
  image.onerror = () => {
    image.removeAttribute('src');
    image.classList.add('is-placeholder');
  };
  image.classList.toggle('is-placeholder', !item.image);
  document.getElementById('travel-detail-category').textContent = category;
  document.getElementById('travel-detail-title').textContent = item.name;

  const badges = [knownCity, item.price].filter(Boolean);
  document.getElementById('travel-detail-badges').innerHTML = badges
    .map(value => `<span>${escapeHtml(value)}</span>`)
    .join('');
  document.getElementById('travel-detail-description').textContent = item.description || '暂未添加详细介绍，可以先把它放进行程，再和同行人一起补充。';

  const detailRows = [];
  if (scheduled) {
    const day = days.find(candidate => candidate.id === Number(item.day));
    detailRows.push(['行程日期', day?.title || `第 ${item.day} 天`]);
    if (item.time) detailRows.push(['计划时间', item.time]);
    if (item.note) detailRows.push(['同行备注', item.note]);
  }
  if (item.lat != null && item.lng != null) {
    detailRows.push(['位置坐标', `${Number(item.lat).toFixed(4)}, ${Number(item.lng).toFixed(4)}`]);
  }
  document.getElementById('travel-detail-facts').innerHTML = detailRows
    .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join('');

  dialog.showModal();
}

function openTimelineItemDetail(timelineId) {
  const item = store.snapshot().timeline.find(candidate => candidate.id === timelineId);
  if (item) openTravelDetail(item, { scheduled: true });
}

function openMoveDayDialog(item) {
  const dialog = document.getElementById('move-day-dialog');
  const select = document.getElementById('move-day-select');
  document.getElementById('move-day-title').textContent = `将「${item.name}」移到哪一天？`;
  dialog.dataset.timelineId = item.id;
  select.replaceChildren(...days.map(day => {
    const option = document.createElement('option');
    option.value = String(day.id);
    option.textContent = `第 ${day.id} 天 · ${day.title}`;
    option.selected = Number(item.day) === day.id;
    return option;
  }));
  dialog.showModal();
}

function createBranchCard(items) {
  const wrapper = document.createElement('div');
  wrapper.className = 'branch-group';
  const branchGroup = items[0]?.branchGroup;
  const polls = store.snapshot().polls;
  const poll = polls.find(p => p.branchGroup === branchGroup)
    || polls.find(p => (
      p.timelineItemId === items[0]?.id
      && p.options.every(option => items.some(item => option === item.id || option === item.name))
    ));
  const hasPoll = !!poll;
  const results = poll ? store.getPollResults(poll.id) : { total: 0 };
  const maxVotes = poll
    ? Math.max(...poll.options.map(option => results[option] || 0), 0)
    : 0;
  const userVote = poll?.votes?.[editor.id];
  const pollStatus = !hasPoll
    ? ''
    : store.isPollOpen(poll.id)
      ? (userVote ? '已投票' : '待投票')
      : '已截止';

  wrapper.innerHTML = `
    <div class="branch-header">
      <span class="branch-icon">🔀</span>
      <span class="branch-label">路线选项（${items.length} 选 1）</span>
      ${hasPoll ? `<span class="branch-voted">${pollStatus}</span>` : ''}
    </div>
    <div class="branch-options">
      ${items.map((item, i) => {
        const choice = poll?.options.includes(item.id) ? item.id : item.name;
        const voteCount = poll ? (results[choice] || 0) : 0;
        const isLeading = maxVotes > 0 && voteCount === maxVotes;
        return `
          <div class="branch-option ${isLeading ? 'branch-winner' : ''}">
            <span class="branch-letter">${String.fromCharCode(65 + i)}</span>
            <span class="branch-name">${escapeHtml(item.name)}</span>
            <span class="branch-time">${escapeHtml(item.time || '')}</span>
            ${item.price ? `<span class="branch-price">${escapeHtml(item.price)}</span>` : ''}
            ${poll && results.total ? `<span class="branch-result">${voteCount} 票</span>` : ''}
          </div>
        `;
      }).join('')}
    </div>
    ${hasPoll
      ? renderPollCard(poll)
      : `<button class="branch-vote-btn" data-branch-group="${escapeHtml(branchGroup)}">发起投票决定</button>`}
  `;

  const voteBtn = wrapper.querySelector('.branch-vote-btn');
  if (voteBtn) {
    voteBtn.addEventListener('click', () => {
      const question = `路线选择：${items.map(i => i.name).join(' 还是 ')}`;
      const options = items.map(i => i.id);
      const optionLabels = Object.fromEntries(items.map(i => [i.id, i.name]));
      store.createPoll({
        question,
        timelineItemId: items[0].id,
        branchGroup,
        creator: editor,
        options,
        optionLabels,
      });
      render();
    });
  }

  if (poll) bindPollVoteHandlers(wrapper);

  return wrapper;
}

function formatHikingDistance(distance) {
  if (!Number.isFinite(Number(distance))) return '';
  return Number(distance) >= 1000
    ? `${(Number(distance) / 1000).toFixed(1)} km`
    : `${Math.round(Number(distance))} m`;
}

function formatHikingDuration(duration) {
  if (!Number.isFinite(Number(duration))) return '';
  const minutes = Math.max(1, Math.round(Number(duration) / 60));
  return minutes >= 60
    ? `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ''}`
    : `${minutes} 分`;
}

function hikingPointLabel(point, fallback) {
  return point?.name || fallback;
}

// #42 根据坐标和日期计算日落时间（简化算法）
function calculateSunset(lat, lng, date = new Date()) {
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const latRad = lat * Math.PI / 180;
  const declination = -23.45 * Math.cos(2 * Math.PI * (dayOfYear + 10) / 365) * Math.PI / 180;
  const hourAngle = Math.acos(-Math.tan(latRad) * Math.tan(declination));
  const sunsetHour = 12 + hourAngle * 180 / Math.PI / 15 - lng / 15;
  const hours = Math.floor(sunsetHour);
  const minutes = Math.round((sunsetHour - hours) * 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// 根据撤离时间和折返点生成安全提醒；天气与景区公告由出发前核验。
function generateHikingSafetyAlerts(route) {
  const alerts = [];
  if (route.retreatTime) {
    const now = new Date();
    const [h, m] = route.retreatTime.split(':').map(Number);
    const retreat = new Date();
    retreat.setHours(h, m, 0);
    if (now > retreat) {
      alerts.push({ type: 'danger', message: `已超过最晚撤离时间 ${route.retreatTime}，请立即停止推进！` });
    } else {
      const remaining = Math.round((retreat - now) / 60000);
      if (remaining < 60) {
        alerts.push({ type: 'warning', message: `距离最晚撤离时间仅剩 ${remaining} 分钟` });
      }
    }
  }
  if (route.turnaround?.name) {
    alerts.push({ type: 'info', message: `折返点：${route.turnaround.name}，超过此点应考虑返回` });
  }
  return alerts;
}

// #43 路线难度自动评估
function evaluateRouteDifficulty(route) {
  if (!route.trackPoints?.length) return route.difficulty || '';
  const distance = trackDistance(route.trackPoints) / 1000; // km
  const elev = elevationStats(route.trackPoints);
  const ascent = elev?.ascent || 0;

  // 基于距离和爬升的综合评分
  let score = distance * 2 + ascent / 100;

  if (score < 10) return '简单';
  if (score < 20) return '中等';
  if (score < 35) return '困难';
  return '挑战';
}



function downloadHikingShareCard() {
  try {
    const svg = createHikingShareCardSvg(hikingRoute);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(hikingRoute.name || '徒步路线').replace(/[\\/:*?"<>|]/g, '_')}-分享卡.svg`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    showToast('路线分享图已生成', '↗');
  } catch (error) {
    showToast(error.message || '暂时无法生成分享图', '!');
  }
}


async function addHikingCheckpoint() {
  const lastPoint = hikingRoute?.checkpoints?.at(-1) || hikingRoute?.start;
  const selected = await openLocationPicker(lastPoint?.lat ?? null, lastPoint?.lng ?? null);
  if (!selected) return;
  updateHikingRoute({
    checkpoints: [...(hikingRoute.checkpoints || []), {
      name: selected.name || `打卡点 ${(hikingRoute.checkpoints || []).length + 1}`,
      address: selected.address || '', lat: selected.lat, lng: selected.lng, type: 'view',
    }],
  }, { rerender: true });
}

function updateHikingRoute(patch, { rerender = false } = {}) {
  hikingRoute = { ...createEmptyHikingRoute(), ...hikingRoute, ...patch };
  if (rerender) {
    render();
    return;
  }
  if (currentView === 'map') renderMapView();
  saveProjectData();
}

async function importHikingGpx(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseGpx(text);
    if (!parsed.trackPoints?.length) {
      showToast('GPX 文件中没有找到轨迹点', '!');
      return;
    }
    // #28 GPX 健康检查
    const health = gpxHealthCheck(parsed.trackPoints);
    if (!health.isHealthy) {
      showToast(`GPX 提示：${health.issues.join('；')}`, '⚠');
    }
    const start = parsed.trackPoints[0];
    const end = parsed.trackPoints.at(-1);
    const distance = trackDistance(parsed.trackPoints);
    const elev = elevationStats(parsed.trackPoints);
    updateHikingRoute({
      name: parsed.name || hikingRoute.name || file.name.replace(/\.gpx$/i, ''),
      start: { ...start, name: start.name || '起点' },
      end: { ...end, name: end.name || '终点' },
      trackPoints: parsed.trackPoints,
      distance: distance > 0 ? `${(distance / 1000).toFixed(1)} km` : hikingRoute.distance,
    }, { rerender: true });
    showToast(`已导入 ${parsed.trackPoints.length} 个轨迹点${health.isHealthy ? '' : '（有问题请检查）'}`, '✓');
  } catch (error) {
    showToast(error.message || 'GPX 导入失败', '!');
  }
}

async function pickHikingEndpoint(kind) {
  const currentPoint = hikingRoute?.[kind];
  const selected = await openLocationPicker(currentPoint?.lat ?? null, currentPoint?.lng ?? null);
  if (!selected) return;
  hikingRoute = {
    ...createEmptyHikingRoute(),
    ...hikingRoute,
    [kind]: {
      name: selected.name || (kind === 'start' ? '徒步起点' : '徒步终点'),
      address: selected.address || '',
      lat: selected.lat,
      lng: selected.lng,
    },
  };

  if (hikingRoute.start && hikingRoute.end) {
    const route = await getWalkingRoute(hikingRoute.start, hikingRoute.end);
    if (route) {
      hikingRoute.distance = formatHikingDistance(route.distance);
      hikingRoute.duration = formatHikingDuration(route.duration);
    }
  }
  render();
}

function createHikingRoutePanel() {
  const panel = document.createElement('section');
  panel.className = 'hiking-route-panel';
  const route = { ...createEmptyHikingRoute(), ...hikingRoute };
  const safety = checkpointSafetySummary(route.checkpoints);
  const safetyMessage = safety.hazards || safety.exits
    ? `${safety.hazards ? `已标记 ${safety.hazards} 处危险点` : '暂无危险点'}${safety.exits ? ` · ${safety.exits} 个撤离点` : ''}`
    : '暂未标记危险点或撤离点；请在出发前补充。';
  const endpoint = (kind, label) => {
    const point = route[kind];
    const value = point
      ? `${point.name || label} · ${Number(point.lat).toFixed(4)}, ${Number(point.lng).toFixed(4)}`
      : `选择${label}`;
    const mapPreview = point?.lat && point?.lng
      ? `<img class="hiking-endpoint-map" src="https://restapi.amap.com/v3/staticmap?location=${point.lng},${point.lat}&zoom=15&size=120*80&markers=mid,0xFF4444,:${point.lng},${point.lat}&key=5f6a87ea770765a1a5fe984ea045f8ea" alt="${escapeHtml(label)}位置预览" loading="lazy" onerror="this.style.display='none'" />`
      : '';
    return `<button class="hiking-endpoint" type="button" data-hiking-endpoint="${kind}"><span>${kind === 'start' ? '①' : '②'} ${label}</span><b>${escapeHtml(value)}</b>${mapPreview}</button>`;
  };

  // 图片画廊
  const allImages = [route.coverImage, ...(route.images || [])].filter(Boolean);
  const imageGallery = allImages.length > 0
    ? `<div class="hiking-image-gallery">${allImages.map((src, i) => `<img class="hiking-gallery-img" src="${escapeHtml(src)}" alt="路线图片${i + 1}" />`).join('')}</div>`
    : '';

  panel.innerHTML = `
    ${imageGallery}
    ${(() => {
      const alerts = generateHikingSafetyAlerts(route);
      if (alerts.length === 0) return '';
      return alerts.map(a => `<div class="hiking-alert-banner hiking-alert-${a.type}">${a.type === 'danger' ? '🚨' : a.type === 'warning' ? '⚠️' : 'ℹ️'} ${escapeHtml(a.message)}</div>`).join('');
    })()}
    <div class="hiking-gpx-import-row">
      <label class="button button-ghost hiking-gpx-import-btn">导入 GPX 轨迹<input id="hiking-gpx-file" type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" hidden /></label>
      <button class="button button-ghost" type="button" id="hiking-share-card">生成分享图</button>
      <button class="button button-ghost hiking-offline-card-btn" type="button">离线路线卡</button>
      <button class="button button-ghost hiking-offline-package-btn" type="button">离线出行包</button>
      <button class="button button-ghost hiking-auto-sunset-btn" type="button" title="根据坐标自动计算日落时间">🌅 自动日落</button>
      ${route.trackPoints?.length ? `<small class="hiking-gpx-info">已载入 ${route.trackPoints.length} 个轨迹点 · 难度：${escapeHtml(evaluateRouteDifficulty(route))}</small>` : '<small class="hiking-gpx-info">导入 GPX 后可显示路线轨迹与海拔数据</small>'}
    </div>
    <label class="hiking-field"><span>路线名称</span><input data-hiking-field="name" value="${escapeHtml(route.name)}" placeholder="如：虎跳峡高路徒步" /></label>
    <label class="hiking-field"><span>路线说明</span><textarea data-hiking-field="summary" placeholder="记录天气、补给、危险路段或同行信息">${escapeHtml(route.summary)}</textarea></label>
    <div class="hiking-arrival-section">
      <span class="hiking-arrival-title">出行提示（公交／自驾／停车）</span>
      <div class="hiking-arrival-editor" id="hiking-arrival-editor">
        ${(route.arrivalTip || '').split('\n').filter(s => s.trim()).map((tip, i) => `
          <div class="hiking-arrival-item" data-index="${i}">
            <textarea class="hiking-arrival-input" placeholder="输入一条提示…" rows="1">${escapeHtml(tip.trim())}</textarea>
            <button class="hiking-arrival-remove" data-index="${i}" type="button" title="删除此条">×</button>
          </div>
        `).join('')}
      </div>
      <button class="hiking-arrival-add" type="button" id="hiking-arrival-add">＋ 添加一条提示</button>
      <small>AI 导入时统一整理；出发前请以交通和景区当天公告为准。</small>
    </div>
    <label class="hiking-field"><span>封面图片链接</span><input data-hiking-field="coverImage" value="${escapeHtml(route.coverImage)}" placeholder="AI 导入或粘贴图片链接" /><div class="hiking-cover-preview" id="hiking-cover-preview">${route.coverImage ? `<img src="${escapeHtml(route.coverImage)}" alt="封面预览" />` : ''}</div></label>
    <label class="hiking-field"><span>更多图片链接（每行一个）</span><textarea data-hiking-field="imagesRaw" rows="3" placeholder="每行粘贴一个图片链接">${(route.images || []).join('\n')}</textarea></label>
    <div class="hiking-endpoints">${endpoint('start', '起点')}${endpoint('end', '终点')}</div>
    <section class="hiking-segments-section">
      <div class="hiking-section-heading"><span>分段路线</span><button class="button button-ghost" type="button" id="hiking-segment-add">＋ 添加分段</button></div>
      <div class="hiking-segments-list">${(route.segments || []).map((seg, i) => `
        <div class="hiking-segment-card" data-segment-index="${i}">
          <div class="hiking-segment-header">
            <span class="hiking-segment-number">${i + 1}</span>
            <input class="hiking-segment-name" value="${escapeHtml(seg.name || '')}" placeholder="路段名称（如：下院→半山亭）" />
            <button class="hiking-segment-remove" data-segment-index="${i}" type="button">×</button>
          </div>
          <div class="hiking-segment-fields">
            <input class="hiking-segment-distance" value="${escapeHtml(seg.distance || '')}" placeholder="距离（如：1.2 km）" />
            <input class="hiking-segment-duration" value="${escapeHtml(seg.duration || '')}" placeholder="用时（如：25 分钟）" />
            <input class="hiking-segment-note" value="${escapeHtml(seg.note || '')}" placeholder="备注（路况、补给等）" />
          </div>
        </div>
      `).join('')}${(route.segments || []).length === 0 ? '<p class="hiking-segments-empty">将整条路线按关键节点拆分，便于分段导航和离线核对</p>' : ''}</div>
    </section>
    <section class="hiking-checkpoints-section">
      <div class="hiking-section-heading"><span>途中打卡点</span><button class="button button-ghost" type="button" id="hiking-checkpoint-add">＋ 添加</button></div>
      <p class="hiking-risk-summary ${safety.hazards ? 'has-hazard' : ''}"><b>安全提示</b><span>${escapeHtml(safetyMessage)}</span>${safety.water ? `<em>补水点 ${safety.water}</em>` : ''}</p>
      <ol class="hiking-checkpoint-list">${(route.checkpoints || []).map((point, index) => {
        const type = checkpointType(point.type);
        return `<li class="hiking-checkpoint-item type-${type.id}"><i aria-hidden="true">${type.icon}</i><span>${escapeHtml(hikingPointLabel(point, `打卡点 ${index + 1}`))}</span><select class="hiking-checkpoint-type" data-checkpoint-index="${index}" aria-label="${escapeHtml(hikingPointLabel(point, `打卡点 ${index + 1}`))}类型">${HIKING_CHECKPOINT_TYPES.map(option => `<option value="${option.id}" ${option.id === type.id ? 'selected' : ''}>${option.icon} ${option.label}</option>`).join('')}</select><button type="button" class="hiking-checkpoint-remove" data-checkpoint-index="${index}" aria-label="删除${escapeHtml(hikingPointLabel(point, `打卡点 ${index + 1}`))}">×</button></li>`;
      }).join('') || '<li class="hiking-checkpoint-empty">可添加观景台、补给点、岔路或撤离点</li>'}</ol>
    </section>
    <div class="hiking-facts">
      <label class="hiking-field"><span>难度</span><input data-hiking-field="difficulty" value="${escapeHtml(route.difficulty)}" placeholder="如：中等（约 2633 级台阶）" /></label>
      <label class="hiking-field"><span>全程距离</span><input data-hiking-field="distance" value="${escapeHtml(route.distance)}" placeholder="如：约 3.5 km（官方资料）" /></label>
      <label class="hiking-field"><span>预计用时</span><input data-hiking-field="duration" value="${escapeHtml(route.duration)}" placeholder="如：约 2-3 小时（建议预留）" /></label>
    </div>
    <div class="hiking-safety-row">
      <label class="hiking-field"><span>折返点</span><input data-hiking-field="turnaroundName" value="${escapeHtml(route.turnaround?.name || '')}" placeholder="如：白云顶观景台" /><small class="hiking-safety-hint">超过此点应考虑折返</small></label>
      <label class="hiking-field"><span>最晚撤离时间</span><input type="time" data-hiking-field="retreatTime" value="${escapeHtml(route.retreatTime || '')}" /><small class="hiking-safety-hint">日落前 / 天黑前必须撤离</small></label>
    </div>
    <section class="hiking-checklist-section">
      <div class="hiking-section-heading"><span>出发检查清单</span><button class="button button-ghost" type="button" id="hiking-checklist-reset">重置</button></div>
      <div class="hiking-checklist" id="hiking-checklist">
        ${['装备：登山鞋、雨衣、头灯', '补给：水 1.5L+、高能量零食', '天气：出发前查看当日天气预报', '紧急联系人：已告知同行人路线', '路线文件：GPX 已下载到手机'].map((item, i) => `
          <label class="hiking-checklist-item"><input type="checkbox" data-checklist-index="${i}" />${escapeHtml(item)}</label>
        `).join('')}
      </div>
    </section>
  `;
  panel.querySelectorAll('[data-hiking-field]').forEach(field => {
    field.addEventListener('change', () => {
      const key = field.dataset.hikingField;
      let value = field.value;
      if (key === 'imagesRaw') {
        updateHikingRoute({ images: value.split('\n').map(s => s.trim()).filter(Boolean) });
      } else if (key === 'turnaroundName') {
        updateHikingRoute({ turnaround: { ...(hikingRoute.turnaround || {}), name: value } });
      } else {
        updateHikingRoute({ [key]: value });
      }
    });
    // #21 封面图片实时预览
    if (field.dataset.hikingField === 'coverImage') {
      field.addEventListener('input', () => {
        const preview = document.getElementById('hiking-cover-preview');
        if (preview) {
          preview.innerHTML = field.value.trim()
            ? `<img src="${escapeHtml(field.value.trim())}" alt="封面预览" onerror="this.parentElement.innerHTML=''" />`
            : '';
        }
      });
    }
  });

  // #26 出行提示分点编辑
  const arrivalEditor = document.getElementById('hiking-arrival-editor');
  const arrivalAddBtn = document.getElementById('hiking-arrival-add');

  function syncArrivalTips() {
    if (!arrivalEditor) return;
    const tips = [...arrivalEditor.querySelectorAll('.hiking-arrival-input')]
      .map(input => input.value.trim())
      .filter(Boolean);
    updateHikingRoute({ arrivalTip: tips.join('\n') });
  }

  arrivalEditor?.addEventListener('input', (e) => {
    if (e.target.classList.contains('hiking-arrival-input')) {
      // 自动增高
      e.target.style.height = 'auto';
      e.target.style.height = e.target.scrollHeight + 'px';
      syncArrivalTips();
    }
  });

  arrivalEditor?.addEventListener('click', (e) => {
    if (e.target.classList.contains('hiking-arrival-remove')) {
      e.target.closest('.hiking-arrival-item').remove();
      syncArrivalTips();
    }
  });

  arrivalAddBtn?.addEventListener('click', () => {
    if (!arrivalEditor) return;
    const item = document.createElement('div');
    item.className = 'hiking-arrival-item';
    item.innerHTML = `<textarea class="hiking-arrival-input" placeholder="输入一条提示…" rows="1"></textarea><button class="hiking-arrival-remove" type="button" title="删除此条">×</button>`;
    arrivalEditor.appendChild(item);
    const ta = item.querySelector('textarea');
    ta.focus();
    // 自动增高
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = ta.scrollHeight + 'px';
    });
  });

  // 初始化已有 textarea 高度
  arrivalEditor?.querySelectorAll('.hiking-arrival-input').forEach(ta => {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  });

  panel.querySelectorAll('[data-hiking-endpoint]').forEach(button => {
    button.addEventListener('click', () => pickHikingEndpoint(button.dataset.hikingEndpoint));
  });
  panel.querySelector('#hiking-share-card')?.addEventListener('click', downloadHikingShareCard);
  panel.querySelector('#hiking-checkpoint-add')?.addEventListener('click', addHikingCheckpoint);
  panel.querySelectorAll('.hiking-checkpoint-type').forEach(select => {
    select.addEventListener('change', () => {
      const index = Number(select.dataset.checkpointIndex);
      updateHikingRoute({ checkpoints: (hikingRoute.checkpoints || []).map((point, pointIndex) =>
        pointIndex === index ? { ...point, type: checkpointType(select.value).id } : point) }, { rerender: true });
    });
  });
  panel.querySelectorAll('.hiking-checkpoint-remove').forEach(button => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.checkpointIndex);
      updateHikingRoute({ checkpoints: (hikingRoute.checkpoints || []).filter((_, itemIndex) => itemIndex !== index) }, { rerender: true });
    });
  });
  panel.querySelector('.hiking-offline-card-btn')?.addEventListener('click', () => openOfflineRouteCard(route));
  panel.querySelector('.hiking-offline-package-btn')?.addEventListener('click', () => downloadOfflinePackage(route));
  panel.querySelector('.hiking-auto-sunset-btn')?.addEventListener('click', () => {
    if (!route.start?.lat || !route.start?.lng) {
      showToast('请先设置起点坐标', '!');
      return;
    }
    const sunset = calculateSunset(route.start.lat, route.start.lng);
    updateHikingRoute({ retreatTime: sunset }, { rerender: true });
    showToast(`日落时间 ${sunset} 已填入`, '🌅');
  });
  panel.querySelector('#hiking-gpx-file')?.addEventListener('change', event => importHikingGpx(event.target.files?.[0]));

  // 分段路线事件处理
  panel.querySelector('#hiking-segment-add')?.addEventListener('click', () => {
    const segments = [...(hikingRoute.segments || []), { name: '', distance: '', duration: '', note: '' }];
    updateHikingRoute({ segments }, { rerender: true });
  });
  panel.querySelectorAll('.hiking-segment-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = Number(btn.dataset.segmentIndex);
      const segments = (hikingRoute.segments || []).filter((_, i) => i !== index);
      updateHikingRoute({ segments }, { rerender: true });
    });
  });
  panel.querySelectorAll('.hiking-segment-name, .hiking-segment-distance, .hiking-segment-duration, .hiking-segment-note').forEach(input => {
    input.addEventListener('change', () => {
      const card = input.closest('.hiking-segment-card');
      const index = Number(card.dataset.segmentIndex);
      const segments = [...(hikingRoute.segments || [])];
      segments[index] = {
        name: card.querySelector('.hiking-segment-name').value,
        distance: card.querySelector('.hiking-segment-distance').value,
        duration: card.querySelector('.hiking-segment-duration').value,
        note: card.querySelector('.hiking-segment-note').value,
      };
      updateHikingRoute({ segments });
    });
  });

  // #44 检查清单重置
  panel.querySelector('#hiking-checklist-reset')?.addEventListener('click', () => {
    panel.querySelectorAll('.hiking-checklist input[type="checkbox"]').forEach(cb => cb.checked = false);
  });

  return panel;
}

let quickAddPopover = null;
function closeQuickAddPopover() {
  if (!quickAddPopover) return;
  quickAddPopover.classList.add('closing');
  const el = quickAddPopover;
  quickAddPopover = null;
  setTimeout(() => el.remove(), 100);
}

function openAddSlotDialog(dayId, defaultTime = '10:00') {
  const dialog = document.getElementById('add-slot-dialog');
  const form = document.getElementById('add-slot-form');
  const blockSelect = document.getElementById('slot-block-id');
  const nameInput = document.getElementById('slot-name');
  const timeInput = document.getElementById('slot-time');
  const blocks = store.snapshot().blocks;

  blockSelect.replaceChildren();
  const newBlockOption = document.createElement('option');
  newBlockOption.value = '';
  newBlockOption.textContent = '新建旅游块';
  blockSelect.append(newBlockOption);
  blocks.forEach(block => {
    const option = document.createElement('option');
    option.value = block.id;
    option.textContent = block.name;
    blockSelect.append(option);
  });

  const syncSelectedBlock = () => {
    const selectedBlock = blocks.find(block => block.id === blockSelect.value);
    nameInput.value = selectedBlock?.name || '';
    nameInput.readOnly = Boolean(selectedBlock);
    nameInput.placeholder = selectedBlock ? '将使用所选旅游块' : '行程名称';
  };

  blockSelect.value = '';
  syncSelectedBlock();
  timeInput.value = defaultTime;
  blockSelect.onchange = syncSelectedBlock;

  form.onsubmit = (e) => {
    e.preventDefault();
    const selectedBlock = blocks.find(block => block.id === blockSelect.value);
    const name = nameInput.value.trim();
    const time = timeInput.value;
    if (!time || (!selectedBlock && !name)) return;
    const blockId = selectedBlock
      ? selectedBlock.id
      : store.createTravelBlock({ name, image: 'diannan-images/spots/建水古城.jpg' }).id;
    store.scheduleBlock({ blockId, day: dayId, time, editor });
    dialog.close();
    render();
    showToast('行程已添加', '＋');
    // #8 新建后自动聚焦到名称输入框
    requestAnimationFrame(() => {
      const newCard = document.querySelector(`[data-timeline-id]`);
      if (newCard) {
        const nameInput = newCard.querySelector('.note');
        nameInput?.focus();
      }
    });
  };

  dialog.showModal();
  // 自动聚焦名称输入框
  requestAnimationFrame(() => nameInput.focus());
}

function renderTimeline() {
  closeQuickAddPopover();
  const connectorLayer = document.getElementById('route-lines');
  timeline.replaceChildren();
  if (connectorLayer) timeline.append(connectorLayer);
  if (isHikingProject()) {
    timeline.append(createHikingRoutePanel());
    return;
  }
  const template = document.querySelector('#timeline-day-template');

  for (const day of days) {
    const fragment = template.content.cloneNode(true);
    const column = fragment.querySelector('.day-column');
    const dropZone = fragment.querySelector('.drop-zone');
    const items = fragment.querySelector('.timeline-items');
    fragment.querySelector('.day-number').textContent = `DAY ${String(day.id).padStart(2, '0')}`;
    fragment.querySelector('.eyebrow').textContent = day.label;
    fragment.querySelector('h3').textContent = day.title;
    column.id = `day-${day.id}`;

    const dayItems = timelineItemsFor(day.id);
    column.classList.toggle('is-empty', dayItems.length === 0);
    const routeDepths = routeDepthsForDay(dayItems, store.snapshot().connections);
    const levelElements = new Map();
    [...new Set(routeDepths.values())].sort((a, b) => a - b).forEach(depth => {
      const level = document.createElement('div');
      level.className = 'route-level';
      level.dataset.routeLevel = String(depth);
      levelElements.set(depth, level);
      items.append(level);
    });
    const rendered = new Set();

    for (const item of dayItems) {
      if (rendered.has(item.id)) continue;

      if (item.branchGroup) {
        // 渲染分支组
        const branchItems = dayItems.filter(t => t.branchGroup === item.branchGroup);
        branchItems.forEach(t => rendered.add(t.id));
        levelElements.get(routeDepths.get(item.id) || 0)?.append(createBranchCard(branchItems));
      } else {
        levelElements.get(routeDepths.get(item.id) || 0)?.append(createTimelineCard(item));
      }
    }

    dropZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      dropZone.classList.add('drag-over');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (event) => {
      event.preventDefault();
      dropZone.classList.remove('drag-over');
      const sourceId = event.dataTransfer.getData('text/travel-block') || draggedBlockId;
      if (!sourceId) return;
      const existing = timelineItemsFor(day.id);
      const hour = String(Math.min(19, 9 + existing.length * 2)).padStart(2, '0');
      store.scheduleBlock({ blockId: sourceId, day: day.id, time: `${hour}:00`, editor });
      render();
    });
    dropZone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && draggedBlockId) {
        store.scheduleBlock({ blockId: draggedBlockId, day: day.id, time: '10:00', editor });
        render();
      }
    });

    // 点击空白处弹出快速新增气泡
    dropZone.addEventListener('click', (event) => {
      // 只响应空白区域的点击（drop-zone 自身或 drop-hint）
      if (!dropZone.contains(event.target)) return;
      if (event.target.closest('.timeline-card, .branch-group, .add-slot, .quick-add-popover')) return;

      // 关闭已有的气泡
      closeQuickAddPopover();

      const blocks = store.snapshot().blocks;
      const existingItems = timelineItemsFor(day.id);
      const hour = String(Math.min(19, 9 + existingItems.length * 2)).padStart(2, '0');
      const timeStr = `${hour}:00`;

      const popover = document.createElement('div');
      popover.className = 'quick-add-popover';
      // 用 fixed 定位挂到 body 上，避免被 dropZone 的 click 事件误关
      popover.style.position = 'fixed';
      popover.style.left = `${Math.min(event.clientX, window.innerWidth - 210)}px`;
      popover.style.top = `${event.clientY}px`;
      popover.style.zIndex = '100';

      let html = `<button data-action="new"><span class="qa-icon">＋</span>新建行程</button>`;
      if (blocks.length > 0) {
        html += `<div class="qa-divider"></div><div class="qa-scroll">`;
        blocks.slice(0, 6).forEach(block => {
          const img = block.image
            ? `<img src="${escapeHtml(block.image)}" alt="">`
            : `<span class="qa-icon">◻</span>`;
          html += `<button data-action="pick" data-block-id="${escapeHtml(block.id)}"><span class="qa-block-item">${img}<span class="qa-block-name">${escapeHtml(block.name)}</span></span></button>`;
        });
        if (blocks.length > 6) {
          html += `<button data-action="more"><span class="qa-icon">▤</span>更多灵感库…</button>`;
        }
        html += `</div>`;
      }
      popover.innerHTML = html;
      document.body.appendChild(popover);
      quickAddPopover = popover;

      // 点击气泡按钮
      popover.addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.target.closest('button');
        if (!btn) return;
        const action = btn.dataset.action;

        if (action === 'new') {
          closeQuickAddPopover();
          openAddSlotDialog(day.id, timeStr);
        } else if (action === 'pick') {
          const blockId = btn.dataset.blockId;
          store.scheduleBlock({ blockId, day: day.id, time: timeStr, editor });
          closeQuickAddPopover();
          render();
          showToast('已添加到行程', '＋');
        } else if (action === 'more') {
          closeQuickAddPopover();
          // 滚动到灵感库面板
          document.getElementById('explore')?.scrollIntoView({ behavior: 'smooth' });
          document.getElementById('search-blocks')?.focus();
        }
      });

      // 点击外部关闭（但忽略 originating dropZone 的冒泡）
      const outsideHandler = (e) => {
        if (popover.contains(e.target)) return;
        if (dropZone.contains(e.target)) return; // 忽略 dropZone 自身的冒泡
        closeQuickAddPopover();
        document.removeEventListener('click', outsideHandler);
      };
      requestAnimationFrame(() => document.addEventListener('click', outsideHandler));
    });

    fragment.querySelector('.add-slot').addEventListener('click', () => {
      openAddSlotDialog(day.id);
    });
    timeline.append(fragment);
  }
  scheduleRouteRender();
}

function renderLibrary(query = '') {
  const keyword = query.trim().toLowerCase();
  const knownCities = new Map(travelBlocks.map((item) => [item.name, item.city]));
  library.replaceChildren();
  store.snapshot().blocks
    .map((block) => ({ ...block, city: knownCities.get(block.name) || 'AI 整理' }))
    .filter((block) => !keyword || `${block.name}${block.city}`.toLowerCase().includes(keyword))
    .forEach((block) => {
      const element = document.createElement('article');
      element.className = 'travel-block';
      element.draggable = true;
      element.dataset.blockId = block.id;
      element.dataset.category = block.category || '';
      element.tabIndex = 0;
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', `${block.name}，单击查看详情，拖动可加入行程`);
      const categoryIcons = { scenic: '🏞️', food: '🍜', hotel: '🏨', transport: '🚗', shopping: '️', activity: '🎯' };
      const categoryIcon = categoryIcons[block.category] || '';
      const priceTag = block.price ? `<span class="block-price">${escapeHtml(block.price)}</span>` : '';
      const descPreview = block.description ? `<small class="block-desc">${escapeHtml(block.description.slice(0, 30))}${block.description.length > 30 ? '…' : ''}</small>` : '';

      element.innerHTML = `
        <img src="${escapeHtml(block.image)}" alt="${escapeHtml(block.name)}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2241%22><rect fill=%22%23eee%22 width=%22100%25%22 height=%22100%25%22/></svg>'">
        <div>
          <strong>${categoryIcon} ${escapeHtml(block.name)}</strong>
          ${priceTag}
          ${descPreview}
          <small>${escapeHtml(block.city || '')}</small>
        </div>
        <button class="delete-block-btn" data-block-id="${escapeHtml(block.id)}" type="button" aria-label="删除 ${escapeHtml(block.name)}"></button>
      `;
      element.querySelector('.delete-block-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`确定删除「${block.name}」？已排入行程的项不会被删除。`)) {
          store.deleteTravelBlock({ blockId: block.id, editor });
          render();
          renderLibrary(document.querySelector('#search-blocks').value);
        }
      });
      let wasDragged = false;
      element.addEventListener('click', event => {
        if (wasDragged || event.target.closest('button')) return;
        openTravelDetail(block, { city: block.city });
      });
      element.addEventListener('keydown', event => {
        if (event.target !== element || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        openTravelDetail(block, { city: block.city });
      });
      element.addEventListener('dragstart', (event) => {
        wasDragged = true;
        draggedBlockId = block.id;
        element.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/travel-block', block.id);
      });
      element.addEventListener('dragend', () => {
        draggedBlockId = null;
        element.classList.remove('dragging');
        setTimeout(() => { wasDragged = false; }, 0);
      });
      library.append(element);
    });
}

function renderActivity() {
  activityList.replaceChildren();
  const activity = store.snapshot().activity.slice(0, 4);
  if (!activity.length) {
    activityList.innerHTML = '<li>还没有编辑记录</li>';
    return;
  }
  activity.forEach((event) => {
    const item = document.createElement('li');
    const action = event.type === 'timeline.created'
      ? '把旅行块排进了行程'
      : event.type === 'timeline.moved'
        ? '调整了行程时间'
        : event.type === 'timeline.connected'
          ? '连接了下一站'
          : event.type === 'timeline.disconnected'
            ? '移除了下一站连线'
            : event.type === 'timeline.connection_voted'
              ? '为下一站路线投了票'
        : event.type === 'ai.draft.imported'
          ? '审核并导入了 AI 整理的旅行块'
          : '更新了行程备注';
    item.innerHTML = `<strong>${escapeHtml(event.editor?.name || '系统')}</strong> ${action}<br><span>刚刚</span>`;
    activityList.append(item);
  });
}

function render({ persist = autosaveEnabled } = {}) {
  renderDayNavigation();
  renderTimeline();
  renderActivity();
  if (currentView === 'map') renderMapView();
  if (persist) saveProjectData();
}

function switchView(view) {
  currentView = view;
  const timeline = document.getElementById('timeline');
  const boardShell = document.querySelector('.board-shell');
  const mapContainer = document.getElementById('map-container');
  const helper = document.querySelector('.itinerary .helper');
  const viewButtons = document.querySelectorAll('.view-switch button');

  viewButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  if (view === 'timeline') {
    timeline.style.display = '';
    if (boardShell) boardShell.style.display = '';
    mapContainer.style.display = 'none';
    if (helper) helper.style.display = '';
    destroyMap();
    mapViewInitialized = false;
    mapViewSignature = null;
  } else if (view === 'map') {
    if (boardShell) boardShell.style.display = 'none';
    mapContainer.style.display = '';
    if (helper) helper.style.display = 'none';
    renderMapView({ force: true });
  }
}

function mapSignature(items, connections) {
  const itemSignature = items
    .map(item => [item.id, item.name, item.time, item.lat, item.lng].join('|'))
    .join('~');
  const itemIds = new Set(items.map(item => item.id));
  const connectionSignature = connections
    .filter(connection => itemIds.has(connection.fromTimelineId) && itemIds.has(connection.toTimelineId))
    .map(connection => `${connection.id}:${connection.fromTimelineId}:${connection.toTimelineId}`)
    .sort()
    .join('~');
  return `${itemSignature}#${connectionSignature}`;
}

function hikingMapSignature(route) {
  const points = [...(route?.checkpoints || [])]
    .map(point => [point.lat, point.lng, point.name].join(','))
    .join('~');
  const track = route?.trackPoints || [];
  const trackSignature = [track[0], track[Math.floor(track.length / 2)], track.at(-1)]
    .map(point => point ? [point.lat, point.lng, point.ele].join(',') : '')
    .join('~');
  return ['hiking', route?.name, route?.start?.lat, route?.start?.lng, route?.end?.lat, route?.end?.lng, points, track.length, trackSignature]
    .map(value => String(value ?? ''))
    .join('|');
}

function renderMapView({ force = false } = {}) {
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return;

  const snapshot = store.snapshot();
  if (isHikingProject()) {
    const nextSignature = hikingMapSignature(hikingRoute);
    if (mapViewInitialized && !force && mapViewSignature === nextSignature) return;
    if (!mapViewInitialized) {
      initMap('map-canvas');
      mapViewInitialized = true;
    }
    addHikingRoute(
      hikingRoute?.start,
      hikingRoute?.end,
      hikingRoute?.trackPoints,
      hikingRoute?.checkpoints,
    );
    mapViewSignature = nextSignature;
    return;
  }
  // 仅将已选择位置的行程项放入地图；排序后标记序号也与行程顺序一致。
  const items = snapshot.timeline
    .filter(item => item.lat != null && item.lng != null)
    .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));

  const nextSignature = mapSignature(items, snapshot.connections);
  if (mapViewInitialized && !force && mapViewSignature === nextSignature) return;

  if (!mapViewInitialized) {
    initMap('map-canvas');
    mapViewInitialized = true;
  }

  // 只有连线的两端都有坐标时才会在地图上画出路线。
  addRouteLines(snapshot.connections, items);
  addMarkers(items, (item) => {
    // 点击标记后切换回时间线并滚动到该卡片
    switchView('timeline');
    requestAnimationFrame(() => {
      const card = document.querySelector(`[data-timeline-id="${item.id}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('highlight');
        setTimeout(() => card.classList.remove('highlight'), 2000);
      }
    });
  });
  mapViewSignature = nextSignature;
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const connectionDrivingInfo = new Map();

function hasLocation(item) {
  return item?.lat != null && item?.lng != null;
}

function connectionDrivingKey(connection, source, target) {
  return [connection.id, source.lng, source.lat, target.lng, target.lat]
    .map(value => String(value))
    .join('|');
}

function drivingInfoForConnection(connection, source, target) {
  if (!hasLocation(source) || !hasLocation(target)) return null;
  const key = connectionDrivingKey(connection, source, target);
  const cached = connectionDrivingInfo.get(connection.id);
  if (cached?.key === key) return cached;

  const pending = { key, status: 'pending' };
  connectionDrivingInfo.set(connection.id, pending);
  getDrivingRoute(source, target).then((route) => {
    if (connectionDrivingInfo.get(connection.id) !== pending) return;
    connectionDrivingInfo.set(connection.id, route
      ? { key, status: 'ready', ...route }
      : { key, status: 'unavailable' });
    scheduleRouteRender();
  });
  return pending;
}

function formatDrivingMetric(info) {
  // 两端尚未选择地点时不显示驾车信息，但连线本身仍应正常绘制并可删除。
  if (!info) return null;
  if (info.status === 'pending') return '🚗 正在计算驾车路线…';
  if (info.status !== 'ready') return null;
  const distance = info.distance >= 1000
    ? `${(info.distance / 1000).toFixed(info.distance >= 10000 ? 0 : 1)} km`
    : `${Math.round(info.distance)} m`;
  const minutes = Math.max(1, Math.round(info.duration / 60));
  const duration = minutes >= 60
    ? `${Math.floor(minutes / 60)} 小时 ${minutes % 60 ? `${minutes % 60} 分` : ''}`
    : `${minutes} 分`;
  return `🚗 ${distance} · ${duration}`;
}

function appendDrivingMetricBadge(svg, geometry, label) {
  const width = Math.max(100, label.length * 7 + 16);
  const x = Math.max(4, Math.min(geometry.labelX - width / 2, timeline.clientWidth - width - 4));
  const y = geometry.labelY + 10;
  const badge = document.createElementNS(SVG_NAMESPACE, 'g');
  badge.classList.add('route-metric-badge');
  const background = document.createElementNS(SVG_NAMESPACE, 'rect');
  background.setAttribute('x', x);
  background.setAttribute('y', y);
  background.setAttribute('width', width);
  background.setAttribute('height', '20');
  background.setAttribute('rx', '10');
  const text = document.createElementNS(SVG_NAMESPACE, 'text');
  text.setAttribute('x', x + width / 2);
  text.setAttribute('y', y + 14);
  text.textContent = label;
  badge.append(background, text);
  svg.append(badge);
}

function resetRouteLayer(svg) {
  svg.replaceChildren();
  const defs = document.createElementNS(SVG_NAMESPACE, 'defs');
  const marker = document.createElementNS(SVG_NAMESPACE, 'marker');
  marker.id = 'route-arrowhead';
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '6');
  marker.setAttribute('markerHeight', '6');
  marker.setAttribute('orient', 'auto-start-reverse');
  const arrow = document.createElementNS(SVG_NAMESPACE, 'path');
  arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  arrow.setAttribute('fill', '#255f4d');
  marker.append(arrow);
  defs.append(marker);
  svg.append(defs);
}

function normalizeRoutePort(port, fallback) {
  return CARD_ROUTE_PORTS.includes(port) ? port : fallback;
}

function routePortVector(port) {
  return {
    top: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    bottom: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
  }[normalizeRoutePort(port, 'bottom')];
}

function cardRoutePortPoint(card, port, timelineRect) {
  const rect = card.getBoundingClientRect();
  const points = {
    top: { x: rect.left + rect.width / 2, y: rect.top },
    right: { x: rect.right, y: rect.top + rect.height / 2 },
    bottom: { x: rect.left + rect.width / 2, y: rect.bottom },
    left: { x: rect.left, y: rect.top + rect.height / 2 },
  };
  const point = points[normalizeRoutePort(port, 'bottom')];
  return {
    x: (point.x - timelineRect.left) / canvasZoom,
    y: (point.y - timelineRect.top) / canvasZoom,
  };
}

function nearestRoutePortForPoint(card, clientX, clientY) {
  const rect = card.getBoundingClientRect();
  const distances = {
    top: Math.abs(clientY - rect.top),
    right: Math.abs(clientX - rect.right),
    bottom: Math.abs(clientY - rect.bottom),
    left: Math.abs(clientX - rect.left),
  };
  return CARD_ROUTE_PORTS.reduce((nearest, port) => (
    distances[port] < distances[nearest] ? port : nearest
  ), 'top');
}

function routeGeometryBetween(sourceCard, targetCard, timelineRect, fanIndex = 0, fromPort = 'bottom', toPort = 'top') {
  const normalizedFromPort = normalizeRoutePort(fromPort, 'bottom');
  const normalizedToPort = normalizeRoutePort(toPort, 'top');
  const start = cardRoutePortPoint(sourceCard, normalizedFromPort, timelineRect);
  const end = cardRoutePortPoint(targetCard, normalizedToPort, timelineRect);
  const sourceVector = routePortVector(normalizedFromPort);
  const targetVector = routePortVector(normalizedToPort);
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const distance = Math.hypot(deltaX, deltaY);
  const handleLength = Math.min(120, Math.max(10, distance * 0.38));
  const fanMagnitude = fanIndex * Math.min(12, Math.max(4, distance * 0.08));
  const normal = distance ? { x: -deltaY / distance, y: deltaX / distance } : { x: 0, y: 0 };
  const fanX = normal.x * fanMagnitude;
  const fanY = normal.y * fanMagnitude;
  const controlOne = {
    x: start.x + sourceVector.x * handleLength + fanX,
    y: start.y + sourceVector.y * handleLength + fanY,
  };
  const controlTwo = {
    x: end.x + targetVector.x * handleLength + fanX,
    y: end.y + targetVector.y * handleLength + fanY,
  };

  return {
    d: `M ${start.x} ${start.y} C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${end.x} ${end.y}`,
    labelX: (start.x + 3 * controlOne.x + 3 * controlTwo.x + end.x) / 8,
    labelY: (start.y + 3 * controlOne.y + 3 * controlTwo.y + end.y) / 8,
  };
}

function connectionVoterNames(connection) {
  return Object.entries(connection.votes || {}).map(([voterId, voter]) => (
    typeof voter === 'string' ? voter : voter?.name || voterId
  ));
}

function voteForConnection(connectionId) {
  try {
    store.voteConnection({ connectionId, voter: editor });
    render();
  } catch (error) {
    showNotification(error.message);
  }
}

function removeTimelineConnection(connectionId) {
  try {
    store.disconnectTimelineItems({ connectionId, editor });
    render();
  } catch (error) {
    showNotification(error.message);
  }
}

function renderRouteLines() {
  const svg = document.getElementById('route-lines');
  if (!svg || !svg.isConnected) return;
  const timelineRect = timeline.getBoundingClientRect();
  if (!timelineRect.width || !timelineRect.height) return;

  svg.setAttribute('viewBox', `0 0 ${timeline.clientWidth} ${timeline.clientHeight}`);
  resetRouteLayer(svg);
  const outgoingIndex = new Map();
  const snapshot = store.snapshot();
  const timelineById = new Map(snapshot.timeline.map(item => [item.id, item]));

  snapshot.connections.forEach((connection) => {
    const sourceCard = timeline.querySelector(`[data-timeline-id="${CSS.escape(connection.fromTimelineId)}"]`);
    const targetCard = timeline.querySelector(`[data-timeline-id="${CSS.escape(connection.toTimelineId)}"]`);
    if (!sourceCard || !targetCard) return;

    const fanIndex = outgoingIndex.get(connection.fromTimelineId) || 0;
    outgoingIndex.set(connection.fromTimelineId, fanIndex + 1);
    const geometry = routeGeometryBetween(
      sourceCard,
      targetCard,
      timelineRect,
      fanIndex,
      connection.fromPort || 'bottom',
      connection.toPort || 'top',
    );

    const hitPath = document.createElementNS(SVG_NAMESPACE, 'path');
    hitPath.classList.add('route-line-hit');
    hitPath.dataset.connectionId = connection.id;
    hitPath.setAttribute('d', geometry.d);
    hitPath.addEventListener('click', () => voteForConnection(connection.id));
    svg.append(hitPath);

    const path = document.createElementNS(SVG_NAMESPACE, 'path');
    path.classList.add('route-line');
    path.dataset.connectionId = connection.id;
    path.setAttribute('d', geometry.d);
    path.setAttribute('marker-end', 'url(#route-arrowhead)');
    const title = document.createElementNS(SVG_NAMESPACE, 'title');
    title.textContent = `${timelineById.get(connection.fromTimelineId)?.name || '上一站'} → ${timelineById.get(connection.toTimelineId)?.name || '下一站'}`;
    path.append(title);
    svg.append(path);

    const drivingMetric = formatDrivingMetric(drivingInfoForConnection(
      connection,
      timelineById.get(connection.fromTimelineId),
      timelineById.get(connection.toTimelineId),
    ));
    if (drivingMetric) appendDrivingMetricBadge(svg, geometry, drivingMetric);

    const voterNames = connectionVoterNames(connection);
    const visibleNames = voterNames.slice(0, 3);
    // 没有人投票时也保留显式入口；投票后同一位置直接展示投票人。
    const label = voterNames.length
      ? `${visibleNames.join('、')}${voterNames.length > 3 ? ` +${voterNames.length - 3}` : ''}`
      : '投票';
    const voterBadgeWidth = Math.max(42, label.length * 11 + 14);
    const preferredX = geometry.labelX - voterBadgeWidth / 2;
    const badgeX = Math.max(4, Math.min(preferredX, timeline.clientWidth - voterBadgeWidth - 4));
    const badgeY = geometry.labelY - 10;
    const badge = document.createElementNS(SVG_NAMESPACE, 'g');
    badge.classList.add('route-voter-badge');
    if (!voterNames.length) badge.classList.add('route-vote-cta');
    badge.dataset.connectionId = connection.id;
    badge.setAttribute('role', 'button');
    badge.setAttribute('tabindex', '0');
    badge.setAttribute('aria-label', voterNames.length
      ? `${label} 投给这条路线；点击修改投票`
      : '投给这条下一站路线');
    const badgeTitle = document.createElementNS(SVG_NAMESPACE, 'title');
    badgeTitle.textContent = voterNames.length ? '点击修改投票' : '点击投票给这条路线';
    const background = document.createElementNS(SVG_NAMESPACE, 'rect');
    background.setAttribute('x', badgeX);
    background.setAttribute('y', badgeY);
    background.setAttribute('width', voterBadgeWidth);
    background.setAttribute('height', '20');
    background.setAttribute('rx', '10');
    const text = document.createElementNS(SVG_NAMESPACE, 'text');
    text.setAttribute('x', badgeX + 7);
    text.setAttribute('y', badgeY + 14);
    text.textContent = label;
    badge.append(badgeTitle, background, text);
    badge.addEventListener('click', () => voteForConnection(connection.id));
    badge.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') voteForConnection(connection.id);
    });
    svg.append(badge);

    const removeControl = document.createElementNS(SVG_NAMESPACE, 'g');
    // 删除按钮始终放在连线中部标记右侧，给触控板和缩放场景留出足够的点击面积。
    const removeX = Math.max(14, Math.min(timeline.clientWidth - 14, geometry.labelX + voterBadgeWidth / 2 + 18));
    const removeY = geometry.labelY;
    removeControl.classList.add('route-remove-control');
    removeControl.dataset.connectionId = connection.id;
    removeControl.setAttribute('role', 'button');
    removeControl.setAttribute('tabindex', '0');
    removeControl.setAttribute('aria-label', `取消 ${title.textContent} 的连接`);
    const removeTitle = document.createElementNS(SVG_NAMESPACE, 'title');
    removeTitle.textContent = '删除这条连接';
    const removeCircle = document.createElementNS(SVG_NAMESPACE, 'circle');
    removeCircle.setAttribute('cx', removeX);
    removeCircle.setAttribute('cy', removeY);
    removeCircle.setAttribute('r', '12');
    const removeText = document.createElementNS(SVG_NAMESPACE, 'text');
    removeText.setAttribute('x', removeX);
    removeText.setAttribute('y', removeY + 5);
    removeText.textContent = '×';
    removeControl.append(removeTitle, removeCircle, removeText);
    removeControl.addEventListener('click', () => removeTimelineConnection(connection.id));
    removeControl.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') removeTimelineConnection(connection.id);
    });
    svg.append(removeControl);
  });
}

// #10 路线预览实时数据徽章
let routePreviewBadge = null;
function updateRoutePreviewBadge(targetCard, sourceCard) {
  // 移除旧徽章
  if (routePreviewBadge) {
    routePreviewBadge.remove();
    routePreviewBadge = null;
  }
  if (!targetCard || !sourceCard) return;

  const timeline = document.getElementById('timeline');
  if (!timeline) return;

  const sourceItem = store.snapshot().timeline.find(t => t.id === sourceCard.dataset.timelineId);
  const targetItem = store.snapshot().timeline.find(t => t.id === targetCard.dataset.timelineId);
  if (!sourceItem?.lat || !targetItem?.lat) return;

  // 获取高德步行路线数据
  getWalkingRoute(sourceItem, targetItem).then(route => {
    if (!routePreviewBadge) return; // 已被移除
    const dist = route ? formatHikingDistance(route.distance) : '—';
    const dur = route ? formatHikingDuration(route.duration) : '—';
    routePreviewBadge.textContent = `${dist} · ${dur}`;
  });

  // 创建徽章
  routePreviewBadge = document.createElement('div');
  routePreviewBadge.className = 'route-preview-badge';
  routePreviewBadge.textContent = '计算中…';
  const targetRect = targetCard.getBoundingClientRect();
  const timelineRect = timeline.getBoundingClientRect();
  routePreviewBadge.style.left = `${(targetRect.left - timelineRect.left) / canvasZoom + targetRect.width / (2 * canvasZoom)}px`;
  routePreviewBadge.style.top = `${(targetRect.top - timelineRect.top) / canvasZoom - 28}px`;
  timeline.appendChild(routePreviewBadge);
}

// 下一站连线拖拽：A → B 表示玩完 A 后接着去 B，可一对多。
(function initRouteConnector() {
  const svg = document.getElementById('route-lines');
  if (!svg) return;

  let dragging = false;
  let sourceCard = null;
  let sourceId = null;
  let sourcePort = null;
  let previewPath = null;
  let hoveredTargetCard = null;

  document.addEventListener('mousedown', (e) => {
    const connector = e.target.closest('.route-connector');
    if (!connector || e.button !== 0) return;
    const card = connector.closest('.timeline-card');
    if (!card) return;
    const item = store.snapshot().timeline.find(t => t.id === card.dataset.timelineId);
    if (!item || item.branchGroup) return;

    dragging = true;
    sourceCard = card;
    sourceId = item.id;
    sourcePort = normalizeRoutePort(connector.dataset.routePort, 'bottom');
    hoveredTargetCard = null;
    timeline.classList.add('is-connecting');
    connector.classList.add('is-active');

    const timelineRect = document.getElementById('timeline').getBoundingClientRect();
    const start = cardRoutePortPoint(card, sourcePort, timelineRect);

    renderRouteLines();
    svg.style.display = '';
    previewPath = document.createElementNS(SVG_NAMESPACE, 'path');
    previewPath.classList.add('route-line', 'route-line-preview');
    previewPath.dataset.startX = start.x;
    previewPath.dataset.startY = start.y;
    previewPath.setAttribute('d', `M ${start.x} ${start.y} L ${start.x} ${start.y}`);
    previewPath.setAttribute('marker-end', 'url(#route-arrowhead)');
    svg.append(previewPath);
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!dragging || !previewPath) return;
    // mouseup 有时会命中 SVG 覆盖层；记录最后一个真实悬停的卡片，保证能连续拉出多条线。
    const moveTarget = e.target instanceof Element ? e.target : null;
    const hoveredCard = moveTarget?.closest('.timeline-card');
    hoveredTargetCard = hoveredCard && hoveredCard !== sourceCard ? hoveredCard : null;
    const timelineRect = document.getElementById('timeline').getBoundingClientRect();
    const x = (e.clientX - timelineRect.left) / canvasZoom;
    const y = (e.clientY - timelineRect.top) / canvasZoom;
    const startX = Number(previewPath.dataset.startX);
    const startY = Number(previewPath.dataset.startY);
    const vector = routePortVector(sourcePort);
    const distance = Math.hypot(x - startX, y - startY);
    const handleLength = Math.min(100, Math.max(10, distance * 0.38));
    previewPath.setAttribute('d', `M ${startX} ${startY} C ${startX + vector.x * handleLength} ${startY + vector.y * handleLength}, ${x} ${y}, ${x} ${y}`);

    // #10 路线预览实时数据：悬停目标卡片时显示距离和时间
    updateRoutePreviewBadge(hoveredTargetCard, sourceCard);
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    previewPath?.remove();
    // 清除路线预览徽章
    if (routePreviewBadge) { routePreviewBadge.remove(); routePreviewBadge = null; }
    timeline.classList.remove('is-connecting');
    sourceCard?.querySelector(`[data-route-port="${sourcePort}"]`)?.classList.remove('is-active');

    // 缩放画布下，elementFromPoint 的坐标换算偶尔会偏移；优先采用 mouseup 实际命中的元素。
    const eventTarget = e.target instanceof Element ? e.target : null;
    const pointTarget = document.elementFromPoint(e.clientX, e.clientY);
    const targetConnector = eventTarget?.closest('.route-connector')
      || pointTarget?.closest('.route-connector');
    const targetCard = eventTarget?.closest('.timeline-card')
      || pointTarget?.closest('.timeline-card')
      || hoveredTargetCard;
    if (targetCard && targetCard !== sourceCard) {
      const targetItem = store.snapshot().timeline.find(t => t.id === targetCard.dataset.timelineId);
      if (targetItem && !targetItem.branchGroup) {
        try {
          store.connectTimelineItems({
            fromTimelineId: sourceId,
            toTimelineId: targetItem.id,
            fromPort: sourcePort,
            // 命中圆点时使用指定边；落在目标卡片任意位置时自动选择最近边，方便继续添加多条出线。
            toPort: targetConnector
              ? normalizeRoutePort(targetConnector.dataset.routePort, 'top')
              : nearestRoutePortForPoint(targetCard, e.clientX, e.clientY),
            editor,
          });
          render();
        } catch (error) {
          const message = error.message === 'Timeline connection already exists'
            ? '这条下一站连线已经存在'
            : error.message === 'Timeline connection would create a cycle'
              ? '这条连线会形成循环路线'
              : error.message;
          showNotification(message);
          scheduleRouteRender();
        }
      }
    } else {
      scheduleRouteRender();
    }
    sourceCard = null;
    sourceId = null;
    sourcePort = null;
    previewPath = null;
    hoveredTargetCard = null;
  });
})();

window.addEventListener('resize', scheduleRouteRender, { passive: true });

document.querySelector('#search-blocks').addEventListener('input', (event) => renderLibrary(event.target.value));
document.querySelector('#invite-button').addEventListener('click', () => document.querySelector('#invite-dialog').showModal());
document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog')?.close());
});
const travelDetailDialog = document.getElementById('travel-detail-dialog');
travelDetailDialog?.addEventListener('click', event => {
  const rect = travelDetailDialog.getBoundingClientRect();
  const clickedBackdrop = event.clientX < rect.left || event.clientX > rect.right
    || event.clientY < rect.top || event.clientY > rect.bottom;
  if (clickedBackdrop) travelDetailDialog.close();
});
document.getElementById('confirm-move-day')?.addEventListener('click', () => {
  const dialog = document.getElementById('move-day-dialog');
  const timelineId = dialog.dataset.timelineId;
  const day = Number(document.getElementById('move-day-select').value);
  if (!timelineId || !Number.isInteger(day)) return;
  store.moveTimelineItem({ timelineId, day, editor });
  dialog.close();
  render();
});
document.querySelector('#reload-conflict').addEventListener('click', () => window.location.reload());
document.querySelector('#overwrite-conflict').addEventListener('click', async () => {
  try {
    await overwriteRemoteProject();
  } catch (error) {
    console.error('Project overwrite failed:', error);
    alert('覆盖保存失败，请稍后重试。');
  }
});
document.querySelector('#copy-invite').addEventListener('click', async (event) => {
  await navigator.clipboard?.writeText('travel-together/diannan-oct');
  event.target.textContent = '已复制';
});
document.querySelector('#share-button').addEventListener('click', () => document.querySelector('#invite-dialog').showModal());

// 视图切换：时间线 / 地图
document.querySelectorAll('.view-switch button[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
// 添加旅行块对话框
let pendingImageData = null;

document.querySelector('#add-block').addEventListener('click', () => {
  pendingImageData = null;
  document.getElementById('add-block-form').reset();
  document.getElementById('image-preview').innerHTML = '';
  document.getElementById('add-block-dialog').showModal();
});

// #14 移动端底部快捷添加按钮
document.querySelector('#mobile-fab')?.addEventListener('click', () => {
  if (isHikingProject()) {
    // 徒步路线：打开添加打卡点
    pickHikingEndpoint('start');
  } else {
    // 行程模式：打开第一个天的 add-slot 对话框
    const firstDay = days[0]?.id || 1;
    openAddSlotDialog(firstDay);
  }
});

document.querySelector('#add-block-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('block-name').value.trim();
  const imageUrl = document.getElementById('block-image').value.trim();
  const category = document.getElementById('block-category').value;
  const price = document.getElementById('block-price').value.trim();
  const description = document.getElementById('block-description').value.trim();
  const image = pendingImageData || imageUrl || 'diannan-images/spots/建水古城.jpg';

  if (!name) {
    alert('请填写名称');
    return;
  }

  store.createTravelBlock({ name, image, category, price, description, editor });
  render();
  renderLibrary(document.querySelector('#search-blocks').value);
  document.getElementById('add-block-dialog').close();
  pendingImageData = null;
});

// 图片文件上传预览
document.getElementById('block-image-file').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    pendingImageData = ev.target.result;
    document.getElementById('block-image').value = '';
    document.getElementById('image-preview').innerHTML =
      `<img src="${pendingImageData}" alt="预览" style="max-width:100%;max-height:120px;border-radius:6px;margin-top:6px;">`;
  };
  reader.readAsDataURL(file);
});

document.getElementById('block-image').addEventListener('input', (e) => {
  const url = e.target.value.trim();
  if (url && !pendingImageData) {
    const preview = document.getElementById('image-preview');
    const img = document.createElement('img');
    img.src = url;
    img.alt = '预览';
    img.style.cssText = 'max-width:100%;max-height:120px;border-radius:6px;margin-top:6px;';
    img.onerror = () => { preview.innerHTML = '<span style="color:var(--terracotta)">图片加载失败</span>'; };
    preview.innerHTML = '';
    preview.appendChild(img);
  } else if (!url) {
    document.getElementById('image-preview').innerHTML = '';
  }
});
window.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
  const target = event.target;
  if (target instanceof HTMLElement && target.matches('input, textarea, [contenteditable="true"]')) return;

  const key = event.key.toLowerCase();
  const shouldRedo = key === 'y' || (key === 'z' && event.shiftKey);
  const shouldUndo = key === 'z' && !event.shiftKey;
  if (!shouldUndo && !shouldRedo) return;

  event.preventDefault();
  const changed = shouldRedo ? store.redo() : store.undo();
  if (changed) render();
});
window.addEventListener('pagehide', () => {
  if (autosaveEnabled) projectAutosave.flush().catch((error) => console.error('Project autosave failed:', error));
});

// 通知系统
let notificationPanel = null;
let notificationBadge = null;
let notificationList = null;

function initNotifications() {
  notificationPanel = document.getElementById('notification-panel');
  notificationBadge = document.getElementById('notification-badge');
  notificationList = document.getElementById('notification-list');
  
  const notificationBtn = document.getElementById('notification-btn');
  const markAllReadBtn = document.getElementById('mark-all-read');
  const settingsButton = document.getElementById('notification-settings');
  const settingsDialog = document.getElementById('notification-settings-dialog');
  const settingsForm = document.getElementById('notification-settings-form');
  
  // 切换通知面板显示
  notificationBtn.addEventListener('click', () => {
    if (notificationPanel.style.display === 'none') {
      notificationPanel.style.display = 'block';
      loadNotifications();
    } else {
      notificationPanel.style.display = 'none';
    }
  });
  
  // 全部标记已读
  markAllReadBtn.addEventListener('click', markAllAsRead);

  // 打开并加载通知偏好。
  settingsButton.addEventListener('click', async () => {
    await loadNotificationPreferences(settingsForm);
    settingsDialog.showModal();
  });

  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const preferences = Object.fromEntries(
      ['mentions', 'polls', 'system'].map((key) => [key, settingsForm.elements[key].checked])
    );
    const saved = await saveNotificationPreferences(preferences);
    if (saved) {
      settingsDialog.close();
      showNotification('通知设置已保存');
    }
  });
  
  // 点击页面其他区域关闭通知面板
  document.addEventListener('click', (e) => {
    if (!notificationPanel.contains(e.target) && !notificationBtn.contains(e.target)) {
      notificationPanel.style.display = 'none';
    }
  });
  
  // 获取未读通知数量
  updateNotificationBadge();
  
  // 监听 WebSocket 通知
  if (realtimeClient && realtimeClient.socket) {
    realtimeClient.socket.on('notification', (data) => {
      updateNotificationBadge();
      if (notificationPanel.style.display === 'block') {
        loadNotifications();
      }
    });
  }
}

async function loadNotificationPreferences(form) {
  try {
    const response = await fetch(`${api.API_BASE}/api/notification-preferences`, { credentials: 'include' });
    if (!response.ok) throw new Error('获取通知设置失败');
    const { preferences } = await response.json();
    for (const key of ['mentions', 'polls', 'system']) {
      form.elements[key].checked = preferences[key] !== false;
    }
  } catch (error) {
    console.error('Failed to load notification preferences:', error);
    showNotification('无法加载通知设置');
  }
}

async function saveNotificationPreferences(preferences) {
  try {
    const response = await fetch(`${api.API_BASE}/api/notification-preferences`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ preferences }),
    });
    if (!response.ok) throw new Error('保存通知设置失败');
    return await response.json();
  } catch (error) {
    console.error('Failed to save notification preferences:', error);
    showNotification('保存通知设置失败');
    return null;
  }
}

async function updateNotificationBadge() {
  try {
    const response = await fetch(`${api.API_BASE}/api/notifications/unread-count`, {
      credentials: 'include'
    });
    
    if (response.ok) {
      const data = await response.json();
      const count = data.count || 0;
      
      if (count > 0) {
        notificationBadge.textContent = count > 99 ? '99+' : count;
        notificationBadge.style.display = 'block';
      } else {
        notificationBadge.style.display = 'none';
      }
    }
  } catch (error) {
    console.error('Failed to update notification badge:', error);
  }
}

async function loadNotifications() {
  try {
    const response = await fetch(`${api.API_BASE}/api/notifications`, {
      credentials: 'include'
    });
    
    if (response.ok) {
      const notifications = await response.json();
      renderNotifications(notifications);
    }
  } catch (error) {
    console.error('Failed to load notifications:', error);
  }
}

function renderNotifications(notifications) {
  if (!notifications || notifications.length === 0) {
    notificationList.innerHTML = '<div class="notification-empty">暂无通知</div>';
    return;
  }
  
  notificationList.innerHTML = notifications.map(notif => `
    <div class="notification-item ${notif.read ? '' : 'unread'}" data-id="${notif.id}">
      <div class="notification-title">${escapeHtml(notif.title)}</div>
      <div class="notification-message">${escapeHtml(notif.message)}</div>
      <div class="notification-time">${formatTime(notif.createdAt)}</div>
    </div>
  `).join('');
  
  // 绑定点击事件
  notificationList.querySelectorAll('.notification-item').forEach(item => {
    item.addEventListener('click', () => {
      const notifId = item.dataset.id;
      markAsRead(notifId);
    });
  });
}

async function markAsRead(notifId) {
  try {
    const response = await fetch(`${api.API_BASE}/api/notifications/${notifId}/read`, {
      method: 'POST',
      credentials: 'include'
    });
    
    if (response.ok) {
      // 更新 UI
      const item = notificationList.querySelector(`[data-id="${notifId}"]`);
      if (item) {
        item.classList.remove('unread');
      }
      
      // 更新徽章
      updateNotificationBadge();
    }
  } catch (error) {
    console.error('Failed to mark notification as read:', error);
  }
}

async function markAllAsRead() {
  try {
    const response = await fetch(`${api.API_BASE}/api/notifications/read-all`, {
      method: 'POST',
      credentials: 'include'
    });
    
    if (response.ok) {
      // 更新 UI
      notificationList.querySelectorAll('.notification-item').forEach(item => {
        item.classList.remove('unread');
      });
      
      // 更新徽章
      updateNotificationBadge();
    }
  } catch (error) {
    console.error('Failed to mark all notifications as read:', error);
  }
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) { // 1 分钟内
    return '刚刚';
  } else if (diff < 3600000) { // 1 小时内
    return `${Math.floor(diff / 60000)} 分钟前`;
  } else if (diff < 86400000) { // 24 小时内
    return `${Math.floor(diff / 3600000)} 小时前`;
  } else if (diff < 604800000) { // 7 天内
    return `${Math.floor(diff / 86400000)} 天前`;
  } else {
    return date.toLocaleDateString('zh-CN');
  }
}

initCanvasControls();
renderLibrary();
render();
