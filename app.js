import { createTripStore } from './src/trip-store.js';
import { travelBlocks } from './src/travel-blocks.js';
import * as api from './src/api-client.js';
import { createProjectAutosave } from './src/project-autosave.js';
import { findTimeConflicts } from './src/timeline-conflicts.js';
import { realtimeClient } from './src/realtime-client.js';
import { initMap, addMarkers, destroyMap } from './src/map-view.js';
import { openLocationPicker } from './src/location-picker.js';

// 获取当前项目
const currentProjectId = localStorage.getItem('currentProjectId');
let currentProject = null;
let autosaveEnabled = false;
let pendingConflictSnapshot = null;
let currentView = 'timeline'; // 'timeline' | 'map'
let mapViewInitialized = false;

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

// 更新页面标题和项目名称显示
function updateProjectUI() {
  if (!currentProject) return;
  
  document.title = `${currentProject.name} · 协作行程`;
  const projectNameEl = document.querySelector('.trip-switcher strong');
  if (projectNameEl) {
    projectNameEl.textContent = currentProject.name;
  }
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

const editor = { id: 'feng', name: 'feng' };
const store = createTripStore();
const timeline = document.querySelector('#timeline');
const library = document.querySelector('#block-library');
const activityList = document.querySelector('#activity-list');
const aiSourceInput = document.querySelector('#ai-source');
const aiDrafts = document.querySelector('#ai-drafts');
const editConflictDialog = document.querySelector('#edit-conflict-dialog');
let draggedBlockId = null;

// 异步初始化
async function init() {
  const loaded = await loadProject();
  if (!loaded) return;
  
  // 生成天数
  if (currentProject.startDate && currentProject.endDate) {
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
  
  // 从项目数据恢复
  if (currentProject.data && currentProject.data.blocks) {
    const { blocks, timeline, polls, aiDrafts, activity } = currentProject.data;
    
    // 恢复旅行块
    blocks.forEach(block => {
      store.createTravelBlock(block);
    });
    
    // 恢复时间线，并保留旧 ID 到新 ID 的映射以恢复关联投票。
    const timelineIdMap = new Map();
    timeline.forEach(item => {
      const block = store.snapshot().blocks.find(b => b.name === item.name);
      if (block) {
        const createdTimelineItem = store.scheduleBlock({
          blockId: block.id,
          day: item.day,
          time: item.time,
          editor: item.editor || editor
        });
        timelineIdMap.set(item.id, createdTimelineItem.id);
        if (item.note) {
          store.editTimelineItem({ timelineId: createdTimelineItem.id, note: item.note, editor: item.editor || editor });
        }
      }
    });
    
    // 恢复投票
    polls.forEach(poll => {
      const restoredTimelineId = timelineIdMap.get(poll.timelineItemId);
      const timelineItem = store.snapshot().timeline.find((item) => (
        item.id === restoredTimelineId || (!restoredTimelineId && item.name === poll.timelineItemName)
      ));
      if (timelineItem) {
        const createdPoll = store.createPoll({
          question: poll.question,
          timelineItemId: timelineItem.id,
          creator: poll.creator || editor,
          options: poll.options,
          deadlineAt: poll.deadlineAt,
        });
        store.restorePollVotes({ pollId: createdPoll.id, votes: poll.votes || {} });
      }
    });
    
    // 恢复 AI 草案
    aiDrafts.forEach(draft => {
      store.createAiDraft(draft);
    });
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
  
  // 监听远程编辑
  realtimeClient.on('remote_edit', (data) => {
    console.log('收到远程编辑:', data);
    // 重新加载项目数据
    loadProject().then(() => {
      render();
      // 显示操作通知
      showRemoteAction(data);
    });
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
      <span class="user-avatar">${user.name.charAt(0)}</span>
      <span class="user-name">${user.name}</span>
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
    'add_comment': '添加了评论'
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
  projectAutosave.schedule(store.snapshot());
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

function createTimelineCard(item) {
  const card = document.createElement('article');
  card.className = 'timeline-card';
  card.dataset.timelineId = item.id;
  card.draggable = true;
  
  const poll = store.snapshot().polls.find(p => p.timelineItemId === item.id);
  const pollHtml = poll ? renderPollCard(poll) : `<button class="poll-btn" data-timeline-id="${item.id}">发起投票</button>`;
  const timeConflicts = findTimeConflicts(store.snapshot().timeline, item);
  const timeConflictHtml = timeConflicts.length
    ? `<p class="time-conflict" role="alert">时间冲突：${timeConflicts.map((conflict) => conflict.name).join('、')} 也安排在 ${item.time}</p>`
    : '';
  
  const locationInfo = item.lat != null && item.lng != null
    ? `<div class="location-info" title="${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}">📍 ${item.lat.toFixed(3)}, ${item.lng.toFixed(3)}</div>`
    : '';

  card.innerHTML = `
    <img src="${item.image}" alt="${item.name}">
    <input aria-label="${item.name} 的时间" type="time" value="${item.time}">
    <div>
      <div class="name">${item.name}</div>
      <input class="note" aria-label="${item.name} 的备注" value="${item.note}" placeholder="添加同行备注">
      ${locationInfo}
      <button class="pick-location-btn" type="button">📍 选择位置</button>
      ${timeConflictHtml}
      <div class="poll-section">${pollHtml}</div>
      <div class="comments-section" data-timeline-id="${item.id}">
        <div class="comments-list"></div>
        <button class="add-comment-btn" data-timeline-id="${item.id}">💬 添加评论</button>
      </div>
    </div>
    <span class="drag-handle" aria-label="可拖动">⠿</span>
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

  // 渲染评论
  const renderComments = () => {
    const commentsList = card.querySelector('.comments-list');
    const comments = store.getCommentsForTimelineItem(item.id);
    
    if (comments.length === 0) {
      commentsList.innerHTML = '<div class="no-comments">暂无评论</div>';
      return;
    }
    
    commentsList.innerHTML = comments.map(comment => {
      // 高亮 @提及
      const highlightedContent = comment.content.replace(
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

  // Drag and drop for reordering and cross-day moves
  card.addEventListener('dragstart', (event) => {
    event.stopPropagation();
    card.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/timeline-item', item.id);
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.timeline-card.drag-over').forEach(c => c.classList.remove('drag-over'));
  });

  card.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const draggingItem = document.querySelector('.timeline-card.dragging');
    if (draggingItem && draggingItem !== card) {
      card.classList.add('drag-over');
    }
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('drag-over');
  });

  card.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    card.classList.remove('drag-over');

    const draggedItemId = event.dataTransfer.getData('text/timeline-item');
    if (!draggedItemId || draggedItemId === item.id) return;

    // Get the day of the target card
    const targetDay = item.day;

    // Get all items in this day
    const dayItems = timelineItemsFor(targetDay);
    const targetIndex = dayItems.findIndex(i => i.id === item.id);

    if (targetIndex === -1) return;

    // Move the item
    store.moveTimelineItem({ timelineId: draggedItemId, day: targetDay, editor });

    // Reorder
    store.reorderTimeline({ timelineId: draggedItemId, newIndex: targetIndex, day: targetDay, editor });

    render();
  });
  
  const pollBtn = card.querySelector('.poll-btn');
  if (pollBtn) {
    pollBtn.addEventListener('click', () => {
      const question = prompt('投票问题：');
      if (question?.trim()) {
        const rawOptions = prompt('投票选项（用逗号分隔）：', '赞成,反对');
        if (rawOptions === null) return;
        const options = rawOptions.split(',').map((option) => option.trim()).filter(Boolean);
        const rawDeadline = prompt('投票截止时间（YYYY-MM-DD HH:mm，留空表示不截止）：', '');
        if (rawDeadline === null) return;
        const deadlineAt = rawDeadline.trim() ? rawDeadline.trim().replace(' ', 'T') : null;
        try {
          store.createPoll({ question, timelineItemId: item.id, creator: editor, options, deadlineAt });
        } catch (error) {
          alert(error.message);
          return;
        }
        render();
      }
    });
  }
  
  card.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pollId = btn.dataset.pollId;
      const choice = btn.dataset.choice;
      const comment = prompt('添加投票评论（可选）：');
      store.vote({ pollId, voter: editor, choice, comment: comment || undefined });
      render();
    });
  });
  
  return card;
}

function renderPollCard(poll) {
  const results = store.getPollResults(poll.id);
  const userVote = poll.votes[editor.id];
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
    return `
      <div class="poll-option-row">
        <button class="vote-btn ${voted}" data-poll-id="${poll.id}" data-choice="${escapeHtml(option)}" ${pollIsOpen ? '' : 'disabled'}>
          ${escapeHtml(option)}
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderTimeline() {
  timeline.replaceChildren();
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

    for (const item of timelineItemsFor(day.id)) items.append(createTimelineCard(item));

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
      dropZone.focus();
      dropZone.classList.add('drag-over');
    });
    timeline.append(fragment);
  }
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
      element.innerHTML = `
        <img src="${block.image}" alt="${block.name}">
        <div><strong>${block.name}</strong><small>${block.city}</small></div>
        <span class="drag-mark">⠿</span>
      `;
      element.addEventListener('dragstart', (event) => {
        draggedBlockId = block.id;
        element.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/travel-block', block.id);
      });
      element.addEventListener('dragend', () => {
        draggedBlockId = null;
        element.classList.remove('dragging');
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
        : event.type === 'ai.draft.imported'
          ? '审核并导入了 AI 整理的旅行块'
          : '更新了行程备注';
    item.innerHTML = `<strong>${event.editor.name}</strong> ${action}<br><span>刚刚</span>`;
    activityList.append(item);
  });
}

function renderAiDrafts() {
  aiDrafts.replaceChildren();
  const drafts = store.snapshot().aiDrafts.filter((draft) => draft.status === 'draft');
  drafts.forEach((draft) => {
    const element = document.createElement('article');
    element.className = 'ai-draft';
    element.innerHTML = `
      <img src="${draft.image}" alt="${draft.name}">
      <div><strong>${draft.name}</strong><small>来源：${draft.source}</small></div>
      <button>审核导入</button>
    `;
    element.querySelector('button').addEventListener('click', () => {
      store.approveAiDraft({ draftId: draft.id, editor });
      renderLibrary(document.querySelector('#search-blocks').value);
      render();
    });
    aiDrafts.append(element);
  });
}

function render({ persist = autosaveEnabled } = {}) {
  renderTimeline();
  renderActivity();
  renderAiDrafts();
  if (currentView === 'map') renderMapView();
  if (persist) saveProjectData();
}

function switchView(view) {
  currentView = view;
  const timeline = document.getElementById('timeline');
  const mapContainer = document.getElementById('map-container');
  const helper = document.querySelector('.itinerary .helper');
  const viewButtons = document.querySelectorAll('.view-switch button');

  viewButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });

  if (view === 'timeline') {
    timeline.style.display = '';
    mapContainer.style.display = 'none';
    if (helper) helper.style.display = '';
    destroyMap();
    mapViewInitialized = false;
  } else if (view === 'map') {
    timeline.style.display = 'none';
    mapContainer.style.display = '';
    if (helper) helper.style.display = 'none';
    renderMapView();
  }
}

function renderMapView() {
  const mapContainer = document.getElementById('map-container');
  if (!mapContainer) return;

  // 收集所有有坐标的行程项
  const items = store.snapshot().timeline.filter(i => i.lat != null && i.lng != null);

  if (!mapViewInitialized) {
    initMap('map-canvas');
    mapViewInitialized = true;
  }

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
}

document.querySelector('#search-blocks').addEventListener('input', (event) => renderLibrary(event.target.value));
document.querySelector('#invite-button').addEventListener('click', () => document.querySelector('#invite-dialog').showModal());
document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog')?.close());
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
document.querySelector('#add-block').addEventListener('click', () => alert('MVP 下一步：上传图片并创建自定义旅行块。'));
document.querySelector('#ai-import').addEventListener('click', () => {
  const source = aiSourceInput.value.trim();
  if (!source) {
    aiSourceInput.focus();
    return;
  }
  store.createAiDraft({
    name: source.includes('团山') ? '团山民居' : 'AI 提取的滇南灵感',
    image: 'diannan-images/spots/建水古城.jpg',
    source: source.slice(0, 32),
  });
  aiSourceInput.value = '';
  render();
});
document.querySelectorAll('[data-day-link]').forEach((button) => {
  button.addEventListener('click', () => document.querySelector(`#day-${button.dataset.dayLink}`).scrollIntoView({ behavior: 'smooth', block: 'center' }));
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
    const response = await fetch('/api/notification-preferences', { credentials: 'include' });
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
    const response = await fetch('/api/notification-preferences', {
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
    const response = await fetch('/api/notifications/unread-count', {
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
    const response = await fetch('/api/notifications', {
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
    const response = await fetch(`/api/notifications/${notifId}/read`, {
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
    const response = await fetch('/api/notifications/read-all', {
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

renderLibrary();
render();
