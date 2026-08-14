const $ = (selector) => document.querySelector(selector);
let employees = [];
let billingState = null;
let selectedRegistryServer = null;

function safe(value) {
  const node = document.createElement('span');
  node.textContent = String(value ?? '');
  return node.innerHTML;
}

function notify(message = '', kind = '') {
  const target = $('#settings-feedback');
  if (!target) return;
  target.textContent = message;
  target.className = `settings-feedback ${kind}`.trim();
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
  return data;
}

function activateTab(tab, writeHash = true) {
  const valid = ['workspace', 'team', 'integrations', 'billing'];
  const selected = valid.includes(tab) ? tab : 'workspace';
  document.querySelectorAll('[data-settings-tab]').forEach((button) => button.classList.toggle('active', button.dataset.settingsTab === selected));
  document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
    const active = panel.dataset.settingsPanel === selected;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
  if (writeHash) history.replaceState(null, '', `#${selected}`);
}

function populateEmployeeSelect(selectId) {
  const select = $(`#${selectId}`);
  if (!select) return;
  const current = select.value;
  select.innerHTML = employees.map((employee) => `<option value="${safe(employee.id)}">${safe(employee.name)} · ${safe(employee.role)}</option>`).join('');
  if (Array.from(select.options).some((option) => option.value === current)) select.value = current;
}

function renderEmployeeTools() {
  const container = $('#employee-tools-list');
  const activeCount = $('#active-team-count');
  if (!container) return;
  if (activeCount) activeCount.textContent = `${employees.length} active`;
  container.innerHTML = employees.length ? employees.map((employee) => {
    const permissions = employee.permissions || [];
    return `<article class="employee-settings-card"><div class="employee-settings-top"><div class="employee-avatar" style="--employee-color:${safe(employee.color || '#7ee8ff')}">${safe(employee.icon || employee.name?.[0] || 'AI')}</div><div><h4>${safe(employee.name)} <span>${safe(employee.role)}</span></h4><p>${safe(employee.department || 'AI workforce')} · ${permissions.length ? `${permissions.length} granted tool${permissions.length === 1 ? '' : 's'}` : 'No direct tool grants'}</p></div><div class="employee-card-actions"><a class="mini-link" href="/employee/${encodeURIComponent(employee.id)}">Open room ↗</a><button class="mini-danger" type="button" data-action="remove-employee" data-employee-id="${safe(employee.id)}">Remove</button></div></div>${permissions.length ? `<div class="permission-chips">${permissions.map((permission) => `<span class="permission-chip"><b>${safe(permission.tool_name)}</b><em>${safe(permission.access_level)}</em><button type="button" aria-label="Revoke ${safe(permission.tool_name)}" data-action="revoke-direct-tool" data-employee-id="${safe(employee.id)}" data-tool-name="${safe(permission.tool_name)}">×</button></span>`).join('')}</div>` : '<p class="employee-empty">No direct permissions. Connections and tool grants will appear here when configured.</p>'}</article>`;
  }).join('') : '<p class="empty-state-sm">No employees are currently active in this workspace.</p>';
}

function renderCatalog(catalog) {
  const container = $('#catalog-list');
  if (!container) return;
  const active = new Set(employees.map((employee) => employee.id));
  container.innerHTML = catalog.length ? catalog.map((employee) => `<article class="catalog-card"><div class="catalog-symbol" style="--employee-color:${safe(employee.color || '#7ee8ff')}">${safe(employee.icon || employee.name?.[0] || 'AI')}</div><div><h4>${safe(employee.name)} <span>${safe(employee.role)}</span></h4><p>${safe(employee.description || employee.department || 'AI workforce specialist')}</p></div>${active.has(employee.id) ? `<button class="mini-danger" type="button" data-action="remove-employee" data-employee-id="${safe(employee.id)}">Remove</button>` : `<button class="btn btn-light catalog-add" type="button" data-action="add-employee" data-employee-id="${safe(employee.id)}">Add to team</button>`}</article>`).join('') : '<p class="empty-state-sm">No employee catalog is available.</p>';
}

