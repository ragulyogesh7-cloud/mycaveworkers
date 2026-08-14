const $ = (selector) => document.querySelector(selector);

let employees = [];
let workroomSource = null;
let workroomMessages = [];
let workroomPresence = [];
let workroomTasks = [];
let taskSummaries = [];
let pendingMessages = [];
let trialCountdownTimer = null;

function safe(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Now' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function relativeTime(iso) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return 'Now';
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

async function responseJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.upgradeRequired = Boolean(data.upgrade_required);
    throw error;
  }
  return data;
}

function setRoomNotice(message = '', kind = '') {
  const notice = $('#room-notice');
  if (!notice) return;
  notice.textContent = message;
  notice.className = `room-notice ${kind}`.trim();
}

function roomAtLatest() {
  const feed = $('#workroom-thread');
  return !feed || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 96;
}

function updateJumpButton() {
  const jump = $('#jump-to-latest');
  if (!jump) return;
  jump.hidden = roomAtLatest();
}

function jumpToLatest() {
  const feed = $('#workroom-thread');
  if (!feed) return;
  feed.scrollTo({ top: feed.scrollHeight, behavior: 'smooth' });
  updateJumpButton();
}

function renderTrialBanner(billing) {
  const banner = $('#trial-banner');
  const title = $('#trial-banner-text');
  const detail = $('#trial-banner-detail');
  if (!banner || !title || !detail) return;
  if (trialCountdownTimer) window.clearInterval(trialCountdownTimer);
  const isTrial = billing.tier_key === 'free_trial' && billing.trial_ends_at;
  if (!isTrial) { banner.hidden = true; return; }
  banner.hidden = false;
  const endsAt = new Date(billing.trial_ends_at).getTime();
  const render = () => {
    const remaining = endsAt - Date.now();
    if (remaining <= 0) {
      banner.classList.add('expired');
      title.textContent = 'Your free trial has ended.';
      detail.textContent = 'Task assignment is paused until you upgrade.';
      return;
    }
    banner.classList.remove('expired');
    const hours = Math.ceil(remaining / (60 * 60 * 1000));
    const days = Math.floor(hours / 24);
    title.textContent = days ? `${days} day${days === 1 ? '' : 's'} left on your free trial.` : `${hours} hour${hours === 1 ? '' : 's'} left on your free trial.`;
    detail.textContent = `Access ends ${new Date(endsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`;
  };
  render();
  trialCountdownTimer = window.setInterval(render, 60 * 1000);
}

async function loadBilling() {
  try {
    const billing = await responseJson('/api/billing');
    const workspace = $('.workspace-name > span:nth-child(2)');
    if (workspace && billing.company_name) workspace.textContent = billing.company_name;
    renderTrialBanner(billing);
  } catch (error) {
    console.error('Unable to load subscription details:', error);
  }
}

async function loadHealth() {
  const railStatus = $('#rail-system-status');
  const railDetail = $('#rail-system-detail');
  try {
    const health = await responseJson('/api/health');
    const database = health.components?.database?.status || 'unknown';
    if (railStatus) railStatus.textContent = health.status === 'healthy' ? 'Systems nominal' : 'Systems need review';
    if (railDetail) railDetail.textContent = database === 'up' ? 'Workspace services connected' : 'Service check incomplete';
  } catch (error) {
    if (railStatus) railStatus.textContent = 'Connection unavailable';
    if (railDetail) railDetail.textContent = 'Retrying service check';
  }
}

function employeeById(employeeId) {
  return employees.find((employee) => employee.id === employeeId);
}

