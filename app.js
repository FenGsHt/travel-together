import { createTripStore } from './src/trip-store.js';
import { travelBlocks } from './src/travel-blocks.js';
import * as api from './src/api-client.js';
import { createProjectAutosave } from './src/project-autosave.js';
import { findTimeConflicts } from './src/timeline-conflicts.js';
import { realtimeClient } from './src/realtime-client.js';
import { initMap, addMarkers, addRouteLines, addHikingRoute, getDrivingRoute, getWalkingRoute, destroyMap } from './src/map-view.js?v=20260911-hiking-routes';
import { openLocationPicker } from './src/location-picker.js?v=20260909-geocoding-fallback';

// 获取当前项目
const currentProjectId = localStorage.getItem('currentProjectId');
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
    difficulty: '',
    distance: '',
    duration: '',
    start: null,
    end: null,
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

  timeline.style.zoom = String(canvasZoom);
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
    if (event.button !== 0 || isInteractiveTarget(event.target)) return;

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
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setCanvasZoom(canvasZoom + (event.deltaY < 0 ? CANVAS_ZOOM_STEP : -CANVAS_ZOOM_STEP));
  }, { passive: false });

  viewport.addEventListener('keydown', event => {
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
    };
    card.setPointerCapture(event.pointerId);
    card.classList.add('canvas-moving');
    event.preventDefault();
  });

  card.addEventListener('pointermove', event => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const deltaX = (event.clientX - dragState.clientX) / canvasZoom;
    const deltaY = (event.clientY - dragState.clientY) / canvasZoom;
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
  });

  const finishDrag = (event, { cancelled = false } = {}) => {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const { moved, startX, startY } = dragState;
    dragState = null;
    card.classList.remove('canvas-moving');
    if (card.hasPointerCapture(event.pointerId)) card.releasePointerCapture(event.pointerId);
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
    openTimelineItemDetail(item.id);
  };
  card.addEventListener('click', openDetailsFromCard);
  card.addEventListener('keydown', event => {
    if (event.target !== card || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    openTimelineItemDetail(item.id);
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

function updateHikingRoute(patch, { rerender = false } = {}) {
  hikingRoute = { ...createEmptyHikingRoute(), ...hikingRoute, ...patch };
  if (rerender) {
    render();
    return;
  }
  if (currentView === 'map') renderMapView();
  saveProjectData();
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
  const endpoint = (kind, label) => {
    const point = route[kind];
    const value = point
      ? `${point.name || label} · ${Number(point.lat).toFixed(4)}, ${Number(point.lng).toFixed(4)}`
      : `选择${label}`;
    return `<button class="hiking-endpoint" type="button" data-hiking-endpoint="${kind}"><span>${kind === 'start' ? '①' : '②'} ${label}</span><b>${escapeHtml(value)}</b></button>`;
  };
  panel.innerHTML = `
    <div class="hiking-route-heading">
      <div><p class="eyebrow">徒步路线</p><h3>只记录这一整段路</h3></div>
      <button class="button button-ink hiking-map-button" type="button">查看完整路线</button>
    </div>
    <p class="hiking-route-tip">不需要按第几天拆分。选择起终点后，会在地图中生成可查看的徒步轨迹。</p>
    <label class="hiking-field"><span>路线名称</span><input data-hiking-field="name" value="${escapeHtml(route.name)}" placeholder="如：虎跳峡高路徒步" /></label>
    <label class="hiking-field"><span>路线说明</span><textarea data-hiking-field="summary" placeholder="记录天气、补给、危险路段或同行信息">${escapeHtml(route.summary)}</textarea></label>
    <div class="hiking-endpoints">${endpoint('start', '起点')}${endpoint('end', '终点')}</div>
    <div class="hiking-facts">
      <label class="hiking-field"><span>难度</span><input data-hiking-field="difficulty" value="${escapeHtml(route.difficulty)}" placeholder="轻松 / 中等 / 挑战" /></label>
      <label class="hiking-field"><span>全程距离</span><input data-hiking-field="distance" value="${escapeHtml(route.distance)}" placeholder="地图自动计算或手动填写" /></label>
      <label class="hiking-field"><span>预计用时</span><input data-hiking-field="duration" value="${escapeHtml(route.duration)}" placeholder="地图自动计算或手动填写" /></label>
    </div>
  `;
  panel.querySelectorAll('[data-hiking-field]').forEach(field => {
    field.addEventListener('change', () => updateHikingRoute({ [field.dataset.hikingField]: field.value }));
  });
  panel.querySelectorAll('[data-hiking-endpoint]').forEach(button => {
    button.addEventListener('click', () => pickHikingEndpoint(button.dataset.hikingEndpoint));
  });
  panel.querySelector('.hiking-map-button').addEventListener('click', () => switchView('map'));
  return panel;
}

function renderTimeline() {
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
    fragment.querySelector('.add-slot').addEventListener('click', () => {
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
      timeInput.value = '10:00';
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
        store.scheduleBlock({ blockId, day: day.id, time, editor });
        dialog.close();
        render();
      };

      dialog.showModal();
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
    item.innerHTML = `<strong>${escapeHtml(event.editor.name)}</strong> ${action}<br><span>刚刚</span>`;
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
  return ['hiking', route?.name, route?.start?.lat, route?.start?.lng, route?.end?.lat, route?.end?.lng]
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
    addHikingRoute(hikingRoute?.start, hikingRoute?.end);
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
  });

  document.addEventListener('mouseup', (e) => {
    if (!dragging) return;
    dragging = false;
    previewPath?.remove();
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