function renderToolGrants(employeeId, connection) {
  const tools = connection.discovered_tools || [];
  if (!tools.length) return '<p class="connection-empty">No tools have been discovered yet. Run a safe discovery before granting access.</p>';
  const grants = connection.tool_grants || [];
  return `<div class="discovered-tools"><p>Discovered tools · ${tools.length}</p>${tools.map((tool) => {
    const name = String(tool.name || 'Unnamed tool');
    const grant = grants.find((entry) => String(entry.tool_name || '').toLowerCase() === name.toLowerCase());
    return `<div class="discovered-tool"><span><b>${safe(name)}</b>${tool.description ? `<small>${safe(tool.description)}</small>` : ''}</span><div>${grant ? `<em>${safe(grant.access_level)}</em><button class="text-mini danger" type="button" data-action="revoke-mcp-tool" data-employee-id="${safe(employeeId)}" data-connection-id="${safe(connection.id)}" data-tool-name="${safe(name)}">Revoke</button>` : `<button class="text-mini" type="button" data-action="grant-mcp-tool" data-access="read_only" data-employee-id="${safe(employeeId)}" data-connection-id="${safe(connection.id)}" data-tool-name="${safe(name)}">Read only</button><button class="text-mini" type="button" data-action="grant-mcp-tool" data-access="requires_approval" data-employee-id="${safe(employeeId)}" data-connection-id="${safe(connection.id)}" data-tool-name="${safe(name)}">Approval</button>`}</div></div>`;
  }).join('')}</div>`;
}

function renderConnections(connectionSets) {
  const container = $('#custom-mcp-list');
  const count = $('#connection-count');
  if (!container) return;
  const all = connectionSets.flatMap((entry) => entry.connections.map((connection) => ({ employee: entry.employee, connection })));
  if (count) count.textContent = `${all.length} connected`;
  container.innerHTML = all.length ? all.map(({ employee, connection }) => {
    const typeLabel = { google_gmail: 'Google Gmail', google_sheets: 'Google Sheets', streamable_http: 'Custom MCP', git_repository: 'Git repository', custom_skill: 'Custom skill' }[connection.connection_type] || connection.connection_type;
    const source = connection.server_url || connection.config?.repo_path || connection.config?.notes || 'Employee capability';
    const needsOauth = (connection.connection_type === 'google_gmail' || connection.connection_type === 'google_sheets') && connection.status !== 'connected';
    const sarahGmailGovernance = employee.id === 'sarah' && connection.connection_type === 'google_gmail'
      ? `<p class="connection-governance ${connection.config?.gmail_send_enabled ? 'enabled' : 'disabled'}">${connection.config?.gmail_send_enabled ? 'Send after manager approval is enabled. Reconnect Google if the send permission has not yet been granted.' : 'Read access only. Enable “Allow Sarah to send after approval” when adding a new Gmail connection to permit approval-gated delivery.'}</p>`
      : '';
    return `<article class="connection-card"><div class="connection-card-top"><div><p class="connection-owner"><span style="--employee-color:${safe(employee.color || '#7ee8ff')}">${safe(employee.name?.[0] || 'AI')}</span>${safe(employee.name)}’s connection</p><h4>${safe(connection.name)} <em class="connection-status ${safe(connection.status || 'unknown')}">${safe(connection.status || 'unknown')}</em></h4><p class="connection-source">${safe(typeLabel)} · ${safe(source)}</p>${sarahGmailGovernance}</div><div class="connection-actions">${needsOauth ? `<a class="btn btn-primary compact-button" href="/api/employees/${encodeURIComponent(employee.id)}/mcp-connections/${encodeURIComponent(connection.id)}/google/start?service=${encodeURIComponent(connection.connection_type)}">Connect Google</a>` : ''}<button class="text-mini" type="button" data-action="test-mcp" data-employee-id="${safe(employee.id)}" data-connection-id="${safe(connection.id)}">Test safely</button><button class="text-mini danger" type="button" data-action="remove-mcp" data-employee-id="${safe(employee.id)}" data-connection-id="${safe(connection.id)}">Remove</button></div></div>${connection.connection_type === 'streamable_http' ? `<div class="connection-tools-header"><span>Tool controls</span><button class="btn btn-light compact-button" type="button" data-action="discover-tools" data-employee-id="${safe(employee.id)}" data-connection-id="${safe(connection.id)}">${connection.discovered_tools?.length ? 'Refresh tools' : 'Discover tools'}</button></div>${renderToolGrants(employee.id, connection)}` : ''}${connection.connection_type === 'git_repository' ? `<div class="connection-tools-header"><span>Repository changes require approval.</span><button class="btn btn-light compact-button" type="button" data-action="request-git-commit" data-employee-id="${safe(employee.id)}" data-connection-id="${safe(connection.id)}">Request commit</button></div>` : ''}</article>`;
  }).join('') : '<p class="empty-state-sm">No employee-scoped connections yet. Add only the tools your team needs.</p>';
}