function renderAssignmentOptions() {
  const select = $('#task-assignee');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Auto-route the best team</option><option value="__whole_team__">Whole team</option>${employees.map((employee) => `<option value="${safe(employee.id)}">${safe(employee.name)} · ${safe(employee.role)}</option>`).join('')}`;
  select.value = Array.from(select.options).some((option) => option.value === current) ? current : '';
}

function renderAvatarStack() {
  const container = $('#room-avatar-stack');
  if (!container) return;
  const visible = employees.slice(0, 5);
  container.innerHTML = visible.map((employee) => `<a href="/employee/${encodeURIComponent(employee.id)}" class="stack-avatar" title="${safe(employee.name)} · ${safe(employee.role)}" style="--avatar-color:${safe(employee.color || '#7ee8ff')}">${safe(employee.name?.[0] || 'A')}</a>`).join('') + (employees.length > visible.length ? `<span class="stack-avatar overflow">+${employees.length - visible.length}</span>` : '');
}

async function loadEmployees() {
  try {
    employees = await responseJson('/api/employees');
    renderAssignmentOptions();
    renderAvatarStack();
    renderWorkroomPresence();
  } catch (error) {
    console.error('Unable to load employees:', error);
    setRoomNotice('Your employee list could not be loaded. Reconnect and try again.', 'error');
  }
}

function renderWorkroomPresence() {
  const container = $('#workroom-presence');
  const count = $('#room-team-count');
  if (!container) return;
  const roster = workroomPresence.length ? workroomPresence : employees.map((employee) => ({ employee_id: employee.id, status: 'idle' }));
  const priority = { working: 0, coordinating: 1, reviewing: 2, idle: 3, offline: 4 };
  roster.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));
  if (count) count.textContent = String(roster.length);
  container.innerHTML = roster.length ? roster.map((entry, index) => {
    const employee = employeeById(entry.employee_id) || {};
    const status = entry.status || 'idle';
    return `<a class="presence-row" href="/employee/${encodeURIComponent(entry.employee_id || '')}" style="--presence-delay:${Math.min(index, 8) * 35}ms"><span class="presence-avatar" style="--avatar-color:${safe(employee.color || '#7ee8ff')}">${safe(employee.name?.[0] || entry.employee_id?.[0] || 'A')}</span><span class="presence-copy"><b>${safe(employee.name || 'AI employee')}</b><small>${safe(employee.role || 'Specialist')} · <span class="presence-status ${safe(status)}">${safe(status.replace('_', ' '))}</span></small></span></a>`;
  }).join('') : '<p class="empty-state-sm">No active employees are available yet.</p>';
}

function messageKey(message) {
  return `${message.task_id || 'room'}:${message.created_at || ''}:${message.sender || ''}:${message.receiver || ''}:${message.body || ''}`;
}

function messageTone(kind) {
  if (kind === 'approval_required') return 'approval';
  if (kind === 'completed') return 'complete';
  if (kind === 'received') return 'manager';
  if (kind === 'task_update') return 'system';
  return 'employee';
}

function messageInitial(message) {
  if (message.kind === 'received' || message.sender === 'Manager') return 'YO';
  if (message.sender === 'Caveworkers coordinator') return 'CW';
  return String(message.sender || 'AI').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'AI';
}

function renderRoomFeed(shouldFollow = roomAtLatest()) {
  const container = $('#workroom-thread');
  if (!container) return;
  const all = [...workroomMessages, ...pendingMessages].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()).slice(-140);
  if (!all.length) {
    container.innerHTML = `<div class="room-empty"><span class="room-empty-mark">✦</span><h3>Your company room is ready.</h3><p>Assign a task below and your team’s routing, collaboration, and review steps will appear here in realtime.</p></div>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  all.forEach((message, index) => {
    const article = document.createElement('article');
    const tone = messageTone(message.kind);
    article.className = `room-message ${tone}${message.pending ? ' pending' : ''}`;
    article.style.setProperty('--message-delay', `${Math.min(index, 10) * 35}ms`);
    const taskReference = message.task_id ? `<button class="message-task" data-task-id="${safe(message.task_id)}" type="button">Task #${safe(message.task_id)}</button>` : '';
    const approvalAction = message.approval_id ? `<button class="message-approval" data-approval-id="${safe(message.approval_id)}" data-approval-status="approved" type="button">Approve</button>` : '';
    article.innerHTML = `<span class="message-avatar">${safe(messageInitial(message))}</span><div class="message-body"><div class="message-meta"><b>${safe(message.sender || 'Caveworkers')}</b>${message.receiver ? `<span>to ${safe(message.receiver)}</span>` : ''}<time>${formatTime(message.created_at)}</time>${taskReference}</div><p>${safe(message.body || '')}</p>${message.pending ? '<span class="typing-dots"><i></i><i></i><i></i></span>' : ''}${approvalAction}</div>`;
    fragment.append(article);
  });
  container.replaceChildren(fragment);
  if (shouldFollow) container.scrollTop = container.scrollHeight;
  updateJumpButton();
}

