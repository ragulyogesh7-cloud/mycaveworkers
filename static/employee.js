(() => {
  const employeeId = document.body.dataset.employeeId;
  const $ = (selector) => document.querySelector(selector);
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
  const request = async (url, options = {}) => {
    const response = await fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Request could not be completed.');
    return body;
  };
  const formatTime = (value) => { try { return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)); } catch (_) { return ''; } };

  let profile = null;
  function renderProfile(data) {
    profile = data;
    const state = $('#employee-instance-state');
    const rail = $('#employee-status');
    const status = data.active_in_workspace ? 'Active in your workforce' : 'Catalog employee — activate in settings';
    state.textContent = status;
    rail.textContent = data.active_in_workspace ? 'Instance active' : 'Activation needed';
    const connectors = data.connectors || [];
    $('#employee-connector-list').innerHTML = connectors.length ? connectors.map((connector) => {
      const grants = (connector.tool_grants || []).map((grant) => `<span class="employee-tool-grant">${escapeHtml(grant.name || grant.tool_name || 'tool')} · ${escapeHtml(grant.access_level || 'read')}</span>`).join(' ');
      return `<div class="employee-connector-item"><div><b>${escapeHtml(connector.name || connector.service || 'Connector')}</b><small>${escapeHtml(connector.service || 'MCP')} · ${grants || 'Tool discovery pending'}</small></div><span class="connector-state">${connector.status === 'connected' || connector.status === 'active' ? 'CONNECTED' : escapeHtml(String(connector.status || 'SETUP').toUpperCase())}</span></div>`;
    }).join('') : '<p class="empty-state-sm">No tenant connector is assigned to this employee yet. Add one in Workspace Settings.</p>';
    const teammates = data.teammates || [];
    $('#employee-teammates').innerHTML = teammates.length ? teammates.map((teammate) => `<div class="employee-teammate-item"><div><b>${escapeHtml(teammate.name)} · ${escapeHtml(teammate.role)}</b><small>${escapeHtml(teammate.department || 'AI specialist')} · Task handoffs are recorded in the shared group chat.</small></div><a href="/employee/${encodeURIComponent(teammate.id)}">Open ↗</a></div>`).join('') : '<p class="empty-state-sm">Activate another employee in Workspace Settings to enable task handoffs.</p>';
    renderMemory(data.memory || []);
  }
  function renderMemory(memory) {
    $('#employee-memory-list').innerHTML = memory.length ? memory.map((entry) => `<div class="employee-memory-item"><div><b>${escapeHtml(String(entry.category || 'preference').toUpperCase())}</b><small>${escapeHtml(entry.content)}</small><small>${formatTime(entry.created_at)}</small></div><button class="memory-delete" data-memory-id="${escapeHtml(entry.id)}" type="button">Delete</button></div>`).join('') : '<p class="empty-state-sm">No role memory saved yet. Add a playbook or handoff rule above.</p>';
    document.querySelectorAll('.memory-delete').forEach((button) => button.addEventListener('click', async () => {
      if (!window.confirm('Delete this tenant-only memory note?')) return;
      try { await request(`/api/employees/${encodeURIComponent(employeeId)}/memory/${encodeURIComponent(button.dataset.memoryId)}`, { method: 'DELETE' }); await loadProfile(); } catch (error) { alert(error.message); }
    }));
  }
  async function loadProfile() {
    try { renderProfile(await request(`/api/employees/${encodeURIComponent(employeeId)}/profile`)); }
    catch (error) { $('#employee-connector-list').innerHTML = `<p class="empty-state-sm">${escapeHtml(error.message)}</p>`; $('#employee-status').textContent = 'Unavailable'; }
  }

  $('#employee-memory-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const content = $('#employee-memory-content').value.trim();
    if (!content) return;
    const button = event.currentTarget.querySelector('button'); button.disabled = true;
    try {
      await request(`/api/employees/${encodeURIComponent(employeeId)}/memory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ category: $('#employee-memory-category').value, content }) });
      $('#employee-memory-content').value = ''; await loadProfile();
    } catch (error) { alert(error.message); } finally { button.disabled = false; }
  });

  $('#employee-brief-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const brief = $('#employee-brief').value.trim();
    if (!brief) return;
    const result = $('#employee-brief-result'); const button = event.currentTarget.querySelector('button');
    button.disabled = true; result.hidden = false; result.textContent = 'Creating a collaborative task and visible group chat…';
    try {
      const task = await request('/api/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request: brief, preferred_employee_id: employeeId }) });
      const participants = (task.participants || []).join(', ');
      result.innerHTML = `<strong>Task #${escapeHtml(task.id)} created.</strong><br>${escapeHtml(task.collaboration_summary || 'The task is routed through the workforce.')}${participants ? `<br><small>Group chat: ${escapeHtml(participants)}</small>` : ''}<br><a href="/command#task-card-${escapeHtml(task.id)}">Open the visible group chat in Command Center ↗</a>`;
      $('#employee-brief').value = '';
    } catch (error) { result.textContent = error.message; } finally { button.disabled = false; }
  });

  const menu = $('#menuButton');
  menu?.addEventListener('click', () => document.querySelector('.side-rail')?.classList.toggle('open'));
  loadProfile();
})();