function renderBilling(billing) {
  billingState = billing;
  const planName = $('#settings-plan-name');
  const planDetail = $('#settings-plan-detail');
  const badge = $('#billing-status');
  const summary = $('#billing-summary');
  if (planName) planName.textContent = billing.tier_name || 'Free trial';
  if (planDetail) planDetail.textContent = `${billing.active_employees || 0} of ${billing.max_employees || 0} employee slots in use`;
  if (badge) badge.textContent = billing.tier_key === 'free_trial' ? 'TRIAL' : 'ACTIVE';
  if (!summary) return;
  const trialEnd = billing.trial_ends_at ? new Date(billing.trial_ends_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : null;
  summary.innerHTML = `<article><span>PLAN</span><b>${safe(billing.tier_name || 'Free Trial')}</b><small>${billing.tier_key === 'free_trial' && trialEnd ? `Trial ends ${safe(trialEnd)}` : 'Your active workspace plan'}</small></article><article><span>EMPLOYEES</span><b>${safe(billing.active_employees || 0)} / ${safe(billing.max_employees || 0)}</b><small>Active workforce capacity</small></article><article><span>AVAILABLE</span><b>${safe(billing.quota_remaining ?? 0)}</b><small>Employee slot${billing.quota_remaining === 1 ? '' : 's'} remaining</small></article>`;
}

function renderRegistryResults(servers = []) {
  const container = $('#mcp-registry-results');
  if (!container) return;
  if (!servers.length) {
    container.innerHTML = '<p class="empty-state-sm">No Registry servers matched that search. Try a provider or capability name.</p>';
    return;
  }
  container.innerHTML = servers.map((server) => `<article class="registry-result-card"><div><p class="registry-result-kicker">${safe(server.official_status || 'PUBLIC REGISTRY')}</p><h4>${safe(server.name)}</h4><p>${safe(server.description)}</p><small>${safe(server.remotes?.length || 0)} advertised remote${server.remotes?.length === 1 ? '' : 's'} · v${safe(server.version || 'unknown')}</small></div><div class="registry-result-actions"><a class="mini-link" href="${safe(server.directory_url)}" target="_blank" rel="noopener noreferrer">MCP.Directory ↗</a><button class="btn btn-light compact-button" type="button" data-action="inspect-registry" data-registry-name="${safe(server.name)}">Inspect remote</button></div></article>`).join('');
}

function renderRegistryEmployeePicker() {
  const picker = $('#mcp-registry-employee-picker');
  if (!picker) return;
  picker.innerHTML = employees.map((employee) => `<label class="registry-employee-choice"><input type="checkbox" value="${safe(employee.id)}" checked><span>${safe(employee.name)}<small>${safe(employee.role || employee.department || 'AI employee')}</small></span></label>`).join('');
}

async function inspectRegistryServer(name) {
  try {
    notify('Loading advertised MCP remotes…');
    const data = await requestJson(`/api/mcp/registry/servers/${encodeURIComponent(name)}`);
    selectedRegistryServer = data.server;
    $('#mcp-registry-selected-name').textContent = selectedRegistryServer.name;
    $('#mcp-registry-selected-description').textContent = selectedRegistryServer.description;
    const directoryLink = $('#mcp-registry-directory-link');
    directoryLink.href = selectedRegistryServer.directory_url;
    directoryLink.hidden = false;
    const remoteSelect = $('#mcp-registry-remote');
    const remotes = (selectedRegistryServer.remotes || []).filter((remote) => remote.type === 'streamable-http');
    remoteSelect.innerHTML = remotes.length ? remotes.map((remote) => `<option value="${safe(remote.url)}">${safe(remote.type)} · ${safe(remote.url)}</option>`).join('') : '<option value="">No compatible streamable HTTP remote advertised</option>';
    const headerNotes = remotes.flatMap((remote) => remote.headers || []).filter((header) => header.isRequired).map((header) => header.name).slice(0, 4);
    $('#mcp-registry-remote-notes').textContent = remotes.length ? `Remote selected from the Registry. Required advertised headers: ${headerNotes.length ? headerNotes.join(', ') : 'none listed'}. Caveworkers will still validate HTTPS and private-host protections.` : 'This Registry entry has no compatible streamable HTTP remote. Choose another server.';
    renderRegistryEmployeePicker();
    $('#mcp-registry-connect-form').hidden = false;
    $('#mcp-registry-connect-form button[type="submit"]').disabled = !remotes.length;
    notify('Review the advertised remote and connect it to the employees who should use it.', 'success');
  } catch (error) { notify(error.message || 'The Registry server could not be inspected.', 'error'); }
}

async function searchRegistry(event) {
  event.preventDefault();
  const query = $('#mcp-registry-query').value.trim();
  if (!query) { notify('Enter a provider, capability, or server name to search.', 'error'); return; }
  const container = $('#mcp-registry-results');
  container.innerHTML = '<p class="empty-state-sm">Searching the official MCP Registry…</p>';
  try {
    const result = await requestJson(`/api/mcp/registry/search?q=${encodeURIComponent(query)}&limit=12`);
    renderRegistryResults(result.servers || []);
    notify(`${result.count || result.servers?.length || 0} Registry result${(result.count || result.servers?.length || 0) === 1 ? '' : 's'} found.`, 'success');
  } catch (error) { container.innerHTML = '<p class="empty-state-sm">Registry search is unavailable right now.</p>'; notify(error.message || 'The Registry search could not be completed.', 'error'); }
}

function toggleRegistryEmployeePicker() {
  const all = $('#mcp-registry-all-employees');
  const picker = $('#mcp-registry-employee-picker');
  if (picker) picker.hidden = Boolean(all?.checked);
}

async function connectRegistryServer(event) {
  event.preventDefault();
  if (!selectedRegistryServer) { notify('Inspect a Registry server before connecting it.', 'error'); return; }
  const serverUrl = $('#mcp-registry-remote').value;
  const allEmployees = $('#mcp-registry-all-employees').checked;
  const employeeIds = Array.from(document.querySelectorAll('#mcp-registry-employee-picker input:checked')).map((input) => input.value);
  if (!serverUrl) { notify('Choose a compatible advertised remote.', 'error'); return; }
  if (!allEmployees && !employeeIds.length) { notify('Select at least one active employee.', 'error'); return; }
  try {
    const result = await requestJson('/api/mcp/registry/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ registry_name: selectedRegistryServer.name, server_url: serverUrl, auth_token: $('#mcp-registry-token').value.trim() || undefined, auth_header_name: $('#mcp-registry-header-name').value.trim(), auth_header_prefix: $('#mcp-registry-header-prefix').value.trim(), all_employees: allEmployees, employee_ids: employeeIds }) });
    notify(`${result.tools_discovered || 0} tools discovered and connected for ${result.employees_connected || 0} employee${result.employees_connected === 1 ? '' : 's'}.`, 'success');
    $('#mcp-registry-connect-form').reset();
    $('#mcp-registry-connect-form').hidden = true;
    selectedRegistryServer = null;
    await loadData();
    activateTab('integrations', false);
  } catch (error) { notify(error.message || 'The Registry server could not be connected.', 'error'); }
}

async function loadData() {
  try {
    notify('');
    const [employeesData, billing, catalog, company, marketplace] = await Promise.all([
      requestJson('/api/employees'), requestJson('/api/billing'), requestJson('/api/employee-catalog'), requestJson('/api/company'), requestJson('/api/mcp/marketplace')
    ]);
    employees = employeesData || [];
    populateEmployeeSelect('grant-emp-id');
    populateEmployeeSelect('custom-mcp-employee');
    populateEmployeeSelect('marketplace-employee');
    const marketSelect = $('#marketplace-server');
    if (marketSelect) marketSelect.innerHTML = (marketplace.servers || []).map((server) => `<option value="${safe(server.id)}">${safe(server.name)} · ${safe(server.category)}</option>`).join('') || '<option value="">No marketplace servers available</option>';
    renderEmployeeTools();
    renderCatalog(catalog || []);
    renderBilling(billing || {});
    if (company) {
      $('#setting-company-name').value = company.name || '';
      $('#setting-industry').value = company.industry || '';
      if (company.name) $('#settings-workspace-title').textContent = company.name;
    }
    const connectionSets = await Promise.all(employees.map(async (employee) => ({ employee, connections: await requestJson(`/api/employees/${encodeURIComponent(employee.id)}/mcp-connections`).catch(() => []) })));
    renderConnections(connectionSets);
  } catch (error) {
    console.error('Unable to load Settings:', error);
    notify(error.message || 'Settings could not be loaded. Refresh the page to try again.', 'error');
  }
}

function updateCustomMcpFields() {
  const type = $('#custom-mcp-type').value;
  const employeeId = $('#custom-mcp-employee').value;
  const label = $('#custom-mcp-target-label');
  const target = $('#custom-mcp-target');
  const name = $('#custom-mcp-name');
  const gmailSendOption = $('#gmail-send-option');
  const gmailSend = $('#custom-mcp-gmail-send');
  const canEnableSarahSend = type === 'google_gmail' && employeeId === 'sarah';
  gmailSendOption.hidden = !canEnableSarahSend;
  gmailSend.disabled = !canEnableSarahSend;
  if (!canEnableSarahSend) gmailSend.checked = false;
  label.firstChild.textContent = 'MCP Server URL';
  target.disabled = false;
  target.value = target.value === 'Google OAuth required after saving' ? '' : target.value;
  if (type === 'google_gmail' || type === 'google_sheets') {
    label.firstChild.textContent = 'Google account';
    target.value = 'Google OAuth required after saving';
    target.disabled = true;
    if (!name.value) name.value = type === 'google_sheets' ? 'Google Sheets' : 'Google Gmail';
  } else if (type === 'git_repository') {
    label.firstChild.textContent = 'Absolute repository path';
    target.placeholder = 'C:\\Projects\\your-repository';
    if (!name.value) name.value = 'Git repository';
  } else if (type === 'custom_skill') {
    label.firstChild.textContent = 'No endpoint required';
    target.value = '';
    target.disabled = true;
    if (!name.value) name.value = 'Custom skill';
  } else {
    target.placeholder = 'https://mcp.example.com';
  }
}

async function saveCompanySettings(event) {
  event.preventDefault();
  const name = $('#setting-company-name').value.trim();
  const industry = $('#setting-industry').value.trim();
  try {
    await requestJson('/api/company', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, industry }) });
    $('#settings-workspace-title').textContent = name || 'Your workspace';
    notify('Workspace profile saved.', 'success');
  } catch (error) { notify(error.message || 'Workspace profile could not be saved.', 'error'); }
}