function rebuildWorkroomMessages() {
  const source = [];
  workroomTasks.forEach((task) => (task.trace || []).forEach((step) => {
    if (step?.body) source.push({ ...step, task_id: task.id });
  }));
  const seen = new Set();
  workroomMessages = source.filter((message) => {
    const key = messageKey(message);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()).slice(-120);
  const keys = new Set(workroomMessages.map(messageKey));
  pendingMessages = pendingMessages.filter((message) => !keys.has(messageKey(message)) && Date.now() - new Date(message.created_at).getTime() < 45000);
  renderRoomFeed();
}

function upsertWorkroomPresence(entry) {
  if (!entry?.employee_id) return;
  const index = workroomPresence.findIndex((item) => item.employee_id === entry.employee_id);
  if (index >= 0) workroomPresence[index] = { ...workroomPresence[index], ...entry };
  else workroomPresence.push(entry);
  renderWorkroomPresence();
}

function setRoomConnection(status, detail) {
  const pill = $('#workroom-status');
  const copy = $('#room-connection-copy');
  if (pill) { pill.textContent = status; pill.classList.toggle('signal-ok', status === 'LIVE'); }
  if (copy) copy.textContent = detail;
}

function applyWorkroomEvent(event) {
  if (!event) return;
  const follow = roomAtLatest();
  if (event.type === 'presence' && event.presence) upsertWorkroomPresence(event.presence);
  if (event.type === 'message' && event.message) {
    const key = messageKey(event.message);
    if (!workroomMessages.some((message) => messageKey(message) === key)) workroomMessages.push(event.message);
    renderRoomFeed(follow);
  }
  if (event.type === 'task_update' && event.task) {
    const index = workroomTasks.findIndex((task) => task.id === event.task.id);
    if (index >= 0) workroomTasks[index] = event.task; else workroomTasks.push(event.task);
    rebuildWorkroomMessages();
    void Promise.all([loadTaskSummaries(), loadApprovals()]);
  }
  setRoomConnection('LIVE', 'Realtime updates are flowing from your workforce.');
}

async function loadWorkroomSnapshot() {
  try {
    const snapshot = await responseJson('/api/workforce/workroom');
    workroomPresence = snapshot.presence || [];
    workroomTasks = snapshot.tasks || [];
    renderWorkroomPresence();
    rebuildWorkroomMessages();
    setRoomConnection('LIVE', 'Realtime updates are flowing from your workforce.');
  } catch (error) {
    console.error('Unable to load company workroom:', error);
    setRoomConnection('UNAVAILABLE', 'The room is temporarily unavailable. Retrying when the connection returns.');
  }
}

function connectWorkroom() {
  if (!window.EventSource) {
    setRoomConnection('POLLING', 'Your browser does not support live updates. Refresh to see new activity.');
    return;
  }
  workroomSource?.close();
  workroomSource = new EventSource('/api/workforce/stream');
  const receive = (event) => { try { applyWorkroomEvent(JSON.parse(event.data)); } catch (error) { console.warn('Invalid workroom update:', error); } };
  workroomSource.onopen = () => setRoomConnection('LIVE', 'Realtime updates are flowing from your workforce.');
  workroomSource.onmessage = receive;
  ['connected', 'presence', 'message', 'task_update'].forEach((type) => workroomSource.addEventListener(type, receive));
  workroomSource.onerror = () => setRoomConnection('RECONNECTING…', 'Reconnecting to your workforce activity stream…');
}

async function loadApprovals() {
  const container = $('#approvals-list');
  const status = $('#approvals-status-text');
  const badge = $('#approval-count-badge');
  if (!container) return;
  try {
    const approvals = await responseJson('/api/approvals');
    if (badge) badge.textContent = String(approvals.length);
    if (status) status.textContent = approvals.length ? `${approvals.length} waiting` : 'Queue clear';
    container.innerHTML = approvals.length ? approvals.slice(0, 4).map((approval) => `<article class="approval-item"><div class="approval-top"><span class="approval-tool">${safe(approval.tool_name)}</span><span class="live-pill">REVIEW</span></div><p class="approval-summary">${safe(approval.action_summary)}</p><div class="approval-actions"><button class="btn-sm btn-approve" data-approval-id="${safe(approval.id)}" data-approval-status="approved">Approve</button><button class="btn-sm btn-reject" data-approval-id="${safe(approval.id)}" data-approval-status="rejected">Reject</button></div></article>`).join('') : '<p class="empty-state-sm">Nothing needs your approval. Your team will always pause consequential actions.</p>';
  } catch (error) {
    console.error('Unable to load approvals:', error);
    if (status) status.textContent = 'Unavailable';
    container.innerHTML = '<p class="empty-state-sm">The approval queue could not be loaded.</p>';
  }
}

async function resolveApproval(id, status) {
  try {
    await responseJson(`/api/approvals/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    setRoomNotice(status === 'approved' ? 'Approval recorded. Your employee can continue the approved action.' : 'Approval request rejected. The team has been notified.', 'success');
    await Promise.all([loadApprovals(), loadTaskSummaries(), loadWorkroomSnapshot()]);
  } catch (error) {
    setRoomNotice(error.message || 'The approval could not be updated.', 'error');
  }
}

function taskStatusLabel(status) {
  if (status === 'pending_approval') return 'Needs review';
  if (status === 'completed') return 'Complete';
  if (status === 'failed') return 'Needs retry';
  return 'In progress';
}

async function loadTaskSummaries() {
  const container = $('#task-dashboard-grid');
  const badge = $('#task-count-badge');
  if (!container) return;
  try {
    const data = await responseJson('/api/tasks');
    taskSummaries = data.tasks || [];
    if (badge) badge.textContent = String(data.total_count || taskSummaries.length);
    container.innerHTML = taskSummaries.length ? taskSummaries.slice(0, 5).map((task) => `<button class="task-summary" data-task-id="${safe(task.id)}" type="button"><span class="task-summary-icon">${safe(task.owner_info?.name?.[0] || 'AI')}</span><span><b>${safe(task.question || 'Untitled task')}</b><small>${safe(task.owner_info?.name || 'Caveworkers')} · ${relativeTime(task.created_at)}</small></span><em class="task-summary-status ${safe(task.status)}">${safe(taskStatusLabel(task.status))}</em></button>`).join('') : '<p class="empty-state-sm">No tasks yet. Assign the first one in the company room.</p>';
  } catch (error) {
    console.error('Unable to load tasks:', error);
    container.innerHTML = '<p class="empty-state-sm">Recent tasks are unavailable right now.</p>';
  }
}

function renderTaskInRoom(taskId) {
  const task = taskSummaries.find((entry) => String(entry.id) === String(taskId)) || workroomTasks.find((entry) => String(entry.id) === String(taskId));
  if (!task) return;
  const trace = task.trace || [];
  if (trace.length) {
    const taskMessages = trace.filter((step) => step?.body).map((step) => ({ ...step, task_id: task.id }));
    const existingKeys = new Set(workroomMessages.map(messageKey));
    taskMessages.forEach((message) => { if (!existingKeys.has(messageKey(message))) workroomMessages.push(message); });
    renderRoomFeed(false);
  }
  const first = [...document.querySelectorAll('.message-task')].find((button) => button.dataset.taskId === String(taskId));
  first?.closest('.room-message')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function submitTask(event) {
  event.preventDefault();
  const input = $('#request');
  const select = $('#task-assignee');
  const button = $('#run');
  const request = input?.value.trim();
  if (!request) { input?.focus(); return; }
  const preferred = select?.value || '';
  const target = preferred === '__whole_team__' ? 'the whole team' : employeeById(preferred)?.name || 'the best available team';
  const pending = { kind: 'received', sender: 'You', receiver: target, body: request, created_at: new Date().toISOString(), pending: true };
  pendingMessages.push(pending);
  renderRoomFeed(true);
  input.value = '';
  button.disabled = true;
  button.innerHTML = 'Assigning…';
  setRoomNotice(`Routing this task to ${target}.`, '');
  try {
    const task = await responseJson('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request, preferred_employee_id: preferred || undefined }) });
    pending.pending = false;
    pending.task_id = task.id;
    pending.receiver = (task.participants || []).slice(1).join(', ') || target;
    setRoomNotice(`Task #${task.id} is in the company room. The team will post updates here.`, 'success');
    await Promise.all([loadTaskSummaries(), loadWorkroomSnapshot()]);
  } catch (error) {
    pendingMessages = pendingMessages.filter((entry) => entry !== pending);
    renderRoomFeed();
    setRoomNotice(error.upgradeRequired ? `${error.message} Open Settings to choose a paid plan.` : error.message, 'error');
  } finally {
    button.disabled = false;
    button.innerHTML = 'Assign work <span>↗</span>';
    input.focus();
  }
}

function bindRoomInteractions() {
  $('#room-composer')?.addEventListener('submit', submitTask);
  $('#request')?.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') $('#room-composer')?.requestSubmit();
  });
  $('#workroom-thread')?.addEventListener('scroll', updateJumpButton);
  $('#jump-to-latest')?.addEventListener('click', jumpToLatest);
  $('#refresh-tasks')?.addEventListener('click', () => Promise.all([loadTaskSummaries(), loadApprovals(), loadWorkroomSnapshot()]));
  $('#menuButton')?.addEventListener('click', () => document.querySelector('.side-rail')?.classList.toggle('is-open'));
  document.addEventListener('click', (event) => {
    const approval = event.target.closest('[data-approval-id]');
    if (approval) resolveApproval(approval.dataset.approvalId, approval.dataset.approvalStatus);
    const task = event.target.closest('[data-task-id]');
    if (task) renderTaskInRoom(task.dataset.taskId);
  });
}

async function initializeRoom() {
  bindRoomInteractions();
  await Promise.all([loadEmployees(), loadBilling(), loadHealth(), loadWorkroomSnapshot(), loadApprovals(), loadTaskSummaries()]);
  connectWorkroom();
}

window.addEventListener('beforeunload', () => workroomSource?.close());
window.addEventListener('DOMContentLoaded', initializeRoom);
