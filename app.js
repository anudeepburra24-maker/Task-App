/* =============================================
   TaskFlow – App Logic
   ============================================= */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let tasks          = [];
let activeFilter   = 'all';
let searchQuery    = '';
let sortMode       = 'created';
let editingId      = null;
let reminderTimers = {};    // taskId → setTimeout handle
let pendingReminders = 0;

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const taskList          = document.getElementById('taskList');
const emptyState        = document.getElementById('emptyState');
const modalOverlay      = document.getElementById('modalOverlay');
const taskForm          = document.getElementById('taskForm');
const modalTitle        = document.getElementById('modalTitle');
const openModalBtn      = document.getElementById('openModalBtn');
const closeModalBtn     = document.getElementById('closeModalBtn');
const cancelBtn         = document.getElementById('cancelBtn');
const searchInput       = document.getElementById('searchInput');
const sortSelect        = document.getElementById('sortSelect');
const reminderToggle    = document.getElementById('reminderToggle');
const reminderFields    = document.getElementById('reminderFields');
const reminderPopup     = document.getElementById('reminderPopup');
const reminderPopupClose= document.getElementById('reminderPopupClose');
const reminderPopupTitle= document.getElementById('reminderPopupTitle');
const reminderPopupMsg  = document.getElementById('reminderPopupMsg');
const toastContainer    = document.getElementById('toastContainer');
const notifBadge        = document.getElementById('notifBadge');

// Form fields
const f = {
  id:           () => document.getElementById('taskId'),
  title:        () => document.getElementById('taskTitle'),
  desc:         () => document.getElementById('taskDesc'),
  priority:     () => document.getElementById('taskPriority'),
  due:          () => document.getElementById('taskDue'),
  reminderDate: () => document.getElementById('reminderDate'),
  reminderTime: () => document.getElementById('reminderTime'),
  reminderNote: () => document.getElementById('reminderNote'),
};

// ─── Utilities ────────────────────────────────────────────────────────────────
const uid = () => `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const toDate = (str) => str ? new Date(str) : null;

function formatDate(str) {
  if (!str) return null;
  const d = new Date(str + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(dateStr, timeStr) {
  if (!dateStr || !timeStr) return null;
  const d = new Date(`${dateStr}T${timeStr}`);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
}

function isToday(str) {
  if (!str) return false;
  const d = new Date(str + 'T00:00:00');
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isUpcoming(str) {
  if (!str) return false;
  const d = new Date(str + 'T00:00:00');
  const now = new Date();
  now.setHours(0,0,0,0);
  return d > now;
}

function isOverdue(str) {
  if (!str) return false;
  const d = new Date(str + 'T00:00:00');
  const now = new Date();
  now.setHours(0,0,0,0);
  return d < now;
}

function priorityLabel(p) {
  return { high: '🔴 High', medium: '🟡 Medium', low: '🟢 Low' }[p] || p;
}

function priorityWeight(p) {
  return { high: 3, medium: 2, low: 1 }[p] || 0;
}

// ─── Local Storage ────────────────────────────────────────────────────────────
function saveTasks() {
  localStorage.setItem('taskflow_tasks', JSON.stringify(tasks));
}

function loadTasks() {
  try {
    const raw = localStorage.getItem('taskflow_tasks');
    tasks = raw ? JSON.parse(raw) : [];
  } catch {
    tasks = [];
  }
}

// ─── Notification Permission ──────────────────────────────────────────────────
async function requestNotifPermission() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

// ─── Reminder Scheduling ──────────────────────────────────────────────────────
function scheduleReminder(task) {
  if (!task.reminderEnabled || !task.reminderDate || !task.reminderTime) return;
  if (task.reminderFired || task.completed) return;

  const fireAt = new Date(`${task.reminderDate}T${task.reminderTime}`).getTime();
  const now    = Date.now();
  const delay  = fireAt - now;

  // Clear any existing timer
  if (reminderTimers[task.id]) clearTimeout(reminderTimers[task.id]);

  if (delay <= 0) return; // Already past

  reminderTimers[task.id] = setTimeout(() => {
    fireReminder(task.id);
  }, delay);
}

function fireReminder(taskId) {
  const task = tasks.find(t => t.id === taskId);
  if (!task || task.completed || task.reminderFired) return;

  task.reminderFired = true;
  saveTasks();
  render();

  // In-app popup
  const msg = task.reminderNote || task.title;
  showReminderPopup(task.title, msg);

  // Browser notification
  if (Notification.permission === 'granted') {
    try {
      const n = new Notification(`⏰ TaskFlow Reminder`, {
        body: `${task.title}${task.reminderNote ? '\n' + task.reminderNote : ''}`,
        icon: 'https://api.iconify.design/twemoji/check-mark-button.svg',
        tag: taskId,
      });
      setTimeout(() => n.close(), 8000);
    } catch {}
  }

  // Update badge
  pendingReminders = Math.max(0, pendingReminders - 1);
  updateNotifBadge();
}

function scheduleAll() {
  tasks.forEach(scheduleReminder);
}

function cancelAllTimers() {
  Object.values(reminderTimers).forEach(clearTimeout);
  reminderTimers = {};
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function updateNotifBadge() {
  const upcoming = tasks.filter(t =>
    !t.completed && t.reminderEnabled && !t.reminderFired &&
    t.reminderDate && t.reminderTime &&
    new Date(`${t.reminderDate}T${t.reminderTime}`) > new Date()
  ).length;

  if (upcoming > 0) {
    notifBadge.textContent = upcoming;
    notifBadge.style.display = 'grid';
  } else {
    notifBadge.style.display = 'none';
  }
}

// ─── Reminder Popup ───────────────────────────────────────────────────────────
function showReminderPopup(title, msg) {
  reminderPopupTitle.textContent = `Reminder: ${title}`;
  reminderPopupMsg.textContent   = msg;
  reminderPopup.style.display    = 'block';
}

reminderPopupClose.addEventListener('click', () => {
  reminderPopup.style.display = 'none';
});

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info') {
  const icons = {
    success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info:    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `${icons[type] || ''}<span>${message}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 350);
  }, 3200);
}

