import { createTripStore } from './src/trip-store.mjs';
import { travelBlocks } from './src/travel-blocks.mjs';

const days = [
  { id: 1, label: '10.01', title: '建水 · 古城慢游' },
  { id: 2, label: '10.02', title: '建水 → 元阳' },
  { id: 3, label: '10.03', title: '元阳 · 梯田日出' },
  { id: 4, label: '10.04', title: '蒙自 · 碧色寨' },
  { id: 5, label: '10.05', title: '普者黑 · 山水' },
];

const editor = { id: 'feng', name: 'feng' };
const store = createTripStore();
const storeIds = new Map();
const timeline = document.querySelector('#timeline');
const library = document.querySelector('#block-library');
const activityList = document.querySelector('#activity-list');
const aiSourceInput = document.querySelector('#ai-source');
const aiDrafts = document.querySelector('#ai-drafts');
let draggedBlockId = null;

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

function timelineItemsFor(day) {
  return store.snapshot().timeline
    .filter((item) => item.day === day)
    .sort((a, b) => a.time.localeCompare(b.time));
}

function createTimelineCard(item) {
  const card = document.createElement('article');
  card.className = 'timeline-card';
  card.dataset.timelineId = item.id;
  card.innerHTML = `
    <img src="${item.image}" alt="${item.name}">
    <input aria-label="${item.name} 的时间" type="time" value="${item.time}">
    <div>
      <div class="name">${item.name}</div>
      <input class="note" aria-label="${item.name} 的备注" value="${item.note}" placeholder="添加同行备注">
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
  return card;
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

function render() {
  renderTimeline();
  renderActivity();
  renderAiDrafts();
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

renderLibrary();
render();
