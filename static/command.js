const $ = (selector) => document.querySelector(selector);

let employees = [];
let workroomSource = null;
let workroomMessages = [];
let workroomPresence = [];
let workroomTasks = [];
let taskSummaries = [];
let pendingMessages = [];
let trialCountdownTimer = null;
let soundEnabled = false;
let audioContext = null;

function getSoundContext() {
  if (!soundEnabled || !window.AudioContext) return null;
  audioContext ||= new window.AudioContext();
  if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  return audioContext;
}

function playCue(kind = 'tick') {
  const context = getSoundContext();
  if (!context) return;
  const frequencies = { submit: [330, 494], approval: [294, 370], complete: [494, 659], failure: [220, 165], tick: [392] };
  const values = frequencies[kind] || frequencies.tick;
  const start = context.currentTime;
  values.forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = kind === 'failure' ? 'sine' : 'triangle';
    oscillator.frequency.setValueAtTime(frequency, start + index * 0.075);
    gain.gain.setValueAtTime(0.0001, start + index * 0.075);
    gain.gain.exponentialRampToValueAtTime(0.045, start + index * 0.075 + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + index * 0.075 + 0.24);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + index * 0.075);
    oscillator.stop(start + index * 0.075 + 0.26);
  });
}

function setSoundToggle() {
  const button = $('#sound-toggle');
  if (!button) return;
  button.setAttribute('aria-pressed', String(soundEnabled));
  button.classList.toggle('is-on', soundEnabled);
  const label = button.querySelector('.sound-toggle-label');
  const icon = button.querySelector('.sound-toggle-icon');
  if (label) label.textContent = soundEnabled ? 'Sound on' : 'Sound off';
  if (icon) icon.textContent = soundEnabled ? '◉' : '◌';
}

function setExecutionLive(state = 'ready', title = 'Ready for an outcome', detail = 'Your team is standing by.') {
  const live = $('#execution-live');
  const liveTitle = $('#execution-live-title');
  const liveDetail = $('#execution-live-detail');
  if (live) live.dataset.state = state;
  if (liveTitle) liveTitle.textContent = title;
  if (liveDetail) liveDetail.textContent = detail;
  const phase = { ready: 0, working: 1, coordinating: 1, approval: 2, complete: 3, failure: 2 }[state] ?? 0;
  document.querySelectorAll('.execution-step').forEach((step, index) => {
    step.classList.toggle('active', index === phase);
    step.classList.toggle('done', index < phase && state === 'complete');
  });
}

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
    error.payload = data;
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

function avatarMarkup(employee = {}, label = 'AI', extraClass = '') {
  const color = employee.color || '#82e9ff';
  const employeeId = employee.id || employee.employee_id || '';
  const initials = String(label || employee.name || 'AI').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'AI';
  const portrait = employee.avatar_url || (employeeId ? `/static/assets/employee-avatars/${encodeURIComponent(employeeId)}.webp` : '');
  const image = portrait ? `<img class="employee-portrait" src="${safe(portrait)}" alt="" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false">` : '';
  return `<span class="employee-dp employee-profile ${extraClass}" style="--avatar-color:${safe(color)}" data-employee-id="${safe(employeeId)}" aria-hidden="true">${image}<span class="profile-initials"${portrait ? ' hidden' : ''}>${safe(initials)}</span></span>`;
}

function employeeStatus(employeeId) {
  return workroomPresence.find((entry) => entry.employee_id === employeeId)?.status || 'idle';
}

