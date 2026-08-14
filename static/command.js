const $ = (selector) => document.querySelector(selector);
let employees = [];
let activeEmployeeId = null;

function safe(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

function formatTime(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Now' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function responseJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data.error || 'The request could not be completed.');
    error.upgradeRequired = Boolean(data.upgrade_required);
    throw error;
  }
  return data;
}

let trialCountdownTimer = null;
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
      detail.textContent = 'Workspace actions are paused until you upgrade.';
      return;
    }
    banner.classList.remove('expired');
    const totalHours = Math.ceil(remaining / (60 * 60 * 1000));
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    title.textContent = days > 0 ? `${days} day${days === 1 ? '' : 's'} left on your free trial.` : `${hours} hour${hours === 1 ? '' : 's'} left on your free trial.`;
    detail.textContent = `Trial access ends ${new Date(endsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.`;
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
  } catch (error) { console.error('Unable to load subscription details:', error); }
}

const SIGNAL_LABELS = {
  healthy: 'Nominal',
  degraded: 'Degraded',
  down: 'Offline',
};

function signalClass(status) {
  return status === 'healthy' ? 'signal-ok' : status === 'degraded' ? 'signal-warn' : 'signal-down';
}

async function loadHealth() {
  const workforce = $('#signal-workforce');
  const systems = $('#signal-systems');
  const access = $('#signal-access');
  if (!workforce || !systems || !access) return;
  try {
    const health = await fetch('/api/health').then((r) => r.json());
    const overall = health.status || 'unknown';
    workforce.textContent = SIGNAL_LABELS[overall] || overall;
    workforce.className = signalClass(overall);
    const db = health.components?.database?.status || 'unknown';
    const payments = health.components?.payments?.status || 'unconfigured';
    systems.textContent = db === 'up' ? 'Connected' : db === 'down' ? 'Offline' : 'Checking…';
    systems.className = db === 'up' ? 'signal-ok' : db === 'down' ? 'signal-down' : 'signal-warn';
    access.textContent = payments === 'configured' ? 'Configured' : 'Not configured';
    access.className = payments === 'configured' ? 'signal-ok' : 'signal-warn';
  } catch (error) {
    [workforce, systems, access].forEach((el) => { if (el) { el.textContent = 'Unavailable'; el.className = 'signal-down'; } });
  }
}

function activeEmployee() {
  return employees.find((employee) => employee.id === activeEmployeeId);
}

async function loadEmployees() {
  const roster = $('#conversation-employees');
  try {
    employees = await responseJson('/api/employees');
    if (!employees.length) {
      roster.innerHTML = '<p class="empty-state-sm">Your crew is empty. Add employees in Workspace Settings.</p>';
      return;
    }
    roster.innerHTML = employees.map((employee) => `
      <button class="conversation-person" data-employee-id="${safe(employee.id)}" type="button">
        <span class="avatar" style="--color:${safe(employee.color)}">${safe(employee.name?.[0] || 'AI')}</span>
        <span><b>${safe(employee.name)}</b><small>${safe(employee.role)}</small></span><i class="person-status" aria-label="Available"></i>
      </button>`).join('');
    const preferred = employees.some((employee) => employee.id === activeEmployeeId) ? activeEmployeeId : employees[0].id;
    await selectEmployee(preferred);
  } catch (error) {
    console.error('Unable to load employees:', error);
    roster.innerHTML = '<p class="empty-state-sm">Your crew could not be loaded right now.</p>';
  }
}

async function selectEmployee(employeeId) {
  activeEmployeeId = employeeId;
  const employee = activeEmployee();
  if (!employee) return;
  document.querySelectorAll('.conversation-person').forEach((item) => item.classList.toggle('active', item.dataset.employeeId === employeeId));
  const avatar = $('#chat-employee-avatar');
  avatar.textContent = employee.name?.slice(0, 2).toUpperCase() || 'AI';
  avatar.style.setProperty('--color', employee.color || '#c5f36a');
  $('#chat-employee-name').textContent = employee.name;
  $('#chat-employee-role').textContent = `${employee.role} · ${employee.department}`;
  const permissions = employee.permissions || [];
  $('#chat-employee-tools').innerHTML = permissions.length
    ? permissions.map((permission) => `<span class="chat-tool">${safe(permission.tool_name)} · ${safe(String(permission.access_level).replace('_', ' '))}</span>`).join('')
    : 'No MCP-style connectors attached yet';
  $('#conversation-input').disabled = false;
  $('#conversation-send').disabled = false;
  $('#conversation-input').placeholder = `Message ${employee.name}…`;
  await loadConversation();
}