async function addCustomMcpConnection(event) {
  event.preventDefault();
  const employeeId = $('#custom-mcp-employee').value;
  const connectionType = $('#custom-mcp-type').value;
  const name = $('#custom-mcp-name').value.trim();
  const target = $('#custom-mcp-target').value.trim();
  const notes = $('#custom-mcp-notes').value.trim();
  const authToken = $('#custom-mcp-token').value.trim();
  const accessLevel = $('#custom-mcp-access').value;
  if (!name) { notify('Give this connection a clear name before saving.', 'error'); return; }
  try {
    const config = { notes };
    if (connectionType === 'git_repository') config.repo_path = target;
    if (connectionType === 'google_gmail' && employeeId === 'sarah') config.gmail_send_enabled = $('#custom-mcp-gmail-send').checked;
    await requestJson(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, connection_type: connectionType, server_url: connectionType === 'streamable_http' ? target : null, auth_token: authToken || undefined, config, access_level: accessLevel }) });
    $('#custom-mcp-form').reset();
    updateCustomMcpFields();
    notify('Connection saved. Complete OAuth or discover available tools before use.', 'success');
    await loadData();
    activateTab('integrations', false);
  } catch (error) { notify(error.message || 'The connection could not be saved.', 'error'); }
}

async function attachMarketplaceServer(event) {
  event.preventDefault();
  const employeeId = $('#marketplace-employee').value;
  const marketplaceId = $('#marketplace-server').value;
  if (!employeeId || !marketplaceId) { notify('Choose both an employee and a marketplace server.', 'error'); return; }
  try {
    await requestJson(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ marketplace_id: marketplaceId, access_level: $('#marketplace-access').value, name: $('#marketplace-name').value.trim() }) });
    $('#marketplace-form').reset();
    notify('Marketplace server attached. Discover its exposed tools before granting access.', 'success');
    await loadData();
    activateTab('integrations', false);
  } catch (error) { notify(error.message || 'The marketplace server could not be attached.', 'error'); }
}