function renderWorkforceStage() {
  const coordinatorNode = $('#map-node-coordinator');
  const rightNode = $('#map-node-right');
  const roster = $('#stage-roster');
  const activeCount = $('#stage-active-count');
  if (!coordinatorNode || !rightNode || !roster) return;
  const coordinator = employeeById('sarah') || employees[0] || { name: 'Sarah', role: 'Coordinator', color: '#82e9ff' };
  const peers = employees.filter((employee) => employee.id !== coordinator.id).slice(0, 3);
  const active = workroomPresence.filter((entry) => ['working', 'coordinating', 'reviewing'].includes(entry.status)).length;
  if (activeCount) activeCount.textContent = `${active || employees.length ? active : 0} active`;
  coordinatorNode.innerHTML = `<a class="map-person map-person-coordinator" href="/employee/${encodeURIComponent(coordinator.id || '')}" title="Open ${safe(coordinator.name)}’s workspace">${avatarMarkup(coordinator, coordinator.name?.[0] || 'S', 'map-avatar')}<span><b>${safe(coordinator.name || 'Sarah')}</b><small>${safe(coordinator.role || 'Coordinator')}</small></span></a>`;
  rightNode.innerHTML = peers.map((employee, index) => `<a class="map-person map-person-peer peer-${index + 1}" href="/employee/${encodeURIComponent(employee.id || '')}" title="Open ${safe(employee.name)}’s workspace">${avatarMarkup(employee, employee.name?.[0] || 'AI', 'map-avatar')}<span><b>${safe(employee.name)}</b><small>${safe(employee.role || 'Specialist')}</small></span></a>`).join('');
  roster.innerHTML = employees.slice(0, 8).map((employee, index) => { const status = employeeStatus(employee.id); return `<a class="stage-roster-item" style="--roster-delay:${Math.min(index, 7) * 35}ms;--avatar-color:${safe(employee.color || '#82e9ff')}" href="/employee/${encodeURIComponent(employee.id)}" data-stage-employee-id="${safe(employee.id)}">${avatarMarkup(employee, employee.name?.[0] || 'AI', 'roster-avatar')}<span><b>${safe(employee.name)}</b><small>${safe(employee.role || 'Specialist')}</small></span><em class="roster-state ${safe(status)}">${safe(status.replace(/_/g, ' '))}</em></a>`; }).join('');
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
  container.innerHTML = visible.map((employee) => `<a href="/employee/${encodeURIComponent(employee.id)}" class="stack-avatar" title="${safe(employee.name)} · ${safe(employee.role)}" style="--avatar-color:${safe(employee.color || '#7ee8ff')}" data-employee-id="${safe(employee.id)}">${avatarMarkup(employee, employee.name?.[0] || 'A', 'stack-dp')}</a>`).join('') + (employees.length > visible.length ? `<span class="stack-avatar overflow">+${employees.length - visible.length}</span>` : '');
}

async function loadEmployees() {
  try {
    employees = await responseJson('/api/employees');
    renderAssignmentOptions();
    renderAvatarStack();
    renderWorkroomPresence();
    renderWorkforceStage();
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
    return `<a class="presence-row" href="/employee/${encodeURIComponent(entry.employee_id || '')}" style="--presence-delay:${Math.min(index, 8) * 35}ms;--avatar-color:${safe(employee.color || '#7ee8ff')}" data-presence-status="${safe(status)}">${avatarMarkup(employee, employee.name?.[0] || entry.employee_id?.[0] || 'A', 'presence-dp')}<span class="presence-copy"><b>${safe(employee.name || 'AI employee')}</b><small>${safe(employee.role || 'Specialist')} · <span class="presence-status ${safe(status)}">${safe(status.replace('_', ' '))}</span></small></span></a>`;
  }).join('') : '<p class="empty-state-sm">No active employees are available yet.</p>';
  renderWorkforceStage();
}

function messageKey(message) {
  return `${message.task_id || 'room'}:${message.created_at || ''}:${message.sender || ''}:${message.receiver || ''}:${message.body || ''}`;
}

function messageTone(kind) {
  if (kind === 'approval_required') return 'approval';
  if (['blocked', 'action_failed', 'worker_failed'].includes(kind)) return 'failure';
  if (['completed', 'action_completed'].includes(kind)) return 'complete';
  if (kind === 'manager_response' || kind === 'manager_result') return 'result';
  if (kind === 'received') return 'manager';
  if (kind === 'task_update') return 'system';
  return 'employee';
}

function messageInitial(message) {
  if (message.kind === 'received' || message.sender === 'Manager') return 'YO';
  if (message.sender === 'Caveworkers coordinator') return 'CW';
  return String(message.sender || 'AI').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'AI';
}

