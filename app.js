import { createTripStore } from './src/trip-store.mjs';
import { travelBlocks } from './src/travel-blocks.mjs';
import * as api from './src/api-client.mjs';
import { createProjectAutosave } from './src/project-autosave.mjs';

// 获取当前项目
const currentProjectId = localStorage.getItem('currentProjectId');
let currentProject = null;
let autosaveEnabled = false;

const projectAutosave = createProjectAutosave({
  delay: 500,
  save: async (data) => {
    if (!currentProjectId) return;
    const updatedProject = await api.updateProject(currentProjectId, { data });
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
    
    // 恢复时间线
    timeline.forEach(item => {
      const block = store.snapshot().blocks.find(b => b.name === item.name);
      if (block) {
        store.scheduleBlock({ 
          blockId: block.id, 
          day: item.day, 
          time: item.time, 
          editor: item.editor || editor 
        });
      }
    });
    
    // 恢复投票
    polls.forEach(poll => {
      const timelineItem = store.snapshot().timeline.find(t => t.name === poll.timelineItemName);
      if (timelineItem) {
        const createdPoll = store.createPoll({ 
          question: poll.question, 
          timelineItemId: timelineItem.id, 
          creator: poll.creator 
        });
        // 恢复投票
        Object.entries(poll.votes).forEach(([voterId, choice]) => {
          store.vote({ pollId: createdPoll.id, voter: { id: voterId, name: voterId }, choice });
        });
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
}

// 启动初始化
init();

function saveProjectData() {
  projectAutosave.schedule(store.snapshot());
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
  
  card.innerHTML = `
    <img src="${item.image}" alt="${item.name}">
    <input aria-label="${item.name} 的时间" type="time" value="${item.time}">
    <div>
      <div class="name">${item.name}</div>
      <input class="note" aria-label="${item.name} 的备注" value="${item.note}" placeholder="添加同行备注">
      <div class="poll-section">${pollHtml}</div>
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
      if (question) {
        store.createPoll({ question, timelineItemId: item.id, creator: editor });
        render();
      }
    });
  }
  
  card.querySelectorAll('.vote-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const pollId = btn.dataset.pollId;
      const choice = btn.dataset.choice;
      store.vote({ pollId, voter: editor, choice });
      render();
    });
  });
  
  return card;
}

function renderPollCard(poll) {
  const results = store.getPollResults(poll.id);
  const userVote = poll.votes[editor.id];
  const total = results.total || 1;
  const yesPercent = Math.round((results.yes / total) * 100);
  const noPercent = Math.round((results.no / total) * 100);
  
  return `
    <div class="poll-card" data-poll-id="${poll.id}">
      <div class="poll-question">${poll.question}</div>
      <div class="poll-options">
        <button class="vote-btn ${userVote === 'yes' ? 'voted' : ''}" data-poll-id="${poll.id}" data-choice="yes">
          👍 ${results.yes} (${yesPercent}%)
        </button>
        <button class="vote-btn ${userVote === 'no' ? 'voted' : ''}" data-poll-id="${poll.id}" data-choice="no">
          👎 ${results.no} (${noPercent}%)
        </button>
      </div>
      <div class="poll-total">共 ${results.total} 人投票</div>
    </div>
  `;
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
  if (persist) saveProjectData();
}

document.querySelector('#search-blocks').addEventListener('input', (event) => renderLibrary(event.target.value));
document.querySelector('#invite-button').addEventListener('click', () => document.querySelector('#invite-dialog').showModal());
document.querySelector('.dialog-close').addEventListener('click', () => document.querySelector('#invite-dialog').close());
document.querySelector('#copy-invite').addEventListener('click', async (event) => {
  await navigator.clipboard?.writeText('travel-together/diannan-oct');
  event.target.textContent = '已复制';
});
document.querySelector('#share-button').addEventListener('click', () => document.querySelector('#invite-dialog').showModal());
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

renderLibrary();
render();