// ─── Counts & Sidebar ─────────────────────────────────────────────────────────
function updateCounts() {
  const today = tasks.filter(t => !t.completed && isToday(t.due));
  const upcoming = tasks.filter(t => !t.completed && isUpcoming(t.due) && !isToday(t.due));
  const completed = tasks.filter(t => t.completed);
  const high   = tasks.filter(t => !t.completed && t.priority === 'high');
  const medium = tasks.filter(t => !t.completed && t.priority === 'medium');
  const low    = tasks.filter(t => !t.completed && t.priority === 'low');

  document.getElementById('countAll').textContent       = tasks.length;
  document.getElementById('countToday').textContent     = today.length;
  document.getElementById('countUpcoming').textContent  = upcoming.length;
  document.getElementById('countCompleted').textContent = completed.length;
  document.getElementById('countHigh').textContent      = high.length;
  document.getElementById('countMedium').textContent    = medium.length;
  document.getElementById('countLow').textContent       = low.length;
}

// ─── Progress Ring ────────────────────────────────────────────────────────────
function updateProgress() {
  const todayTasks = tasks.filter(t => isToday(t.due) || isToday(t.createdAt?.split('T')[0]));
  const done = todayTasks.filter(t => t.completed).length;
  const total = todayTasks.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  const circle = document.getElementById('progressRing');
  const circumference = 201.06;
  const offset = circumference - (pct / 100) * circumference;
  circle.style.strokeDashoffset = offset;

  document.getElementById('progressPercent').textContent = `${pct}%`;
  document.getElementById('progressSub').textContent     = `${done} of ${total} tasks done`;
}