function cleanChatCopy(value) {
  return String(value ?? '')
    .replace(/\r/g, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\*{0,2}(Blocker|Work completed|Current result|Next action|Your request|Delivery lead|Team|Sarah[’']s manager update)\*{0,2}\s*:\s*/gim, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
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
    const senderEmployee = employees.find((employee) => employee.name === message.sender || employee.id === String(message.sender || '').toLowerCase());
    article.className = `room-message ${tone}${message.pending ? ' pending' : ''}`;
    if (senderEmployee?.color) article.style.setProperty('--avatar-color', senderEmployee.color);
    article.style.setProperty('--message-delay', `${Math.min(index, 10) * 35}ms`);
    const taskReference = message.task_id ? `<button class="message-task" data-task-id="${safe(message.task_id)}" type="button">Task #${safe(message.task_id)}</button>` : '';
    const approvalAction = message.approval_id ? `<button class="message-approval" data-approval-id="${safe(message.approval_id)}" data-approval-status="approved" type="button">Approve</button>` : '';
    const senderName = message.sender === 'Manager' ? 'You' : (senderEmployee?.name || message.sender || 'Caveworkers');
    const recipient = message.receiver && message.receiver !== 'Manager' ? `<span>to ${safe(message.receiver)}</span>` : '';
    const messageLabel = tone === 'result' ? 'Manager update' : tone === 'approval' ? 'Needs your attention' : tone === 'failure' ? 'Blocked' : tone === 'complete' ? 'Completed' : message.kind === 'team_context' ? 'Coordination' : '';
    article.innerHTML = `${avatarMarkup(senderEmployee || { id: '', color: tone === 'approval' ? '#ffd78f' : '#82e9ff' }, senderName, 'message-dp')}<div class="message-body"><div class="message-meta"><b>${safe(senderName)}</b>${recipient}${messageLabel ? `<span class="message-label ${tone}">${safe(messageLabel)}</span>` : ''}<time>${formatTime(message.created_at)}</time>${taskReference}</div>${tone === 'result' ? '<span class="final-answer-label">Sarah’s update</span>' : ''}<p>${safe(cleanChatCopy(message.body || ''))}</p>${message.pending ? '<span class="typing-dots"><i></i><i></i><i></i></span>' : ''}${approvalAction}</div>`;
    fragment.append(article);
  });
  container.replaceChildren(fragment);
  if (shouldFollow) container.scrollTop = container.scrollHeight;
  updateJumpButton();
}

function rebuildWorkroomMessages() {
  const source = [];
  workroomTasks.forEach((task) => {
    (task.trace || []).forEach((step) => { if (step?.body) source.push({ ...step, task_id: task.id }); });
    if (task.answer && !['queued', 'processing'].includes(task.status)) {
      source.push({ kind: 'manager_response', sender: 'Sarah', receiver: 'Manager', body: task.answer, task_id: task.id, created_at: task.completed_at || task.created_at });
    }
    if (task.execution && !['queued', 'not_required'].includes(task.execution.status)) {
      source.push({ kind: task.execution.status === 'succeeded' ? 'action_completed' : ['failed', 'blocked'].includes(task.execution.status) ? 'action_failed' : 'action_update', sender: 'Sarah', receiver: 'Manager', body: `Execution status — ${task.execution.status.replace(/_/g, ' ')}: ${task.execution.summary}`, task_id: task.id, created_at: task.execution.updated_at || task.completed_at || task.created_at });
    }
  });
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
  if (event.type === 'message' && event.message) playCue(event.message.kind === 'approval_required' ? 'approval' : 'tick');
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
    const taskStatus = event.task.status || event.task.execution?.status || 'processing';
    if (['completed', 'succeeded'].includes(taskStatus)) { setExecutionLive('complete', 'Work verified', event.task.execution?.summary || 'The latest task has reported evidence.'); playCue('complete'); }
    else if (['failed', 'blocked'].includes(taskStatus)) { setExecutionLive('failure', taskStatus === 'blocked' ? 'Action blocked' : 'Execution needs attention', event.task.execution?.summary || 'Review the task details and connector policy.'); playCue('failure'); }
    else if (taskStatus === 'pending_approval') setExecutionLive('approval', 'Approval required', 'A consequential action is paused for your review.');
    else setExecutionLive('working', 'Work is moving', 'The workforce is coordinating and preparing the next step.');
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
    const result = await responseJson(`/api/approvals/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    const summary = result.execution?.summary;
    setRoomNotice(summary || (status === 'approved' ? 'Approval recorded. Sarah is now reporting the execution outcome in the room.' : 'Approval request rejected. Sarah has kept the work product and stopped the external action.'), 'success');
    await Promise.all([loadApprovals(), loadTaskSummaries(), loadWorkroomSnapshot()]);
  } catch (error) {
    setRoomNotice(error.payload?.execution?.summary || error.message || 'The approval could not be updated.', 'error');
    await Promise.all([loadApprovals(), loadTaskSummaries(), loadWorkroomSnapshot()]);
  }
}

function taskStatusLabel(status) {
  if (status === 'pending_approval') return 'Needs review';
  if (status === 'completed') return 'Complete';
  if (status === 'failed') return 'Needs retry';
  if (status === 'blocked') return 'Blocked';
  if (status === 'queued') return 'Queued';
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
    container.innerHTML = taskSummaries.length ? taskSummaries.slice(0, 5).map((task) => `<button class="task-summary" data-task-id="${safe(task.id)}" type="button"><span class="task-summary-icon">${safe(task.owner_info?.name?.[0] || 'AI')}</span><span><b>${safe(task.question || 'Untitled task')}</b><small>${safe(task.status === 'blocked' ? task.execution?.summary || 'Sarah needs a connector or action detail.' : `${task.owner_info?.name || 'Sarah'} · ${relativeTime(task.created_at)}`)}</small></span><em class="task-summary-status ${safe(task.status)}">${safe(taskStatusLabel(task.status))}</em></button>`).join('') : '<p class="empty-state-sm">No tasks yet. Assign the first one in the company room.</p>';
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
  button.innerHTML = '<span class="button-spinner" aria-hidden="true"></span> Working…';
  playCue('submit');
  setExecutionLive('working', 'Routing your outcome', `Sarah is preparing the workforce for ${target}.`);
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
    button.innerHTML = 'Start the work <span>↗</span>';
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
  $('#sound-toggle')?.addEventListener('click', () => { soundEnabled = !soundEnabled; window.localStorage.setItem('caveworkers-sound', soundEnabled ? 'on' : 'off'); setSoundToggle(); if (soundEnabled) playCue('complete'); });
  const connectorButton = $('#connector-plus');
  const connectorPopover = $('#connector-popover');
  const closeConnectorPopover = () => { if (!connectorPopover || !connectorButton) return; connectorPopover.hidden = true; connectorButton.setAttribute('aria-expanded', 'false'); };
  connectorButton?.addEventListener('click', (event) => { event.stopPropagation(); if (!connectorPopover) return; connectorPopover.hidden = !connectorPopover.hidden; connectorButton.setAttribute('aria-expanded', String(!connectorPopover.hidden)); if (!connectorPopover.hidden) playCue('tick'); });
  $('#connector-popover-close')?.addEventListener('click', closeConnectorPopover);
  document.addEventListener('click', (event) => { if (connectorPopover && !connectorPopover.hidden && !event.target.closest('#connector-popover, #connector-plus')) closeConnectorPopover(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeConnectorPopover(); });
  document.addEventListener('click', (event) => {
    const approval = event.target.closest('[data-approval-id]');
    if (approval) resolveApproval(approval.dataset.approvalId, approval.dataset.approvalStatus);
    const task = event.target.closest('[data-task-id]');
    if (task) renderTaskInRoom(task.dataset.taskId);
  });
}

async function initializeRoom() {
  soundEnabled = false;
  setSoundToggle();
  setExecutionLive();
  bindRoomInteractions();
  await Promise.all([loadEmployees(), loadBilling(), loadHealth(), loadWorkroomSnapshot(), loadApprovals(), loadTaskSummaries()]);
  connectWorkroom();
}

window.addEventListener('beforeunload', () => workroomSource?.close());
window.addEventListener('DOMContentLoaded', initializeRoom);
