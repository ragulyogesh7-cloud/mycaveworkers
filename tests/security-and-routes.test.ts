import crypto from 'crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { isTrialExpired, verifyRazorpayPaymentSignature, verifyRazorpayWebhookSignature } from '../security.js';

process.env.NODE_ENV = 'test';
process.env.SENTRY_DSN = '';
process.env.VITEST = 'true';
process.env.ALWAYS_ON_WORKER_ENABLED = 'false';
process.env.RAZORPAY_KEY_SECRET = 'payment_test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook_test_secret';

const { app, db, pendingPaymentOrders } = await import('../server.js');

const now = new Date().toISOString();

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
  pendingPaymentOrders.clear();

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