async function submitToolGrant(event) {
  event.preventDefault();
  const employeeId = $('#grant-emp-id').value;
  const toolName = $('#grant-tool-name').value.trim();
  if (!toolName) { notify('Enter a tool name before granting access.', 'error'); return; }
  try {
    await requestJson(`/api/employees/${encodeURIComponent(employeeId)}/tools`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool_name: toolName, action: 'add', access_level: $('#grant-access-level').value }) });
    $('#grant-tool-name').value = '';
    notify('Tool permission granted to this employee.', 'success');
    await loadData();
    activateTab('integrations', false);
  } catch (error) { notify(error.message || 'The tool could not be granted.', 'error'); }
}

async function configureEmployee(employeeId, action) {
  try {
    await requestJson('/api/employees/configure', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ employee_id: employeeId, action }) });
    notify(action === 'add' ? 'Employee added to your active team.' : 'Employee removed from your active team.', 'success');
    await loadData();
    activateTab('team', false);
  } catch (error) { notify(error.message || 'Employee configuration could not be updated.', 'error'); }
}

async function revokeDirectTool(employeeId, toolName) {
  if (!window.confirm(`Revoke ${toolName} from this employee?`)) return;
  try {
    await requestJson(`/api/employees/${encodeURIComponent(employeeId)}/tools`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool_name: toolName, action: 'remove' }) });
    notify('Tool permission revoked.', 'success');
    await loadData();
  } catch (error) { notify(error.message || 'The tool could not be revoked.', 'error'); }
}