// ─── Filter Tasks ─────────────────────────────────────────────────────────────
function getFilteredTasks() {
  let result = [...tasks];

  // Filter
  switch (activeFilter) {
    case 'today':
      result = result.filter(t => isToday(t.due)); break;
    case 'upcoming':
      result = result.filter(t => isUpcoming(t.due) && !isToday(t.due)); break;
    case 'completed':
      result = result.filter(t => t.completed); break;
    case 'high':
      result = result.filter(t => t.priority === 'high' && !t.completed); break;
    case 'medium':
      result = result.filter(t => t.priority === 'medium' && !t.completed); break;
    case 'low':
      result = result.filter(t => t.priority === 'low' && !t.completed); break;
    default: break; // 'all'
  }

  // Search
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    result = result.filter(t =>
      t.title.toLowerCase().includes(q) ||
      (t.desc && t.desc.toLowerCase().includes(q))
    );
  }

  // Sort
  switch (sortMode) {
    case 'due':
      result.sort((a, b) => {
        if (!a.due && !b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        return new Date(a.due) - new Date(b.due);
      });
      break;
    case 'priority':
      result.sort((a, b) => priorityWeight(b.priority) - priorityWeight(a.priority));
      break;
    case 'alpha':
      result.sort((a, b) => a.title.localeCompare(b.title));
      break;
    default: // 'created'
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  return result;
}

// ─── Render ───────────────────────────────────────────────────────────────────
function render() {
  updateCounts();
  updateProgress();
  updateNotifBadge();

  const filtered = getFilteredTasks();

  if (filtered.length === 0) {
    taskList.innerHTML = '';
    emptyState.style.display = 'flex';
    return;
  }

  emptyState.style.display = 'none';

  // Diff rendering – only replace if changed
  const html = filtered.map(buildTaskCard).join('');
  taskList.innerHTML = html;

  // Re-attach events
  taskList.querySelectorAll('.task-checkbox').forEach(el => {
    el.addEventListener('click', () => toggleComplete(el.dataset.id));
  });
  taskList.querySelectorAll('.task-action-btn.edit').forEach(el => {
    el.addEventListener('click', () => openEditModal(el.dataset.id));
  });
  taskList.querySelectorAll('.task-action-btn.delete').forEach(el => {
    el.addEventListener('click', () => deleteTask(el.dataset.id));
  });
}

function buildTaskCard(task) {
  const overdueClass   = isOverdue(task.due) && !task.completed ? 'overdue' : '';
  const completedClass = task.completed ? 'completed' : '';

  const dueBadge = task.due
    ? `<span class="tag tag-due ${overdueClass}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        ${overdueClass ? '⚠ Overdue · ' : ''}${formatDate(task.due)}
       </span>`
    : '';

  const reminderBadge = task.reminderEnabled && task.reminderDate && task.reminderTime
    ? `<span class="tag tag-reminder ${task.reminderFired ? 'fired' : ''}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
        ${task.reminderFired ? 'Reminded' : formatDateTime(task.reminderDate, task.reminderTime)}
       </span>`
    : '';

  const checkIcon = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  return `
    <div class="task-card ${completedClass}" data-id="${task.id}" data-priority="${task.priority}">
      <div class="task-checkbox ${task.completed ? 'checked' : ''}" data-id="${task.id}" role="checkbox" aria-checked="${task.completed}" tabindex="0">
        ${checkIcon}
      </div>
      <div class="task-body">
        <p class="task-title">${escHtml(task.title)}</p>
        ${task.desc ? `<p class="task-desc">${escHtml(task.desc)}</p>` : ''}
        <div class="task-meta">
          <span class="tag tag-priority" data-priority="${task.priority}">${priorityLabel(task.priority)}</span>
          ${dueBadge}
          ${reminderBadge}
        </div>
      </div>
      <div class="task-actions">
        <button class="task-action-btn edit" data-id="${task.id}" title="Edit task" aria-label="Edit task">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="task-action-btn delete" data-id="${task.id}" title="Delete task" aria-label="Delete task">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </button>
      </div>
    </div>
  `;
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────
function toggleComplete(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  task.completed = !task.completed;
  if (task.completed && reminderTimers[id]) {
    clearTimeout(reminderTimers[id]);
    delete reminderTimers[id];
  }
  if (!task.completed) scheduleReminder(task);
  saveTasks();
  render();
  showToast(task.completed ? '✅ Task marked complete!' : '↩ Task reopened', task.completed ? 'success' : 'info');
}

function deleteTask(id) {
  const idx = tasks.findIndex(t => t.id === id);
  if (idx === -1) return;
  if (reminderTimers[id]) { clearTimeout(reminderTimers[id]); delete reminderTimers[id]; }
  tasks.splice(idx, 1);
  saveTasks();
  render();
  showToast('🗑 Task deleted', 'warning');
}

// ─── Modal ────────────────────────────────────────────────────────────────────
function openAddModal() {
  editingId = null;
  taskForm.reset();
  f.id().value = '';
  modalTitle.textContent = 'New Task';
  reminderFields.style.display = 'none';
  reminderToggle.checked = false;
  clearErrors();

  // Set default due date to today
  const today = new Date().toISOString().split('T')[0];
  f.due().value   = today;

  modalOverlay.classList.add('open');
  setTimeout(() => f.title().focus(), 100);
}

function openEditModal(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  editingId = id;
  modalTitle.textContent = 'Edit Task';
  clearErrors();

  f.id().value           = task.id;
  f.title().value        = task.title;
  f.desc().value         = task.desc || '';
  f.priority().value     = task.priority;
  f.due().value          = task.due || '';
  reminderToggle.checked = task.reminderEnabled || false;
  f.reminderDate().value = task.reminderDate || '';
  f.reminderTime().value = task.reminderTime || '';
  f.reminderNote().value = task.reminderNote || '';

  reminderFields.style.display = task.reminderEnabled ? 'flex' : 'none';

  modalOverlay.classList.add('open');
  setTimeout(() => f.title().focus(), 100);
}

function closeModal() {
  modalOverlay.classList.remove('open');
  editingId = null;
}

reminderToggle.addEventListener('change', () => {
  reminderFields.style.display = reminderToggle.checked ? 'flex' : 'none';
  if (reminderToggle.checked) {
    // Default to today + current time +1 hour
    const now = new Date();
    now.setHours(now.getHours() + 1, 0, 0, 0);
    f.reminderDate().value = now.toISOString().split('T')[0];
    f.reminderTime().value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    requestNotifPermission().then(granted => {
      if (!granted) showToast('Enable browser notifications for reminders to work', 'warning');
    });
  }
});

function clearErrors() {
  document.getElementById('titleError').textContent       = '';
  document.getElementById('reminderDateError').textContent = '';
  document.getElementById('reminderTimeError').textContent = '';
}

function validateForm() {
  let valid = true;
  clearErrors();

  if (!f.title().value.trim()) {
    document.getElementById('titleError').textContent = 'Task title is required.';
    f.title().focus();
    valid = false;
  }

  if (reminderToggle.checked) {
    if (!f.reminderDate().value) {
      document.getElementById('reminderDateError').textContent = 'Reminder date is required.';
      valid = false;
    }
    if (!f.reminderTime().value) {
      document.getElementById('reminderTimeError').textContent = 'Reminder time is required.';
      valid = false;
    }
    if (f.reminderDate().value && f.reminderTime().value) {
      const fireAt = new Date(`${f.reminderDate().value}T${f.reminderTime().value}`);
      if (fireAt <= new Date()) {
        document.getElementById('reminderDateError').textContent = 'Reminder must be set in the future.';
        valid = false;
      }
    }
  }

  return valid;
}

taskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!validateForm()) return;

  const isEdit = !!editingId;
  const now    = new Date().toISOString();

  const taskData = {
    id:             editingId || uid(),
    title:          f.title().value.trim(),
    desc:           f.desc().value.trim(),
    priority:       f.priority().value,
    due:            f.due().value || null,
    reminderEnabled: reminderToggle.checked,
    reminderDate:   reminderToggle.checked ? f.reminderDate().value : null,
    reminderTime:   reminderToggle.checked ? f.reminderTime().value : null,
    reminderNote:   reminderToggle.checked ? f.reminderNote().value.trim() : null,
    reminderFired:  false,
    completed:      false,
    createdAt:      now,
    updatedAt:      now,
  };

  if (isEdit) {
    const idx = tasks.findIndex(t => t.id === editingId);
    if (idx !== -1) {
      taskData.completed  = tasks[idx].completed;
      taskData.createdAt  = tasks[idx].createdAt;
      taskData.reminderFired = tasks[idx].reminderFired;

      // If reminder changed, reset fired state
      if (
        tasks[idx].reminderDate !== taskData.reminderDate ||
        tasks[idx].reminderTime !== taskData.reminderTime
      ) {
        taskData.reminderFired = false;
      }

      tasks[idx] = taskData;
      if (reminderTimers[editingId]) {
        clearTimeout(reminderTimers[editingId]);
        delete reminderTimers[editingId];
      }
    }
    showToast('✏️ Task updated!', 'info');
  } else {
    tasks.unshift(taskData);
    showToast('🎉 Task added!', 'success');
  }

  scheduleReminder(taskData);
  saveTasks();
  render();
  closeModal();
});

