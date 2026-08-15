import crypto from 'crypto';
import { google } from 'googleapis';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isTrialExpired, verifyRazorpayPaymentSignature, verifyRazorpayWebhookSignature } from '../security.js';

process.env.NODE_ENV = 'test';
process.env.SENTRY_DSN = '';
process.env.VITEST = 'true';
process.env.ALWAYS_ON_WORKER_ENABLED = 'false';
process.env.RAZORPAY_KEY_SECRET = 'payment_test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_test_secret';
process.env.MCP_TOKEN_ENCRYPTION_KEY = 'mcp_test_encryption_key';
process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-google-client-secret';

const { app, db, pendingPaymentOrders, workforceTestHooks } = await import('../server.js');

const now = new Date().toISOString();

function encryptTestCredentials(value: Record<string, any>) {
  const key = crypto.createHash('sha256').update(process.env.MCP_TOKEN_ENCRYPTION_KEY || '').digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function seedTenants() {
  db.users.clear();
  db.companies.clear();
  db.orgEmployees.clear();
  db.tasks.clear();
  db.approvals.clear();
  db.taskTenantsLoaded.clear();
  db.approvalTenantsLoaded.clear();
  db.activityLoaded.clear();
  db.analystApprovalsLoaded.clear();
  db.analystMemory.clear();
  db.analystRuns.clear();
  db.knowledge.clear();
  db.activity.clear();
  db.mcpConnections.clear();
  db.workforceQueue.clear();
  db.employeePresence.clear();
  pendingPaymentOrders.clear();
  workforceTestHooks?.resetRateLimits();

  db.users.set('user-a', {
    uid: 'user-a', email: 'a@example.com', display_name: 'Tenant A Manager', company_id: 'company-a', company_name: 'Tenant A', onboarded: true, selected_tier: 'growth'
  });
  db.users.set('user-b', {
    uid: 'user-b', email: 'b@example.com', display_name: 'Tenant B Manager', company_id: 'company-b', company_name: 'Tenant B', onboarded: true, selected_tier: 'growth'
  });
  db.companies.set('company-a', { id: 'company-a', name: 'Tenant A', tier: 'growth', status: 'active', owner_uid: 'user-a', created_at: now });
  db.companies.set('company-b', { id: 'company-b', name: 'Tenant B', tier: 'growth', status: 'active', owner_uid: 'user-b', created_at: now });
  db.taskTenantsLoaded.add('company-a');
  db.taskTenantsLoaded.add('company-b');
}

function csrfRequest(userId: string, method: 'post' | 'put' | 'patch' | 'delete', path: string) {
  const token = `csrf-token-${userId}`;
  return request(app)[method](path)
    .set('x-caveworkers-test-user', userId)
    .set('x-csrf-token', token)
    .set('Cookie', [`cw_csrf=${token}`]);
}

function registryResponse(server: any) {
  return {
    servers: [{ server, _meta: { 'io.modelcontextprotocol.registry/official': { status: 'active' } } }],
    metadata: { count: 1 }
  };
}

function registryServer(remoteUrl = 'https://mcp.example.com/tools') {
  return {
    name: 'io.example/workspace-tools',
    description: 'Tenant-owned workspace tools for CRM and operations.',
    version: '1.2.0',
    repository: { source: 'github', url: 'https://github.com/example/workspace-tools' },
    remotes: [{ type: 'streamable-http', url: remoteUrl, headers: [{ name: 'Authorization', isRequired: true, isSecret: true }] }]
  };
}

function mockRegistryAndMcpTransport(tools: any[] = [
  { name: 'contacts.search', description: 'Search contacts', inputSchema: { type: 'object', properties: {} } },
  { name: 'email.send', description: 'Send email', inputSchema: { type: 'object', properties: {} } }
]) {
  process.env.MCP_REGISTRY_URL = 'https://registry.mock/v0.1';
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes('registry.mock')) {
      return new Response(JSON.stringify(registryResponse(registryServer())), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const body = JSON.parse(String(init?.body || '{}'));
    const result = body.method === 'initialize'
      ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'workspace-tools', version: '1.2.0' } }
      : { tools };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.MCP_REGISTRY_URL;
});