async function testMcp(employeeId, connectionId) {
  try {
    const result = await requestJson(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections/${encodeURIComponent(connectionId)}/test`, { method: 'POST' });
    notify(result.message || (result.ok ? 'Connection check completed successfully.' : 'Connection check failed.'), result.ok ? 'success' : 'error');
  } catch (error) { notify(error.message || 'Connection test could not be completed.', 'error'); }
}

async function removeMcp(employeeId, connectionId) {
  if (!window.confirm('Remove this employee-scoped connection? This cannot be undone.')) return;
  try {
    await requestJson(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections/${encodeURIComponent(connectionId)}`, { method: 'DELETE' });
    notify('Connection removed.', 'success');
    await loadData();
  } catch (error) { notify(error.message || 'The connection could not be removed.', 'error'); }
}

async function discoverTools(employeeId, connectionId) {
  try {
    const result = await requestJson(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections/${encodeURIComponent(connectionId)}/tools?refresh=1`);
    notify(`Discovery completed. ${result.discovered?.length || 0} tool${result.discovered?.length === 1 ? '' : 's'} found.`, 'success');
    await loadData();
    activateTab('integrations', false);
  } catch (error) { notify(error.message || 'Tools could not be discovered.', 'error'); }
}

async function grantMcpTool(employeeId, connectionId, toolName, accessLevel) {
  try {
    await requestJson(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_level: accessLevel }) });
    notify(`${toolName} is now ${accessLevel === 'read_only' ? 'read-only' : 'approval-gated'} for this employee.`, 'success');
    await loadData();
    activateTab('integrations', false);
  } catch (error) { notify(error.message || 'Tool access could not be updated.', 'error'); }
}

async function revokeMcpTool(employeeId, connectionId, toolName) {
  if (!window.confirm(`Revoke ${toolName} from this employee?`)) return;
  try {
    await requestJson(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections/${encodeURIComponent(connectionId)}/tools/${encodeURIComponent(toolName)}`, { method: 'DELETE' });
    notify('Tool access revoked.', 'success');
    await loadData();
  } catch (error) { notify(error.message || 'Tool access could not be revoked.', 'error'); }
}

