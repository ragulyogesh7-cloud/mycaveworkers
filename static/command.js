const $ = (selector) => document.querySelector(selector);

let employees = [];
let workroomSource = null;
let workroomMessages = [];
let workroomPresence = [];
let workroomTasks = [];
let taskSummaries = [];
let pendingMessages = [];
let deletedChatIds = new Set();
let lastRenderedFeedSignature = '';
let roomDirectoryState = { catalog: [], categories: [], query: '', category: '', showAll: false, open: false, setupConnector: null, setupServer: null };
let trialCountdownTimer = null;
let soundEnabled = false;
let audioContext = null;
let voiceEnabled = false;
let availableSpeechVoices = [];

const EMPLOYEE_VOICE_PROFILES = Object.freeze({
  data_analyst: { label: 'Measured British English', locale: 'en-GB', gender: 'male', hints: ['george', 'daniel', 'google uk english male'], rate: 0.91, pitch: 0.92 },
  cybersecurity_analyst: { label: 'Precise British English', locale: 'en-GB', gender: 'female', hints: ['serena', 'kate', 'google uk english female'], rate: 0.88, pitch: 0.96 },
  backend_developer: { label: 'Clear Australian English', locale: 'en-AU', gender: 'male', hints: ['lee', 'google australian english'], rate: 0.94, pitch: 0.9 },
  qa_engineer: { label: 'Warm Indian English', locale: 'en-IN', gender: 'female', hints: ['heera', 'samantha', 'google us english female'], rate: 0.98, pitch: 1.04 },
  sarah: { label: 'Warm Indian English', locale: 'en-IN', gender: 'female', hints: ['heera', 'samantha', 'google us english female'], rate: 0.98, pitch: 1.04 },
  david: { label: 'Measured British English', locale: 'en-GB', gender: 'male', hints: ['george', 'daniel', 'google uk english male'], rate: 0.91, pitch: 0.92 },
  alex: { label: 'Calm American English', locale: 'en-US', gender: 'male', hints: ['guy', 'mark', 'google us english'], rate: 0.96, pitch: 0.97 },
  mike: { label: 'Clear Australian English', locale: 'en-AU', gender: 'male', hints: ['lee', 'google australian english'], rate: 0.94, pitch: 0.9 },
  iris: { label: 'Precise British English', locale: 'en-GB', gender: 'female', hints: ['serena', 'kate', 'google uk english female'], rate: 0.88, pitch: 0.96 }
});

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

function refreshSpeechVoices() {
  if (!('speechSynthesis' in window)) return [];
  availableSpeechVoices = window.speechSynthesis.getVoices() || [];
  return availableSpeechVoices;
}

function speechVoiceProfile(employeeId) {
  return EMPLOYEE_VOICE_PROFILES[String(employeeId || '').toLowerCase()] || { label: 'Natural workspace voice', locale: 'en-IN', gender: 'neutral', hints: [], rate: 0.96, pitch: 1 };
}

function chooseSpeechVoice(profile) {
  const voices = refreshSpeechVoices();
  if (!voices.length) return null;
  const locale = profile.locale.toLowerCase();
  const hints = profile.hints.map((hint) => hint.toLowerCase());
  return [...voices].sort((a, b) => {
    const score = (voice) => {
      const name = String(voice.name || '').toLowerCase();
      const voiceLocale = String(voice.lang || '').toLowerCase();
      let value = voiceLocale === locale ? 70 : voiceLocale.startsWith(locale.slice(0, 2)) ? 42 : 0;
      if (voice.localService === false) value += 18;
      if (/natural|neural|premium|enhanced|online/.test(name)) value += 16;
      if (hints.some((hint) => name.includes(hint))) value += 45;
      if (profile.gender === 'female' && /female|woman|samantha|heera|hazel|serena|karen|susan|raveena|ava|allison|kate/.test(name)) value += 8;
      if (profile.gender === 'male' && /male|man|george|daniel|guy|mark|lee|ravi/.test(name)) value += 8;
      return value;
    };
    return score(b) - score(a);
  })[0] || null;
}

function setVoiceToggle() {
  const button = $('#voice-toggle');
  if (!button) return;
  button.disabled = !('speechSynthesis' in window);
  button.setAttribute('aria-pressed', String(voiceEnabled));
  button.classList.toggle('is-on', voiceEnabled);
  const label = button.querySelector('.sound-toggle-label');
  const icon = button.querySelector('.sound-toggle-icon');
  if (label) label.textContent = voiceEnabled ? 'Voice on' : 'Voice off';
  if (icon) icon.textContent = voiceEnabled ? '◉' : '◌';
  button.title = voiceEnabled ? 'Voice mode is on. New final answers will be read aloud.' : 'Turn on voice mode for employee final answers.';
}

function speechText(value) {
  return cleanChatCopy(value).replace(/\[[^\]]+\]/g, '').slice(0, 900).trim();
}