function renderConversation(messages) {
  const container = $('#conversation-messages');
  if (!messages.length) {
    const employee = activeEmployee();
    container.innerHTML = `<p class="empty-state-sm">Start a direct line with ${safe(employee?.name || 'your employee')}. They will respond here and retain the conversation context.</p>`;
    return;
  }
  container.innerHTML = messages.map((message) => `
    <div class="chat-message ${message.sender === 'manager' ? 'manager' : 'employee'}">${safe(message.body)}<time>${message.sender === 'manager' ? 'You' : safe(activeEmployee()?.name || 'Employee')} · ${formatTime(message.created_at)}</time></div>`).join('');
  container.scrollTop = container.scrollHeight;
}

async function loadConversation() {
  if (!activeEmployeeId) return;
  const container = $('#conversation-messages');
  container.innerHTML = '<p class="chat-typing">Opening direct line…</p>';
  try {
    const conversation = await responseJson(`/api/employees/${encodeURIComponent(activeEmployeeId)}/conversation`);
    renderConversation(conversation.messages || []);
  } catch (error) {
    container.innerHTML = `<p class="empty-state-sm">${safe(error.message)}</p>`;
  }
}

async function sendConversation(event) {
  event.preventDefault();
  const input = $('#conversation-input');
  const message = input.value.trim();
  if (!message || !activeEmployeeId) return;
  const button = $('#conversation-send');
  button.disabled = true;
  input.disabled = true;
  const container = $('#conversation-messages');
  container.insertAdjacentHTML('beforeend', `<div class="chat-message manager">${safe(message)}<time>You · Now</time></div><p class="chat-typing">${safe(activeEmployee()?.name || 'Employee')} is working…</p>`);
  container.scrollTop = container.scrollHeight;
  input.value = '';
  try {
    const result = await responseJson(`/api/employees/${encodeURIComponent(activeEmployeeId)}/conversation`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message })
    });
    const typing = $('.chat-typing');
    if (typing) typing.remove();
    container.insertAdjacentHTML('beforeend', `<div class="chat-message employee">${safe(result.employee_message.body)}<time>${safe(activeEmployee()?.name || 'Employee')} · Now</time></div>`);
    container.scrollTop = container.scrollHeight;
    loadActivity();
  } catch (error) {
    const typing = $('.chat-typing');
    if (typing) typing.textContent = error.upgradeRequired ? `${error.message} Open Workspace Settings to upgrade.` : error.message;
    else container.insertAdjacentHTML('beforeend', `<p class="empty-state-sm">${safe(error.message)}</p>`);
  } finally {
    button.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

async function loadApprovals() {
  const countBadge = $('#approval-count-badge'); const statusText = $('#approvals-status-text'); const container = $('#approvals-list');
  try {
    const approvals = await responseJson('/api/approvals');
    countBadge.textContent = approvals.length;
    statusText.textContent = approvals.length ? `${approvals.length} waiting for review` : 'Queue clear';
    const reviewSignal = $('#signal-review');
    if (reviewSignal) {
      reviewSignal.textContent = approvals.length ? `${approvals.length} waiting` : 'Queue clear';
      reviewSignal.className = approvals.length ? 'signal-warn' : 'signal-ok';
    }
    container.innerHTML = approvals.length ? approvals.map((approval) => `<div class="approval-item"><div class="approval-top"><span class="approval-tool">${safe(approval.tool_name)}</span><span class="live-pill">REVIEW NEEDED</span></div><p class="approval-summary">${safe(approval.action_summary)}</p><div class="approval-actions"><button class="btn-sm btn-approve" data-approval-id="${approval.id}" data-approval-status="approved">Approve ✓</button><button class="btn-sm btn-reject" data-approval-id="${approval.id}" data-approval-status="rejected">Reject</button></div></div>`).join('') : '<p class="empty-state-sm">Nothing needs your approval. Caveworkers will always pause consequential actions.</p>';
  } catch (error) { console.error('Unable to load approvals:', error); statusText.textContent = 'Queue unavailable'; }
}

async function resolveApproval(id, status) {
  try { await responseJson(`/api/approvals/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) }); await Promise.all([loadApprovals(), loadActivity()]); } catch (error) { alert(error.message); }
}

async function loadTools() {
  const container = $('#tools-catalog');
  try {
    const connectors = await responseJson('/api/mcp-connectors');
    container.innerHTML = connectors.length ? connectors.map((connector) => `<div class="tool-card"><div class="tool-card-title"><span>${safe(connector.name.toUpperCase())}</span><span class="live-pill">MCP READY</span></div><p class="tool-card-desc">${safe(connector.description)}</p><span class="tool-server">${safe(connector.server)} · ${safe(String(connector.default_access_level).replace('_', ' '))}</span></div>`).join('') : '<p class="empty-state-sm">No connectors are available.</p>';
  } catch (error) { console.error('Unable to load connectors:', error); }
}

async function loadKnowledge() {
  const container = $('#knowledge-list');
  try { const documents = await responseJson('/api/knowledge'); container.innerHTML = documents.length ? documents.map((document) => `<div class="knowledge-item"><b>[${safe(String(document.category).toUpperCase())}] ${safe(document.title)}</b><span>${safe(String(document.content).slice(0, 90))}${document.content.length > 90 ? '…' : ''}</span></div>`).join('') : '<p class="empty-state-sm">No context has been added yet.</p>'; } catch (error) { console.error('Unable to load knowledge:', error); }
}

async function loadOfficeStatus() {
  const roster = $('#digital-office-roster');
  const countTag = $('#office-count-tag');
  if (!roster) return;
  try {
    const data = await responseJson('/api/office/status');
    if (countTag) countTag.textContent = `${data.total_active_employees} EMPLOYEES ACTIVE`;
    roster.innerHTML = (data.office || []).map((emp) => `
      <div class="office-card">
        <div class="office-card-top">
          <div class="office-card-name">
            <span class="avatar" style="--color:${safe(emp.color)}">${safe(emp.name?.[0] || 'AI')}</span>
            <div><b>${safe(emp.name)}</b><small>${safe(emp.role)}</small></div>
          </div>
          <span class="office-status-pill ${safe(emp.status)}">${safe(emp.status.replace('_', ' ').toUpperCase())}</span>
        </div>
        <div class="office-task-desc">${safe(emp.current_task)}</div>
        <div class="office-meta">
          <span>${emp.collaborating_with ? `🤝 ${safe(emp.collaborating_with)}` : `Tools: ${safe((emp.tools || []).join(', '))}`}</span>
          <span class="office-autonomy">${safe(emp.autonomy_level)}</span>
        </div>
      </div>`).join('');
  } catch (err) {
    console.error('Unable to load office status:', err);
  }
}

async function loadRoiMetrics() {
  try {
    const roi = await responseJson('/api/roi');
    if ($('#roi-human-cost')) $('#roi-human-cost').textContent = roi.human_equivalent_monthly_cost;
    if ($('#roi-ai-cost')) $('#roi-ai-cost').textContent = roi.caveworkers_subscription_cost;
    if ($('#roi-net-savings')) $('#roi-net-savings').textContent = roi.net_monthly_savings;
    if ($('#roi-annual-projection')) $('#roi-annual-projection').textContent = `Projected Annual: ${roi.annual_projected_savings}`;
    if ($('#roi-multiplier-tag')) $('#roi-multiplier-tag').textContent = `${roi.roi_multiplier} ROI SAVINGS`;
  } catch (err) {
    console.error('Unable to load ROI metrics:', err);
  }
}

let workroomSource = null;
let workroomMessages = [];
let workroomPresence = [];
let workroomTasks = [];

function renderWorkroomPresence(presence = workroomPresence) {
  const container = $('#workroom-presence');
  if (!container) return;
  container.innerHTML = presence.length ? presence.map((entry) => {
    const employee = employees.find((item) => item.id === entry.employee_id) || {};
    const status = entry.status || 'idle';
    return `<div class="workroom-presence-card"><span class="presence-avatar" style="color:${safe(employee.color || '#8ee6ff')}; border-color:${safe(employee.color || '#8ee6ff')}66; background:${safe(employee.color || '#8ee6ff')}18">${safe((employee.name || entry.employee_id || 'AI').charAt(0))}</span><div><b>${safe(employee.name || entry.employee_id || 'AI employee')}</b><small>${safe(employee.role || 'Specialist')} · <span class="presence-status ${safe(status)}">${safe(status)}</span></small></div></div>`;
  }).join('') : '<p class="empty-state-sm">No active employees are available yet.</p>';
}

function renderWorkroomMessages() {
  const container = $('#workroom-thread');
  if (!container) return;
  container.innerHTML = workroomMessages.length ? workroomMessages.slice(-40).reverse().map((message) => `<div class="workroom-message"><span class="workroom-message-avatar">${safe(String(message.sender || 'AI').charAt(0))}</span><div><div class="workroom-message-meta"><b>${safe(message.sender || 'Caveworkers')}</b><span>to ${safe(message.receiver || 'Company')}</span><time>${formatTime(message.created_at)}</time></div><p>${safe(message.body || '')}</p>${message.task_id ? `<small class="workroom-task-ref">Task #${safe(message.task_id)}</small>` : ''}</div></div>`).join('') : '<p class="empty-state-sm">The workroom will show employee updates when the worker is active.</p>';
}

function rebuildWorkroomMessages() {
  const messages = [];
  workroomTasks.forEach((task) => (task.trace || []).forEach((step) => {
    if (!step || !step.body) return;
    messages.push({ ...step, task_id: task.id });
  }));
  const seen = new Set();
  workroomMessages = messages.filter((message) => {
    const key = `${message.task_id}:${message.created_at}:${message.sender}:${message.receiver}:${message.body}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()).slice(-100);
  renderWorkroomMessages();
}

function upsertWorkroomPresence(entry) {
  if (!entry || !entry.employee_id) return;
  const existing = workroomPresence.findIndex((item) => item.employee_id === entry.employee_id);
  if (existing >= 0) workroomPresence[existing] = { ...workroomPresence[existing], ...entry };
  else workroomPresence.push(entry);
  renderWorkroomPresence();
}

function applyWorkroomEvent(event) {
  if (!event) return;
  if (event.type === 'presence' && event.presence) upsertWorkroomPresence(event.presence);
  if (event.type === 'message' && event.message) { workroomMessages.push(event.message); renderWorkroomMessages(); }
  if (event.type === 'task_update' && event.task) {
    const index = workroomTasks.findIndex((task) => task.id === event.task.id);
    if (index >= 0) workroomTasks[index] = event.task; else workroomTasks.push(event.task);
    rebuildWorkroomMessages();
    loadTaskDashboard();
  }
  const status = $('#workroom-status');
  if (status) { status.textContent = 'LIVE'; status.classList.add('signal-ok'); }
}

async function loadWorkroomSnapshot() {
  try {
    const snapshot = await responseJson('/api/workforce/workroom');
    workroomPresence = snapshot.presence || [];
    workroomTasks = snapshot.tasks || [];
    renderWorkroomPresence();
    rebuildWorkroomMessages();
    const status = $('#workroom-status');
    if (status) { status.textContent = 'LIVE'; status.classList.add('signal-ok'); }
  } catch (error) {
    const status = $('#workroom-status');
    if (status) status.textContent = 'UNAVAILABLE';
    console.error('Unable to load company workroom:', error);
  }
}

function connectWorkroom() {
  if (!window.EventSource) return;
  if (workroomSource) workroomSource.close();
  workroomSource = new EventSource('/api/workforce/stream');
  const handleEvent = (event) => { try { applyWorkroomEvent(JSON.parse(event.data)); } catch (error) { console.warn('Invalid workroom update:', error); } };
  workroomSource.onopen = () => { const status = $('#workroom-status'); if (status) { status.textContent = 'LIVE'; status.classList.add('signal-ok'); } };
  workroomSource.onmessage = handleEvent;
  workroomSource.addEventListener('connected', handleEvent);
  workroomSource.addEventListener('presence', handleEvent);
  workroomSource.addEventListener('task_update', handleEvent);
  workroomSource.onerror = () => { const status = $('#workroom-status'); if (status) status.textContent = 'RECONNECTING…'; };
}

window.addEventListener('beforeunload', () => workroomSource?.close());

let allTasksCache = [];
let currentTaskFilter = 'all';

async function loadTaskDashboard() {
  const grid = $('#task-dashboard-grid');
  const summary = $('#task-metrics-summary');
  const badge = $('#task-count-badge');
  if (!grid) return;

  try {
    const res = await responseJson('/api/tasks');
    allTasksCache = res.tasks || [];
    if (badge) badge.textContent = res.total_count || allTasksCache.length;
    if (summary) summary.textContent = `${res.total_count || 0} TOTAL TASKS`;

    if ($('#count-all')) $('#count-all').textContent = res.total_count || 0;
    if ($('#count-completed')) $('#count-completed').textContent = res.completed_count || 0;
    if ($('#count-pending')) $('#count-pending').textContent = res.pending_approval_count || 0;

    renderFilteredTasks();
  } catch (err) {
    console.error('Unable to load Task Dashboard:', err);
    grid.innerHTML = '<p class="empty-state-sm">Unable to load tasks at this time.</p>';
  }
}

function setTaskFilter(filter, btn) {
  currentTaskFilter = filter;
  document.querySelectorAll('.filter-tab').forEach((t) => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderFilteredTasks();
}

function filterTaskDashboard() {
  renderFilteredTasks();
}

function renderFilteredTasks() {
  const grid = $('#task-dashboard-grid');
  if (!grid) return;

  const searchQuery = ($('#task-search-input')?.value || '').toLowerCase().trim();

  let filtered = allTasksCache.filter((t) => {
    if (currentTaskFilter !== 'all' && t.status !== currentTaskFilter) return false;
    if (searchQuery) {
      const matchQ = (t.question || '').toLowerCase().includes(searchQuery);
      const matchA = (t.answer || '').toLowerCase().includes(searchQuery);
      const matchO = (t.owner_info?.name || '').toLowerCase().includes(searchQuery);
      if (!matchQ && !matchA && !matchO) return false;
    }
    return true;
  });

  if (!filtered.length) {
    grid.innerHTML = '<p class="empty-state-sm">No tasks match the selected filter.</p>';
    return;
  }

  grid.innerHTML = filtered.map((t) => {
    const owner = t.owner_info || {};
    const statusText = t.status === 'pending_approval' ? 'Awaiting Sign-off' : t.status === 'completed' ? 'Completed' : 'In Progress';

    return `
      <div class="task-card" id="task-card-${t.id}">
        <div class="task-card-top">
          <div class="task-owner-info">
            <span class="task-owner-avatar" style="background:${owner.color || '#3b82f6'}22; color:${owner.color || '#3b82f6'}; border:1px solid ${owner.color || '#3b82f6'}55">
              ${safe(owner.name?.[0] || 'A')}
            </span>
            <div class="task-owner-name">
              <b>${safe(owner.name || 'AI Employee')}</b>
              <small>${safe(owner.role || 'AI Specialist')} · ${safe(owner.employee_code || 'CW_EMP')}</small>
            </div>
          </div>
          <span class="task-status-pill ${safe(t.status)}">${safe(statusText)}</span>
        </div>

        <div class="task-question">Task #${t.id}: ${safe(t.question)}</div>

        ${t.plan ? `<div class="task-plan-box"><b>EXECUTION PLAN:</b> ${safe(t.plan)}</div>` : ''}
        ${t.participants?.length ? `<div class="task-team-line"><b>GROUP:</b> ${safe(t.participants.join(' · '))}</div>` : ''}

        <div class="task-answer-box">${safe(t.answer || 'Processing task execution...')}</div>

        <div class="task-actions">
          <span class="task-time">Created: ${formatTime(t.created_at)}</span>
          <div class="task-btn-group">
            ${t.has_pending_approval ? `<button class="btn-sm btn-approve" onclick="resolveApproval(${t.approval_id}, 'approved')">Approve HITL Action ✓</button>` : ''}
            <button class="btn-sm text-button group-chat-button" onclick="toggleTaskGroupChat(${t.id})">Open AI group chat ↗</button>
            <button class="btn-sm text-button" onclick="toggleTaskTrace(${t.id})">Inspect Full Trace ▾</button>
          </div>
        </div>

        <div class="task-group-chat-drawer" id="group-chat-drawer-${t.id}">
          <div class="group-chat-head"><div><p class="panel-kicker">AI GROUP CHAT</p><b>Visible collaboration room</b></div><span>${safe((t.participants || []).length ? `${t.participants.length} participants` : 'Task activity')}</span></div>
          <p class="group-chat-help">This is the manager-visible record of how the team delegated and consolidated the work. Tool writes remain paused until approval.</p>
          <div class="task-group-messages">
            ${(t.trace || []).filter((step) => ['received', 'team_context', 'group_message', 'approval_required', 'completed'].includes(step.kind)).map((step) => `
              <div class="task-group-message ${safe(step.kind)}">
                <span class="group-message-avatar">${safe(String(step.sender || 'AI').charAt(0))}</span>
                <div><div class="group-message-meta"><b>${safe(step.sender)}</b><span>to ${safe(step.receiver)}</span><time>${formatTime(step.created_at)}</time></div><p>${safe(step.body)}</p></div>
              </div>`).join('') || '<p class="empty-state-sm">No group messages were recorded for this task.</p>'}
          </div>
        </div>

        <div class="task-trace-drawer" id="trace-drawer-${t.id}">
          <p class="panel-kicker" style="margin-bottom:8px;">AGENT INTERFACE &amp; EXECUTION STEPS</p>
          <div class="trace-steps">
            ${(t.trace || []).map((step) => `
              <div class="trace-step ${safe(step.kind)}">
                <div class="trace-step-top">
                  <span class="trace-badge">${safe(step.kind)}</span>
                  <b>${safe(step.sender)}</b> → <b>${safe(step.receiver)}</b>
                  <time>${formatTime(step.created_at)}</time>
                </div>
                <div>${safe(step.body)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function toggleTaskTrace(taskId) {
  const drawer = document.getElementById(`trace-drawer-${taskId}`);
  if (drawer) {
    drawer.style.display = drawer.style.display === 'block' ? 'none' : 'block';
  }
}

function toggleTaskGroupChat(taskId) {
  const drawer = document.getElementById(`group-chat-drawer-${taskId}`);
  if (drawer) {
    const shouldOpen = drawer.style.display !== 'block';
    drawer.style.display = shouldOpen ? 'block' : 'none';
    if (shouldOpen) drawer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function loadActivity() {
  const container = $('#activity');
  try { const activity = await responseJson('/api/activity'); const messages = activity.messages || []; container.innerHTML = messages.length ? messages.map((message) => `<div class="event"><time>${formatTime(message.created_at)}</time><b>${safe(message.sender)}</b> → <b>${safe(message.receiver)}</b><span> · ${safe(message.kind)}</span> — ${safe(message.body)}</div>`).join('') : '<p class="empty-state">No activity yet. Your work will appear here as your crew gets started.</p>'; } catch (error) { console.error('Unable to load activity:', error); }
}

function renderTrace(trace) { const container = $('#trace-steps'); container.innerHTML = trace?.length ? trace.map((step) => `<div class="trace-step ${safe(step.kind)}"><div class="trace-step-top"><span class="trace-badge">${safe(step.kind)}</span><b>${safe(step.sender)}</b> → <b>${safe(step.receiver)}</b><time>${formatTime(step.created_at)}</time></div><div>${safe(step.body)}</div></div>`).join('') : '<p class="empty-state-sm">No execution trace was recorded.</p>'; }

$('#conversation-form')?.addEventListener('submit', sendConversation);
$('#knowledge-form')?.addEventListener('submit', async (event) => { event.preventDefault(); const title = $('#knowledge-title').value.trim(); const content = $('#knowledge-content').value.trim(); if (!title || !content) return; try { await responseJson('/api/knowledge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, content, category: 'policy' }) }); $('#knowledge-title').value = ''; $('#knowledge-content').value = ''; await loadKnowledge(); } catch (error) { alert(error.message); } });
$('#run')?.addEventListener('click', async () => { const request = $('#request').value.trim(); if (!request) return $('#request').focus(); const button = $('#run'); button.disabled = true; button.textContent = 'Routing task…'; try { const task = await responseJson('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request }) }); $('#results').hidden = false; $('#result-title').textContent = `Task #${task.id} · ${task.participants.join(' → ')}`; $('#result-answer').textContent = task.answer; renderTrace(task.trace); $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' }); await Promise.all([loadApprovals(), loadActivity(), loadTaskDashboard()]); } catch (error) { $('#results').hidden = false; $('#result-title').textContent = error.upgradeRequired ? 'Trial ended' : 'Task could not run'; $('#result-answer').textContent = error.upgradeRequired ? `${error.message} Open Workspace Settings to choose a paid plan.` : error.message; } finally { button.disabled = false; button.innerHTML = 'Route task <span>↗</span>'; } });
document.addEventListener('click', (event) => { const person = event.target.closest('.conversation-person'); if (person) selectEmployee(person.dataset.employeeId); const approval = event.target.closest('[data-approval-id]'); if (approval) resolveApproval(approval.dataset.approvalId, approval.dataset.approvalStatus); });
$('#refresh')?.addEventListener('click', () => Promise.all([loadBilling(), loadEmployees(), loadApprovals(), loadTools(), loadKnowledge(), loadActivity(), loadHealth(), loadTaskDashboard()]));
$('#menuButton')?.addEventListener('click', () => document.querySelector('.side-rail')?.classList.toggle('is-open'));
$('#logout-btn')?.addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    if (window.firebaseAuth && window.firebaseAuth.signOut) {
      await window.firebaseAuth.signOut();
    }
  } catch (err) { console.warn('Firebase signout note:', err); }
  try {
    await fetch('/api/session-logout', { method: 'POST' });
  } catch (err) { console.warn('Logout fetch note:', err); }
  window.location.replace('/login');
});

(async () => { await Promise.all([loadBilling(), loadApprovals(), loadTools(), loadKnowledge(), loadActivity(), loadHealth(), loadTaskDashboard()]); await loadEmployees(); await loadWorkroomSnapshot(); connectWorkroom(); })();


// Liquid-glass interaction polish. This is progressive enhancement only; all core task flows above remain independent of motion.
(function initialiseLiquidGlassMotion() {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const revealTargets = document.querySelectorAll('.command-intro, .composer, .signal-strip, .panel-block, .results-block');

  revealTargets.forEach((element, index) => {
    element.classList.add('reveal');
    element.style.setProperty('--reveal-delay', `${Math.min(index * 35, 180)}ms`);
  });

  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealTargets.forEach((element) => element.classList.add('is-visible'));
  } else {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });
    revealTargets.forEach((element) => revealObserver.observe(element));
  }

  document.addEventListener('pointermove', (event) => {
    const surface = event.target.closest('.composer, .panel-block, .results-block');
    if (!surface) return;
    const bounds = surface.getBoundingClientRect();
    surface.style.setProperty('--pointer-x', `${event.clientX - bounds.left}px`);
    surface.style.setProperty('--pointer-y', `${event.clientY - bounds.top}px`);
  }, { passive: true });

  document.addEventListener('pointerleave', (event) => {
    const surface = event.target.closest?.('.composer, .panel-block, .results-block');
    if (!surface) return;
    surface.style.removeProperty('--pointer-x');
    surface.style.removeProperty('--pointer-y');
  }, true);
})();