// ─── Filter Nav ───────────────────────────────────────────────────────────────
document.querySelectorAll('.nav-item[data-filter]').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    activeFilter = item.dataset.filter;
    render();
  });
});

// ─── Search & Sort ────────────────────────────────────────────────────────────
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  render();
});

sortSelect.addEventListener('change', () => {
  sortMode = sortSelect.value;
  render();
});

// ─── Open / Close Modal Events ────────────────────────────────────────────────
openModalBtn.addEventListener('click', openAddModal);
closeModalBtn.addEventListener('click', closeModal);
cancelBtn.addEventListener('click', closeModal);

modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalOverlay.classList.contains('open')) closeModal();
  // Accessibility: Enter/Space on checkbox
  if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('task-checkbox')) {
    e.preventDefault();
    toggleComplete(e.target.dataset.id);
  }
});

// ─── Notification Bell ────────────────────────────────────────────────────────
document.getElementById('notifBell').addEventListener('click', () => {
  const upcoming = tasks.filter(t =>
    !t.completed && t.reminderEnabled && !t.reminderFired &&
    t.reminderDate && t.reminderTime &&
    new Date(`${t.reminderDate}T${t.reminderTime}`) > new Date()
  );

  if (upcoming.length === 0) {
    showToast('No upcoming reminders', 'info');
  } else {
    showToast(`${upcoming.length} upcoming reminder${upcoming.length > 1 ? 's' : ''}`, 'info');
  }
});