function speakEmployeeMessage(message, employee, force = false) {
  if ((!voiceEnabled && !force) || !('speechSynthesis' in window) || !employee) return;
  const text = speechText(message?.body || '');
  if (!text) return;
  const profile = speechVoiceProfile(employee.id);
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = profile.locale;
  utterance.rate = profile.rate;
  utterance.pitch = profile.pitch;
  const voice = chooseSpeechVoice(profile);
  if (voice) utterance.voice = voice;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function voiceActionMarkup(message, employee) {
  if (!employee || message.pending || !message.body || message.kind === 'failure') return '';
  const profile = speechVoiceProfile(employee.id);
  return `<button class="message-voice" data-speak-message-id="${safe(chatMessageId(message))}" data-speak-employee="${safe(employee.id)}" type="button" aria-label="Play ${safe(employee.name)}'s voice" title="Play ${safe(employee.name)}'s voice · ${safe(profile.label)}">Voice</button>`;
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

async function loadRoiDashboard() {
  const ids = ['roi-hours-saved', 'roi-tasks-completed', 'roi-actions-automated', 'roi-approvals', 'roi-value-inr', 'roi-note'];
  if (!ids.some((id) => document.getElementById(id))) return;
  try {
    const roi = await responseJson('/api/roi');
    const set = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
    set('roi-hours-saved', `${Number(roi.estimated_hours_saved || 0).toLocaleString()}h`);
    set('roi-tasks-completed', Number(roi.tasks_completed || 0).toLocaleString());
    set('roi-actions-automated', Number(roi.actions_automated || 0).toLocaleString());
    set('roi-approvals', Number(roi.approvals_requested || 0).toLocaleString());
    set('roi-value-inr', `₹${Number(roi.estimated_value_inr || 0).toLocaleString('en-IN')}`);
    set('roi-note', roi.evidence_note || 'Based on this workspace activity and the displayed assumptions.');
  } catch (error) {
    const note = document.getElementById('roi-note');
    if (note) note.textContent = 'Value metrics will appear after the first workspace task.';
  }
}

async function loadActivationDashboard() {
  const root = document.getElementById('activation-dashboard');
  if (!root) return;
  try {
    const data = await responseJson('/api/usage');
    const activation = data.activation || {};
    const milestones = Array.isArray(activation.milestones) ? activation.milestones : [];
    const completed = milestones.filter((milestone) => milestone.completed).length;
    const total = milestones.length || Number(activation.total || 0) || 1;
    const progress = Math.round((completed / total) * 100);
    const count = document.getElementById('activation-count');
    const bar = document.getElementById('activation-progress-bar');
    const copy = document.getElementById('activation-progress-copy');
    const next = document.getElementById('activation-next-action');
    const taskUsage = document.getElementById('activation-task-usage');
    const toolUsage = document.getElementById('activation-tool-usage');
    if (count) count.textContent = `${completed}/${total}`;
    if (bar) bar.style.width = `${progress}%`;
    if (copy) copy.textContent = activation.next_action || (completed === total ? 'Your workspace has reached the first activation milestone.' : 'Complete one milestone to unlock the next step.');
    if (next) {
      const action = activation.next_action || '';
      const href = activation.next_action_url || '';
      next.innerHTML = action ? `${safe(action)}${href ? ` <a href="${safe(href)}">Open ↗</a>` : ''}` : 'Your team is ready for the next useful task.';
    }
    const ledger = data.usage || {};
    const taskLimit = Number(data.limits?.max_tasks_per_month || 0);
    const toolLimit = Number(data.limits?.max_tool_calls_per_month || 0);
    if (taskUsage) taskUsage.textContent = `${Number(ledger.tasks_created || 0).toLocaleString()}${taskLimit ? ` / ${taskLimit.toLocaleString()}` : ''}`;
    if (toolUsage) toolUsage.textContent = `${Number(ledger.tool_calls || 0).toLocaleString()}${toolLimit ? ` / ${toolLimit.toLocaleString()}` : ''}`;
  } catch (error) {
    const copy = document.getElementById('activation-progress-copy');
    const next = document.getElementById('activation-next-action');
    if (copy) copy.textContent = 'Activation status is temporarily unavailable.';
    if (next) next.textContent = error.message || 'Try refreshing the Company Room.';
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

function saveRoomCache() {
  try {
    if (employees && employees.length) localStorage.setItem('cw_cached_employees', JSON.stringify(employees));
    if (workroomMessages && workroomMessages.length) localStorage.setItem('cw_cached_messages', JSON.stringify(workroomMessages.slice(-80)));
    if (workroomPresence && workroomPresence.length) localStorage.setItem('cw_cached_presence', JSON.stringify(workroomPresence));
  } catch (_e) {
    // local storage quota safety
  }
}

function restoreRoomCache() {
  try {
    const rawEmployees = localStorage.getItem('cw_cached_employees');
    if (rawEmployees) {
      employees = JSON.parse(rawEmployees);
      renderAssignmentOptions();
      renderAvatarStack();
      renderWorkroomPresence();
      renderWorkroomIntroductions();
      renderWorkforceStage();
    }
    const rawMessages = localStorage.getItem('cw_cached_messages');
    if (rawMessages) {
      workroomMessages = JSON.parse(rawMessages);
      renderRoomFeed();
    }
    const rawPresence = localStorage.getItem('cw_cached_presence');
    if (rawPresence) {
      workroomPresence = JSON.parse(rawPresence);
      renderWorkroomPresence();
    }
  } catch (_e) {
    // ignore corrupted cache
  }
}

function employeeById(employeeId) {
  if (!employeeId) return null;
  const target = String(employeeId).trim().toLowerCase();
  return employees.find((employee) => (employee.id || '').toLowerCase() === target || (employee.name || '').toLowerCase() === target);
}

function avatarMarkup(employee = {}, label = 'AI', extraClass = '') {
  const color = employee.color || '#82e9ff';
  const employeeId = String(employee.id || employee.employee_id || '').toLowerCase();
  const initials = String(label || employee.name || 'AI').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'AI';
  const knownAvatars = ['data_analyst', 'cybersecurity_analyst', 'backend_developer', 'qa_engineer', 'alex', 'arav', 'david', 'emma', 'iris', 'maya', 'mike', 'olivia', 'priya', 'sarah'];
  const hasPortrait = Boolean(employee.avatar_url || knownAvatars.includes(employeeId));
  const portraitUrl = employee.avatar_url || (knownAvatars.includes(employeeId) ? `/static/assets/employee-avatars/${encodeURIComponent(employeeId)}.webp` : '');
  const image = hasPortrait ? `<img class="employee-portrait" src="${safe(portraitUrl)}" alt="${safe(employee.name || initials)}" loading="lazy" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='flex';">` : '';
  return `<span class="employee-dp employee-profile ${extraClass}" style="--avatar-color:${safe(color)}" data-employee-id="${safe(employeeId)}" aria-hidden="true">${image}<span class="profile-initials"${hasPortrait ? ' style="display:none"' : ''}>${safe(initials)}</span></span>`;
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
  const coordinator = employees[0] || { name: 'AI Lead', role: 'Coordinator', color: '#82e9ff', id: 'data_analyst' };
  const peers = employees.filter((employee) => employee.id !== coordinator.id).slice(0, 3);
  const active = workroomPresence.filter((entry) => ['working', 'coordinating', 'reviewing'].includes(entry.status)).length;
  if (activeCount) activeCount.textContent = `${active || employees.length ? active : 0} active`;
  coordinatorNode.innerHTML = `<a class="map-person map-person-coordinator" href="/employee/${encodeURIComponent(coordinator.id || '')}" title="Open ${safe(coordinator.name)}’s workspace">${avatarMarkup(coordinator, coordinator.name?.[0] || 'S', 'map-avatar')}<span><b>${safe(coordinator.name || 'Sarah')}</b><small>${safe(coordinator.role || 'Coordinator')}</small></span></a>`;
  rightNode.innerHTML = peers.map((employee, index) => `<a class="map-person map-person-peer peer-${index + 1}" href="/employee/${encodeURIComponent(employee.id || '')}" title="Open ${safe(employee.name)}’s workspace">${avatarMarkup(employee, employee.name?.[0] || 'AI', 'map-avatar')}<span><b>${safe(employee.name)}</b><small>${safe(employee.role || 'Specialist')}</small></span></a>`).join('');
  roster.innerHTML = employees.slice(0, 8).map((employee, index) => { const status = employeeStatus(employee.id); return `<a class="stage-roster-item" style="--roster-delay:${Math.min(index, 7) * 35}ms;--avatar-color:${safe(employee.color || '#82e9ff')}" href="/employee/${encodeURIComponent(employee.id)}" data-stage-employee-id="${safe(employee.id)}">${avatarMarkup(employee, employee.name?.[0] || 'AI', 'roster-avatar')}<span><b>${safe(employee.name)}</b><small>${safe(employee.role || 'Specialist')}</small></span><em class="roster-state ${safe(status)}">${safe(status.replace(/_/g, ' '))}</em></a>`; }).join('');
}

function mentionedEmployeeId(request) {
  const text = String(request || '').toLowerCase();
  return employees.find((employee) => {
    const name = String(employee.name || '').trim().toLowerCase();
    if (!name) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?:^|[^a-z])@?${escaped}(?:$|[^a-z])`, 'i').test(text);
  })?.id || '';
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
    saveRoomCache();
    renderAssignmentOptions();
    renderAvatarStack();
    renderWorkroomPresence();
    renderWorkroomIntroductions();
    renderWorkforceStage();
  } catch (error) {
    console.error('Unable to load employees:', error);
    setRoomNotice('Your employee list could not be loaded. Reconnect and try again.', 'error');
  }
}

function renderWorkroomIntroductions() {
  const container = $('#workroom-introductions');
  if (!container) return;
  container.innerHTML = employees.length ? employees.map((employee) => `<article class="intro-card" style="--avatar-color:${safe(employee.color || '#7ee8ff')}">${avatarMarkup(employee, employee.name?.[0] || 'AI', 'intro-dp')}<div class="intro-card-copy"><b>${safe(employee.name)}</b><small>${safe(employee.role || 'Specialist')}</small><p>${safe(employee.capability_summary || `Available for ${employee.department || 'company'} work.`)}</p></div><button class="intro-ask" type="button" data-introduce-employee="${safe(employee.id)}">Ask for intro</button></article>`).join('') : '<p class="empty-state-sm">Your employee introductions will appear here.</p>';
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
  renderWorkroomIntroductions();
}

function messageKey(message) {
  return message.chat_id || `${message.task_id || 'room'}:${message.created_at || ''}:${message.sender_id || message.sender || ''}:${message.receiver_id || message.receiver || ''}:${message.body || ''}`;
}

function chatMessageId(message) { return String(message?.chat_id || messageKey(message)); }

function feedMessageSignature(message) {
  return [chatMessageId(message), message.kind || '', message.created_at || '', message.body || '', message.pending ? 'pending' : 'settled', message.chat_visible === false ? 'hidden' : 'visible'].join('¦');
}

function messageTone(kind) {
  if (kind === 'approval_required') return 'approval';
  if (['blocked', 'action_failed', 'worker_failed'].includes(kind)) return 'failure';
  if (['completed', 'action_completed'].includes(kind)) return 'complete';
  if (['manager_response', 'manager_result', 'final_answer'].includes(kind)) return 'result';
  if (kind === 'introduction') return 'introduction';
  if (['handoff', 'handoff_ack'].includes(kind)) return 'handoff';
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
  const previousScrollTop = container.scrollTop;
  const all = [...workroomMessages, ...pendingMessages].filter((message) => message.chat_visible !== false && message.sender !== 'You' && !deletedChatIds.has(chatMessageId(message))).sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime()).slice(-140);
  const signature = all.map(feedMessageSignature).join('‖');
  const hadRenderedFeed = Boolean(lastRenderedFeedSignature);
  if (signature === lastRenderedFeedSignature && container.childElementCount) {
    updateJumpButton();
    return;
  }
  lastRenderedFeedSignature = signature;
  if (!all.length) {
    container.innerHTML = `<div class="room-empty"><span class="room-empty-mark">✦</span><h3>Your company room is ready.</h3><p>Assign a task below and your team’s routing, collaboration, and review steps will appear here in realtime.</p></div>`;
    updateJumpButton();
    return;
  }
  const fragment = document.createDocumentFragment();
  all.forEach((message, index) => {
    const article = document.createElement('article');
    const tone = messageTone(message.kind);
    const senderText = String(message.sender || '').trim();
    const senderIdText = String(message.sender_id || '').trim().toLowerCase();
    let senderEmployee = null;
    if (message.sender !== 'Manager' && message.sender !== 'You') {
      senderEmployee = employees.find((emp) => 
        (emp.id && emp.id.toLowerCase() === senderIdText) ||
        (emp.id && emp.id.toLowerCase() === senderText.toLowerCase()) ||
        (emp.name && emp.name.toLowerCase() === senderText.toLowerCase()) ||
        (emp.name && senderText.toLowerCase().includes(emp.name.toLowerCase())) ||
        (emp.id && senderText.toLowerCase().includes(emp.id.toLowerCase()))
      );
    }
    article.className = `room-message ${tone}${message.pending ? ' pending' : ''}`;
    if (senderEmployee?.color) article.style.setProperty('--avatar-color', senderEmployee.color);
    article.style.setProperty('--message-delay', `${Math.min(index, 10) * 35}ms`);
    const taskReference = message.task_id ? `<button class="message-task" data-task-id="${safe(message.task_id)}" type="button">Task #${safe(message.task_id)}</button>` : '';
    const approvalAction = message.approval_id ? `<button class="message-approval" data-approval-id="${safe(message.approval_id)}" data-approval-status="approved" type="button">Approve</button>` : '';
    const deleteAction = message.chat_id && message.task_id ? `<button class="message-delete" data-delete-chat-id="${safe(message.chat_id)}" data-delete-task-id="${safe(message.task_id)}" type="button" aria-label="Delete this message" title="Delete message">Delete</button>` : '';
    const voiceAction = voiceActionMarkup(message, senderEmployee);
    const senderName = message.sender === 'Manager' ? 'You' : (senderEmployee?.name || message.sender || 'Caveworkers');
    const recipient = message.receiver && message.receiver !== 'Manager' ? `<span class="message-recipient">to ${safe(message.receiver)}</span>` : '';
    const mentionNames = Array.isArray(message.mentions) ? message.mentions.map((id) => employeeById(id)?.name || id).filter(Boolean) : [];
    const mentionMarkup = mentionNames.length ? `<span class="message-mentions">${mentionNames.map((name) => `@${safe(name)}`).join(' ')}</span>` : '';
    const messageLabel = tone === 'result' ? (message.kind === 'final_answer' ? 'Final answer' : 'Team update') : tone === 'approval' ? 'Needs your attention' : tone === 'failure' ? 'Blocked' : tone === 'complete' ? 'Completed' : tone === 'introduction' ? 'Introduces self' : tone === 'handoff' && message.kind === 'handoff_ack' ? 'Handoff received' : tone === 'handoff' ? 'Handoff' : message.kind === 'team_context' ? 'Team chat' : message.kind === 'queued' ? 'Sarah is coordinating' : '';
    article.dataset.chatId = message.chat_id || '';
    article.innerHTML = `${avatarMarkup(senderEmployee || { id: '', color: tone === 'approval' ? '#ffd78f' : '#82e9ff' }, senderName, 'message-dp')}<div class="message-body"><div class="message-meta"><b>${safe(senderName)}</b>${recipient}${mentionMarkup}${messageLabel ? `<span class="message-label ${tone}">${safe(messageLabel)}</span>` : ''}<time>${formatTime(message.created_at)}</time>${taskReference}${voiceAction}${deleteAction}</div>${tone === 'result' ? '<span class="final-answer-label">Final answer</span>' : ''}<p>${safe(cleanChatCopy(message.body || ''))}</p>${message.pending ? '<span class="typing-dots"><i></i><i></i><i></i></span>' : ''}${approvalAction}</div>`;
    fragment.append(article);
  });
  container.replaceChildren(fragment);
  const restoreScroll = () => {
    if (shouldFollow) container.scrollTop = container.scrollHeight;
    else container.scrollTop = Math.min(previousScrollTop, Math.max(0, container.scrollHeight - container.clientHeight));
    updateJumpButton();
  };
  restoreScroll();
  window.requestAnimationFrame(restoreScroll);
  if (voiceEnabled && hadRenderedFeed) {
    const latestAnswer = [...all].reverse().find((message) => message.sender !== 'Manager' && !message.pending && ['final_answer', 'result', 'complete'].includes(message.kind) && message.body);
    const latestEmployee = latestAnswer ? employeeById(latestAnswer.sender) || employees.find((employee) => employee.name === latestAnswer.sender) : null;
    if (latestAnswer && latestEmployee) window.setTimeout(() => speakEmployeeMessage(latestAnswer, latestEmployee), 80);
  }
  updateJumpButton();
}

function rebuildWorkroomMessages() {
  const source = [];
  workroomTasks.forEach((task) => {
    (task.chat_messages || []).forEach((message) => { if (message?.body) source.push({ ...message, task_id: task.id, chat_visible: true }); });
  });
  const seen = new Set();
  workroomMessages = source.filter((message) => !deletedChatIds.has(chatMessageId(message))).filter((message) => {
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
    if (event.message.chat_visible !== false && !deletedChatIds.has(chatMessageId(event.message)) && !workroomMessages.some((message) => messageKey(message) === key)) workroomMessages.push(event.message);
    saveRoomCache();
    renderRoomFeed(follow);
  }
  if (event.type === 'chat_deleted' && event.chat_id) {
    deletedChatIds.add(String(event.chat_id));
    pendingMessages = pendingMessages.filter((message) => chatMessageId(message) !== String(event.chat_id));
    workroomMessages = workroomMessages.filter((message) => chatMessageId(message) !== String(event.chat_id));
    workroomTasks = workroomTasks.map((task) => String(task.id) === String(event.task_id) ? { ...task, chat_messages: (task.chat_messages || []).filter((message) => chatMessageId(message) !== String(event.chat_id)) } : task);
    saveRoomCache();
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
    saveRoomCache();
    void Promise.all([loadTaskSummaries(), loadApprovals(), loadRoiDashboard(), loadActivationDashboard()]);
  }
  setRoomConnection('LIVE', `${employees.length || 10} employees can address one another in the room.`);
}

async function loadWorkroomSnapshot() {
  try {
    const snapshot = await responseJson('/api/workforce/workroom');
    workroomPresence = snapshot.presence || [];
    workroomTasks = snapshot.tasks || [];
    saveRoomCache();
    renderWorkroomPresence();
    rebuildWorkroomMessages();
    setRoomConnection('LIVE', `${employees.length || 10} employees can address one another in the room.`);
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
  ['connected', 'presence', 'message', 'chat_deleted', 'task_update'].forEach((type) => workroomSource.addEventListener(type, receive));
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

async function deleteChatMessage(taskId, chatId) {
  if (!taskId || !chatId) return;
  try {
    await responseJson(`/api/workforce/tasks/${encodeURIComponent(taskId)}/chat/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
    deletedChatIds.add(String(chatId));
    pendingMessages = pendingMessages.filter((message) => chatMessageId(message) !== String(chatId));
    workroomMessages = workroomMessages.filter((message) => chatMessageId(message) !== String(chatId));
    workroomTasks = workroomTasks.map((task) => String(task.id) === String(taskId) ? { ...task, chat_messages: (task.chat_messages || []).filter((message) => chatMessageId(message) !== String(chatId)) } : task);
    renderRoomFeed(false);
    setRoomNotice('Message deleted from your Company Room.', 'success');
  } catch (error) {
    setRoomNotice(error.message || 'This message could not be deleted.', 'error');
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
  if ((task.chat_messages || []).length) {
    const taskMessages = (task.chat_messages || []).filter((step) => step?.body && !deletedChatIds.has(chatMessageId(step))).map((step) => ({ ...step, task_id: task.id }));
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
  const selectedPreferred = select?.value || '';
  const mentioned = !selectedPreferred ? mentionedEmployeeId(request) : '';
  const preferred = selectedPreferred || mentioned;
  const target = preferred === '__whole_team__' ? 'the whole team' : employeeById(preferred)?.name || 'the best available specialist';
  const leadName = employees[0]?.name || 'Your AI Team';
  const leadId = employees[0]?.id || 'data_analyst';
  const pending = { kind: 'employee_typing', sender: leadName, sender_id: leadId, receiver: target, body: preferred && preferred !== '__whole_team__' ? `${leadName} is bringing ${target} into this conversation…` : `${leadName} is bringing the right specialists into this conversation…`, created_at: new Date().toISOString(), pending: true, chat_visible: true };
  pendingMessages.push(pending);
  renderRoomFeed(true);
  input.value = '';
  button.disabled = true;
  button.innerHTML = '<span class="button-spinner" aria-hidden="true"></span> Working…';
  playCue('submit');
  setExecutionLive('working', 'Routing your outcome', preferred && preferred !== '__whole_team__' ? `${target} is preparing a direct response.` : `Preparing the workforce for ${target}.`);
  setRoomNotice(preferred && preferred !== '__whole_team__' ? `Speaking with ${target} directly.` : `Routing this task to ${target}.`, '');
  try {
    const task = await responseJson('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request, preferred_employee_id: preferred || undefined }) });
    pendingMessages = pendingMessages.filter((entry) => entry !== pending);
    const existingTask = workroomTasks.find((entry) => entry.id === task.id);
    if (!existingTask) workroomTasks.push(task);
    rebuildWorkroomMessages();
    setRoomNotice(`Task #${task.id} is in the company room. The team will post updates here.`, 'success');
    void Promise.all([loadTaskSummaries()]);
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


function roomDirectoryConnectorCard(connector) {
  const connectedEmployees = connector.connected_employee_ids || [];
  const readyEmployees = connector.ready_employee_ids || [];
  const connected = Boolean(connector.connected);
  const ready = Boolean(connector.ready);
  const employeeNames = (ready ? readyEmployees : connectedEmployees).map((id) => employeeById(id)?.name || id).slice(0, 2);
  const needsSecureSetup = connector.connection_mode !== 'google_oauth';
  const statusCopy = ready
    ? `Ready${employeeNames.length ? ` · ${employeeNames.join(', ')}` : ''}`
    : connected
      ? `Connected · access needs attention${employeeNames.length ? ` · ${employeeNames.join(', ')}` : ''}`
      : (needsSecureSetup ? 'Secure setup required' : 'Ready to connect');
  const actionCopy = ready ? 'Manage' : connected ? 'Fix access' : (needsSecureSetup ? 'Configure' : 'Connect');
  const actions = (connector.supported_actions || []).slice(0, 3).map((action) => `<span>${safe(action)}</span>`).join('');
  const stateClass = ready ? 'is-ready' : connected ? 'is-connected is-attention' : '';
  const readinessDetail = connector.connection_states?.length
    ? `<small class="room-directory-readiness">${connector.ready_connection_count || 0}/${connector.connection_count || 0} employee connection${(connector.connection_count || 0) === 1 ? '' : 's'} ready · ${Array.from(new Set((connector.connection_states || []).flatMap((state) => state.granted_tools || []))).slice(0, 3).map((tool) => safe(tool)).join(', ') || 'no tool grant yet'}</small>`
    : '';
  return `<article class="room-directory-card ${stateClass}" style="--directory-color:${safe(connector.icon_tone || 'custom')}"><div class="room-directory-card-top"><span class="room-directory-icon room-directory-icon-${safe(connector.icon_tone || 'custom')}">${safe(connector.icon_label || connector.short_name?.[0] || '?')}</span><div class="room-directory-card-heading"><div><h4>${safe(connector.name)}</h4>${connector.verified ? '<span class="room-directory-verified">✓</span>' : '<span class="room-directory-custom">Custom</span>'}</div><span>${safe(connector.category)}</span></div><span class="room-directory-card-brand"><img src="${safe(connector.brand_logo_url || '/static/logo.jpeg')}" alt="Caveworkers"><small>WORKFORCE</small></span></div><p class="room-directory-card-description">${safe(connector.description)}</p><div class="room-directory-action-chips">${actions}</div><p class="room-directory-card-setup">${safe(connector.setup_copy)}</p>${readinessDetail}<div class="room-directory-card-footer"><span class="room-directory-connection-state ${stateClass}"><i></i>${safe(statusCopy)}</span><button class="room-directory-connect-button ${stateClass}" type="button" data-room-directory-id="${safe(connector.id)}" aria-label="${safe(actionCopy)} ${safe(connector.name)}"><span>${ready ? '✓' : connected ? '!' : '+'}</span>${safe(actionCopy)}</button></div></article>`;
}

function roomDirectoryFiltered() {
  const query = roomDirectoryState.query.trim().toLowerCase();
  const category = roomDirectoryState.category.trim().toLowerCase();
  return roomDirectoryState.catalog.filter((connector) => {
    const categoryMatch = !category || String(connector.category || '').toLowerCase() === category;
    const haystack = [connector.name, connector.short_name, connector.description, connector.category, ...(connector.keywords || [])].join(' ').toLowerCase();
    return categoryMatch && (!query || haystack.includes(query));
  });
}

function renderRoomDirectory() {
  const modal = $('#room-connector-directory');
  if (!modal) return;
  const filtered = roomDirectoryFiltered();
  const search = $('#room-directory-search');
  if (search && search.value !== roomDirectoryState.query) search.value = roomDirectoryState.query;
  const categories = $('#room-directory-categories');
  if (categories) categories.innerHTML = [`<button class="room-directory-category-chip ${!roomDirectoryState.category ? 'active' : ''}" type="button" role="tab" aria-selected="${!roomDirectoryState.category}" data-room-directory-category="">All</button>`, ...(roomDirectoryState.categories || []).map((item) => `<button class="room-directory-category-chip ${roomDirectoryState.category === item ? 'active' : ''}" type="button" role="tab" aria-selected="${roomDirectoryState.category === item}" data-room-directory-category="${safe(item)}">${safe(item)}</button>`)].join('');
  const featured = filtered.filter((connector) => connector.featured).slice(0, 6);
  const featuredGrid = $('#room-directory-featured-grid');
  if (featuredGrid) featuredGrid.innerHTML = featured.length ? featured.map(roomDirectoryConnectorCard).join('') : '<p class="room-directory-empty">No featured connector matches this search.</p>';
  const allGrid = $('#room-directory-all-grid');
  const visible = roomDirectoryState.showAll ? filtered : filtered.slice(0, 6);
  if (allGrid) allGrid.innerHTML = visible.length ? visible.map(roomDirectoryConnectorCard).join('') : '<p class="room-directory-empty">No connectors match these filters.</p>';
  const count = $('#room-directory-result-count');
  if (count) count.textContent = `${filtered.length} match${filtered.length === 1 ? '' : 'es'} · ${roomDirectoryState.catalog.length} curated`;
  const toggle = $('#room-directory-toggle-all');
  if (toggle) { toggle.hidden = filtered.length <= 6; toggle.textContent = roomDirectoryState.showAll ? 'Show fewer' : `Show all ${filtered.length}`; toggle.setAttribute('aria-expanded', String(roomDirectoryState.showAll)); }
  const summary = $('#room-directory-summary');
  if (summary) { const ready = filtered.filter((connector) => connector.ready).length; const connected = filtered.filter((connector) => connector.connected).length; summary.textContent = ready ? `${ready} connector${ready === 1 ? '' : 's'} ready for employee work. ${connected - ready > 0 ? `${connected - ready} saved connection${connected - ready === 1 ? '' : 's'} need access grants.` : 'All connected tools have usable grants.'}` : connected ? 'Connections exist, but employee grants or OAuth readiness still need attention. Open a connector card to finish access.' : 'Browse verified apps, connect Google services, or configure a tenant-approved MCP remote from this room.'; }
}

function closeRoomDirectory() {
  const modal = $('#room-connector-directory');
  if (!modal) return;
  modal.hidden = true;
  roomDirectoryState.open = false;
  roomDirectoryState.setupConnector = null;
  document.body.classList.remove('room-directory-open');
  $('#connector-plus')?.setAttribute('aria-expanded', 'false');
}

function showRoomDirectoryCatalog() {
  $('#room-directory-catalog')?.removeAttribute('hidden');
  $('#room-directory-setup')?.setAttribute('hidden', '');
  roomDirectoryState.setupConnector = null;
  roomDirectoryState.setupServer = null;
}

function showRoomDirectorySetup(connector, server = null, reason = '') {
  const catalog = $('#room-directory-catalog');
  const setup = $('#room-directory-setup');
  const title = $('#room-directory-setup-title');
  const copy = $('#room-directory-setup-copy');
  const fields = $('#room-directory-setup-fields');
  if (!catalog || !setup || !title || !copy || !fields) return;
  roomDirectoryState.setupConnector = connector;
  roomDirectoryState.setupServer = server;
  catalog.setAttribute('hidden', '');
  setup.removeAttribute('hidden');
  title.textContent = `Connect ${connector.name}`;
  copy.textContent = reason || connector.setup_copy || 'Caveworkers will keep this connection tenant-scoped and approval-aware.';
  if (connector.connection_mode === 'mcp_registry') {
    const remotes = (server?.remotes || []).filter((remote) => remote.type === 'streamable-http');
    fields.innerHTML = `<div class="room-directory-setup-grid"><label>Advertised remote<select id="room-directory-remote">${remotes.map((remote) => `<option value="${safe(remote.url)}">${safe(remote.url)}</option>`).join('')}</select></label><label>Authentication token<input id="room-directory-token" type="password" autocomplete="new-password" placeholder="Optional if the server is public"></label></div><div class="room-directory-setup-grid"><label>Header name<input id="room-directory-header" value="Authorization" maxlength="120"></label><label>Header prefix<input id="room-directory-prefix" value="Bearer" maxlength="24"></label></div>`;
  } else {
    fields.innerHTML = `<div class="room-directory-setup-grid"><label>Secure MCP endpoint<input id="room-directory-endpoint" type="url" placeholder="https://mcp.example.com"></label><label>Authentication token<input id="room-directory-token" type="password" autocomplete="new-password" placeholder="Stored encrypted"></label></div><p class="room-directory-setup-note">Custom connectors need the endpoint and credential supplied by your company. Standard connectors can be connected directly from the directory.</p>`;
  }
}

async function refreshRoomDirectoryCatalog() {
  const data = await responseJson('/api/mcp/directory');
  roomDirectoryState.catalog = data.catalog || [];
  roomDirectoryState.categories = data.categories || [];
  renderRoomDirectory();
}

async function openRoomDirectory() {
  const modal = $('#room-connector-directory');
  const button = $('#connector-plus');
  if (!modal) return;
  roomDirectoryState = { catalog: [], categories: [], query: '', category: '', showAll: false, open: true, setupConnector: null, setupServer: null };
  modal.hidden = false;
  document.body.classList.add('room-directory-open');
  button?.setAttribute('aria-expanded', 'true');
  renderRoomDirectory();
  try { await refreshRoomDirectoryCatalog(); $('#room-directory-search')?.focus(); } catch (error) { setRoomNotice(error.message || 'The connector directory is temporarily unavailable.', 'error'); const grid = $('#room-directory-featured-grid'); if (grid) grid.innerHTML = '<p class="room-directory-empty">The directory is temporarily unavailable. Existing connections remain safe.</p>'; }
}

async function connectRegistryFromRoom(connector, server, formData = {}) {
  const remotes = (server?.remotes || []).filter((remote) => remote.type === 'streamable-http');
  const serverUrl = formData.server_url || remotes[0]?.url;
  if (!serverUrl) throw new Error('This connector has no advertised secure remote yet.');
  return responseJson('/api/mcp/registry/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registry_name: connector.registry_name, server_url: serverUrl, auth_token: formData.auth_token || '', auth_header_name: formData.auth_header_name || 'Authorization', auth_header_prefix: formData.auth_header_prefix ?? 'Bearer', all_employees: true, access_level: connector.default_access_level || 'requires_approval' }) });
}

async function connectFromRoomDirectory(connectorId) {
  const connector = roomDirectoryState.catalog.find((entry) => entry.id === connectorId);
  if (!connector) return;
  if (connector.connected && connector.ready) { setRoomNotice(`${connector.name} is ready for ${connector.ready_connection_count || connector.ready_employee_ids?.length || 1} employee${(connector.ready_connection_count || connector.ready_employee_ids?.length || 1) === 1 ? '' : 's'} with granted tools.`, 'success'); closeRoomDirectory(); return; }
  if (connector.connected && !connector.ready) { setRoomNotice(`${connector.name} is saved, but no employee has a usable grant yet. Open Settings → employee tools to complete access before assigning it.`, 'error'); window.setTimeout(() => window.location.assign('/settings'), 350); return; }
  setRoomNotice(`Preparing ${connector.name} for the workforce…`, '');
  try {
    if (connector.connection_mode === 'google_oauth') {
      const employeeId = connector.recommended_employee_ids?.find((id) => employeeById(id)) || employees[0]?.id || 'data_analyst';
      const saved = await responseJson(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: connector.name, connection_type: connector.connection_type, access_level: connector.connection_type === 'google_gmail' ? 'requires_approval' : (connector.default_access_level || 'requires_approval'), config: { gmail_send_enabled: connector.connection_type === 'google_gmail', notes: 'Connected from the Company Room connector directory.' } }) });
      if (!saved.connection?.id) throw new Error('The connector was saved but Google authorization could not start.');
      const googleService = connector.connection_type === 'google_gmail' ? 'gmail' : connector.connection_type === 'google_drive' ? 'drive' : 'sheets';
      if (window.CaveworkersGoogleConnect) {
        const res = await window.CaveworkersGoogleConnect({
          employeeId,
          connectionId: saved.connection.id,
          service: googleService,
          gmailSendEnabled: connector.connection_type === 'google_gmail'
        });
        if (res && res.ok) {
          setRoomNotice(`${connector.name} is now connected for ${employeeById(employeeId)?.name || 'the workforce'}!`, 'success');
          await refreshRoomDirectoryCatalog();
          closeRoomDirectory();
          return;
        }
      }
      window.location.assign(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections/${encodeURIComponent(saved.connection.id)}/google/start?service=${googleService}&return_to=%2Fcommand`);
      return;
    }
    if (connector.connection_mode === 'mcp_registry') {
      const detail = await responseJson(`/api/mcp/directory/${encodeURIComponent(connector.id)}`);
      showRoomDirectorySetup(connector, detail.server || {}, 'Review the advertised secure remote and provide the tenant-approved credential before connecting this MCP server.');
      return;
    }
    showRoomDirectorySetup(connector, null);
  } catch (error) { setRoomNotice(error.message || `Caveworkers could not connect ${connector.name}.`, 'error'); }
}

async function submitRoomDirectorySetup(event) {
  event.preventDefault();
  const connector = roomDirectoryState.setupConnector;
  if (!connector) return;
  const submit = event.currentTarget.querySelector('button[type="submit"]');
  if (submit) { submit.disabled = true; submit.textContent = 'Connecting…'; }
  try {
    let result;
    if (connector.connection_mode === 'mcp_registry') {
      result = await connectRegistryFromRoom(connector, roomDirectoryState.setupServer || {}, { server_url: $('#room-directory-remote')?.value, auth_token: $('#room-directory-token')?.value, auth_header_name: $('#room-directory-header')?.value, auth_header_prefix: $('#room-directory-prefix')?.value });
    } else {
      const employeeId = connector.recommended_employee_ids?.find((id) => employeeById(id)) || employees[0]?.id || 'data_analyst';
      result = await responseJson(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: connector.name, connection_type: 'streamable_http', server_url: $('#room-directory-endpoint')?.value, auth_token: $('#room-directory-token')?.value, access_level: connector.default_access_level || 'requires_approval', config: { notes: 'Connected from the Company Room connector directory.' } }) });
    }
    setRoomNotice(result.notice || `${connector.name} is connected.`, 'success');
    await refreshRoomDirectoryCatalog();
    showRoomDirectoryCatalog();
    closeRoomDirectory();
  } catch (error) { setRoomNotice(error.message || `Caveworkers could not connect ${connector.name}.`, 'error'); } finally { if (submit) { submit.disabled = false; submit.innerHTML = 'Connect for the workforce <span>↗</span>'; } }
}

function bindRoomDirectoryInteractions() {
  const button = $('#connector-plus');
  const modal = $('#room-connector-directory');
  button?.addEventListener('click', (event) => { event.stopPropagation(); if (modal?.hidden) void openRoomDirectory(); else closeRoomDirectory(); playCue('tick'); });
  $('#room-directory-close')?.addEventListener('click', closeRoomDirectory);
  $('#room-directory-back')?.addEventListener('click', showRoomDirectoryCatalog);
  modal?.addEventListener('click', (event) => {
    if (event.target.closest('[data-room-directory-close]')) { closeRoomDirectory(); return; }
    const connector = event.target.closest('[data-room-directory-id]');
    if (connector) { void connectFromRoomDirectory(connector.dataset.roomDirectoryId); return; }
    const category = event.target.closest('[data-room-directory-category]');
    if (category) { roomDirectoryState.category = category.dataset.roomDirectoryCategory || ''; roomDirectoryState.showAll = false; renderRoomDirectory(); }
  });
  let searchTimer;
  $('#room-directory-search')?.addEventListener('input', (event) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { roomDirectoryState.query = event.target.value || ''; roomDirectoryState.showAll = false; renderRoomDirectory(); }, 100); });
  $('#room-directory-toggle-all')?.addEventListener('click', () => { roomDirectoryState.showAll = !roomDirectoryState.showAll; renderRoomDirectory(); });
  $('#room-directory-setup-form')?.addEventListener('submit', submitRoomDirectorySetup);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && roomDirectoryState.open) closeRoomDirectory(); if (event.key === '/' && !roomDirectoryState.open && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { event.preventDefault(); void openRoomDirectory(); } });
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
  $('#voice-toggle')?.addEventListener('click', () => { voiceEnabled = !voiceEnabled; window.localStorage.setItem('caveworkers-voice', voiceEnabled ? 'on' : 'off'); setVoiceToggle(); if (voiceEnabled) { const latest = [...workroomMessages].reverse().find((message) => message.sender !== 'Manager' && !message.pending && message.body); const employee = latest ? employeeById(latest.sender) || employees.find((entry) => entry.name === latest.sender) : null; if (latest && employee) speakEmployeeMessage(latest, employee, true); } else if ('speechSynthesis' in window) window.speechSynthesis.cancel(); });
  bindRoomDirectoryInteractions();
  document.addEventListener('click', (event) => {
    const voiceButton = event.target.closest('[data-speak-message-id]');
    if (voiceButton) {
      const message = [...workroomMessages, ...pendingMessages].find((entry) => chatMessageId(entry) === voiceButton.dataset.speakMessageId);
      const employee = employeeById(voiceButton.dataset.speakEmployee);
      if (message && employee) speakEmployeeMessage(message, employee, true);
      return;
    }
    const approval = event.target.closest('[data-approval-id]');
    if (approval) resolveApproval(approval.dataset.approvalId, approval.dataset.approvalStatus);
    const deleteButton = event.target.closest('[data-delete-chat-id]');
    if (deleteButton) { void deleteChatMessage(deleteButton.dataset.deleteTaskId, deleteButton.dataset.deleteChatId); return; }
    const introButton = event.target.closest('[data-introduce-employee]');
    if (introButton) {
      const employee = employeeById(introButton.dataset.introduceEmployee);
      const input = $('#request');
      const select = $('#task-assignee');
      if (employee && input) {
        input.value = `@${employee.name}, introduce yourself to the team and explain how you will contribute to this request.`;
        if (select) select.value = employee.id;
        input.focus();
        setRoomNotice(`${employee.name} is ready to introduce themselves when you start the work.`, 'success');
        playCue('tick');
      }
      return;
    }
    const task = event.target.closest('[data-task-id]');
    if (task) renderTaskInRoom(task.dataset.taskId);
  });
}

function consumeConnectorCallbackNotice() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get('connector_error');
  const connected = params.get('connector') === 'connected';
  if (error) setRoomNotice(`Google connection was not completed: ${error.replace(/[<>]/g, '').slice(0, 180)}`, 'error');
  else if (connected) setRoomNotice('Google connector connected. The workforce can now use its approved tools.', 'success');
  if (error || connected) window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
}
async function initializeRoom() {
  restoreRoomCache();
  consumeConnectorCallbackNotice();
  soundEnabled = false;
  voiceEnabled = window.localStorage.getItem('caveworkers-voice') === 'on';
  setSoundToggle();
  setVoiceToggle();
  if ('speechSynthesis' in window) {
    refreshSpeechVoices();
    window.speechSynthesis.addEventListener('voiceschanged', refreshSpeechVoices, { once: true });
  }
  setExecutionLive();
  bindRoomInteractions();
  renderRoomFeed();
  await Promise.allSettled([loadEmployees(), loadBilling(), loadHealth(), loadRoiDashboard(), loadActivationDashboard(), loadWorkroomSnapshot(), loadApprovals(), loadTaskSummaries()]);
  connectWorkroom();
}

window.addEventListener('beforeunload', () => workroomSource?.close());
window.addEventListener('DOMContentLoaded', initializeRoom);
