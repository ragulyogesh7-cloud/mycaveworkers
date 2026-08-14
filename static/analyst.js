(() => {
  const state = { profile: null, sources: [], connectors: [], memory: [], runs: [], approvals: [], latestRun: null };
  const $ = (selector) => document.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value)) : '—';
  const typeLabel = (kind) => ({ csv: 'CSV', google_sheets: 'Google Sheets', sql: 'SQL workspace' }[kind] || kind);
  const connectorLabel = (kind) => ({ google_gmail: 'Gmail', google_sheets: 'Google Sheets', streamable_http: 'Custom MCP' }[kind] || kind);

  async function jsonRequest(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
    return payload;
  }

  function setMessage(id, text, kind = '') { const node = $(`#${id}`); if (node) { node.textContent = text; node.className = `analyst-form-message ${kind}`; } }

  function renderProfile() {
    const profile = state.profile || {};
    const employee = profile.employee || {};
    $('#analyst-profile-status').textContent = profile.active_in_workspace === false ? 'Not activated' : 'Available';
    $('#analyst-profile-role').textContent = employee.role || 'Data & Financial Analyst';
    $('#analyst-model-name').textContent = profile.model?.name || 'Preview planner';
    $('#analyst-model-provider').textContent = profile.model?.provider ? `${profile.model.provider} / configurable` : 'Configure a production model';
    $('#analyst-source-count').textContent = `${state.sources.length} ${state.sources.length === 1 ? 'source' : 'sources'}`;
    $('#analyst-memory-count').textContent = `${state.memory.length} durable ${state.memory.length === 1 ? 'note' : 'notes'}`;
    $('#analyst-system-status').textContent = profile.active_in_workspace === false ? 'David not activated' : 'Analyst ready';
  }

  function renderConnectors() {
    const node = $('#analyst-connector-list');
    if (!node) return;
    if (!state.connectors.length) { node.innerHTML = '<div class="analyst-empty-row">No connectors yet. Add Gmail, Sheets, or a custom MCP server above.</div>'; return; }
    node.innerHTML = state.connectors.map((connector) => {
      const isGoogle = connector.connection_type === 'google_gmail' || connector.connection_type === 'google_sheets';
      const tools = connector.discovered_tools || [];
      const grants = connector.tool_grants || [];
      const toolMarkup = tools.length ? `<div class="connector-tools">${tools.slice(0, 12).map((tool) => { const grant = grants.find((item) => item.tool_name === tool.name); return `<div class="connector-tool"><span><strong>${esc(tool.name)}</strong><small>${esc(tool.description || (tool.risk === 'write' ? 'Write-capable tool' : 'Read-capable tool'))}</small></span><span class="connector-tool-actions">${grant ? `<b class="connector-grant">${esc(grant.access_level)}</b>` : `<button type="button" data-grant-tool="${esc(tool.name)}" data-connector-id="${connector.id}" data-access="read_only">Grant read</button><button type="button" data-grant-tool="${esc(tool.name)}" data-connector-id="${connector.id}" data-access="requires_approval">Grant HITL</button>`}</span></div>`; }).join('')}</div>` : '';
      const action = isGoogle ? (connector.status === 'connected' ? '<span class="connector-connected">Connected</span>' : `<a class="connector-action" href="/api/employees/david/mcp-connections/${connector.id}/google/start?service=${encodeURIComponent(connector.connection_type)}">Connect Google</a>`) : `<button type="button" class="connector-action" data-discover-connector="${connector.id}">${tools.length ? 'Refresh tools' : 'Discover tools'}</button>`;
      return `<article class="connector-card"><div class="connector-card-head"><div><strong>${esc(connector.name)}</strong><small>${esc(connectorLabel(connector.connection_type))}${connector.oauth_email ? ` · ${esc(connector.oauth_email)}` : ''}</small></div><div class="connector-card-actions">${action}<span class="source-state ${connector.status !== 'connected' ? 'pending' : ''}"><i></i>${esc(connector.status || 'needs_configuration')}</span><button type="button" class="source-remove" data-delete-connector="${connector.id}">Remove</button></div></div>${connector.server_url ? `<small class="connector-url">${esc(connector.server_url)}</small>` : ''}${toolMarkup}</article>`;
    }).join('');
    node.querySelectorAll('[data-discover-connector]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true; button.textContent = 'Discovering…';
      try { await jsonRequest(`/api/employees/david/mcp-connections/${button.dataset.discoverConnector}/tools?refresh=1`); await loadAll(); } catch (error) { setMessage('connector-form-message', error.message, 'error'); } finally { button.disabled = false; }
    }));
    node.querySelectorAll('[data-grant-tool]').forEach((button) => button.addEventListener('click', async () => {
      try { await jsonRequest(`/api/employees/david/mcp-connections/${button.dataset.connectorId}/tools/${encodeURIComponent(button.dataset.grantTool)}`, { method: 'POST', body: JSON.stringify({ access_level: button.dataset.access }) }); await loadAll(); } catch (error) { setMessage('connector-form-message', error.message, 'error'); }
    }));
    node.querySelectorAll('[data-delete-connector]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('Remove this tenant connector and revoke David access?')) return;
      try { await jsonRequest(`/api/employees/david/mcp-connections/${button.dataset.deleteConnector}`, { method: 'DELETE' }); await loadAll(); } catch (error) { setMessage('connector-form-message', error.message, 'error'); }
    }));
  }

  function renderSources() {
    const node = $('#data-source-list');
    const options = ['<option value="">No source selected — transparent preview</option>'];
    state.sources.forEach((source) => options.push(`<option value="${esc(source.id)}">${esc(source.name)} · ${esc(typeLabel(source.kind))}</option>`));
    $('#analysis-source').innerHTML = options.join('');
    if (!state.sources.length) { node.innerHTML = '<div class="analyst-empty-row">No sources yet. Import a CSV or register a secure connection shell below.</div>'; return; }
    node.innerHTML = state.sources.map((source) => {
      const detail = source.kind === 'csv' ? `${source.metadata?.row_count || 0} rows · ${(source.metadata?.columns || []).slice(0, 3).join(', ')}` : (source.metadata?.sheet_url || source.metadata?.database_label || 'Configuration required');
      const pending = source.status !== 'connected';
      return `<div class="data-source-item"><div class="source-meta"><strong>${esc(source.name)}</strong><small>${esc(typeLabel(source.kind))} · ${esc(detail)}</small></div><span class="source-state ${pending ? 'pending' : ''}"><i></i>${pending ? 'CONFIGURE' : 'CONNECTED'}</span><button class="source-remove" data-source-delete="${esc(source.id)}" type="button">Remove</button></div>`;
    }).join('');
    node.querySelectorAll('[data-source-delete]').forEach((button) => button.addEventListener('click', async () => {
      if (!confirm('Remove this analyst data source from the workspace?')) return;
      try { await jsonRequest(`/api/analyst/data-sources/${button.dataset.sourceDelete}`, { method: 'DELETE' }); await loadAll(); setMessage('source-form-message', 'Source removed.', 'success'); } catch (error) { setMessage('source-form-message', error.message, 'error'); }
    }));
  }

  function renderMemory() {
    const node = $('#memory-list');
    if (!state.memory.length) { node.innerHTML = '<div class="analyst-empty-row">David has no durable workspace notes yet.</div>'; return; }
    node.innerHTML = state.memory.map((memory) => `<div class="memory-item"><div class="memory-item-top"><span>${esc(memory.category.replace('_', ' '))}</span><button class="memory-delete" type="button" data-memory-delete="${esc(memory.id)}" aria-label="Delete memory note">×</button></div><p>${esc(memory.content)}</p></div>`).join('');
    node.querySelectorAll('[data-memory-delete]').forEach((button) => button.addEventListener('click', async () => {
      try { await jsonRequest(`/api/analyst/memory/${button.dataset.memoryDelete}`, { method: 'DELETE' }); await loadAll(); } catch (error) { setMessage('memory-form-message', error.message, 'error'); }
    }));
  }

  function renderApprovals() {
    const node = $('#analyst-approval-list');
    $('#analyst-approval-count').textContent = state.approvals.length;
    $('#analyst-approval-status').textContent = state.approvals.length ? `${state.approvals.length} PENDING` : 'CLEAR';
    if (!state.approvals.length) { node.innerHTML = '<div class="analyst-empty-row">No David actions are waiting for your review.</div>'; return; }
    node.innerHTML = state.approvals.map((approval) => `<div class="approval-card"><div class="approval-card-top"><strong>${esc(approval.tool_name)}</strong><span>PENDING</span></div><p>${esc(approval.action_summary)}</p><div class="approval-actions"><button type="button" class="approval-approve" data-approval="${approval.id}" data-status="approved">Approve draft</button><button type="button" class="approval-reject" data-approval="${approval.id}" data-status="rejected">Decline</button></div></div>`).join('');
    node.querySelectorAll('[data-approval]').forEach((button) => button.addEventListener('click', async () => {
      button.disabled = true;
      try { await jsonRequest(`/api/approvals/${button.dataset.approval}`, { method: 'POST', body: JSON.stringify({ status: button.dataset.status }) }); await loadAll(); } catch (error) { button.disabled = false; setMessage('analysis-form-message', error.message, 'error'); }
    }));
  }

  function renderRuns() {
    const node = $('#analyst-runs');
    if (!state.runs.length) { node.innerHTML = '<div class="analyst-empty-row">Your completed analysis runs will appear here.</div>'; return; }
    node.innerHTML = state.runs.map((run) => `<button type="button" class="run-row" data-run-id="${esc(run.id)}"><time>${formatDate(run.created_at)}</time><strong>${esc(run.question)}</strong><span>${esc(run.status === 'awaiting_approval' ? 'approval' : run.output_format)}</span></button>`).join('');
    node.querySelectorAll('[data-run-id]').forEach((button) => button.addEventListener('click', () => {
      const run = state.runs.find((entry) => entry.id === button.dataset.runId); if (run) showRun(run);
    }));
  }

  function renderChart(chart) {
    if (!chart) { $('#chart-title').textContent = 'No visual signal'; $('#chart-bars').innerHTML = ''; $('#chart-note').textContent = 'A chart will appear when David produces a structured result.'; return; }
    $('#chart-title').textContent = chart.title || 'Trend preview'; $('#chart-unit').textContent = chart.unit || 'PREVIEW'; $('#chart-note').textContent = chart.source_note || '';
    const values = chart.values || []; const max = Math.max(...values, 1);
    $('#chart-bars').innerHTML = values.map((value, index) => `<div class="chart-bar-wrap"><div class="chart-bar" style="height:${Math.max(8, (Number(value) / max) * 93)}%" title="${esc(value)} ${esc(chart.unit || '')}"></div><span class="chart-bar-label">${esc(chart.labels?.[index] || index + 1)}</span></div>`).join('');
  }

  function renderTrace(trace = []) {
    $('#analyst-trace').innerHTML = trace.map((step) => `<div class="trace-step"><span>${esc(step.stage)}</span><p>${esc(step.body)}</p></div>`).join('');
  }

  function showRun(run) {
    state.latestRun = run;
    const result = $('#analysis-result'); result.hidden = false;
    $('#result-heading').textContent = run.status === 'awaiting_approval' ? 'Draft analysis ready for review' : 'Latest analysis';
    $('#result-state').textContent = run.status === 'awaiting_approval' ? 'AWAITING APPROVAL' : 'COMPLETE';
    $('#result-report-body').textContent = run.report || 'No report was returned.';
    $('#result-notice').textContent = run.status === 'awaiting_approval' ? 'David prepared the analysis, but the requested external action remains a draft. Review it in the approval queue before any connector is allowed to act.' : 'This result is scoped to your workspace. Live source values and external delivery remain controlled by the configured permissions.';
    renderChart(run.chart); renderTrace(run.trace || []);
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function loadAll() {
    try {
      const [profile, sources, connectors, memory, runs, approvals] = await Promise.all([
        jsonRequest('/api/analyst/profile'), jsonRequest('/api/analyst/data-sources'), jsonRequest('/api/analyst/connectors'), jsonRequest('/api/analyst/memory?type=long_term'), jsonRequest('/api/analyst/runs'), jsonRequest('/api/analyst/approvals')
      ]);
      state.profile = profile; state.sources = sources.sources || []; state.connectors = connectors.connections || profile.connectors || []; state.memory = memory.memory || []; state.runs = runs.runs || []; state.approvals = approvals.approvals || [];
      renderProfile(); renderSources(); renderConnectors(); renderMemory(); renderApprovals(); renderRuns();
      if (state.runs[0] && !state.latestRun) showRun(state.runs[0]);
    } catch (error) {
      $('#analyst-system-status').textContent = 'Needs attention';
      setMessage('analysis-form-message', error.message, 'error');
    }
  }

  $('#source-kind')?.addEventListener('change', () => {
    const isCsv = $('#source-kind').value === 'csv'; $('#source-csv-field').hidden = !isCsv; $('#source-url-field').hidden = isCsv;
  });

  $('#connector-type')?.addEventListener('change', () => {
    const custom = $('#connector-type').value === 'streamable_http';
    $('#connector-url-field').hidden = !custom; $('#connector-token-field').hidden = !custom;
    if (!custom) { $('#connector-url').value = ''; $('#connector-token').value = ''; }
  });

  $('#connector-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const type = $('#connector-type').value; const custom = type === 'streamable_http';
    const payload = { name: $('#connector-name').value.trim(), connection_type: type, access_level: $('#connector-access').value, server_url: custom ? $('#connector-url').value.trim() : undefined, auth_token: custom ? $('#connector-token').value.trim() : undefined, config: { notes: $('#connector-notes').value.trim() } };
    if (!payload.name) return setMessage('connector-form-message', 'Name the connector first.', 'error');
    if (custom && !payload.server_url) return setMessage('connector-form-message', 'Enter the custom MCP HTTPS URL.', 'error');
    try { const response = await jsonRequest('/api/employees/david/mcp-connections', { method: 'POST', body: JSON.stringify(payload) }); $('#connector-form').reset(); $('#connector-type').dispatchEvent(new Event('change')); await loadAll(); setMessage('connector-form-message', response.notice || 'Connector saved. Connect or discover its tools next.', 'success'); } catch (error) { setMessage('connector-form-message', error.message, 'error'); }
  });

  $('#source-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const kind = $('#source-kind').value; const file = $('#source-csv').files?.[0]; const payload = { kind, name: $('#source-name').value.trim() };
    if (kind === 'csv') {
      if (!file) { setMessage('source-form-message', 'Choose a CSV file first.', 'error'); return; }
      try { payload.csv_text = await file.text(); } catch { setMessage('source-form-message', 'Could not read that CSV file.', 'error'); return; }
    } else if (kind === 'google_sheets') payload.sheet_url = $('#source-reference').value.trim(); else payload.database_label = $('#source-reference').value.trim();
    try { await jsonRequest('/api/analyst/data-sources', { method: 'POST', body: JSON.stringify(payload) }); $('#source-form').reset(); $('#source-kind').dispatchEvent(new Event('change')); await loadAll(); setMessage('source-form-message', 'Source registered in this workspace.', 'success'); } catch (error) { setMessage('source-form-message', error.message, 'error'); }
  });

  $('#analysis-form')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const submit = $('#analysis-submit'); const question = $('#analysis-question').value.trim(); if (!question) return;
    submit.disabled = true; submit.textContent = 'David is working…'; setMessage('analysis-form-message', 'David is perceiving context, planning a read-only path, and preparing the evidence…');
    try { const payload = await jsonRequest('/api/analyst/analyze', { method: 'POST', body: JSON.stringify({ question, source_id: $('#analysis-source').value || undefined, output_format: $('#analysis-format').value }) }); showRun(payload.run); setMessage('analysis-form-message', payload.run.status === 'awaiting_approval' ? 'Analysis complete. External delivery is paused for your approval.' : 'Analysis complete and saved to the run history.', 'success'); await loadAll(); } catch (error) { setMessage('analysis-form-message', error.message, 'error'); } finally { submit.disabled = false; submit.innerHTML = 'Ask David <span>↗</span>'; }
  });

  $('#memory-form')?.addEventListener('submit', async (event) => {
    event.preventDefault(); const input = $('#memory-content'); if (!input.value.trim()) return;
    try { await jsonRequest('/api/analyst/memory', { method: 'POST', body: JSON.stringify({ content: input.value.trim(), category: $('#memory-category').value }) }); input.value = ''; await loadAll(); setMessage('memory-form-message', 'Saved as a tenant-scoped memory note.', 'success'); } catch (error) { setMessage('memory-form-message', error.message, 'error'); }
  });

  $('#analyst-menu-button')?.addEventListener('click', () => $('.analyst-shell').classList.toggle('rail-open'));
  $('#analyst-logout')?.addEventListener('click', async (event) => { event.preventDefault(); await fetch('/api/session-logout', { method: 'POST' }); window.location.assign('/login'); });
  loadAll();
})();