async function requestGitCommit(employeeId, connectionId) {
  const message = window.prompt('Commit message. A manager approval will be required before Git writes:');
  if (!message?.trim()) return;
  try {
    const result = await requestJson(`/api/employees/${encodeURIComponent(employeeId)}/mcp-connections/${encodeURIComponent(connectionId)}/git-commit-request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: message.trim() }) });
    notify(result.message || 'Commit request created for approval.', 'success');
  } catch (error) { notify(error.message || 'Commit request could not be created.', 'error'); }
}

async function startUpgrade(tier) {
  try {
    notify('Preparing a secure checkout…');
    // Do not pre-apply a paid tier. The server applies it only after Razorpay signature verification.
    const order = await requestJson('/api/payments/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tier }) });
    if (typeof window.Razorpay === 'undefined') throw new Error('Secure checkout is unavailable. Refresh the page and try again.');
    const checkout = new window.Razorpay({ key: order.key_id, amount: order.amount, currency: order.currency, name: 'Caveworkers', description: `${tier} workspace plan`, order_id: order.order_id, theme: { color: '#7ee8ff' }, handler: async (payment) => {
      try {
        const verification = await requestJson('/api/payments/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payment) });
        if (verification.status !== 'verified') throw new Error('Payment verification did not complete.');
        notify(`Your workspace is now on the ${tier.toUpperCase()} plan.`, 'success');
        await loadData();
        activateTab('billing', false);
      } catch (error) { notify(error.message || 'Payment could not be verified. Your plan was not changed.', 'error'); }
    } });
    checkout.on('payment.failed', () => notify('Payment was not completed. Your plan has not changed.', 'error'));
    checkout.open();
  } catch (error) { notify(error.message || 'Secure checkout could not be started.', 'error'); }
}

function bindEvents() {
  document.querySelector('.settings-nav')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-settings-tab]');
    if (button) activateTab(button.dataset.settingsTab);
  });
  window.addEventListener('hashchange', () => activateTab(window.location.hash.slice(1), false));
  $('#company-settings-form')?.addEventListener('submit', saveCompanySettings);
  $('#custom-mcp-form')?.addEventListener('submit', addCustomMcpConnection);
  $('#marketplace-form')?.addEventListener('submit', attachMarketplaceServer);
  $('#tool-grant-form')?.addEventListener('submit', submitToolGrant);
  $('#mcp-registry-search-form')?.addEventListener('submit', searchRegistry);
  $('#mcp-registry-connect-form')?.addEventListener('submit', connectRegistryServer);
  $('#mcp-registry-all-employees')?.addEventListener('change', toggleRegistryEmployeePicker);
  $('#custom-mcp-type')?.addEventListener('change', updateCustomMcpFields);
  $('#custom-mcp-employee')?.addEventListener('change', updateCustomMcpFields);
  $('#menuButton')?.addEventListener('click', () => document.querySelector('.settings-rail')?.classList.toggle('is-open'));
  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action], [data-plan]');
    if (!target) return;
    const action = target.dataset.action;
    const { employeeId, connectionId, toolName, access } = target.dataset;
    if (target.dataset.plan) startUpgrade(target.dataset.plan);
    if (action === 'add-employee') configureEmployee(employeeId, 'add');
    if (action === 'remove-employee') { if (window.confirm('Remove this employee from your active team?')) configureEmployee(employeeId, 'remove'); }
    if (action === 'revoke-direct-tool') revokeDirectTool(employeeId, toolName);
    if (action === 'test-mcp') testMcp(employeeId, connectionId);
    if (action === 'remove-mcp') removeMcp(employeeId, connectionId);
    if (action === 'discover-tools') discoverTools(employeeId, connectionId);
    if (action === 'grant-mcp-tool') grantMcpTool(employeeId, connectionId, toolName, access);
    if (action === 'revoke-mcp-tool') revokeMcpTool(employeeId, connectionId, toolName);
    if (action === 'request-git-commit') requestGitCommit(employeeId, connectionId);
    if (action === 'inspect-registry') inspectRegistryServer(target.dataset.registryName);
  });
  $('#logout-btn')?.addEventListener('click', async (event) => {
    event.preventDefault();
    try { if (window.firebaseAuth?.signOut) await window.firebaseAuth.signOut(); } catch (_) {}
    try { await fetch('/api/session-logout', { method: 'POST' }); } catch (_) {}
    window.location.replace('/login');
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  bindEvents();
  activateTab(window.location.hash.slice(1), false);
  updateCustomMcpFields();
  await loadData();
});