// ─── SVG Gradient for Progress Ring ───────────────────────────────────────────
function injectRingGradient() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';
  svg.innerHTML = `
    <defs>
      <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#8b5cf6"/>
        <stop offset="100%" stop-color="#22d3ee"/>
      </linearGradient>
    </defs>`;
  document.body.prepend(svg);
}

// ─── Sample Tasks (first visit) ───────────────────────────────────────────────
function seedSampleTasks() {
  if (localStorage.getItem('taskflow_seeded')) return;
  localStorage.setItem('taskflow_seeded', '1');

  const today = new Date().toISOString().split('T')[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
  const in2 = new Date(Date.now() + 2*86400000).toISOString().split('T')[0];

  const hour2 = new Date(Date.now() + 2 * 3600 * 1000);
  const rDate = hour2.toISOString().split('T')[0];
  const rTime = `${String(hour2.getHours()).padStart(2,'0')}:${String(hour2.getMinutes()).padStart(2,'0')}`;

  tasks = [
    {
      id: uid(), title: 'Review project proposal',
      desc: 'Go through the attached PDF and leave comments on each section.',
      priority: 'high', due: today, completed: false,
      reminderEnabled: true, reminderDate: rDate, reminderTime: rTime,
      reminderNote: 'Check your email for the attached PDF!',
      reminderFired: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    {
      id: uid(), title: 'Team standup meeting',
      desc: 'Daily sync with the engineering team — share progress and blockers.',
      priority: 'medium', due: today, completed: true,
      reminderEnabled: false, reminderDate: null, reminderTime: null,
      reminderNote: null, reminderFired: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    {
      id: uid(), title: 'Update design mockups',
      desc: 'Redesign the onboarding flow based on user feedback from last sprint.',
      priority: 'medium', due: tomorrow, completed: false,
      reminderEnabled: false, reminderDate: null, reminderTime: null,
      reminderNote: null, reminderFired: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    {
      id: uid(), title: 'Submit quarterly report',
      desc: 'Compile metrics and send to finance team before end of business.',
      priority: 'high', due: in2, completed: false,
      reminderEnabled: false, reminderDate: null, reminderTime: null,
      reminderNote: null, reminderFired: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
    {
      id: uid(), title: 'Buy groceries',
      desc: 'Milk, eggs, bread, coffee, apples.',
      priority: 'low', due: null, completed: false,
      reminderEnabled: false, reminderDate: null, reminderTime: null,
      reminderNote: null, reminderFired: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    },
  ];

  saveTasks();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
function init() {
  injectRingGradient();
  loadTasks();
  seedSampleTasks();
  scheduleAll();
  render();

  // Re-check reminders every 30 seconds (catch any drift)
  setInterval(() => {
    scheduleAll();
    updateNotifBadge();
  }, 30_000);

  console.log('%c TaskFlow ✓ ', 'background:#7c3aed;color:white;padding:4px 10px;border-radius:4px;font-weight:bold;');
}

init();