describe('Caveworkers security invariants', () => {
  beforeEach(() => seedTenants());

  it('accepts a valid Razorpay payment signature and rejects tampering', () => {
    const orderId = 'order_test_123';
    const paymentId = 'pay_test_123';
    const signature = crypto.createHmac('sha256', 'payment_test_secret').update(`${orderId}|${paymentId}`).digest('hex');

    expect(verifyRazorpayPaymentSignature(orderId, paymentId, signature, 'payment_test_secret')).toBe(true);
    expect(verifyRazorpayPaymentSignature(orderId, 'pay_tampered', signature, 'payment_test_secret')).toBe(false);
    expect(verifyRazorpayPaymentSignature(orderId, paymentId, `${signature}00`, 'payment_test_secret')).toBe(false);
  });

  it('accepts a valid webhook HMAC and rejects altered bodies or signatures', () => {
    const rawBody = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_123' } } } }));
    const signature = crypto.createHmac('sha256', 'webhook_test_secret').update(rawBody).digest('hex');

    expect(verifyRazorpayWebhookSignature(rawBody, signature, 'webhook_test_secret')).toBe(true);
    expect(verifyRazorpayWebhookSignature(Buffer.from(`${rawBody.toString()} `), signature, 'webhook_test_secret')).toBe(false);
    expect(verifyRazorpayWebhookSignature(rawBody, 'invalid', 'webhook_test_secret')).toBe(false);
  });

  it('returns 401 for an invalid webhook signature and accepts a valid signed event envelope', async () => {
    const payload = { event: 'payment.authorized', payload: { payment: { entity: { id: 'pay_123', order_id: 'order_unknown' } } } };
    const rawBody = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', 'webhook_test_secret').update(rawBody).digest('hex');

    await request(app).post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', 'invalid')
      .send(rawBody)
      .expect(401);

    const response = await request(app).post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signature)
      .send(rawBody);
    expect(response.status).toBe(202);
    expect(response.body.received).toBe(true);
  });

  it('returns 402 for an expired free trial before a workspace task is queued', async () => {
    const expired = new Date(Date.now() - 60_000).toISOString();
    db.companies.set('company-a', { id: 'company-a', name: 'Tenant A', tier: 'free_trial', status: 'active', owner_uid: 'user-a', created_at: now, trial_ends_at: expired });

    const response = await csrfRequest('user-a', 'post', '/api/tasks').send({ request: 'Run an operations review' });
    expect(response.status).toBe(402);
    expect(response.body.upgrade_required).toBe(true);
    expect(response.body.trial_ends_at).toBe(expired);
    expect(Array.from(db.tasks.values()).some((task: any) => task.company_id === 'company-a' && task.question === 'Run an operations review')).toBe(false);
    expect(isTrialExpired('free_trial', expired)).toBe(true);
    expect(isTrialExpired('growth', expired)).toBe(false);
  });

  it('queues the explicit whole-team assignment only for active employees in the authenticated tenant', async () => {
    db.orgEmployees.set('company-a', [
      { id: 'alex', name: 'Alex', role: 'Operations Lead', department: 'Operations', status: 'active', tools: [], permissions: [] },
      { id: 'emma', name: 'Emma', role: 'Finance Controller', department: 'Finance', status: 'active', tools: [], permissions: [] },
      { id: 'david', name: 'David', role: 'Data Analyst', department: 'Analytics', status: 'active', tools: [], permissions: [] }
    ]);
    db.orgEmployees.set('company-b', [
      { id: 'iris', name: 'Iris', role: 'Security Analyst', department: 'Security', status: 'active', tools: [], permissions: [] }
    ]);

    const response = await csrfRequest('user-a', 'post', '/api/tasks')
      .send({ request: 'Prepare the weekly cross-functional operations brief', preferred_employee_id: '__whole_team__' })
      .expect(202);

    expect(response.body.company_id).toBe('company-a');
    expect(response.body.participants).toEqual(expect.arrayContaining(['Manager', 'Alex', 'Emma', 'David']));
    expect(response.body.participants).not.toContain('Iris');
    const queued = Array.from(db.tasks.values()).find((task: any) => task.id === response.body.id) as any;
    expect(queued).toMatchObject({ company_id: 'company-a', status: 'queued', owner: 'sarah' });
    expect(queued.participants).toEqual(expect.arrayContaining(['Sarah', 'Alex', 'Emma', 'David']));
  });

  it('has Sarah own the completed result and delivers a visible manager response', async () => {
    db.orgEmployees.set('company-a', [
      { id: 'alex', name: 'Alex', role: 'Operations Lead', department: 'Operations', status: 'active', tools: [], permissions: [] },
      { id: 'david', name: 'David', role: 'Data Analyst', department: 'Analytics', status: 'active', tools: [], permissions: [] }
    ]);

    const result = await workforceTestHooks!.handleTaskRoutingAsync('Prepare an operations handoff for this week', 'company-a', 'alex');
    expect(result).toMatchObject({ company_id: 'company-a', owner: 'sarah', status: 'completed' });
    expect(result.answer.length).toBeGreaterThan(80);
    expect(result.participants).toEqual(expect.arrayContaining(['Manager', 'Sarah', 'Alex']));
    expect(result.trace).toEqual(expect.arrayContaining([
      expect.objectContaining({ sender: 'Sarah', receiver: 'Manager', kind: 'group_message' })
    ]));
    expect(db.tasks.get(result.id)).toMatchObject({ company_id: 'company-a', owner: 'sarah', status: 'completed' });
  });

  it('routes operations work to Alex and exposes his specialist operating capability', async () => {
    db.orgEmployees.set('company-a', [
      { id: 'alex', name: 'Alex', role: 'Operations Manager', department: 'Operations', status: 'active', tools: ['Gmail', 'Google Calendar', 'Sheets'], permissions: [] },
      { id: 'mike', name: 'Mike', role: 'Engineering Manager', department: 'Engineering', status: 'active', tools: [], permissions: [] }
    ]);

    const result = await workforceTestHooks!.handleTaskRoutingAsync('Build an incident response runbook with an owner, deadline, SLA, and escalation path', 'company-a');
    expect(result.participants).toEqual(expect.arrayContaining(['Manager', 'Sarah', 'Alex']));
    expect(result.plan).toContain('Alex');
    expect(result.answer).not.toMatch(/^#{1,6}\\s|^\\s*[-*]\\s/m);

    const workforceResponse = await request(app)
      .get('/api/workforce/workroom')
      .set('x-caveworkers-test-user', 'user-a')
      .expect(200);
    const alex = workforceResponse.body.employees.find((employee: any) => employee.id === 'alex');
    expect(alex).toMatchObject({
      id: 'alex',
      capability_summary: expect.stringContaining('owned workflows'),
      avatar_url: '/static/assets/employee-avatars/alex.webp'
    });
    expect(alex.system_prompt).toBeUndefined();
  });

  it('truthfully blocks Sarah email delivery until a tenant Gmail send capability is connected', async () => {
    const result = await workforceTestHooks!.handleTaskRoutingAsync('Send an email to ops@example.com confirming the weekly handoff', 'company-a', 'alex');
    expect(result).toMatchObject({ company_id: 'company-a', owner: 'sarah', status: 'blocked' });
    expect(result.execution).toMatchObject({ action_type: 'gmail.send', status: 'blocked' });
    expect(result.execution.summary).toMatch(/Gmail|connect/i);
    const approval = Array.from(db.approvals.values()).find((entry: any) => entry.task_id === result.id) as any;
    expect(approval).toMatchObject({ company_id: 'company-a', employee_id: 'sarah', status: 'rejected' });
    expect(approval.payload.action_type).toBe('gmail.send');
  });

  it('returns normalized official Registry results with an MCP.Directory detail link', async () => {
    const fetchMock = mockRegistryAndMcpTransport();
    const response = await request(app)
      .get('/api/mcp/registry/search?q=workspace')
      .set('x-caveworkers-test-user', 'user-a')
      .expect(200);

    expect(response.body.count).toBe(1);
    expect(response.body.servers[0]).toMatchObject({
      name: 'io.example/workspace-tools',
      version: '1.2.0',
      directory_url: 'https://mcp.directory/servers?search=io.example%2Fworkspace-tools'
    });
    expect(response.body.servers[0].remotes).toEqual([
      expect.objectContaining({ type: 'streamable-http', url: 'https://mcp.example.com/tools' })
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rejects private Registry-advertised remotes before any MCP connection attempt', async () => {
    process.env.MCP_REGISTRY_URL = 'https://registry.mock/v0.1';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      if (String(input).includes('registry.mock')) {
        return new Response(JSON.stringify(registryResponse(registryServer('http://127.0.0.1:8080/internal'))), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error('The private remote must never be contacted.');
    });

    const response = await csrfRequest('user-a', 'post', '/api/mcp/registry/connect')
      .send({ registry_name: 'io.example/workspace-tools', server_url: 'http://127.0.0.1:8080/internal', all_employees: true })
      .expect(400);

    expect(response.body.error).toMatch(/Private hosts|credentials|unsafe/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.mcpConnections.size).toBe(0);
  });

  it('connects only active employees in the authenticated tenant and applies encrypted, approval-gated grants', async () => {
    db.orgEmployees.set('company-a', [
      { id: 'alex', name: 'Alex', role: 'Operations Lead', department: 'Operations', status: 'active', tools: [], permissions: [] },
      { id: 'david', name: 'David', role: 'Data Analyst', department: 'Analytics', status: 'active', tools: [], permissions: [] }
    ]);
    db.orgEmployees.set('company-b', [
      { id: 'iris', name: 'Iris', role: 'Security Analyst', department: 'Security', status: 'active', tools: [], permissions: [] }
    ]);
    const fetchMock = mockRegistryAndMcpTransport();

    const response = await csrfRequest('user-a', 'post', '/api/mcp/registry/connect')
      .send({
        registry_name: 'io.example/workspace-tools',
        server_url: 'https://mcp.example.com/tools',
        auth_token: 'tenant-secret-token',
        auth_header_name: 'X-Workspace-Token',
        auth_header_prefix: '',
        all_employees: false,
        employee_ids: ['alex', 'iris']
      })
      .expect(201);

    expect(response.body.employees_connected).toBe(1);
    expect(response.body.tools_discovered).toBe(2);
    expect(response.body.connections[0]).not.toHaveProperty('auth_token_encrypted');
    expect(response.body.connections[0].auth_configured).toBe(true);
    expect(Array.from(db.mcpConnections.keys())).toEqual(['company-a:alex']);
    expect(db.mcpConnections.has('company-b:iris')).toBe(false);
    const connection = db.mcpConnections.get('company-a:alex')?.[0] as any;
    expect(connection.auth_token_encrypted).toEqual(expect.any(String));
    expect(connection.auth_token_encrypted).not.toContain('tenant-secret-token');
    expect(connection.config).toMatchObject({ auth_header_name: 'X-Workspace-Token', auth_header_prefix: '' });
    expect(connection.tool_grants).toEqual(expect.arrayContaining([
      { tool_name: 'contacts.search', access_level: 'read_only' },
      { tool_name: 'email.send', access_level: 'requires_approval' }
    ]));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((db.activity.get('company-a') || []).some((entry: any) => entry.kind === 'mcp.registry_connected')).toBe(true);
  });

  it('executes a granted read-only MCP tool for every active employee', async () => {
    const employeeIds = ['sarah', 'david', 'alex', 'mike', 'emma', 'arav', 'olivia', 'maya', 'priya', 'iris'];
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: any, init?: any) => {
      const payload = JSON.parse(String(init?.body || '{}'));
      const result = payload.method === 'initialize'
        ? { protocolVersion: '2025-11-25', capabilities: {} }
        : { content: [{ type: 'text', text: 'Synthetic tenant MCP read succeeded.' }] };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'test-session' } });
    });

    employeeIds.forEach((employeeId, index) => {
      const employee = (['Sarah', 'David', 'Alex', 'Mike', 'Emma', 'Arav', 'Olivia', 'Maya', 'Priya', 'Iris'] as string[])[index];
      db.mcpConnections.set(`company-a:${employeeId}`, [{
        id: 7000 + index,
        company_id: 'company-a',
        employee_id: employeeId,
        name: `${employee} tenant tools`,
        connection_type: 'streamable_http',
        server_url: 'https://mcp.example.com/tools',
        status: 'connected',
        discovered_tools: [{ name: 'contacts.search', description: 'Read contacts', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }, risk: 'read' }],
        tool_grants: [{ tool_name: 'contacts.search', access_level: 'read_only' }],
        created_at: now,
        updated_at: now
      }]);
    });

    const evidence = await Promise.all(employeeIds.map((employeeId, index) => workforceTestHooks!.executeEmployeeReadTools!('company-a', { id: employeeId, name: (['Sarah', 'David', 'Alex', 'Mike', 'Emma', 'Arav', 'Olivia', 'Maya', 'Priya', 'Iris'] as string[])[index] }, 'Run the MCP connectivity check')));
    const flattened = evidence.flat();
    expect(flattened).toHaveLength(10);
    expect(flattened.map((entry: any) => entry.employee_id)).toEqual(employeeIds);
    expect(flattened.every((entry: any) => entry.status === 'executed')).toBe(true);
    expect(flattened.every((entry: any) => entry.summary.includes('Synthetic tenant MCP read succeeded'))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it('supports approval-gated Gmail preparation for every active employee', async () => {
    const employeeIds = ['sarah', 'david', 'alex', 'mike', 'emma', 'arav', 'olivia', 'maya', 'priya', 'iris'];
    employeeIds.forEach((employeeId, index) => {
      db.mcpConnections.set(`company-a:${employeeId}`, [{
        id: 8000 + index,
        company_id: 'company-a',
        employee_id: employeeId,
        name: `${employeeId} Gmail`,
        connection_type: 'google_gmail',
        status: 'connected',
        auth_token_encrypted: 'test-token-placeholder',
        auth_scopes: ['https://www.googleapis.com/auth/gmail.send'],
        config: { gmail_send_enabled: true },
        discovered_tools: [{ name: 'gmail.send', description: 'Send email', risk: 'write' }],
        tool_grants: [{ tool_name: 'gmail.send', access_level: 'requires_approval' }],
        created_at: now,
        updated_at: now
      }]);
    });

    for (const employeeId of employeeIds) {
      const result = await workforceTestHooks!.handleTaskRoutingAsync!(`Send an email to ragulyogesh7@gmail.com saying Hi from ${employeeId}`, 'company-a', employeeId, undefined, employeeId);
      expect(result.execution).toMatchObject({ action_type: 'gmail.send', status: 'awaiting_approval' });
      const approval = Array.from(db.approvals.values()).find((entry: any) => entry.task_id === result.id) as any;
      expect(approval).toMatchObject({ company_id: 'company-a', employee_id: employeeId, tool_name: 'Gmail send', status: 'pending' });
      expect(approval.payload).toMatchObject({ action_type: 'gmail.send', employee_id: employeeId, to: ['ragulyogesh7@gmail.com'] });
    }
  });

  it('dispatches one approval-gated Gmail message for every active employee with verified results', async () => {
    const employeeIds = ['sarah', 'david', 'alex', 'mike', 'emma', 'arav', 'olivia', 'maya', 'priya', 'iris'];
    const sendMock = vi.fn(async ({ requestBody }: any) => ({ data: { id: `message-${sendMock.mock.calls.length}`, threadId: `thread-${sendMock.mock.calls.length}`, raw_size: String(requestBody?.raw || '').length } }));
    const gmailSpy = vi.spyOn(google, 'gmail').mockReturnValue({ users: { messages: { send: sendMock } } } as any);

    for (const [index, employeeId] of employeeIds.entries()) {
      const connectionId = 9000 + index;
      db.mcpConnections.set(`company-a:${employeeId}`, [{
        id: connectionId,
        company_id: 'company-a',
        employee_id: employeeId,
        name: `${employeeId} Gmail`,
        connection_type: 'google_gmail',
        status: 'connected',
        auth_token_encrypted: encryptTestCredentials({ access_token: `test-access-${employeeId}` }),
        auth_scopes: ['https://www.googleapis.com/auth/gmail.send'],
        config: { gmail_send_enabled: true },
        tool_grants: [{ tool_name: 'gmail.send', access_level: 'requires_approval' }],
        created_at: now,
        updated_at: now
      }]);

      const approval: any = {
        id: 10000 + index,
        company_id: 'company-a',
        task_id: 11000 + index,
        employee_id: employeeId,
        tool_name: 'Gmail send',
        action_summary: `Send a test email from ${employeeId}.`,
        status: 'approved',
        created_at: now,
        payload: { action_type: 'gmail.send', connection_id: connectionId, employee_id: employeeId, to: ['ragulyogesh7@gmail.com'], subject: `Caveworkers ${employeeId} MCP test`, body: 'Hi', execution_status: 'pending' }
      };
      db.approvals.set(approval.id, approval);

      const result = await workforceTestHooks!.dispatchApprovedEmployeeEmail!(approval);
      expect(result).toMatchObject({ employee_id: employeeId, message_id: `message-${index + 1}`, recipients: 'ragulyogesh7@gmail.com' });
      expect(approval.payload.execution_status).toBe('succeeded');
    }

    expect(gmailSpy).toHaveBeenCalledTimes(10);
    expect(sendMock).toHaveBeenCalledTimes(10);
  });

  it('prepares and executes an approval-gated tenant GitHub MCP write with a verified commit SHA', async () => {
    db.orgEmployees.set('company-a', [{ id: 'mike', name: 'Mike', role: 'Engineering Manager', department: 'Engineering', status: 'active', tools: ['GitHub MCP'], permissions: [] }]);
    const connectionId = 12001;
    db.mcpConnections.set('company-a:mike', [{
      id: connectionId,
      company_id: 'company-a',
      employee_id: 'mike',
      name: 'GitHub MCP',
      connection_type: 'streamable_http',
      server_url: 'https://api.githubcopilot.com/mcp/',
      status: 'connected',
      auth_token_encrypted: encryptTestCredentials({ access_token: 'tenant-github-token' }),
      config: { registry_server_name: 'GitHub Official MCP Server' },
      discovered_tools: [{
        name: 'create_or_update_file',
        description: 'Create or update a file in a GitHub repository.',
        inputSchema: { type: 'object', properties: { owner: { type: 'string' }, repo: { type: 'string' }, path: { type: 'string' }, message: { type: 'string' }, content: { type: 'string' }, branch: { type: 'string' } }, required: ['owner', 'repo', 'path', 'message', 'content'] },
        risk: 'write'
      }],
      tool_grants: [{ tool_name: 'create_or_update_file', access_level: 'requires_approval' }],
      created_at: now,
      updated_at: now
    }]);

    const prepared = await workforceTestHooks!.handleTaskRoutingAsync!('Edit the file employee-mcp-test.txt with a hello world message in my GitHub repo https://github.com/ragulyogesh7-cloud/caveworkers-employee-mcp-test.git', 'company-a', 'mike');
    expect(prepared).toMatchObject({ company_id: 'company-a', status: 'pending_approval', owner: 'sarah', execution: { action_type: 'mcp.tool', status: 'awaiting_approval' } });
    const approval = Array.from(db.approvals.values()).find((entry: any) => entry.task_id === prepared.id) as any;
    expect(approval).toMatchObject({ company_id: 'company-a', employee_id: 'mike', tool_name: 'create_or_update_file', status: 'pending' });
    expect(approval.payload).toMatchObject({ action_type: 'mcp.tool', connection_id: connectionId, employee_id: 'mike', tool_name: 'create_or_update_file', arguments: { owner: 'ragulyogesh7-cloud', repo: 'caveworkers-employee-mcp-test', path: 'employee-mcp-test.txt', content: 'Hello World' } });

    const commitSha = '0123456789abcdef0123456789abcdef01234567';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input: any, init?: any) => {
      const payload = JSON.parse(String(init?.body || '{}'));
      const result = payload.method === 'initialize'
        ? { protocolVersion: '2025-11-25', capabilities: { tools: {} } }
        : { content: [{ type: 'text', text: `Committed successfully. Commit ${commitSha}` }] };
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: payload.id, result }), { status: 200, headers: { 'content-type': 'application/json', 'mcp-session-id': 'github-test-session' } });
    });

    const dispatched = await workforceTestHooks!.dispatchApprovedMcpTool!(approval);
    expect(dispatched).toMatchObject({ employee_id: 'mike', connector_name: 'GitHub MCP', tool_name: 'create_or_update_file', commit_sha: commitSha });
    expect(approval.payload.execution_status).toBe('succeeded');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const callPayload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body || '{}'));
    expect(callPayload).toMatchObject({ method: 'tools/call', params: { name: 'create_or_update_file', arguments: expect.objectContaining({ owner: 'ragulyogesh7-cloud', repo: 'caveworkers-employee-mcp-test', path: 'employee-mcp-test.txt', content: 'Hello World' }) } });
  });

  it('rate-limits Registry search requests for the same client', async () => {
    const fetchMock = mockRegistryAndMcpTransport();
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await request(app)
        .get('/api/mcp/registry/search?q=workspace')
        .set('x-caveworkers-test-user', 'user-a')
        .expect(200);
    }
    const limited = await request(app)
      .get('/api/mcp/registry/search?q=workspace')
      .set('x-caveworkers-test-user', 'user-a')
      .expect(429);
    expect(limited.body.error).toMatch(/rate limited/i);
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  it('returns only the authenticated tenant’s tasks and approvals', async () => {
    db.tasks.set(501, { id: 501, company_id: 'company-a', question: 'Tenant A task', owner: 'alex', status: 'completed', answer: 'A', plan: 'A', created_at: now, trace: [] });
    db.tasks.set(502, { id: 502, company_id: 'company-b', question: 'Tenant B task', owner: 'alex', status: 'completed', answer: 'B', plan: 'B', created_at: now, trace: [] });
    db.approvals.set(601, { id: 601, company_id: 'company-a', task_id: 501, employee_id: 'alex', tool_name: 'Gmail', action_summary: 'A approval', status: 'pending', created_at: now });
    db.approvals.set(602, { id: 602, company_id: 'company-b', task_id: 502, employee_id: 'alex', tool_name: 'Gmail', action_summary: 'B approval', status: 'pending', created_at: now });
    db.analystApprovalsLoaded.add('company-a');

    const tasks = await request(app).get('/api/tasks').set('x-caveworkers-test-user', 'user-a').expect(200);
    expect(tasks.body.tasks.map((task: any) => task.id)).toContain(501);
    expect(tasks.body.tasks.map((task: any) => task.id)).not.toContain(502);

    const approvals = await request(app).get('/api/approvals').set('x-caveworkers-test-user', 'user-a').expect(200);
    expect(approvals.body.map((approval: any) => approval.id)).toEqual([601]);
  });

  it('rejects unsafe API requests without a matching CSRF cookie and header', async () => {
    const response = await request(app)
      .post('/api/tasks')
      .set('x-caveworkers-test-user', 'user-a')
      .send({ request: 'This must be rejected' });

    expect(response.status).toBe(403);
    expect(response.body.error).toBe('CSRF validation failed.');
  });

  it('reports health component readiness and returns a request correlation ID', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.status).toBe('healthy');
    expect(response.body.components).toHaveProperty('database');
    expect(response.body.components).toHaveProperty('payments');
    expect(response.body.components).toHaveProperty('observability');
    expect(response.headers['x-request-id']).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
  });
});
