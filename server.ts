import express from 'express';
import path from 'path';
import { readFileSync } from 'fs';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import ejs from 'ejs';
import crypto from 'crypto';
import net from 'net';
import { lookup } from 'dns/promises';
import Razorpay from 'razorpay';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';
import { google } from 'googleapis';
import { Sentry, anonymizeIdentifier, reportOperationalFailure, sentryEnabled } from './instrument.js';
import { isTrialExpired, verifyRazorpayPaymentSignature, verifyRazorpayWebhookSignature } from './security.js';

dotenv.config();

const app = express();
const requestIds = new WeakMap<express.Request, string>();
function getRequestId(req: express.Request): string { return requestIds.get(req) || 'unavailable'; }
const PORT = Number(process.env.PORT || '3000') || 3000;
const HOST = '0.0.0.0';
const IS_PRODUCTION = process.env.CAVEWORKERS_ENV === 'production';
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((origin) => origin.trim().replace(/\/$/, '')).filter(Boolean);
if (IS_PRODUCTION && ALLOWED_ORIGINS.length === 0) {
  console.warn('ALLOWED_ORIGINS is empty in production; only same-origin requests will be accepted.');
}
function getRequestOrigin(req: express.Request): string {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol;
  const host = req.get('host');
  return host ? `${protocol}://${host}`.replace(/\/$/, '') : '';
}
function isAllowedRequestOrigin(req: express.Request, origin: string): boolean {
  const normalizedOrigin = origin.trim().replace(/\/$/, '');
  return normalizedOrigin === getRequestOrigin(req) || ALLOWED_ORIGINS.includes(normalizedOrigin);
}

let genAIClient: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    genAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
    console.log('Gemini 3.6 Flash SDK initialized successfully');
  } catch (err) {
    reportOperationalFailure('analyst.gemini_initialization', err);
  }
}

// David's provider is configurable. OpenRouter/Qwen is preferred in production;
// Gemini remains a backwards-compatible fallback while a tenant is provisioned.
const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || '').trim();
const OPENROUTER_KEY_READY = /^sk-or-v1-[A-Za-z0-9_-]{20,}$/.test(OPENROUTER_API_KEY);
if (OPENROUTER_API_KEY && !OPENROUTER_KEY_READY) console.warn('OPENROUTER_API_KEY is present but does not match the expected provider key format; analyst model calls are disabled.');
const OPENROUTER_BASE_URL = (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
const ANALYST_MODEL = process.env.ANALYST_MODEL || 'qwen/qwen3-30b-a3b';
const OPENROUTER_TIMEOUT_MS = Math.min(Math.max(Number(process.env.OPENROUTER_TIMEOUT_MS || '30000') || 30000, 5000), 60000);
const ANALYST_MAX_TOKENS = Math.min(Math.max(Number(process.env.ANALYST_MAX_TOKENS || '900') || 900, 128), 2000);
const PUBLIC_APP_URL = (process.env.PUBLIC_APP_URL || 'https://caveworkers.app').replace(/\/$/, '');
const GOOGLE_OAUTH_CLIENT_ID = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const GOOGLE_OAUTH_CLIENT_SECRET = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
const GOOGLE_OAUTH_REDIRECT_URI = (process.env.GOOGLE_OAUTH_REDIRECT_URI || `${PUBLIC_APP_URL}/api/google/oauth/callback`).replace(/\/$/, '');
const MCP_TOKEN_ENCRYPTION_KEY = (process.env.MCP_TOKEN_ENCRYPTION_KEY || '').trim();
const OAUTH_STATE_SECRET = (process.env.FLASK_SECRET || '').trim();
const ALWAYS_ON_WORKER_ENABLED = process.env.ALWAYS_ON_WORKER_ENABLED !== 'false';
const WORKER_POLL_MS = Math.min(Math.max(Number(process.env.WORKER_POLL_MS || '1500') || 1500, 500), 10000);
const WORKER_INSTANCE_ID = process.env.WORKER_INSTANCE_ID || `worker-${crypto.randomBytes(6).toString('hex')}`;
const WEB_RESEARCH_ENABLED = process.env.WEB_RESEARCH_ENABLED === 'true';
const TAVILY_API_KEY = (process.env.TAVILY_API_KEY || '').trim();
const BRAVE_SEARCH_API_KEY = (process.env.BRAVE_SEARCH_API_KEY || '').trim();

type AnalystNarrativeResult = {
  text: string;
  provider: 'openrouter' | 'gemini' | 'preview';
  model?: string;
  latency_ms: number;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number };
  error_code?: string;
};

function extractAnalystText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map((part: any) => typeof part === 'string' ? part : part?.text || '').join('').trim();
  return '';
}

async function generateAnalystNarrative(prompt: string, tenantId: string): Promise<AnalystNarrativeResult> {
  const startedAt = Date.now();
  let openRouterFailure: AnalystNarrativeResult | null = null;
  if (OPENROUTER_KEY_READY) {
    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': PUBLIC_APP_URL,
          'X-OpenRouter-Title': 'Caveworkers Data Analyst',
          'X-OpenRouter-Categories': 'cloud-agent'
        },
        body: JSON.stringify({
          model: ANALYST_MODEL,
          temperature: 0.2,
          max_tokens: ANALYST_MAX_TOKENS,
          stream: false,
          user: crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 32),
          messages: [
            { role: 'system', content: 'You are David, a precise senior business data analyst. Write concise decision-ready analysis. Never invent access to data, results, or external actions. Clearly label previews, assumptions, and missing sources.' },
            { role: 'user', content: prompt }
          ]
        })
      });
      if (response.ok) {
        const payload: any = await response.json();
        const content = extractAnalystText(payload?.choices?.[0]?.message?.content);
        if (content) return { text: content, provider: 'openrouter', model: payload?.model || ANALYST_MODEL, latency_ms: Date.now() - startedAt, usage: payload?.usage ? { prompt_tokens: payload.usage.prompt_tokens, completion_tokens: payload.usage.completion_tokens, total_tokens: payload.usage.total_tokens, cost: payload.usage.cost } : undefined };
        reportOperationalFailure('analyst.openrouter_response', new Error('OpenRouter returned no text.'), { tenant_hash: anonymizeIdentifier(tenantId), response_id: String(payload?.id || 'unknown').slice(0, 120) });
        openRouterFailure = { text: '', provider: 'openrouter', model: ANALYST_MODEL, latency_ms: Date.now() - startedAt, error_code: 'empty_response' };
      } else {
        reportOperationalFailure('analyst.openrouter_request', new Error(`OpenRouter returned HTTP ${response.status}.`), { tenant_hash: anonymizeIdentifier(tenantId), status_code: response.status });
        openRouterFailure = { text: '', provider: 'openrouter', model: ANALYST_MODEL, latency_ms: Date.now() - startedAt, error_code: `http_${response.status}` };
      }
    } catch (error: any) {
      const errorCode = error?.name === 'TimeoutError' || error?.name === 'AbortError' ? 'timeout' : 'network_error';
      reportOperationalFailure('analyst.openrouter_request', error, { tenant_hash: anonymizeIdentifier(tenantId), error_code: errorCode });
      openRouterFailure = { text: '', provider: 'openrouter', model: ANALYST_MODEL, latency_ms: Date.now() - startedAt, error_code: errorCode };
    }
  }
  if (genAIClient) {
    try {
      const response = await genAIClient.models.generateContent({ model: 'gemini-3.6-flash', contents: prompt });
      if (response.text?.trim()) return { text: response.text.trim(), provider: 'gemini', model: 'gemini-3.6-flash', latency_ms: Date.now() - startedAt };
    } catch (error) {
      reportOperationalFailure('analyst.gemini_fallback', error, { tenant_hash: anonymizeIdentifier(tenantId) });
    }
  }
  return openRouterFailure || { text: '', provider: 'preview', latency_ms: Date.now() - startedAt, error_code: OPENROUTER_KEY_READY ? 'provider_unavailable' : 'model_not_configured' };
}

async function generateWorkforceNarrative(prompt: string, tenantId: string): Promise<AnalystNarrativeResult> {
  const startedAt = Date.now();
  if (OPENROUTER_KEY_READY) {
    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST', signal: AbortSignal.timeout(OPENROUTER_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'HTTP-Referer': PUBLIC_APP_URL, 'X-OpenRouter-Title': 'Caveworkers Workforce Manager' },
        body: JSON.stringify({
          model: ANALYST_MODEL, temperature: 0.2, max_tokens: Math.min(1400, ANALYST_MAX_TOKENS + 350), stream: false,
          user: crypto.createHash('sha256').update(tenantId).digest('hex').slice(0, 32),
          messages: [
            { role: 'system', content: 'You are Sarah, Caveworkers’ workforce manager. You own the manager response for every task, delegate rather than pretending to be every specialist, and return the useful final answer before process commentary. Never invent evidence, connector access, or external completion. Be concrete about blockers and name the next action.' },
            { role: 'user', content: prompt }
          ]
        })
      });
      if (response.ok) {
        const payload: any = await response.json();
        const text = extractAnalystText(payload?.choices?.[0]?.message?.content);
        if (text) return { text, provider: 'openrouter', model: payload?.model || ANALYST_MODEL, latency_ms: Date.now() - startedAt, usage: payload?.usage ? { prompt_tokens: payload.usage.prompt_tokens, completion_tokens: payload.usage.completion_tokens, total_tokens: payload.usage.total_tokens, cost: payload.usage.cost } : undefined };
      } else reportOperationalFailure('workforce.openrouter_request', new Error(`OpenRouter returned HTTP ${response.status}.`), { tenant_hash: anonymizeIdentifier(tenantId), status_code: response.status });
    } catch (error) { reportOperationalFailure('workforce.openrouter_request', error, { tenant_hash: anonymizeIdentifier(tenantId) }); }
  }
  if (genAIClient) {
    try {
      const response = await genAIClient.models.generateContent({ model: 'gemini-3.6-flash', contents: `You are Sarah, Caveworkers’ workforce manager. ${prompt}` });
      if (response.text?.trim()) return { text: response.text.trim(), provider: 'gemini', model: 'gemini-3.6-flash', latency_ms: Date.now() - startedAt };
    } catch (error) { reportOperationalFailure('workforce.gemini_fallback', error, { tenant_hash: anonymizeIdentifier(tenantId) }); }
  }
  return { text: '', provider: 'preview', latency_ms: Date.now() - startedAt, error_code: OPENROUTER_KEY_READY ? 'provider_unavailable' : 'model_not_configured' };
}

app.use((req, res, next) => {
  const requestOrigin = req.get('origin');
  if (requestOrigin) {
    if (!isAllowedRequestOrigin(req, requestOrigin)) {
      return res.status(403).json({ error: 'Origin not allowed by CORS.' });
    }
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Request-Id');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use((req, res, next) => {
  const incoming = String(req.get('x-request-id') || '').trim();
  const requestId = /^[A-Za-z0-9_-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  requestIds.set(req, requestId);
  res.setHeader('X-Request-Id', requestId);
  next();
});
app.use(express.json({ verify: (req, _res, buffer) => { (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); } }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Static assets
app.use('/static', express.static(path.join(process.cwd(), 'static')));

// Template engine setup
app.engine('html', ejs.renderFile);
app.set('view engine', 'html');
app.set('views', path.join(process.cwd(), 'templates'));

// Firebase Config
const FIREBASE_WEB_CONFIG = {
  apiKey: process.env.FIREBASE_API_KEY || 'AIzaSyBXDF0iimw-zgwaxG5qJ9gngRKSJ_eLPt8',
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || 'caveworkers.firebaseapp.com',
  projectId: process.env.FIREBASE_PROJECT_ID || 'caveworkers',
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'caveworkers.firebasestorage.app',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || '980597206467',
  appId: process.env.FIREBASE_APP_ID || '1:980597206467:web:789036c39cfb0541d1a176'
};

// Initialize Firebase Admin SDK from deployment-provided credentials only.
const firebaseProjectId = process.env.FIREBASE_PROJECT_ID;
const firebaseClientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const firebasePrivateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const firebaseServiceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

if (!getApps().length) {
  try {
    if (firebaseServiceAccountPath) {
      const serviceAccount = JSON.parse(readFileSync(path.resolve(firebaseServiceAccountPath), 'utf8'));
      initializeApp({ credential: cert(serviceAccount) });
    } else if (firebaseProjectId && firebaseClientEmail && firebasePrivateKey) {
      initializeApp({
        credential: cert({
          projectId: firebaseProjectId,
          clientEmail: firebaseClientEmail,
          privateKey: firebasePrivateKey
        })
      });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      initializeApp();
    } else {
      console.warn('Firebase Admin SDK is not configured; Google sign-in will fail closed until Firebase credentials are provided.');
    }
  } catch (e) {
    reportOperationalFailure('firebase.initialization', e);
  }
}

const firebaseAuth = getApps().length ? getAuth() : null;
const firestoreDb = getApps().length ? getFirestore() : null;
const SESSION_COOKIE_MAX_AGE = 5 * 24 * 60 * 60 * 1000;
const cookieSecure = process.env.COOKIE_SECURE === 'true' || process.env.CAVEWORKERS_ENV === 'production';
const sessionCookieOptions = { httpOnly: true, secure: cookieSecure, sameSite: 'lax' as const, path: '/', maxAge: SESSION_COOKIE_MAX_AGE };
const readableCookieOptions = { httpOnly: false, secure: cookieSecure, sameSite: 'lax' as const, path: '/', maxAge: SESSION_COOKIE_MAX_AGE };

// Razorpay Setup
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || '';
if (IS_PRODUCTION && (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET || !RAZORPAY_WEBHOOK_SECRET)) {
  throw new Error('RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET are required in production.');
}

let razorpayClient: Razorpay | null = null;
try {
  razorpayClient = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
  });
} catch (err) {
  reportOperationalFailure('payments.razorpay_initialization', err);
}

const SUBSCRIPTION_PLANS: Record<string, any> = {
  free_trial: { name: 'Free Trial', price: 0, price_inr: 0, trial_days: 3, max_employees: 2, description: '3-day trial with 2 AI employees', features: ['2 AI employees', 'Permissioned tools', 'HITL Approvals'] },
  starter: { name: 'Starter', price: 25, price_inr: 1999, max_employees: 3, description: 'Essential AI workforce for small teams', features: ['3 AI employees', 'SQL & Gmail tools', 'Audit logging'] },
  growth: { name: 'Growth', price: 85, price_inr: 6999, max_employees: 6, description: 'Expanded capacity for growing companies', features: ['6 AI employees', 'Custom MCP Connectors', 'Priority routing'] },
  enterprise: { name: 'Enterprise', price: 180, price_inr: 14999, max_employees: 10, description: 'Full workforce OS with priority routing', features: ['10 AI employees', 'Unlimited MCP skills', '24/7 dedicated lead'] }
};

const EMPLOYEE_CATALOG = [
  {
    id: 'sarah', employee_code: 'CW_EMP_001', name: 'Sarah', role: 'Talent & HR Manager', department: 'Talent & Human Resources', color: '#10b981', autonomy_level: 'Level 3 (Recommend with Review)',
    persona: 'A precise, empathetic talent leader who turns workforce needs into compliant, human-first hiring and onboarding decisions.',
    system_prompt: 'You are Sarah, Caveworkers Talent & HR Manager. You own recruiting plans, candidate screening, interview operations, onboarding readiness, policy-aware people communications, and safe handoffs to People Operations and Analytics.',
    default_tools: ['Gmail', 'Google Calendar', 'ATS / HRIS MCP', 'Drive / Notion'], collaborates_with: ['arav', 'david', 'alex'], status: 'active'
  },
  {
    id: 'david', employee_code: 'CW_EMP_002', name: 'David', role: 'Data & Financial Analyst', department: 'Finance & Analytics', color: '#f59e0b', autonomy_level: 'Level 2 (Analyze & Draft)',
    persona: 'An evidence-first analyst who distinguishes data from assumptions, surfaces uncertainty, and gives every department a decision-ready view of the numbers.',
    system_prompt: 'You are David, Caveworkers Data & Financial Analyst. You own read-only business analysis, KPI definitions, trends, forecasts, variance explanations, and evidence-backed handoffs to the workforce.',
    default_tools: ['Google Sheets', 'SQL workspace', 'Gmail', 'Custom analytics MCP'], collaborates_with: ['priya', 'olivia', 'maya', 'sarah', 'arav', 'alex'], status: 'active'
  },
  {
    id: 'alex', employee_code: 'CW_EMP_003', name: 'Alex', role: 'Operations Manager', department: 'Operations', color: '#3b82f6', autonomy_level: 'Level 4 (Execute with Approval)',
    persona: 'A calm operating leader who turns ambiguous requests into accountable workflows, clear owners, service levels, and escalation paths.',
    system_prompt: 'You are Alex, Caveworkers Operations Manager. You own workflow design, work intake, SLA tracking, vendor and team coordination, process documentation, and approval-gated operational actions.',
    default_tools: ['Gmail', 'Google Calendar', 'Sheets', 'Project management MCP', 'Notion'], collaborates_with: ['david', 'mike', 'iris', 'emma'], status: 'active'
  },
  {
    id: 'mike', employee_code: 'CW_EMP_004', name: 'Mike', role: 'Engineering Manager', department: 'Engineering', color: '#8b5cf6', autonomy_level: 'Level 3 (Recommend with Review)',
    persona: 'A pragmatic engineering leader who prioritizes reliability, technical clarity, change safety, and honest incident communication.',
    system_prompt: 'You are Mike, Caveworkers Engineering Manager. You own technical planning, backlog and incident triage, architecture review, release readiness, repository and CI workflow drafts, and safe technical handoffs.',
    default_tools: ['GitHub MCP', 'Jira / Linear MCP', 'Slack', 'Notion'], collaborates_with: ['iris', 'alex', 'david'], status: 'active'
  },
  {
    id: 'emma', employee_code: 'CW_EMP_005', name: 'Emma', role: 'Customer Success Manager', department: 'Customer Success', color: '#ec4899', autonomy_level: 'Level 2 (Analyze & Draft)',
    persona: 'A thoughtful customer advocate who turns inbound signals into timely, empathetic resolutions and clear account-health actions.',
    system_prompt: 'You are Emma, Caveworkers Customer Success Manager. You own customer triage, onboarding progress, support insight, renewal risk summaries, knowledge-base drafts, and escalation handoffs.',
    default_tools: ['Gmail', 'Help desk MCP', 'CRM MCP', 'Slack', 'Knowledge base MCP'], collaborates_with: ['olivia', 'alex', 'david'], status: 'active'
  },
  {
    id: 'arav', employee_code: 'CW_EMP_006', name: 'Arav', role: 'People Operations Manager', department: 'People Operations', color: '#06b6d4', autonomy_level: 'Level 3 (Recommend with Review)',
    persona: 'A discreet people-operations specialist who turns policy, workforce signals, and employee moments into consistent internal operations.',
    system_prompt: 'You are Arav, Caveworkers People Operations Manager. You own people-program operations, policy acknowledgements, onboarding and offboarding logistics, engagement reporting, and confidential workflow handoffs.',
    default_tools: ['HRIS MCP', 'Gmail', 'Google Calendar', 'Drive / Notion'], collaborates_with: ['sarah', 'david', 'alex'], status: 'active'
  },
  {
    id: 'olivia', employee_code: 'CW_EMP_007', name: 'Olivia', role: 'Sales & Revenue Operations Manager', department: 'Revenue Operations', color: '#f97316', autonomy_level: 'Level 3 (Recommend with Review)',
    persona: 'A revenue operator who keeps pipeline reality, follow-up discipline, customer context, and forecasting aligned without overstating certainty.',
    system_prompt: 'You are Olivia, Caveworkers Sales & Revenue Operations Manager. You own lead qualification, pipeline hygiene, CRM workflow drafts, account follow-up preparation, revenue forecast handoffs, and approval-gated outreach.',
    default_tools: ['CRM MCP', 'Gmail', 'Google Calendar', 'Google Sheets'], collaborates_with: ['emma', 'david', 'maya'], status: 'active'
  },
  {
    id: 'maya', employee_code: 'CW_EMP_008', name: 'Maya', role: 'Marketing & Growth Manager', department: 'Marketing & Growth', color: '#e879f9', autonomy_level: 'Level 3 (Recommend with Review)',
    persona: 'A commercially minded growth leader who converts audience insight and performance signals into cohesive, reviewable campaigns.',
    system_prompt: 'You are Maya, Caveworkers Marketing & Growth Manager. You own campaign briefs, content calendars, audience research, performance synthesis, lifecycle draft work, and approval-gated publishing plans.',
    default_tools: ['Analytics MCP', 'Ads MCP', 'CRM MCP', 'Google Sheets', 'Content / social MCP'], collaborates_with: ['olivia', 'david', 'emma'], status: 'active'
  },
  {
    id: 'priya', employee_code: 'CW_EMP_009', name: 'Priya', role: 'Finance Operations Manager', department: 'Finance Operations', color: '#14b8a6', autonomy_level: 'Level 3 (Recommend with Review)',
    persona: 'A methodical finance operator who keeps transaction workflows organized, exception-aware, and subject to appropriate review.',
    system_prompt: 'You are Priya, Caveworkers Finance Operations Manager. You own invoice and expense workflow drafts, receivables follow-up preparation, budget variance operations, cash-flow preparation, and audit-ready handoffs to David.',
    default_tools: ['Accounting MCP', 'Gmail', 'Google Sheets', 'Drive / Notion'], collaborates_with: ['david', 'olivia', 'alex'], status: 'active'
  },
  {
    id: 'iris', employee_code: 'CW_EMP_010', name: 'Iris', role: 'IT & Security Operations Manager', department: 'IT & Security', color: '#64748b', autonomy_level: 'Level 3 (Recommend with Review)',
    persona: 'A security-conscious IT operator who prefers least privilege, clear evidence, reversible changes, and escalation before impact.',
    system_prompt: 'You are Iris, Caveworkers IT & Security Operations Manager. You own IT request triage, access-review drafts, security questionnaire evidence, asset and compliance workflow preparation, and approval-gated administrative changes.',
    default_tools: ['Identity provider MCP', 'ITSM MCP', 'Endpoint / security MCP', 'Gmail', 'Drive'], collaborates_with: ['mike', 'alex', 'david'], status: 'active'
  }
];

// In-Memory Database
interface User {
  uid: string;
  email: string;
  display_name?: string;
  photo_url?: string;
  company_id?: string;
  company_name?: string;
  onboarded: boolean;
  selected_tier?: string;
  role?: string;
  created_at?: string;
  updated_at?: string;
  auth_provider?: string;
  email_verified?: boolean;
}

interface Company {
  id: string;
  name: string;
  industry?: string;
  team_size?: string;
  owner_uid: string;
  tier: string;
  status: string;
  selected_employees?: string[];
  trial_started_at?: string;
  trial_ends_at?: string;
  payment_verified_at?: string;
  payment_id?: string;
  created_at: string;
}

interface OrgEmployee {
  id: string;
  employee_id: string;
  name: string;
  role: string;
  department: string;
  color: string;
  status: string;
  tools: string[];
  permissions: Array<{ tool_name: string; access_level: string }>;
}

interface WebResearchEvidence {
  title: string;
  url: string;
  snippet: string;
  content_preview?: string;
  fetched_at: string;
}

interface WorkforceQueueJob {
  id: string;
  task_id: number;
  company_id: string;
  question: string;
  preferred_employee_id?: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  claimed_by?: string;
  attempts: number;
  created_at: string;
  updated_at: string;
  error?: string;
}

interface TaskRecord {
  id: number;
  company_id: string;
  question: string;
  owner: string;
  status: string;
  answer: string;
  plan: string;
  created_at: string;
  trace: any[];
  participants?: string[];
  collaboration_summary?: string;
  live_tool_evidence?: WorkforceLiveToolEvidence[];
  web_research?: WebResearchEvidence[];
  queued_at?: string;
  started_at?: string;
  completed_at?: string;
  execution?: {
    action_type: string;
    status: 'queued' | 'not_required' | 'awaiting_approval' | 'blocked' | 'processing' | 'succeeded' | 'failed' | 'cancelled';
    summary: string;
    updated_at: string;
    result?: Record<string, string>;
  };
}

interface WorkforceLiveToolEvidence {
  employee_id: string;
  employee_name: string;
  connector_name: string;
  tool_name: string;
  status: 'executed' | 'skipped' | 'failed';
  summary: string;
  created_at: string;
}

interface EmployeeMemory {
  id: string;
  company_id: string;
  employee_id: string;
  category: 'preference' | 'playbook' | 'handoff';
  content: string;
  created_at: string;
}

interface ApprovalRecord {
  id: number;
  company_id: string;
  task_id: number;
  employee_id: string;
  tool_name: string;
  action_summary: string;
  status: 'pending' | 'approved' | 'rejected';
  payload?: any;
  created_at: string;
  decided_at?: string;
  executed_at?: string;
}

interface AnalystDataSource {
  id: string;
  company_id: string;
  kind: 'sql' | 'google_sheets' | 'csv';
  name: string;
  status: 'connected' | 'needs_configuration';
  access_level: 'read_only';
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

interface TenantConnector {
  id: number;
  company_id: string;
  employee_id: string;
  name: string;
  connection_type: 'google_gmail' | 'google_sheets' | 'streamable_http' | 'git_repository' | 'custom_skill';
  server_url?: string;
  access_level: 'read_only' | 'requires_approval' | 'read_write';
  status: 'connected' | 'needs_configuration' | 'error';
  config: Record<string, any>;
  discovered_tools: Array<{ name: string; description?: string; inputSchema?: any; risk?: 'read' | 'write' }>;
  tool_grants: Array<{ tool_name: string; access_level: 'read_only' | 'requires_approval' | 'read_write' }>;
  auth_scopes?: string[];
  oauth_email?: string;
  auth_token_encrypted?: string;
  last_error?: string;
  created_at: string;
  updated_at: string;
}

interface AnalystMemory {
  id: string;
  company_id: string;
  memory_type: 'working' | 'long_term';
  session_id?: string;
  category: 'task_state' | 'preference' | 'business_rule' | 'metric_definition' | 'reflection';
  content: string;
  confidence: number;
  created_at: string;
  expires_at?: string;
}

interface AnalystRun {
  id: string;
  company_id: string;
  task_id: number;
  question: string;
  source_id?: string;
  output_format: 'brief' | 'report' | 'chart' | 'table';
  status: 'completed' | 'awaiting_approval';
  plan: string[];
  trace: Array<{ stage: 'perceive' | 'plan' | 'act' | 'reflect' | 'approval'; body: string; created_at: string }>;
  report: string;
  chart?: { title: string; labels: string[]; values: number[]; unit: string; source_note: string };
  approval_id?: number;
  model?: { provider: 'openrouter' | 'gemini' | 'preview'; name?: string; latency_ms: number; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number }; error_code?: string };
  created_at: string;
}

const db = {
  users: new Map<string, User>(),
  companies: new Map<string, Company>(),
  orgEmployees: new Map<string, OrgEmployee[]>(),
  conversations: new Map<string, any[]>(),
  tasks: new Map<number, TaskRecord>(),
  approvals: new Map<number, ApprovalRecord>(),
  knowledge: new Map<string, any[]>(),
  activity: new Map<string, any[]>(),
  mcpConnections: new Map<string, any[]>(),
  analystDataSources: new Map<string, AnalystDataSource[]>(),
  analystMemory: new Map<string, AnalystMemory[]>(),
  analystRuns: new Map<string, AnalystRun[]>(),
  analystApprovalsLoaded: new Set<string>(),
  approvalTenantsLoaded: new Set<string>(),
  employeeMemory: new Map<string, EmployeeMemory[]>(),
  taskTenantsLoaded: new Set<string>(),
  workforceQueue: new Map<string, WorkforceQueueJob>(),
  employeePresence: new Map<string, { employee_id: string; status: 'idle' | 'working' | 'offline'; task_id?: number; last_seen_at: string }>(),
  activityLoaded: new Set<string>(),
  nextTaskId: 1,
  nextApprovalId: 101,
};

const authenticatedUsers = new WeakMap<express.Request, User>();
const pendingPaymentOrders = new Map<string, { uid: string; company_id: string; tier: string; amount: number; created_at: string }>();
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();
const workroomStreams = new Map<string, Set<express.Response>>();
function rateLimitKey(req: express.Request, scope: string): string { return `${scope}:${req.ip || req.socket.remoteAddress || 'unknown'}`; }
function isRateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const current = rateLimitBuckets.get(key);
  if (!current || now >= current.resetAt) { rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs }); return false; }
  current.count += 1;
  return current.count > limit;
}

async function loadUserFromFirebase(uid: string): Promise<User | null> {
  const cached = db.users.get(uid);
  if (cached) return cached;
  if (!firestoreDb) return null;

  try {
    const snapshot = await firestoreDb.collection('users').doc(uid).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() || {};
    const user = { uid, ...data } as User;
    db.users.set(uid, user);
    return user;
  } catch (error) {
    console.warn('Could not load Firebase user profile:', error);
    return null;
  }
}

async function loadCompanyFromFirebase(id: string): Promise<Company | null> {
  const cached = db.companies.get(id);
  if (cached) return cached;
  if (!firestoreDb) return null;

  try {
    const snapshot = await firestoreDb.collection('companies').doc(id).get();
    if (!snapshot.exists) return null;
    const company = { id, ...(snapshot.data() || {}) } as Company;
    db.companies.set(id, company);
    return company;
  } catch (error) {
    console.warn('Could not load Firebase company profile:', error);
    return null;
  }
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.filter((item) => item !== undefined).map((item) => stripUndefined(item)) as T;
  if (!value || typeof value !== 'object' || value instanceof Date || Buffer.isBuffer(value)) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, stripUndefined(item)])
  ) as T;
}

async function persistUser(user: User, extra: Record<string, unknown> = {}) {
  if (!firestoreDb) throw new Error('Firebase Firestore is not configured');
  const now = new Date().toISOString();
  const record = stripUndefined({ ...user, ...extra, updated_at: now });
  await firestoreDb.collection('users').doc(user.uid).set(record, { merge: true });
  db.users.set(user.uid, stripUndefined({ ...user, ...extra, updated_at: now }) as User);
}

async function persistCompany(company: Company) {
  if (!firestoreDb) throw new Error('Firebase Firestore is not configured');
  const record = stripUndefined(company);
  await firestoreDb.collection('companies').doc(company.id).set(record, { merge: true });
  db.companies.set(company.id, record as Company);
}

function analystTenantCollection(companyId: string, collection: string) {
  return firestoreDb?.collection('tenants').doc(companyId).collection(collection) || null;
}

function connectorCollection(companyId: string) {
  return analystTenantCollection(companyId, 'connectors');
}

function employeeMemoryKey(companyId: string, employeeId: string) {
  return `${companyId}:${employeeId}`;
}

async function loadEmployeeMemory(companyId: string, employeeId: string): Promise<EmployeeMemory[]> {
  const key = employeeMemoryKey(companyId, employeeId);
  const cached = db.employeeMemory.get(key);
  if (cached) return cached;
  const collection = analystTenantCollection(companyId, 'employee_memory');
  if (collection) {
    try {
      const snapshot = await collection.where('employee_id', '==', employeeId).get();
      const entries = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) } as EmployeeMemory)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 50);
      db.employeeMemory.set(key, entries);
      return entries;
    } catch (error) {
      console.warn('Could not load employee memory:', error);
    }
  }
  db.employeeMemory.set(key, []);
  return [];
}

async function persistEmployeeMemory(memory: EmployeeMemory) {
  const key = employeeMemoryKey(memory.company_id, memory.employee_id);
  const existing = db.employeeMemory.get(key) || [];
  db.employeeMemory.set(key, [memory, ...existing.filter((entry) => entry.id !== memory.id)].slice(0, 50));
  const collection = analystTenantCollection(memory.company_id, 'employee_memory');
  if (collection) await collection.doc(memory.id).set(stripUndefined(memory), { merge: true });
}

async function deleteEmployeeMemory(companyId: string, employeeId: string, memoryId: string) {
  const key = employeeMemoryKey(companyId, employeeId);
  const entries = await loadEmployeeMemory(companyId, employeeId);
  db.employeeMemory.set(key, entries.filter((entry) => entry.id !== memoryId));
  const collection = analystTenantCollection(companyId, 'employee_memory');
  if (collection) await collection.doc(memoryId).delete();
}

async function hydrateTenantTasks(companyId: string) {
  if (db.taskTenantsLoaded.has(companyId)) return;
  db.taskTenantsLoaded.add(companyId);
  const collection = analystTenantCollection(companyId, 'tasks');
  if (!collection) return;
  try {
    const snapshot = await collection.orderBy('created_at', 'desc').limit(100).get();
    snapshot.docs.forEach((doc) => {
      const record = { id: Number(doc.data()?.id || doc.id), ...(doc.data() || {}) } as TaskRecord;
      if (record.company_id === companyId && Number.isFinite(record.id)) {
        db.tasks.set(record.id, record);
        db.nextTaskId = Math.max(db.nextTaskId, record.id + 1);
      }
    });
  } catch (error) {
    reportOperationalFailure('task.hydration', error, { tenant_hash: anonymizeIdentifier(companyId) });
  }
}

async function persistTaskRecord(task: TaskRecord) {
  const collection = analystTenantCollection(task.company_id, 'tasks');
  if (collection) await collection.doc(String(task.id)).set(stripUndefined(task), { merge: true });
}

async function hydrateTenantActivity(companyId: string) {
  if (db.activityLoaded.has(companyId)) return;
  db.activityLoaded.add(companyId);
  const collection = analystTenantCollection(companyId, 'activity');
  if (!collection) return;
  try {
    const snapshot = await collection.orderBy('created_at', 'desc').limit(100).get();
    if (snapshot.docs.length) {
      db.activity.set(companyId, snapshot.docs.map((doc) => ({ id: Number(doc.data()?.id || doc.id), company_id: companyId, ...(doc.data() || {}) })).filter((entry) => Number.isFinite(entry.id)));
    }
  } catch (error) {
    reportOperationalFailure('activity.hydration', error, { tenant_hash: anonymizeIdentifier(companyId) });
  }
}

async function persistActivityLog(companyId: string, entry: Record<string, any>) {
  const logs = db.activity.get(companyId) || [];
  const record: Record<string, any> = { ...entry, company_id: companyId };
  db.activity.set(companyId, [record, ...logs.filter((item) => item.id !== record.id)].slice(0, 100));
  db.activityLoaded.add(companyId);
  const collection = analystTenantCollection(companyId, 'activity');
  if (collection) await collection.doc(String(record.id)).set(stripUndefined(record), { merge: true });
}

async function hydrateTenantApprovals(companyId: string) {
  if (db.approvalTenantsLoaded.has(companyId)) return;
  db.approvalTenantsLoaded.add(companyId);
  const collection = analystTenantCollection(companyId, 'approvals');
  if (!collection) return;
  try {
    const snapshot = await collection.limit(100).get();
    snapshot.docs.forEach((doc) => {
      const approval = { id: Number(doc.data()?.id || doc.id), ...(doc.data() || {}) } as ApprovalRecord;
      if (approval.company_id === companyId && Number.isFinite(approval.id)) db.approvals.set(approval.id, approval);
    });
  } catch (error) {
    reportOperationalFailure('approval.hydration', error, { tenant_hash: anonymizeIdentifier(companyId) });
  }
}

async function persistApprovalRecord(approval: ApprovalRecord) {
  db.approvals.set(approval.id, approval);
  db.approvalTenantsLoaded.add(approval.company_id);
  const collection = analystTenantCollection(approval.company_id, 'approvals');
  if (collection) await collection.doc(String(approval.id)).set(stripUndefined(approval), { merge: true });
}


function queueCollection() {
  return firestoreDb?.collection('workforce_jobs') || null;
}

async function persistWorkforceJob(job: WorkforceQueueJob) {
  db.workforceQueue.set(job.id, job);
  const collection = queueCollection();
  if (collection) await collection.doc(job.id).set(stripUndefined(job), { merge: true });
}

function workroomStreamKey(companyId: string, taskId?: number) {
  return `${companyId}:${taskId || 'all'}`;
}

function workroomSnapshot(task: TaskRecord) {
  return {
    id: task.id,
    company_id: task.company_id,
    question: task.question,
    owner: task.owner,
    status: task.status,
    answer: task.answer,
    plan: task.plan,
    trace: task.trace || [],
    participants: task.participants || [],
    collaboration_summary: task.collaboration_summary,
    live_tool_evidence: task.live_tool_evidence || [],
    web_research: task.web_research || [],
    execution: task.execution,
    queued_at: task.queued_at,
    started_at: task.started_at,
    completed_at: task.completed_at,
  };
}

function emitWorkroomEvent(companyId: string, taskId: number | undefined, payload: Record<string, any>) {
  const targets = [workroomStreamKey(companyId), taskId ? workroomStreamKey(companyId, taskId) : ''];
  const delivered = new Set<express.Response>();
  targets.filter(Boolean).forEach((key) => {
    for (const response of workroomStreams.get(key) || []) {
      if (delivered.has(response)) continue;
      delivered.add(response);
      try { response.write(`event: ${payload.type || 'update'}\ndata: ${JSON.stringify(payload)}\n\n`); } catch (_error) { /* cleanup occurs on close */ }
    }
  });
}

function setEmployeePresence(companyId: string, employeeId: string, status: 'idle' | 'working' | 'offline', taskId?: number) {
  const presence = { employee_id: employeeId, status, task_id: taskId, last_seen_at: new Date().toISOString() };
  db.employeePresence.set(`${companyId}:${employeeId}`, presence);
  emitWorkroomEvent(companyId, taskId, { type: 'presence', presence });
}

function companyPresence(companyId: string) {
  return activeWorkforce(companyId).map((employee) => db.employeePresence.get(`${companyId}:${employee.id}`) || { employee_id: employee.id, status: 'idle', last_seen_at: new Date().toISOString() });
}

async function loadQueuedJobs() {
  const collection = queueCollection();
  if (!collection) return;
  try {
    const snapshot = await collection.where('status', 'in', ['queued', 'processing']).limit(50).get();
    const companyIds = new Set<string>();
    snapshot.docs.forEach((doc) => {
      const job = { id: doc.id, ...(doc.data() || {}) } as WorkforceQueueJob;
      if (job.status === 'processing' && job.claimed_by !== WORKER_INSTANCE_ID) {
        const staleAt = Date.now() - 5 * 60 * 1000;
        if (new Date(job.updated_at || 0).getTime() < staleAt) job.status = 'queued'; else return;
      }
      if (!job.company_id || !Number.isFinite(Number(job.task_id))) return;
      db.workforceQueue.set(job.id, job);
      companyIds.add(job.company_id);
    });
    await Promise.all(Array.from(companyIds).map((companyId) => hydrateTenantTasks(companyId)));
  } catch (error) {
    reportOperationalFailure('worker.queue_hydration', error);
  }
}

async function enqueueWorkforceTask(companyId: string, question: string, preferredEmployeeId?: string) {
  await hydrateTenantTasks(companyId);
  const taskId = db.nextTaskId++;
  const now = new Date().toISOString();
  const { manager, lead, collaborators } = selectCollaborativeTeam(question || 'Operations review', companyId, preferredEmployeeId);
  const trace = [{ kind: 'queued', sender: 'Sarah', receiver: 'Company workroom', body: `I received this request and assigned ${lead.name} as delivery lead. I will return the final result and any execution blocker here.`, created_at: now }];
  const task: TaskRecord = {
    id: taskId,
    company_id: companyId,
    question: question.slice(0, 6000),
    owner: manager.id,
    status: 'queued',
    answer: 'Sarah has accepted your request and is assigning the delivery team…',
    plan: `Sarah intake → ${lead.name} delivery lead → ${collaborators.length ? collaborators.map((employee) => employee.name).join(', ') : 'role assessment'} → evidence → Sarah’s manager response`,
    created_at: now,
    queued_at: now,
    trace,
    participants: ['Manager', manager.name, lead.name, ...collaborators.map((employee) => employee.name).filter((name, index, list) => list.indexOf(name) === index)],
    collaboration_summary: `${manager.name} will manage ${lead.name}${collaborators.length ? ` and ${collaborators.length} supporting specialist${collaborators.length === 1 ? '' : 's'}` : ''}.`,
    execution: { action_type: 'none', status: 'queued', summary: 'Sarah has accepted the request and is coordinating the delivery team.', updated_at: now },
    live_tool_evidence: [],
    web_research: [],
  };
  db.tasks.set(taskId, task);
  await persistTaskRecord(task);
  const job: WorkforceQueueJob = { id: `${companyId}:${taskId}`, task_id: taskId, company_id: companyId, question: task.question, preferred_employee_id: preferredEmployeeId, status: 'queued', attempts: 0, created_at: now, updated_at: now };
  await persistWorkforceJob(job);
  await persistActivityLog(companyId, { id: Date.now(), sender: 'Manager', receiver: 'Caveworkers worker', kind: 'task.queued', body: `Task #${taskId} entered the always-on employee queue.`, created_at: now });
  emitWorkroomEvent(companyId, taskId, { type: 'task_update', task: workroomSnapshot(task) });
  // Wake the process-local worker immediately; the interval remains a recovery poll.
  if (ALWAYS_ON_WORKER_ENABLED) void processNextWorkforceJob();
  return { ...workroomSnapshot(task), queued: true, worker_enabled: ALWAYS_ON_WORKER_ENABLED, worker_instance: WORKER_INSTANCE_ID };
}

async function claimNextWorkforceJob(): Promise<WorkforceQueueJob | null> {
  await loadQueuedJobs();
  const candidates = Array.from(db.workforceQueue.values()).filter((job) => job.status === 'queued').sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  for (const candidate of candidates) {
    const collection = queueCollection();
    if (collection) {
      try {
        const claimed = await firestoreDb!.runTransaction(async (transaction) => {
          const ref = collection.doc(candidate.id);
          const snapshot = await transaction.get(ref);
          const current = snapshot.exists ? { id: candidate.id, ...(snapshot.data() || {}) } as WorkforceQueueJob : candidate;
          if (current.status !== 'queued') return null;
          const next = { ...current, status: 'processing' as const, claimed_by: WORKER_INSTANCE_ID, attempts: Number(current.attempts || 0) + 1, updated_at: new Date().toISOString() };
          transaction.set(ref, stripUndefined(next), { merge: true });
          return next;
        });
        if (claimed) { db.workforceQueue.set(candidate.id, claimed); return claimed; }
      } catch (error) { reportOperationalFailure('worker.job_claim', error, { job_hash: anonymizeIdentifier(candidate.id) }); }
    } else {
      candidate.status = 'processing';
      candidate.claimed_by = WORKER_INSTANCE_ID;
      candidate.attempts += 1;
      candidate.updated_at = new Date().toISOString();
      db.workforceQueue.set(candidate.id, candidate);
      return candidate;
    }
  }
  return null;
}

async function updateQueuedTask(task: TaskRecord, status: TaskRecord['status'], body: string) {
  task.status = status;
  task.trace = [...(task.trace || []), { kind: status === 'processing' ? 'worker_started' : status === 'failed' ? 'worker_failed' : 'worker_update', sender: 'Caveworkers worker', receiver: 'Company workroom', body, created_at: new Date().toISOString() }];
  if (status === 'processing') task.started_at = new Date().toISOString();
  if (status === 'completed' || status === 'pending_approval' || status === 'failed') task.completed_at = new Date().toISOString();
  await persistTaskRecord(task);
  emitWorkroomEvent(task.company_id, task.id, { type: 'task_update', task: workroomSnapshot(task) });
}

let workerBusy = false;
async function processNextWorkforceJob() {
  if (!ALWAYS_ON_WORKER_ENABLED || workerBusy) return;
  workerBusy = true;
  try {
    const job = await claimNextWorkforceJob();
    if (!job) return;
    const task = db.tasks.get(job.task_id);
    if (!task || task.company_id !== job.company_id) {
      job.status = 'failed'; job.error = 'Tenant task record was not found.'; job.updated_at = new Date().toISOString(); await persistWorkforceJob(job); return;
    }
    const { manager, lead, collaborators } = selectCollaborativeTeam(job.question, job.company_id, job.preferred_employee_id);
    const workerEmployees = [...new Set([manager.id, lead.id, ...collaborators.map((employee) => employee.id)])];
    workerEmployees.forEach((employeeId) => setEmployeePresence(job.company_id, employeeId, 'working', task.id));
    await updateQueuedTask(task, 'processing', `${manager.name} is managing this task. ${lead.name} and the assigned specialists are now working in the company room.`);
    try {
      const completed = await handleTaskRoutingAsync(job.question, job.company_id, job.preferred_employee_id, task.id);
      Object.assign(task, completed);
      task.status = completed.status || 'completed';
      task.started_at = task.started_at || new Date().toISOString();
      task.completed_at = new Date().toISOString();
      await persistTaskRecord(task);
      job.status = 'completed'; job.updated_at = new Date().toISOString(); await persistWorkforceJob(job);
      emitWorkroomEvent(job.company_id, task.id, { type: 'task_update', task: workroomSnapshot(task) });
    } catch (error: any) {
      reportOperationalFailure('worker.task_execution', error, { tenant_hash: anonymizeIdentifier(job.company_id), task_id: task.id, worker_instance: WORKER_INSTANCE_ID });
      const failureDetail = String(error?.message || 'Worker execution failed').slice(0, 300);
      task.answer = `### Sarah’s manager update (Task #${task.id})\n\nI could not complete the requested work because the execution service returned a recoverable failure. I have **not** represented a draft, tool intent, or partial planning as completed work.\n\n**What I completed**\n- Recorded the task, assigned delivery ownership, and preserved the workroom trace.\n- Stopped any external action; no email, write, payment, or account change was performed.\n\n**Next action**\nRetry this task after the configured model, connector, or source is available. If the problem persists, review the connection state in Settings and share the task trace with support.`;
      task.execution = { action_type: task.execution?.action_type || 'none', status: 'failed', summary: 'Sarah could not complete the execution run. No external action was performed.', updated_at: new Date().toISOString() };
      task.trace = [...(task.trace || []), { kind: 'manager_result', sender: 'Sarah', receiver: 'Manager', body: 'I could not complete this run. I preserved the trace, performed no external action, and provided the next step in the final response.', created_at: new Date().toISOString() }];
      await updateQueuedTask(task, 'failed', failureDetail);
      job.status = 'failed'; job.error = failureDetail; job.updated_at = new Date().toISOString(); await persistWorkforceJob(job);
    } finally {
      workerEmployees.forEach((employeeId) => setEmployeePresence(job.company_id, employeeId, 'idle'));
    }
  } catch (error) {
    reportOperationalFailure('worker.poll', error, { worker_instance: WORKER_INSTANCE_ID });
  } finally {
    workerBusy = false;
  }
}

async function startAlwaysOnWorker() {
  if (!ALWAYS_ON_WORKER_ENABLED) { console.log('Always-on workforce worker disabled by configuration.'); return; }
  console.log(`Always-on workforce worker enabled (${WORKER_INSTANCE_ID}); poll ${WORKER_POLL_MS}ms.`);
  await loadQueuedJobs();
  await processNextWorkforceJob();
  const timer = setInterval(() => { void processNextWorkforceJob(); }, WORKER_POLL_MS);
  (timer as any).unref?.();
}

async function performWebResearch(question: string): Promise<WebResearchEvidence[]> {
  if (!WEB_RESEARCH_ENABLED || (!TAVILY_API_KEY && !BRAVE_SEARCH_API_KEY)) return [];
  let results: Array<{ title?: string; url?: string; snippet?: string }> = [];
  try {
    if (TAVILY_API_KEY) {
      const response = await fetch('https://api.tavily.com/search', { method: 'POST', signal: AbortSignal.timeout(12000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: TAVILY_API_KEY, query: question.slice(0, 500), search_depth: 'basic', max_results: 5, include_answer: false }) });
      if (response.ok) { const payload: any = await response.json(); results = Array.isArray(payload?.results) ? payload.results : []; }
    } else if (BRAVE_SEARCH_API_KEY) {
      const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(question.slice(0, 500))}&count=5`, { signal: AbortSignal.timeout(12000), headers: { Accept: 'application/json', 'X-Subscription-Token': BRAVE_SEARCH_API_KEY } });
      if (response.ok) { const payload: any = await response.json(); results = Array.isArray(payload?.web?.results) ? payload.web.results.map((entry: any) => ({ title: entry.title, url: entry.url, snippet: entry.description })) : []; }
    }
  } catch (error) { reportOperationalFailure('research.provider', error); }
  const evidence: WebResearchEvidence[] = [];
  for (const result of results.slice(0, 5)) {
    const url = String(result.url || '').trim();
    if (!url || !/^https:\/\//i.test(url)) continue;
    try {
      const parsed = new URL(url);
      if (isPrivateOrLocalHost(parsed.hostname)) continue;
      const addresses = await lookup(parsed.hostname, { all: true });
      if (addresses.some((address) => isPrivateOrLocalHost(address.address))) continue;
      let preview = '';
      const page = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { Accept: 'text/html,text/plain', 'User-Agent': 'CaveworkersResearch/1.0' } });
      if (page.ok) preview = (await page.text()).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);
      evidence.push({ title: String(result.title || url).slice(0, 200), url: url.slice(0, 500), snippet: String(result.snippet || '').slice(0, 500), content_preview: preview, fetched_at: new Date().toISOString() });
    } catch (_error) {
      evidence.push({ title: String(result.title || url).slice(0, 200), url: url.slice(0, 500), snippet: String(result.snippet || '').slice(0, 500), fetched_at: new Date().toISOString() });
    }
  }
  return evidence;
}

function connectorPublicView(connection: TenantConnector) {
  const { auth_token_encrypted: _secret, ...safe } = connection;
  return { ...safe, auth_configured: Boolean(connection.auth_token_encrypted) };
}

function getMcpEncryptionKey(): Buffer | null {
  if (!MCP_TOKEN_ENCRYPTION_KEY) return null;
  return crypto.createHash('sha256').update(MCP_TOKEN_ENCRYPTION_KEY).digest();
}

function encryptConnectorCredentials(value: Record<string, any>): string {
  const key = getMcpEncryptionKey();
  if (!key) throw new Error('MCP_TOKEN_ENCRYPTION_KEY is not configured on this server.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
}

function decryptConnectorCredentials(value?: string): Record<string, any> | null {
  if (!value) return null;
  const key = getMcpEncryptionKey();
  if (!key) return null;
  try {
    const [ivText, tagText, ciphertextText] = value.split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
    return JSON.parse(plaintext);
  } catch (_error) {
    return null;
  }
}

function sanitizeConnectorConfig(config: Record<string, any> = {}) {
  return {
    notes: typeof config.notes === 'string' ? config.notes.slice(0, 800) : '',
    repo_path: typeof config.repo_path === 'string' ? config.repo_path.slice(0, 400) : undefined,
    // Gmail write access is an explicit opt-in. It is still approval-gated per message.
    gmail_send_enabled: config.gmail_send_enabled === true
  };
}

async function persistMcpConnection(connection: TenantConnector) {
  const key = `${connection.company_id}:${connection.employee_id}`;
  const list = db.mcpConnections.get(key) || [];
  const index = list.findIndex((entry: TenantConnector) => entry.id === connection.id);
  if (index >= 0) list[index] = connection; else list.unshift(connection);
  db.mcpConnections.set(key, list.slice(0, 100));
  const collection = connectorCollection(connection.company_id);
  if (collection) await collection.doc(`${connection.employee_id}_${connection.id}`).set(stripUndefined(connection), { merge: true });
}

async function loadMcpConnections(companyId: string, employeeId: string): Promise<TenantConnector[]> {
  const key = `${companyId}:${employeeId}`;
  const cached = db.mcpConnections.get(key);
  if (cached) return cached as TenantConnector[];
  const collection = connectorCollection(companyId);
  if (collection) {
    try {
      const snapshot = await collection.get();
      const entries = snapshot.docs.map((doc) => ({ id: Number(doc.data()?.id || doc.id.split('_').pop()), ...(doc.data() || {}) } as TenantConnector)).filter((entry) => entry.employee_id === employeeId);
      db.mcpConnections.set(key, entries);
      return entries;
    } catch (error) {
      reportOperationalFailure('connector.load', error, { tenant_hash: anonymizeIdentifier(companyId), employee_id: employeeId });
    }
  }
  db.mcpConnections.set(key, []);
  return [];
}

function isPrivateOrLocalHost(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\\.$/, '');
  if (normalized === 'localhost' || normalized.endsWith('.local') || normalized === '0.0.0.0' || normalized === '::1') return true;
  const ipVersion = net.isIP(normalized);
  if (ipVersion !== 4) return false;
  const octets = normalized.split('.').map(Number);
  return octets[0] === 10 || octets[0] === 127 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 169 && octets[1] === 254);
}

function validateRemoteMcpUrl(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('A remote MCP HTTPS URL is required.');
  let parsed: URL;
  try { parsed = new URL(raw); } catch (_error) { throw new Error('Enter a valid remote MCP URL.'); }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && !IS_PRODUCTION)) throw new Error('Remote MCP servers must use HTTPS in production.');
  if (parsed.username || parsed.password || isPrivateOrLocalHost(parsed.hostname)) throw new Error('Private hosts and embedded URL credentials are not allowed.');
  return parsed.toString();
}

function oauthStateSign(payload: Record<string, any>) {
  if (IS_PRODUCTION && !OAUTH_STATE_SECRET) throw new Error('FLASK_SECRET is required for Google OAuth state protection.');
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', OAUTH_STATE_SECRET || 'caveworkers-development-oauth-state').update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function oauthStateVerify(value: string): Record<string, any> | null {
  try {
    const [encoded, signature] = value.split('.');
    const expected = crypto.createHmac('sha256', OAUTH_STATE_SECRET || 'caveworkers-development-oauth-state').update(encoded).digest('base64url');
    if (!encoded || !signature || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.iat || Date.now() - Number(payload.iat) > 10 * 60 * 1000) return null;
    return payload;
  } catch (_error) {
    return null;
  }
}

function googleOAuthClient() {
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET) throw new Error('Google OAuth client credentials are not configured.');
  return new google.auth.OAuth2(GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI);
}

function googleScopesFor(connection: TenantConnector) {
  if (connection.connection_type === 'google_gmail') {
    const scopes = ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly'];
    if (connection.config?.gmail_send_enabled === true) scopes.push('https://www.googleapis.com/auth/gmail.send');
    return scopes;
  }
  return ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/spreadsheets.readonly'];
}

function parseSpreadsheetId(value: string) {
  const match = String(value || '').match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] || String(value || '').trim();
}

function isLikelyWriteTool(toolName: string) {
  return /(^|[._:-])(write|send|create|update|delete|remove|post|put|patch|execute|run|append|move)([._:-]|$)/i.test(toolName) || /send|write|delete|update|create|post|execute/i.test(toolName);
}

function parseMcpResponse(text: string): any {
  try { return JSON.parse(text); } catch (_error) {
    const events = text.split(/\\r?\\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter(Boolean);
    for (let index = events.length - 1; index >= 0; index -= 1) {
      try { return JSON.parse(events[index]); } catch (_ignored) { /* continue */ }
    }
  }
  throw new Error('The MCP server returned an unreadable response.');
}

async function mcpRpc(connection: TenantConnector, method: string, params: Record<string, any>, sessionId?: string) {
  const credentials = decryptConnectorCredentials(connection.auth_token_encrypted);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' };
  if (credentials?.access_token) headers.Authorization = `Bearer ${credentials.access_token}`;
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(connection.server_url!, { method: 'POST', headers, signal: controller.signal, body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomBytes(4).toString('hex'), method, params }) });
    const text = await response.text();
    if (!response.ok) throw new Error(`MCP server returned HTTP ${response.status}.`);
    return { data: parseMcpResponse(text), sessionId: response.headers.get('mcp-session-id') || sessionId };
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverMcpTools(connection: TenantConnector) {
  const initialized = await mcpRpc(connection, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Caveworkers', version: '1.0.0' } });
  const listed = await mcpRpc(connection, 'tools/list', {}, initialized.sessionId);
  const tools = Array.isArray(listed.data?.result?.tools) ? listed.data.result.tools : [];
  return tools.slice(0, 100).map((tool: any) => ({ name: String(tool.name || '').slice(0, 120), description: String(tool.description || '').slice(0, 500), inputSchema: tool.inputSchema, risk: isLikelyWriteTool(String(tool.name || '')) ? 'write' : 'read' })).filter((tool: any) => tool.name);
}

function buildReadToolArguments(tool: any, question: string): Record<string, any> | null {
  const properties = tool?.inputSchema?.properties && typeof tool.inputSchema.properties === 'object' ? tool.inputSchema.properties : {};
  const args: Record<string, any> = {};
  Object.keys(properties).forEach((key) => {
    if (/query|search|term|text|question|prompt|input|keyword/i.test(key)) args[key] = question.slice(0, 500);
    else if (/limit|max_results|maxResults|count|page_size/i.test(key)) args[key] = 10;
  });
  const required = Array.isArray(tool?.inputSchema?.required) ? tool.inputSchema.required : [];
  return required.every((key: string) => Object.prototype.hasOwnProperty.call(args, key)) ? args : null;
}

function summarizeMcpToolResult(value: any) {
  const result = value?.result || value;
  const content = Array.isArray(result?.content) ? result.content.map((entry: any) => typeof entry?.text === 'string' ? entry.text : JSON.stringify(entry)).join('\\n') : JSON.stringify(result);
  return String(content || 'The tool returned no readable content.').slice(0, 1800);
}

async function executeEmployeeReadTools(companyId: string, employee: any, question: string): Promise<WorkforceLiveToolEvidence[]> {
  if (!['emma', 'olivia'].includes(employee.id)) return [];
  const connections = (await loadMcpConnections(companyId, employee.id)).filter((connection) => connection.status === 'connected' && connection.connection_type === 'streamable_http');
  const candidates: Array<{ connection: TenantConnector; tool: any; args: Record<string, any> }> = [];
  for (const connection of connections.slice(0, 5)) {
    for (const tool of (connection.discovered_tools || []).slice(0, 25)) {
      if (tool.risk === 'write' || isLikelyWriteTool(tool.name)) continue;
      const grant = (connection.tool_grants || []).find((entry) => entry.tool_name === tool.name);
      if (!grant || grant.access_level === 'requires_approval') continue;
      const args = buildReadToolArguments(tool, question);
      if (!args) continue;
      candidates.push({ connection, tool, args });
      if (candidates.length >= 2) break;
    }
    if (candidates.length >= 2) break;
  }
  const results = await Promise.all(candidates.map(async ({ connection, tool, args }) => {
    const createdAt = new Date().toISOString();
    try {
      const initialized = await mcpRpc(connection, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Caveworkers', version: '1.0.0' } });
      const called = await mcpRpc(connection, 'tools/call', { name: tool.name, arguments: args }, initialized.sessionId);
      return { employee_id: employee.id, employee_name: employee.name, connector_name: connection.name, tool_name: tool.name, status: 'executed' as const, summary: summarizeMcpToolResult(called.data), created_at: createdAt };
    } catch (error: any) {
      reportOperationalFailure('connector.read_tool', error, { tenant_hash: anonymizeIdentifier(companyId), employee_id: employee.id, connector_type: connection.connection_type, tool_name: tool.name });
      return { employee_id: employee.id, employee_name: employee.name, connector_name: connection.name, tool_name: tool.name, status: 'failed' as const, summary: String(error?.message || 'The read tool failed.').slice(0, 500), created_at: createdAt };
    }
  }));
  return results;
}

async function getGoogleConnection(companyId: string, employeeId: string, connectionId: number, type: 'google_gmail' | 'google_sheets') {
  const connections = await loadMcpConnections(companyId, employeeId);
  const connection = connections.find((entry) => entry.id === connectionId && entry.connection_type === type && entry.status === 'connected');
  if (!connection || !connection.auth_token_encrypted) throw new Error(`The requested Google connector is not connected for ${employeeId}.`);
  const credentials = decryptConnectorCredentials(connection.auth_token_encrypted);
  if (!credentials) throw new Error('The Google connector credentials cannot be decrypted. Rotate the connector and reconnect it.');
  const oauth2 = googleOAuthClient();
  oauth2.setCredentials(credentials);
  return { connection, oauth2 };
}

async function readGoogleSheetValues(companyId: string, connectionId: number, sheetReference: string, range?: string) {
  const { oauth2 } = await getGoogleConnection(companyId, 'david', connectionId, 'google_sheets');
  const sheets = google.sheets({ version: 'v4', auth: oauth2 });
  const spreadsheetId = parseSpreadsheetId(sheetReference);
  if (!spreadsheetId || spreadsheetId.length < 10) throw new Error('A valid Google Sheets URL or spreadsheet ID is required.');
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, fields: 'properties(title),sheets(properties(title))' });
  const firstSheet = metadata.data.sheets?.[0]?.properties?.title || 'Sheet1';
  const boundedRange = String(range || `'${firstSheet}'!A1:Z50`).slice(0, 200);
  const valuesResponse = await sheets.spreadsheets.values.get({ spreadsheetId, range: boundedRange, majorDimension: 'ROWS' });
  const values = (valuesResponse.data.values || []).slice(0, 50).map((row) => (row || []).slice(0, 26).map((cell) => String(cell ?? '').slice(0, 500)));
  return { spreadsheet_id: spreadsheetId, title: metadata.data.properties?.title || 'Google Sheet', range: boundedRange, values };
}

async function searchGmail(companyId: string, connectionId: number, query: string, maxResults = 10) {
  const { oauth2 } = await getGoogleConnection(companyId, 'david', connectionId, 'google_gmail');
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const listed = await gmail.users.messages.list({ userId: 'me', q: String(query || '').slice(0, 500), maxResults: Math.min(Math.max(Number(maxResults) || 10, 1), 10) });
  const messages = await Promise.all((listed.data.messages || []).slice(0, 10).map(async (message) => {
    const detail = await gmail.users.messages.get({ userId: 'me', id: message.id!, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] });
    const headers = Object.fromEntries((detail.data.payload?.headers || []).map((header) => [header.name || '', header.value || '']));
    return { id: message.id, thread_id: message.threadId, snippet: detail.data.snippet || '', headers };
  }));
  return { query: String(query || '').slice(0, 500), messages };
}

const EMAIL_ADDRESS_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function emailDraftFromRequest(question: string, companyName: string) {
  const recipients = Array.from(new Set((question.match(EMAIL_ADDRESS_PATTERN) || []).map((email) => email.toLowerCase()))).slice(0, 10);
  const safeLine = (value: string, limit: number) => value.replace(/[\r\n]+/g, ' ').trim().slice(0, limit);
  const subjectMatch = question.match(/(?:subject|re)\s*[:\-]\s*([^\n.]{3,160})/i);
  const bodyMatch = question.match(/(?:body|message|saying|say)\s*[:\-]?\s*([\s\S]{3,2200})/i);
  const subject = safeLine(subjectMatch?.[1] || `Update from ${companyName || 'your Caveworkers workspace'}`, 160);
  const body = String(bodyMatch?.[1] || `Hello,\n\n${question}\n\nRegards,\nSarah\n${companyName || 'Caveworkers'}`).replace(/\r\n/g, '\n').slice(0, 3000);
  return { recipients, subject, body };
}

function hasApprovalGatedGmailSend(connection: TenantConnector) {
  const grant = (connection.tool_grants || []).find((entry) => entry.tool_name === 'gmail.send');
  return connection.connection_type === 'google_gmail'
    && connection.status === 'connected'
    && connection.config?.gmail_send_enabled === true
    && (connection.auth_scopes || []).includes('https://www.googleapis.com/auth/gmail.send')
    && grant?.access_level === 'requires_approval';
}

async function prepareSarahEmailAction(companyId: string, question: string, taskId: number) {
  const company = db.companies.get(companyId);
  const draft = emailDraftFromRequest(question, company?.name || 'your workspace');
  if (!draft.recipients.length) return { status: 'blocked' as const, summary: 'Sarah prepared the work but cannot draft an executable email because no recipient address was included. Add a recipient such as name@company.com and try again.' };
  const connections = await loadMcpConnections(companyId, 'sarah');
  const gmailConnection = connections.find(hasApprovalGatedGmailSend);
  if (!gmailConnection) {
    const hasConfiguredGmail = connections.some((connection) => connection.connection_type === 'google_gmail' && connection.config?.gmail_send_enabled === true);
    return { status: 'blocked' as const, summary: hasConfiguredGmail ? 'Sarah’s Gmail connection needs to be reconnected with the Gmail send permission before an email can be sent.' : 'Sarah has no approval-gated Gmail send connection. In Settings, connect Gmail to Sarah, enable “Allow Sarah to send after approval,” then complete Google OAuth.' };
  }
  return {
    status: 'awaiting_approval' as const,
    summary: `Sarah drafted an email to ${draft.recipients.join(', ')}. It will not be sent until you approve it.`,
    payload: { action_type: 'gmail.send', connection_id: gmailConnection.id, employee_id: 'sarah', to: draft.recipients, subject: draft.subject, body: draft.body, execution_status: 'pending', idempotency_key: crypto.randomUUID() }
  };
}

function gmailRawMessage(to: string[], subject: string, body: string) {
  const safeHeader = (value: string, limit: number) => String(value || '').replace(/[\r\n]+/g, ' ').trim().slice(0, limit);
  const safeBody = String(body || '').replace(/\r\n/g, '\n').slice(0, 3000);
  return Buffer.from(`To: ${safeHeader(to.join(', '), 1200)}\r\nSubject: ${safeHeader(subject, 160)}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${safeBody}`, 'utf8').toString('base64url');
}

async function dispatchApprovedSarahEmail(approval: ApprovalRecord) {
  const payload = approval.payload || {};
  if (payload.action_type !== 'gmail.send') return null;
  if (payload.execution_status === 'succeeded') return payload.execution_result || null;
  if (payload.execution_status === 'processing') throw new Error('This email is already being sent. Check the task result before retrying.');
  const recipients = Array.isArray(payload.to) ? payload.to.filter((email: unknown) => typeof email === 'string' && EMAIL_ADDRESS_PATTERN.test(email)) : [];
  EMAIL_ADDRESS_PATTERN.lastIndex = 0;
  if (!recipients.length || recipients.length > 10) throw new Error('The approved email has no valid recipients. Create a new draft with up to 10 valid email addresses.');
  approval.payload = { ...payload, execution_status: 'processing' };
  await persistApprovalRecord(approval);
  const { oauth2 } = await getGoogleConnection(approval.company_id, 'sarah', Number(payload.connection_id), 'google_gmail');
  const gmail = google.gmail({ version: 'v1', auth: oauth2 });
  const sent = await gmail.users.messages.send({ userId: 'me', requestBody: { raw: gmailRawMessage(recipients, String(payload.subject || ''), String(payload.body || '')) } });
  const result = { message_id: String(sent.data.id || ''), thread_id: String(sent.data.threadId || ''), recipients: recipients.join(', '), subject: String(payload.subject || '').slice(0, 160) };
  approval.payload = { ...approval.payload, execution_status: 'succeeded', execution_result: result };
  approval.executed_at = new Date().toISOString();
  await persistApprovalRecord(approval);
  return result;
}

async function recordWorkforceApprovalOutcome(approval: ApprovalRecord, status: TaskRecord['execution']['status'], summary: string, result?: Record<string, string>) {
  await hydrateTenantTasks(approval.company_id);
  const task = db.tasks.get(approval.task_id);
  if (!task || task.company_id !== approval.company_id) return;
  task.execution = { action_type: String(approval.payload?.action_type || 'external.action'), status, summary: summary.slice(0, 1200), updated_at: new Date().toISOString(), result };
  task.status = status === 'succeeded' || status === 'cancelled' ? 'completed' : status === 'failed' ? 'failed' : status === 'blocked' ? 'blocked' : 'pending_approval';
  task.trace = [...(task.trace || []), { kind: status === 'succeeded' ? 'action_completed' : status === 'cancelled' ? 'approval_declined' : status === 'failed' || status === 'blocked' ? 'action_failed' : 'action_update', sender: 'Sarah', receiver: 'Manager', body: summary.slice(0, 1200), created_at: new Date().toISOString() }];
  task.completed_at = new Date().toISOString();
  db.tasks.set(task.id, task);
  await persistTaskRecord(task);
  await persistActivityLog(approval.company_id, { id: Date.now(), sender: 'Sarah', receiver: 'Manager', kind: `task.execution.${status}`, body: `Task #${task.id}: ${summary.slice(0, 900)}`, created_at: new Date().toISOString() });
  emitWorkroomEvent(approval.company_id, task.id, { type: 'task_update', task: workroomSnapshot(task) });
}

async function persistAnalystDataSource(sourceRecord: AnalystDataSource) {
  const sources = db.analystDataSources.get(sourceRecord.company_id) || [];
  const index = sources.findIndex((entry) => entry.id === sourceRecord.id);
  if (index >= 0) sources[index] = sourceRecord; else sources.unshift(sourceRecord);
  db.analystDataSources.set(sourceRecord.company_id, sources);
  const collection = analystTenantCollection(sourceRecord.company_id, 'data_sources');
  if (collection) await collection.doc(sourceRecord.id).set(stripUndefined(sourceRecord), { merge: true });
}

async function loadAnalystDataSources(companyId: string): Promise<AnalystDataSource[]> {
  const cached = db.analystDataSources.get(companyId);
  if (cached) return cached;
  const collection = analystTenantCollection(companyId, 'data_sources');
  if (collection) {
    try {
      const snapshot = await collection.orderBy('created_at', 'desc').get();
      const entries = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) } as AnalystDataSource));
      db.analystDataSources.set(companyId, entries);
      return entries;
    } catch (error) {
      console.warn('Could not load analyst data sources:', error);
    }
  }
  return [];
}

async function persistAnalystMemory(memory: AnalystMemory) {
  const items = db.analystMemory.get(memory.company_id) || [];
  const index = items.findIndex((entry) => entry.id === memory.id);
  if (index >= 0) items[index] = memory; else items.unshift(memory);
  db.analystMemory.set(memory.company_id, items.slice(0, 100));
  const collection = analystTenantCollection(memory.company_id, memory.memory_type === 'working' ? 'working_memory' : 'long_term_memory');
  if (collection) await collection.doc(memory.id).set(stripUndefined(memory), { merge: true });
}

async function loadAnalystMemory(companyId: string, memoryType?: AnalystMemory['memory_type']): Promise<AnalystMemory[]> {
  const cached = db.analystMemory.get(companyId) || [];
  if (cached.length) return memoryType ? cached.filter((entry) => entry.memory_type === memoryType) : cached;
  const loaded: AnalystMemory[] = [];
  for (const kind of (memoryType ? [memoryType] : ['long_term', 'working'] as AnalystMemory['memory_type'][])) {
    const collection = analystTenantCollection(companyId, kind === 'working' ? 'working_memory' : 'long_term_memory');
    if (!collection) continue;
    try {
      const snapshot = await collection.orderBy('created_at', 'desc').limit(40).get();
      loaded.push(...snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) } as AnalystMemory)));
    } catch (error) {
      console.warn('Could not load analyst memory:', error);
    }
  }
  loaded.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  db.analystMemory.set(companyId, loaded);
  return memoryType ? loaded.filter((entry) => entry.memory_type === memoryType) : loaded;
}

async function persistAnalystRun(run: AnalystRun) {
  const runs = db.analystRuns.get(run.company_id) || [];
  const index = runs.findIndex((entry) => entry.id === run.id);
  if (index >= 0) runs[index] = run; else runs.unshift(run);
  db.analystRuns.set(run.company_id, runs.slice(0, 40));
  const collection = analystTenantCollection(run.company_id, 'analyst_runs');
  if (collection) await collection.doc(run.id).set(stripUndefined(run), { merge: true });
}

async function persistAnalystApproval(approval: ApprovalRecord) {
  await persistApprovalRecord(approval);
  db.analystApprovalsLoaded.add(approval.company_id);
}

async function loadAnalystApprovals(companyId: string): Promise<ApprovalRecord[]> {
  await hydrateTenantApprovals(companyId);
  db.analystApprovalsLoaded.add(companyId);
  return Array.from(db.approvals.values()).filter((approval) => approval.company_id === companyId && approval.employee_id === 'david');
}

function analystSourceSummary(sourceRecord: AnalystDataSource | undefined): string {
  if (!sourceRecord) return 'No live data source is connected. David will prepare a transparent preview and state which source is needed to verify it.';
  if (sourceRecord.kind === 'csv') return `CSV source “${sourceRecord.name}” is connected read-only with ${Number(sourceRecord.metadata?.row_count || 0)} imported rows.`;
  return `${sourceRecord.kind === 'sql' ? 'SQL' : 'Google Sheets'} source “${sourceRecord.name}” is registered read-only but needs secure configuration before a live query can run.`;
}

function isExternalAnalystAction(question: string) {
  const lower = question.toLowerCase();
  if (/\b(email|send mail|gmail)\b/.test(lower)) return { requested: true, tool: 'Gmail', summary: 'Draft and send an analyst report by email' };
  if (/\b(slack|post to channel|channel update)\b/.test(lower)) return { requested: true, tool: 'Slack', summary: 'Post an analyst update to Slack' };
  if (/\b(notion|write to notion|update notion)\b/.test(lower)) return { requested: true, tool: 'Notion', summary: 'Write analyst findings to Notion' };
  if (/\b(whatsapp|send a message)\b/.test(lower)) return { requested: true, tool: 'WhatsApp Business', summary: 'Send an analyst update via WhatsApp Business' };
  return { requested: false, tool: '', summary: '' };
}

function createPreviewChart(question: string, sourceRecord?: AnalystDataSource) {
  const lower = question.toLowerCase();
  const wantsMargin = /cost|expense|margin|profit/.test(lower);
  const wantsVolume = /customer|ticket|order|volume/.test(lower);
  const values = wantsMargin ? [28, 29, 31, 31] : wantsVolume ? [62, 68, 73, 79] : [128, 145, 162, 184];
  return {
    title: wantsMargin ? 'Margin trajectory (preview)' : wantsVolume ? 'Business volume trend (preview)' : 'Revenue trend (preview)',
    labels: ['Q4', 'Q1', 'Q2', 'Q3'], values, unit: wantsMargin ? '%' : wantsVolume ? 'index' : '$k',
    source_note: sourceRecord?.status === 'connected' ? `Preview based on ${sourceRecord.name}; confirm figures with a live query before distribution.` : 'Illustrative workspace preview only — connect a source to calculate live figures.'
  };
}

function parseCsvPreview(csvText: string) {
  const lines = csvText.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('The CSV needs a header row and at least one data row.');
  const parseLine = (line: string) => line.split(',').map((value) => value.trim().replace(/^"|"$/g, ''));
  const columns = parseLine(lines[0]).filter(Boolean).slice(0, 30);
  return { columns, row_count: lines.length - 1, sample_rows: lines.slice(1, 11).map((line) => Object.fromEntries(columns.map((column, index) => [column, parseLine(line)[index] || '']))) };
}

async function runAnalystLoop(input: { companyId: string; managerName: string; question: string; sourceId?: string; outputFormat?: string }) {
  const question = String(input.question || '').trim();
  if (!question) throw new Error('An analysis question is required.');
  if (question.length > 6000) throw new Error('Keep the analysis question under 6,000 characters.');
  const outputFormat: AnalystRun['output_format'] = ['brief', 'report', 'chart', 'table'].includes(input.outputFormat || '') ? input.outputFormat as AnalystRun['output_format'] : 'brief';
  const sources = await loadAnalystDataSources(input.companyId);
  const sourceRecord = input.sourceId ? sources.find((entry) => entry.id === input.sourceId) : sources.find((entry) => entry.status === 'connected') || sources[0];
  if (input.sourceId && !sourceRecord) throw new Error('That data source is not available in this workspace.');
  const memories = await loadAnalystMemory(input.companyId);
  const taskId = db.nextTaskId++;
  const runId = `analysis_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  const now = new Date().toISOString();
  let liveEvidence = '';
  if (sourceRecord?.kind === 'google_sheets' && sourceRecord.status === 'connected' && sourceRecord.metadata?.connection_id) {
    try {
      const sheetResult = await readGoogleSheetValues(input.companyId, Number(sourceRecord.metadata.connection_id), sourceRecord.metadata.sheet_url);
      liveEvidence = `Live read-only sample from ${sheetResult.title} (${sheetResult.range}): ${JSON.stringify(sheetResult.values.slice(0, 8))}`;
    } catch (error: any) {
      liveEvidence = `The Google Sheets connector was selected but the live read failed: ${String(error?.message || 'unknown error').slice(0, 180)}`;
    }
  }
  const trace: AnalystRun['trace'] = [
    { stage: 'perceive', body: `Loaded tenant-scoped context: ${sources.length} source(s) and ${memories.filter((memory) => memory.memory_type === 'long_term').length} durable memory item(s).`, created_at: now },
    { stage: 'plan', body: `Planned a read-only ${outputFormat} workflow with manager review before any external action.`, created_at: new Date().toISOString() },
    { stage: 'act', body: sourceRecord?.status === 'connected' ? `Prepared a read-only analysis against ${sourceRecord.name}; no source write was attempted.${liveEvidence ? ' Live evidence was fetched within bounded limits.' : ''}` : 'Prepared a transparent preview because a live source is not fully connected; no data access was claimed.', created_at: new Date().toISOString() }
  ];
  const chart = createPreviewChart(question, sourceRecord);
  const verification = sourceRecord?.status === 'connected' ? 'The source is connected read-only. Verify material decisions against the live result before distribution.' : 'No live data connection is configured, so no business fact is presented as verified. Connect a CSV, Sheets, or SQL source to replace this preview with a live query.';
  const preferences = memories.filter((memory) => memory.memory_type === 'long_term').slice(0, 3).map((memory) => `• ${memory.content}`).join('\n') || 'No durable reporting preferences have been saved yet.';
  const deterministicReport = `### Analysis brief\n\n**Question:** ${question}\n\n**Source status:** ${analystSourceSummary(sourceRecord)}\n\n**Live evidence:** ${liveEvidence || 'No live evidence was fetched.'}\n\n**Current read:** David has produced a reviewable ${outputFormat} analysis structure with a transparent trend preview.\n\n**What to validate next:**\n1. Confirm reporting period, metric definitions, and exclusions.\n2. Run the approved read-only source query or CSV calculation.\n3. Review material assumptions before sharing externally.\n\n**Manager context applied:**\n${preferences}\n\n**Controls:** ${verification}`;
  const narrative = await generateAnalystNarrative(`Business question: ${question}\nSource: ${analystSourceSummary(sourceRecord)}\nLive evidence: ${liveEvidence || 'No live evidence was fetched.'}\nKnown tenant preferences: ${preferences}\nWrite no more than five short paragraphs. Be explicit about previews, missing data, and validation.`, input.companyId);
  const report = narrative.text ? `${deterministicReport}\n\n---\n\n### David’s executive note\n\n${narrative.text}` : deterministicReport;
  trace.push({ stage: 'reflect', body: narrative.text ? `Applied ${narrative.provider}${narrative.model ? ` (${narrative.model})` : ''} narrative with ${narrative.latency_ms} ms latency.` : `No model narrative was applied; returned a deterministic result with status ${narrative.error_code || 'unavailable'}.`, created_at: new Date().toISOString() });
  await persistAnalystMemory({ id: `working_${runId}`, company_id: input.companyId, memory_type: 'working', session_id: runId, category: 'task_state', content: `Run ${runId}: ${question.slice(0, 420)}`, confidence: 1, created_at: now, expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() });
  if (/\b(always|never|prefer|exclude|definition|call it)\b/i.test(question)) {
    await persistAnalystMemory({ id: `memory_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, company_id: input.companyId, memory_type: 'long_term', category: 'reflection', content: `Manager guidance: ${question.slice(0, 500)}`, confidence: 0.72, created_at: now });
    trace.push({ stage: 'reflect', body: 'Saved manager guidance as a tenant-scoped long-term reflection.', created_at: new Date().toISOString() });
  } else {
    trace.push({ stage: 'reflect', body: 'Stored a short-lived working checkpoint; no durable preference was inferred.', created_at: new Date().toISOString() });
  }
  const externalAction = isExternalAnalystAction(question);
  let approvalId: number | undefined;
  if (externalAction.requested) {
    approvalId = db.nextApprovalId++;
    await persistAnalystApproval({ id: approvalId, company_id: input.companyId, task_id: taskId, employee_id: 'david', tool_name: externalAction.tool, action_summary: `${externalAction.summary}: “${question.slice(0, 180)}”`, status: 'pending', payload: { origin: 'analyst', mode: 'draft_only', external_action: true, run_id: runId }, created_at: new Date().toISOString() });
    trace.push({ stage: 'approval', body: `Created a human-approval gate for ${externalAction.tool}. This is a draft only; no external action has been performed.`, created_at: new Date().toISOString() });
  }
  const run: AnalystRun = { id: runId, company_id: input.companyId, task_id: taskId, question, source_id: sourceRecord?.id, output_format: outputFormat, status: approvalId ? 'awaiting_approval' : 'completed', plan: ['Perceive tenant context', 'Plan read-only analysis', 'Act with a configured source or transparent preview', 'Reflect to tenant memory'], trace, report, chart, approval_id: approvalId, model: { provider: narrative.provider, name: narrative.model, latency_ms: narrative.latency_ms, usage: narrative.usage, error_code: narrative.error_code }, created_at: now };
  await persistAnalystRun(run);
  const analystTask: TaskRecord = { id: taskId, company_id: input.companyId, question, owner: 'david', status: approvalId ? 'pending_approval' : 'completed', answer: report, plan: run.plan.join(' → '), created_at: now, trace: trace.map((entry) => ({ kind: entry.stage, sender: 'David', receiver: entry.stage === 'approval' ? 'Human approval gate' : 'Analyst run', body: entry.body, created_at: entry.created_at })) };
  db.tasks.set(taskId, analystTask);
  await persistTaskRecord(analystTask);
  await persistActivityLog(input.companyId, { id: Date.now(), sender: 'David', receiver: input.managerName || 'Workspace Manager', kind: approvalId ? 'analyst.awaiting_approval' : 'analyst.completed', body: approvalId ? `Analysis ${runId} is ready; external delivery is paused for approval.` : `Completed analyst run ${runId}: ${question.slice(0, 90)}${question.length > 90 ? '…' : ''}`, created_at: new Date().toISOString() });
  return run;
}

// Seed default user & company for seamless previewing
const DEFAULT_UID = 'user_demo_123';
const DEFAULT_COMPANY_ID = 'org_demo_123';

db.users.set(DEFAULT_UID, {
  uid: DEFAULT_UID,
  email: 'demo@caveworkers.com',
  display_name: 'Demo Workspace Manager',
  company_id: DEFAULT_COMPANY_ID,
  company_name: 'Acme Operations',
  onboarded: true,
  selected_tier: 'growth',
  role: 'admin'
});

db.companies.set(DEFAULT_COMPANY_ID, {
  id: DEFAULT_COMPANY_ID,
  name: 'Acme Operations',
  industry: 'Technology',
  team_size: '11-50',
  owner_uid: DEFAULT_UID,
  tier: 'growth',
  status: 'active',
  selected_employees: ['alex', 'sarah', 'mike'],
  created_at: new Date().toISOString()
});

db.orgEmployees.set(DEFAULT_COMPANY_ID, [
  {
    id: 'sarah',
    employee_id: 'CW_EMP_001',
    name: 'Sarah',
    role: 'HR & Talent Acquisition Manager',
    department: 'Human Resources',
    color: '#10b981',
    status: 'active',
    tools: ['Gmail', 'Notion', 'Slack'],
    permissions: [
      { tool_name: 'Gmail', access_level: 'requires_approval' },
      { tool_name: 'Notion', access_level: 'read_write' },
      { tool_name: 'Slack', access_level: 'requires_approval' }
    ]
  },
  {
    id: 'david',
    employee_id: 'CW_EMP_002',
    name: 'David',
    role: 'Data & Financial Analyst',
    department: 'Finance & Analytics',
    color: '#f59e0b',
    status: 'active',
    tools: ['SQL workspace', 'Notion', 'Slack'],
    permissions: [
      { tool_name: 'SQL workspace', access_level: 'read_only' },
      { tool_name: 'Notion', access_level: 'read_write' },
      { tool_name: 'Slack', access_level: 'read_write' }
    ]
  },
  {
    id: 'alex',
    employee_id: 'CW_EMP_003',
    name: 'Alex',
    role: 'Senior Operations Specialist',
    department: 'Operations',
    color: '#3b82f6',
    status: 'active',
    tools: ['SQL workspace', 'Gmail', 'Notion'],
    permissions: [
      { tool_name: 'SQL workspace', access_level: 'read_only' },
      { tool_name: 'Gmail', access_level: 'requires_approval' },
      { tool_name: 'Notion', access_level: 'read_write' }
    ]
  },
  {
    id: 'mike',
    employee_id: 'CW_EMP_004',
    name: 'Mike',
    role: 'Technical Lead & Systems Developer',
    department: 'Engineering',
    color: '#8b5cf6',
    status: 'active',
    tools: ['Notion', 'Slack'],
    permissions: [
      { tool_name: 'Notion', access_level: 'read_write' },
      { tool_name: 'Slack', access_level: 'requires_approval' }
    ]
  }
]);

db.knowledge.set(DEFAULT_COMPANY_ID, [
  { id: 1, title: 'Q3 Financial Goals', category: 'policy', content: 'Target ARR growth is 25% with operating margin above 30%.', created_at: new Date().toISOString() },
  { id: 2, title: 'Approval Policy', category: 'policy', content: 'All external communications and code commits require human sign-off.', created_at: new Date().toISOString() }
]);

db.activity.set(DEFAULT_COMPANY_ID, [
  { id: 1, company_id: DEFAULT_COMPANY_ID, sender: 'System', receiver: 'Workspace', kind: 'workspace.activated', body: 'Workspace activated on Growth plan with 3 AI employees.', created_at: new Date().toISOString() }
]);

db.approvals.set(101, {
  id: 101,
  company_id: DEFAULT_COMPANY_ID,
  task_id: 103,
  employee_id: 'alex',
  tool_name: 'Gmail',
  action_summary: 'Send Q3 Operations Status email to clients (3 recipients)',
  status: 'pending',
  created_at: new Date().toISOString()
});

db.tasks.set(101, {
  id: 101,
  company_id: DEFAULT_COMPANY_ID,
  question: 'Synthesize Q3 engineering headcount demand & candidate screening rubrics',
  owner: 'sarah',
  status: 'completed',
  answer: '### Executive Workforce Brief (Task #101)\n\n**Lead**: Sarah (HR Manager · CW_EMP_001)\n**Collaborator**: David (Data Analyst · CW_EMP_002)\n\n1. **Headcount Demand**: 5 new technical requisitions based on David\'s Q3 revenue trend analysis (+32% ARR growth).\n2. **Screening Rubric**: Standardized 4-tier technical evaluation in Notion.\n3. **SLA**: Candidate outreach email ready in Approvals queue for Manager sign-off.',
  plan: '1. Ingest brief -> 2. Knowledge Vault Search -> 3. Inter-Agent Bus (David) -> 4. Generate Recruitment Report',
  created_at: new Date(Date.now() - 3600000 * 2).toISOString(),
  trace: [
    { kind: 'received', sender: 'Workspace Manager', receiver: 'Task Orchestrator', body: 'Ingested brief: "Synthesize Q3 engineering headcount demand"', created_at: new Date(Date.now() - 3600000 * 2).toISOString() },
    { kind: 'inter_agent', sender: 'Sarah', receiver: 'David', body: '[Inter-Agent Bus] Delegating subtask to David (Data Analyst): "Evaluate Q3 revenue growth against headcount bandwidth"', created_at: new Date(Date.now() - 3600000 * 2 + 1000).toISOString() },
    { kind: 'inter_agent', sender: 'David', receiver: 'Sarah', body: '[Inter-Agent Bus] David returned verified analytics payload (+32% ARR growth justifies headcount expansion)', created_at: new Date(Date.now() - 3600000 * 2 + 2000).toISOString() },
    { kind: 'completed', sender: 'Sarah', receiver: 'Task Ledger', body: 'Task execution recorded in immutable ledger.', created_at: new Date(Date.now() - 3600000 * 2 + 3000).toISOString() }
  ]
});

db.tasks.set(102, {
  id: 102,
  company_id: DEFAULT_COMPANY_ID,
  question: 'Query SQL sales database for net ARR and margin compliance',
  owner: 'david',
  status: 'completed',
  answer: '### Financial Analytics Brief (Task #102)\n\n**Lead**: David (Data Analyst · CW_EMP_002)\n\n1. **Net ARR**: $1.84M (+32% YoY growth).\n2. **Operating Margins**: 31.4% net margin (exceeds Q3 goal threshold of 30%).\n3. **Resource Efficiency**: Operational capacity at 88% threshold.',
  plan: '1. Ingest brief -> 2. SQL Workspace Query -> 3. Financial Analysis',
  created_at: new Date(Date.now() - 3600000 * 4).toISOString(),
  trace: [
    { kind: 'received', sender: 'Workspace Manager', receiver: 'Task Orchestrator', body: 'Ingested brief: "Query SQL sales database for net ARR"', created_at: new Date(Date.now() - 3600000 * 4).toISOString() },
    { kind: 'verified', sender: 'David', receiver: 'Permission Engine', body: 'Verified MCP tool access: SQL workspace (Read Only)', created_at: new Date(Date.now() - 3600000 * 4 + 1000).toISOString() },
    { kind: 'completed', sender: 'David', receiver: 'Task Ledger', body: 'Analytics output logged to ledger.', created_at: new Date(Date.now() - 3600000 * 4 + 2000).toISOString() }
  ]
});

db.tasks.set(103, {
  id: 103,
  company_id: DEFAULT_COMPANY_ID,
  question: 'Draft Q3 Operations Status email and dispatch to key client accounts',
  owner: 'alex',
  status: 'pending_approval',
  answer: '### Operational Brief (Task #103)\n\n**Lead**: Alex (Operations Specialist · CW_EMP_003)\n\nDrafted executive status update email. Action paused for Human-In-The-Loop manager sign-off prior to Gmail dispatch.',
  plan: '1. Ingest brief -> 2. Draft Email -> 3. Trigger HITL Approval Queue',
  created_at: new Date(Date.now() - 1800000).toISOString(),
  trace: [
    { kind: 'received', sender: 'Workspace Manager', receiver: 'Task Orchestrator', body: 'Ingested brief: "Draft Q3 Operations Status email"', created_at: new Date(Date.now() - 1800000).toISOString() },
    { kind: 'approval_required', sender: 'Alex', receiver: 'HITL Queue', body: 'Action requires Manager approval before Gmail dispatch', created_at: new Date(Date.now() - 1800000 + 1000).toISOString() }
  ]
});
db.nextTaskId = 104;

// Helper to resolve the verified Firebase user attached by the session middleware.
function getAuthUser(req: express.Request): User | null {
  return authenticatedUsers.get(req) || null;
}

function getAuthUserOrDefault(req: express.Request): User {
  return getAuthUser(req) || db.users.get(DEFAULT_UID) || {
    uid: DEFAULT_UID,
    email: 'user@caveworkers.com',
    display_name: 'Workspace Manager',
    company_id: DEFAULT_COMPANY_ID,
    company_name: 'Acme Operations',
    onboarded: true,
    selected_tier: 'growth'
  };
}

// Verify Firebase session cookies before protected routes are evaluated.
app.use(async (req, res, next) => {
  const sessionCookie = req.cookies?.__session;
  if (!sessionCookie || !firebaseAuth) return next();

  try {
    const decoded = await firebaseAuth.verifySessionCookie(sessionCookie, true);
    const user = await loadUserFromFirebase(decoded.uid);
    if (!user) throw new Error('Firebase user profile not found');
    authenticatedUsers.set(req, user);
  } catch (_error) {
    res.clearCookie('__session', { path: '/' });
    res.clearCookie('cw_csrf', { path: '/' });
  }
  next();
});

// Test-only authentication injection. This middleware is not registered in production builds or runtime.
if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
  app.use('/api', (req, _res, next) => {
    const uid = String(req.get('x-caveworkers-test-user') || '').trim();
    const user = uid ? db.users.get(uid) : undefined;
    if (user) authenticatedUsers.set(req, user);
    next();
  });
}

// Every unsafe API request must echo the same token issued in the readable CSRF cookie.
app.use('/api', (req, res, next) => {
  const unsafe = /^(POST|PUT|PATCH|DELETE)$/i.test(req.method);
  const publicPath = req.path === '/session-login' || req.path === '/session-logout' || req.path === '/payments/webhook';
  if (!unsafe || publicPath) return next();

  const cookieToken = req.cookies?.cw_csrf || '';
  const headerToken = req.get('x-csrf-token') || '';
  const matches = cookieToken && headerToken && cookieToken.length === headerToken.length && crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken));
  if (!matches) return res.status(403).json({ error: 'CSRF validation failed.' });
  next();
});

// Apply local-process request limits until a shared edge limiter is configured for multi-instance production.
app.use('/api', (req, res, next) => {
  const limits: Record<string, [number, number]> = {
    '/session-login': [10, 15 * 60 * 1000],
    '/task': [30, 60 * 1000],
    '/tasks': [30, 60 * 1000],
    '/payments/create-order': [8, 15 * 60 * 1000],
    '/payments/verify': [12, 15 * 60 * 1000],
    '/payments/webhook': [120, 60 * 1000],
    '/analyst/analyze': [10, 5 * 60 * 1000],
    '/analyst/data-sources': [20, 15 * 60 * 1000],
    '/analyst/memory': [30, 15 * 60 * 1000]
  };
  const rule = limits[req.path];
  if (!rule || !isRateLimited(rateLimitKey(req, req.path), rule[0], rule[1])) return next();
  return res.status(429).json({ error: 'Too many requests. Please try again later.' });
});

// All non-auth API routes require the verified Firebase session above.
app.use('/api', (req, res, next) => {
  const publicApiPaths = new Set(['/health', '/session-login', '/session-logout', '/payments/webhook']);
  if (publicApiPaths.has(req.path)) return next();
  if (!getAuthUser(req)) return res.status(401).json({ error: 'Authentication required.' });
  next();
});

async function enforceWorkspaceAccess(req: express.Request, res: express.Response): Promise<boolean> {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return true;
  }
  const company = user.company_id ? await loadCompanyFromFirebase(user.company_id) || db.companies.get(user.company_id) : null;
  if (!company) return false;
  if (isTrialExpired(company.tier, company.trial_ends_at)) {
    res.status(402).json({ error: 'Your free trial has ended. Upgrade to continue using workspace actions.', upgrade_required: true, trial_ends_at: company.trial_ends_at });
    return true;
  }
  return false;
}

function getTenantIdOrFail(req: express.Request, res: express.Response): string | null {
  const user = getAuthUser(req);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return null;
  }
  if (!user.company_id) {
    res.status(403).json({ error: 'A verified workspace is required.' });
    return null;
  }
  return user.company_id;
}

// ── PAGE ROUTES ──────────────────────────────────────────

app.get('/', (_req, res) => {
  res.sendFile(path.join(process.cwd(), 'deskforce.html'));
});

app.get('/login', (req, res) => {
  const user = getAuthUser(req);
  if (user && user.onboarded) {
    return res.redirect('/command');
  }
  res.render('login', { firebase_config: FIREBASE_WEB_CONFIG });
});

app.get('/onboarding', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.redirect('/login');
  }
  res.render('onboarding', {
    firebase_config: FIREBASE_WEB_CONFIG,
    plans: SUBSCRIPTION_PLANS,
    employee_catalog: EMPLOYEE_CATALOG,
    razorpay_key: RAZORPAY_KEY_ID
  });
});

app.get('/command', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.redirect('/login');
  }
  res.render('command', {
    firebase_config: FIREBASE_WEB_CONFIG,
    user,
    org_id: user.company_id || DEFAULT_COMPANY_ID
  });
});

app.get('/dashboard', (_req, res) => {
  res.redirect('/command');
});

app.get('/analyst', (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.redirect('/login');
  res.render('analyst', { firebase_config: FIREBASE_WEB_CONFIG, user, org_id: user.company_id || DEFAULT_COMPANY_ID, analyst_model: OPENROUTER_KEY_READY ? ANALYST_MODEL : (genAIClient ? 'Gemini fallback' : 'Preview planner') });
});

app.get('/employee/:id', (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.redirect('/login');
  const employee = EMPLOYEE_CATALOG.find((entry) => entry.id === req.params.id);
  if (!employee) return res.status(404).render('404', { message: 'Employee not found' });
  res.render('employee', {
    firebase_config: FIREBASE_WEB_CONFIG,
    user,
    org_id: user.company_id || DEFAULT_COMPANY_ID,
    employee,
    employee_catalog: EMPLOYEE_CATALOG
  });
});

app.get('/settings', (req, res) => {
  const user = getAuthUser(req);
  if (!user) {
    return res.redirect('/login');
  }
  res.render('settings', {
    firebase_config: FIREBASE_WEB_CONFIG,
    user,
    org_id: user.company_id || DEFAULT_COMPANY_ID,
    plans: SUBSCRIPTION_PLANS,
    employee_catalog: EMPLOYEE_CATALOG
  });
});

app.get('/terms', (_req, res) => {
  res.render('terms');
});

app.get('/privacy', (_req, res) => {
  res.render('privacy');
});

// ── HEALTH & API ROUTES ──────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    components: {
      database: { status: firestoreDb ? 'active' : 'unconfigured' },
      payments: { status: RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && RAZORPAY_WEBHOOK_SECRET ? 'configured' : 'unconfigured' },
      firebase: { status: firebaseAuth && firestoreDb ? 'active' : 'unconfigured' },
      analyst: { status: OPENROUTER_KEY_READY ? 'openrouter_configured' : genAIClient ? 'gemini_fallback' : 'preview_only', model: OPENROUTER_KEY_READY ? ANALYST_MODEL : undefined },
      mcp_bus: { status: 'active' },
      observability: { sentry: sentryEnabled ? 'configured' : 'unconfigured' }
    }
  });
});

app.post('/api/session-login', async (req, res) => {
  const { idToken } = req.body || {};
  if (!idToken || !firebaseAuth || !firestoreDb) {
    return res.status(503).json({ error: 'Google sign-in is not configured on this server.' });
  }

  let decodedUser: any;
  try {
    decodedUser = await firebaseAuth.verifyIdToken(idToken);
  } catch (_error) {
    return res.status(401).json({ error: 'The Google sign-in token is invalid or expired.' });
  }

  if (!decodedUser?.uid || !decodedUser.email || decodedUser.firebase?.sign_in_provider !== 'google.com') {
    return res.status(401).json({ error: 'Please sign in with a verified Google account.' });
  }

  const now = new Date().toISOString();
  const existingUser = await loadUserFromFirebase(decodedUser.uid);
  const user: User = {
    ...(existingUser || {}),
    uid: decodedUser.uid,
    email: decodedUser.email,
    display_name: decodedUser.name || existingUser?.display_name || decodedUser.email.split('@')[0],
    photo_url: decodedUser.picture || existingUser?.photo_url || '',
    company_id: existingUser?.company_id,
    company_name: existingUser?.company_name,
    onboarded: existingUser?.onboarded ?? false,
    selected_tier: existingUser?.selected_tier || 'free_trial',
    role: existingUser?.role || 'admin',
    created_at: existingUser?.created_at || now,
    updated_at: now
  };

  try {
    await persistUser(user, {
      auth_provider: decodedUser.firebase?.sign_in_provider || 'google.com',
      email_verified: Boolean(decodedUser.email_verified)
    });

    const existingCompany = user.company_id ? await loadCompanyFromFirebase(user.company_id) : null;
    if (user.company_id && !existingCompany) {
      const company: Company = {
        id: user.company_id!,
        name: user.company_name || 'Acme Operations',
        industry: 'Technology',
        team_size: '11-50',
        owner_uid: user.uid,
        tier: user.selected_tier || 'growth',
        status: 'active',
        selected_employees: ['sarah', 'david', 'alex', 'mike'],
        created_at: now
      };
      await persistCompany(company);
      db.orgEmployees.set(company.id, db.orgEmployees.get(DEFAULT_COMPANY_ID) || []);
      db.knowledge.set(company.id, db.knowledge.get(DEFAULT_COMPANY_ID) || []);
    }

    const sessionCookie = await firebaseAuth.createSessionCookie(idToken, { expiresIn: SESSION_COOKIE_MAX_AGE });
    const csrfToken = crypto.randomBytes(32).toString('hex');
    res.cookie('__session', sessionCookie, sessionCookieOptions);
    res.cookie('cw_csrf', csrfToken, readableCookieOptions);
    res.json({
      status: 'success',
      redirect: user.onboarded ? '/command' : '/onboarding',
      csrf_token: csrfToken
    });
  } catch (error: any) {
    const code = typeof error?.code === 'string' ? error.code : 'session_persistence_failed';
    console.error('Firebase session persistence failed:', { code, message: error?.message || String(error) });
    res.status(500).json({ error: 'Could not create a secure CaveWorkers session.', code });
  }
});

app.post('/api/session-logout', (_req, res) => {
  res.clearCookie('__session', { path: '/' });
  res.clearCookie('cw_csrf', { path: '/' });
  res.clearCookie('csrf_token', { path: '/' });
  res.clearCookie('demo_uid', { path: '/' });
  res.json({ status: 'logged_out' });
});

app.get('/logout', (_req, res) => {
  res.clearCookie('__session', { path: '/' });
  res.clearCookie('cw_csrf', { path: '/' });
  res.clearCookie('csrf_token', { path: '/' });
  res.clearCookie('demo_uid', { path: '/' });
  res.redirect('/login');
});

app.get('/api/me', (req, res) => {
  const user = getAuthUser(req);
  res.json(user);
});

app.get('/api/billing', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const company: Company = user.company_id
    ? await loadCompanyFromFirebase(companyId) || db.companies.get(companyId) || {
      id: companyId,
      name: user.company_name || 'Acme Operations',
      tier: user.selected_tier || 'free_trial',
      status: 'active',
      owner_uid: user.uid,
      created_at: new Date().toISOString()
    }
    : db.companies.get(companyId) || {
      id: companyId,
      name: user.company_name || 'Acme Operations',
      tier: user.selected_tier || 'free_trial',
      status: 'active',
      owner_uid: user.uid,
      created_at: new Date().toISOString()
    };
  const plan = SUBSCRIPTION_PLANS[company.tier] || SUBSCRIPTION_PLANS.growth;
  const activeEmps = (db.orgEmployees.get(companyId) || []).length;

  res.json({
    company_name: company.name,
    tier_name: plan.name,
    tier_key: company.tier,
    active_employees: activeEmps,
    max_employees: plan.max_employees,
    quota_remaining: Math.max(0, plan.max_employees - activeEmps),
    status: company.status,
    trial_started_at: company.trial_started_at,
    trial_ends_at: company.trial_ends_at,
    upgrade_required: company.tier === 'free_trial' && Boolean(company.trial_ends_at && Date.now() >= Date.parse(company.trial_ends_at))
  });
});

app.post('/api/onboarding/save-profile', async (req, res) => {
  const user = getAuthUser(req);
  const { display_name, photo_url } = req.body || {};
  if (display_name) user.display_name = display_name;
  if (photo_url) user.photo_url = photo_url;
  await persistUser(user);
  res.json({ ok: true });
});

app.post('/api/onboarding/save-company', async (req, res) => {
  const user = getAuthUser(req);
  const { company_name, industry, team_size } = req.body || {};
  if (!company_name) {
    return res.status(400).json({ error: 'Company name is required' });
  }
  const company_id = `org_${user.uid.slice(0, 10)}`;
  user.company_id = company_id;
  user.company_name = company_name;
  const company: Company = {
    id: company_id,
    name: company_name,
    industry: industry || 'Technology',
    team_size: team_size || '11-50',
    owner_uid: user.uid,
    tier: 'free_trial',
    status: 'active',
    created_at: new Date().toISOString()
  };
  await persistUser(user);
  await persistCompany(company);

  res.json({ ok: true, company_id });
});

app.post('/api/onboarding/select-plan', async (req, res) => {
  const user = getAuthUser(req);
  const { tier } = req.body || {};
  if (tier && SUBSCRIPTION_PLANS[tier]) {
    user.selected_tier = tier;
    if (user.company_id) {
      const comp = await loadCompanyFromFirebase(user.company_id) || db.companies.get(user.company_id);
      if (comp) {
        comp.tier = tier;
        if (tier === 'free_trial') {
          const trialStartedAt = comp.trial_started_at || new Date().toISOString();
          comp.trial_started_at = trialStartedAt;
          comp.trial_ends_at = comp.trial_ends_at || new Date(Date.parse(trialStartedAt) + (SUBSCRIPTION_PLANS.free_trial.trial_days || 3) * 24 * 60 * 60 * 1000).toISOString();
          comp.status = 'active';
        } else {
          comp.status = 'payment_pending';
        }
        await persistCompany(comp);
      }
    }
    await persistUser(user);
  }
  res.json({ ok: true, tier: user.selected_tier });
});

app.post('/api/onboarding/select-employees', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const { employee_ids } = req.body || {};

  if (Array.isArray(employee_ids)) {
    const companyForPlan = user.company_id ? await loadCompanyFromFirebase(user.company_id) : null;
    const plan = SUBSCRIPTION_PLANS[user.selected_tier || companyForPlan?.tier || 'free_trial'] || SUBSCRIPTION_PLANS.free_trial;
    if (employee_ids.length > plan.max_employees) {
      return res.status(402).json({ error: `${plan.name} allows up to ${plan.max_employees} AI employees. Upgrade to add more.`, upgrade_required: true });
    }
    const orgEmps: OrgEmployee[] = [];
    employee_ids.forEach((empId: string) => {
      const cat = EMPLOYEE_CATALOG.find((e) => e.id === empId);
      if (cat) {
        orgEmps.push({
          id: cat.id,
          employee_id: cat.id,
          name: cat.name,
          role: cat.role,
          department: cat.department,
          color: cat.color,
          status: 'active',
          tools: [...cat.default_tools],
          permissions: cat.default_tools.map((t) => ({ tool_name: t, access_level: t === 'Gmail' ? 'requires_approval' : 'read_write' }))
        });
      }
    });
    db.orgEmployees.set(companyId, orgEmps);
    const company = await loadCompanyFromFirebase(companyId) || db.companies.get(companyId);
    if (company) {
      company.selected_employees = employee_ids;
      await persistCompany(company);
    }
  }
  res.json({ ok: true, employees_added: (employee_ids || []).length });
});

app.post('/api/onboarding/complete', async (req, res) => {
  const user = getAuthUser(req);
  user.onboarded = true;
  if (user.company_id) {
    const company = await loadCompanyFromFirebase(user.company_id) || db.companies.get(user.company_id);
    if (company) {
      if (company.tier === 'free_trial' && !company.trial_started_at) {
        const started = new Date();
        company.trial_started_at = started.toISOString();
        company.trial_ends_at = new Date(started.getTime() + (SUBSCRIPTION_PLANS.free_trial.trial_days || 3) * 24 * 60 * 60 * 1000).toISOString();
      }
      company.status = 'active';
      await persistCompany(company);
    }
  }
  await persistUser(user);

  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  await persistActivityLog(companyId, {
    id: Date.now(),
    sender: 'System',
    receiver: 'Workspace',
    kind: 'workspace.onboarded',
    body: `Workspace "${user.company_name || 'Acme'}" setup complete on ${user.selected_tier || 'Growth'} plan.`,
    created_at: new Date().toISOString()
  });

  res.json({ ok: true, redirect: '/command' });
});

app.get('/api/company', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const company = user.company_id ? await loadCompanyFromFirebase(companyId) || db.companies.get(companyId) : db.companies.get(companyId) || {
    id: companyId,
    name: user.company_name || 'Acme Operations',
    industry: 'Technology',
    team_size: '11-50',
    tier: user.selected_tier || 'free_trial',
    status: 'active',
    owner_uid: user.uid,
    created_at: new Date().toISOString()
  };
  res.json(company);
});

app.post('/api/company', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const company = db.companies.get(companyId) || {
    id: companyId,
    name: user.company_name || 'Acme Operations',
    tier: 'growth',
    status: 'active',
    owner_uid: user.uid,
    created_at: new Date().toISOString()
  };
  Object.assign(company, req.body);
  if (req.body.name) user.company_name = req.body.name;
  await persistUser(user);
  await persistCompany(company);
  res.json({ ok: true, company });
});

app.get('/api/employee-catalog', (_req, res) => {
  res.json(EMPLOYEE_CATALOG);
});

app.get('/api/employees', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const emps = db.orgEmployees.get(companyId) || db.orgEmployees.get(DEFAULT_COMPANY_ID) || [];
  res.json(emps);
});

app.post('/api/employees/configure', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const { employee_id, action } = req.body || {};

  let emps = db.orgEmployees.get(companyId) || [];
  if (action === 'add') {
    const companyForPlan = user.company_id ? await loadCompanyFromFirebase(user.company_id) : null;
    const plan = SUBSCRIPTION_PLANS[user.selected_tier || companyForPlan?.tier || 'free_trial'] || SUBSCRIPTION_PLANS.free_trial;
    if (emps.length >= plan.max_employees) {
      return res.status(402).json({ error: `${plan.name} allows up to ${plan.max_employees} AI employees. Upgrade to add more.`, upgrade_required: true });
    }
    const cat = EMPLOYEE_CATALOG.find((e) => e.id === employee_id);
    if (cat && !emps.some((e) => e.id === employee_id)) {
      emps.push({
        id: cat.id,
        employee_id: cat.id,
        name: cat.name,
        role: cat.role,
        department: cat.department,
        color: cat.color,
        status: 'active',
        tools: [...cat.default_tools],
        permissions: cat.default_tools.map((t) => ({ tool_name: t, access_level: t === 'Gmail' ? 'requires_approval' : 'read_write' }))
      });
    }
  } else if (action === 'remove') {
    emps = emps.filter((e) => e.id !== employee_id);
  }
  db.orgEmployees.set(companyId, emps);

  res.json({ ok: true, active_count: emps.length });
});

app.post('/api/employees/:id/tools', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const empId = req.params.id;
  const { tool_name, action, access_level } = req.body || {};

  const emps = db.orgEmployees.get(companyId) || db.orgEmployees.get(DEFAULT_COMPANY_ID) || [];
  const emp = emps.find((e) => e.id === empId);

  if (!emp) {
    return res.status(404).json({ error: 'Employee not found' });
  }

  if (action === 'remove') {
    emp.permissions = (emp.permissions || []).filter((p) => p.tool_name.toLowerCase() !== tool_name.toLowerCase());
    emp.tools = (emp.tools || []).filter((t) => t.toLowerCase() !== tool_name.toLowerCase());
  } else {
    emp.permissions = emp.permissions || [];
    const existing = emp.permissions.find((p) => p.tool_name.toLowerCase() === tool_name.toLowerCase());
    if (existing) {
      existing.access_level = access_level || 'read_write';
    } else {
      emp.permissions.push({ tool_name, access_level: access_level || 'read_write' });
      if (!emp.tools.includes(tool_name)) emp.tools.push(tool_name);
    }
  }

  res.json({ ok: true, permissions: emp.permissions });
});

app.get('/api/employees/:id/profile', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = getTenantIdOrFail(req, res);
  if (!user || !companyId) return;
  const employee = EMPLOYEE_CATALOG.find((entry) => entry.id === req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employee not found.' });
  const active = (db.orgEmployees.get(companyId) || []).find((entry) => entry.id === employee.id);
  const [connectors, memory] = await Promise.all([loadMcpConnections(companyId, employee.id), loadEmployeeMemory(companyId, employee.id)]);
  const teammates = (db.orgEmployees.get(companyId) || []).filter((entry) => entry.id !== employee.id).map((entry) => ({ id: entry.id, name: entry.name, role: entry.role, department: entry.department }));
  res.json({ employee, active_in_workspace: Boolean(active), instance: active || null, connectors: connectors.map(connectorPublicView), memory, teammates });
});

app.get('/api/employees/:id/memory', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = getTenantIdOrFail(req, res);
  if (!user || !companyId) return;
  const employee = EMPLOYEE_CATALOG.find((entry) => entry.id === req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employee not found.' });
  res.json({ memory: await loadEmployeeMemory(companyId, employee.id) });
});

app.post('/api/employees/:id/memory', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = getTenantIdOrFail(req, res);
  if (!user || !companyId) return;
  if (await enforceWorkspaceAccess(req, res)) return;
  const employee = EMPLOYEE_CATALOG.find((entry) => entry.id === req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employee not found.' });
  const content = String(req.body?.content || '').trim();
  const category = ['preference', 'playbook', 'handoff'].includes(req.body?.category) ? req.body.category : 'preference';
  if (!content || content.length > 1200) return res.status(400).json({ error: 'Memory must be between 1 and 1200 characters.' });
  const memory: EmployeeMemory = { id: `memory_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, company_id: companyId, employee_id: employee.id, category, content, created_at: new Date().toISOString() };
  await persistEmployeeMemory(memory);
  res.status(201).json({ memory });
});

app.delete('/api/employees/:id/memory/:memoryId', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = getTenantIdOrFail(req, res);
  if (!user || !companyId) return;
  if (await enforceWorkspaceAccess(req, res)) return;
  const employee = EMPLOYEE_CATALOG.find((entry) => entry.id === req.params.id);
  if (!employee) return res.status(404).json({ error: 'Employee not found.' });
  const memories = await loadEmployeeMemory(companyId, employee.id);
  if (!memories.some((entry) => entry.id === req.params.memoryId)) return res.status(404).json({ error: 'Memory note not found.' });
  await deleteEmployeeMemory(companyId, employee.id, req.params.memoryId);
  res.json({ ok: true });
});

app.get('/api/tasks/:id/group-chat', async (req, res) => {
  const companyId = getTenantIdOrFail(req, res);
  if (!companyId) return;
  await hydrateTenantTasks(companyId);
  const task = db.tasks.get(Number(req.params.id));
  if (!task || task.company_id !== companyId) return res.status(404).json({ error: 'Task room not found.' });
  res.json({ task_id: task.id, question: task.question, owner: task.owner, participants: task.participants || ['Manager', task.owner], messages: task.trace.filter((step) => !['rag_retrieval', 'verified'].includes(step.kind)) });
});


app.get('/api/workforce/workroom', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = getTenantIdOrFail(req, res);
  if (!user || !companyId) return;
  await hydrateTenantTasks(companyId);
  const tasks = Array.from(db.tasks.values()).filter((task) => task.company_id === companyId).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 30).map(workroomSnapshot);
  res.json({ company: { id: companyId, name: user.company_name || 'Your company' }, employees: activeWorkforce(companyId), presence: companyPresence(companyId), tasks, worker: { enabled: ALWAYS_ON_WORKER_ENABLED, instance: WORKER_INSTANCE_ID, poll_ms: WORKER_POLL_MS }, research: { enabled: WEB_RESEARCH_ENABLED && Boolean(TAVILY_API_KEY || BRAVE_SEARCH_API_KEY) } });
});

app.post('/api/workforce/workroom', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = getTenantIdOrFail(req, res);
  if (!user || !companyId) return;
  if (await enforceWorkspaceAccess(req, res)) return;
  const message = String(req.body?.message || '').trim().slice(0, 6000);
  if (!message) return res.status(400).json({ error: 'A company workroom message is required.' });
  const result = await enqueueWorkforceTask(companyId, message, typeof req.body?.preferred_employee_id === 'string' ? req.body.preferred_employee_id : undefined);
  res.status(202).json(result);
});

app.get('/api/workforce/stream', (req, res) => {
  const companyId = getTenantIdOrFail(req, res);
  if (!companyId) return;
  const requestedTaskId = Number(req.query.task_id);
  const taskId = Number.isFinite(requestedTaskId) && requestedTaskId > 0 ? requestedTaskId : undefined;
  const key = workroomStreamKey(companyId, taskId);
  res.status(200).set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  const streams = workroomStreams.get(key) || new Set<express.Response>();
  streams.add(res); workroomStreams.set(key, streams);
  res.write(`event: connected\ndata: ${JSON.stringify({ company_id: companyId, task_id: taskId || null })}\n\n`);
  const heartbeat = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch (_error) { clearInterval(heartbeat); } }, 15000);
  req.on('close', () => { clearInterval(heartbeat); streams.delete(res); if (!streams.size) workroomStreams.delete(key); });
});

app.get('/api/employees/:id/conversation', (req, res) => {
  const companyId = getTenantIdOrFail(req, res);
  if (!companyId) return;
  const empId = req.params.id;
  const key = `${companyId}:${empId}`;

  const empCatalog = EMPLOYEE_CATALOG.find((e) => e.id === empId);
  const empName = empCatalog?.name || empId.toUpperCase();

  const msgs = db.conversations.get(key) || [
    {
      sender: empId,
      receiver: 'manager',
      body: `Hello! I'm ${empName}. How can I assist with operations, data analysis, or task coordination today?`,
      created_at: new Date().toISOString()
    }
  ];

  res.json({ messages: msgs });
});

app.post('/api/employees/:id/conversation', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const empId = req.params.id;
  const { message } = req.body || {};
  const key = `${companyId}:${empId}`;

  const msgs = db.conversations.get(key) || [];
  const userMsg = { sender: 'manager', receiver: empId, body: message, created_at: new Date().toISOString() };
  msgs.push(userMsg);

  const empCatalog = EMPLOYEE_CATALOG.find((e) => e.id === empId) || EMPLOYEE_CATALOG[0];
  const empName = empCatalog.name;

  let botAnswer = '';
  if (genAIClient) {
    try {
      const response = await genAIClient.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: `${empCatalog.system_prompt}
Role: ${empCatalog.role} (${empCatalog.employee_code || empId.toUpperCase()})
Department: ${empCatalog.department}
Autonomy Level: ${empCatalog.autonomy_level || 'Level 3'}
Attached Tools: ${empCatalog.default_tools.join(', ')}
Active teammate context: ${(db.orgEmployees.get(companyId) || []).filter((entry) => entry.id !== empId).map((entry) => `${entry.name} (${entry.role})`).join(', ') || 'No other activated teammates'}
Collaboration rule: keep the manager accountable, mention a specialist handoff only when it is useful, and never claim an external tool action occurred without an approval-backed trace.

User Manager Message: "${message}"

Respond as ${empName} directly to your manager in a helpful, concise, professional tone.`
      });
      botAnswer = response.text || '';
    } catch (err) {
      console.warn('Gemini conversation response note:', err);
    }
  }

  if (!botAnswer) {
    botAnswer = `Understood! I'm ${empName} (${empCatalog.role}). I have processed your instruction: "${message}". I will coordinate with workspace tools (${empCatalog.default_tools.join(', ')}) and log the handoff.`;
  }

  const botMsg = { sender: empId, receiver: 'manager', body: botAnswer, created_at: new Date().toISOString() };
  msgs.push(botMsg);
  db.conversations.set(key, msgs);

  // Activity log
  await persistActivityLog(companyId, {
    id: Date.now(),
    sender: user.display_name || 'Manager',
    receiver: empName,
    kind: 'direct.message',
    body: message,
    created_at: new Date().toISOString()
  });

  res.json({ ok: true, employee_message: botMsg, messages: msgs });
});

function activeWorkforce(companyId: string) {
  const activeIds = (db.orgEmployees.get(companyId) || []).map((employee) => employee.id);
  const workforce = activeIds.length ? EMPLOYEE_CATALOG.filter((employee) => activeIds.includes(employee.id)) : EMPLOYEE_CATALOG;
  return workforce.length ? workforce : EMPLOYEE_CATALOG;
}

const WORKFORCE_DOMAINS: Array<{ employeeId: string; keywords: string[] }> = [
  { employeeId: 'david', keywords: ['data', 'sql', 'revenue', 'forecast', 'kpi', 'margin', 'metric', 'dashboard', 'trend', 'analytics'] },
  { employeeId: 'priya', keywords: ['invoice', 'expense', 'budget', 'cash flow', 'payable', 'receivable', 'reconciliation', 'billing'] },
  { employeeId: 'olivia', keywords: ['lead', 'pipeline', 'deal', 'prospect', 'crm', 'sales', 'follow-up', 'renewal'] },
  { employeeId: 'emma', keywords: ['support', 'customer', 'ticket', 'onboarding client', 'account health', 'complaint'] },
  { employeeId: 'maya', keywords: ['marketing', 'campaign', 'content', 'audience', 'brand', 'advertising', 'growth'] },
  { employeeId: 'mike', keywords: ['code', 'repo', 'github', 'ci', 'technical', 'engineering', 'bug', 'incident', 'release'] },
  { employeeId: 'iris', keywords: ['security', 'access', 'identity', 'compliance', 'it ', 'device', 'vulnerability', 'risk review'] },
  { employeeId: 'sarah', keywords: ['hire', 'recruit', 'candidate', 'interview', 'job description', 'talent', 'staffing'] },
  { employeeId: 'arav', keywords: ['people ops', 'offboarding', 'policy acknowledgement', 'engagement', 'leave', 'handbook', 'employee experience'] },
  { employeeId: 'alex', keywords: ['route', 'workflow', 'sla', 'operations', 'vendor', 'project', 'process', 'coordinate'] }
];

function selectCollaborativeTeam(question: string, companyId: string, preferredEmployeeId?: string) {
  const workforce = activeWorkforce(companyId);
  const lower = question.toLowerCase();
  const scored = WORKFORCE_DOMAINS.map((domain) => ({ ...domain, score: domain.keywords.reduce((total, keyword) => total + (lower.includes(keyword) ? 1 : 0), 0) }))
    .filter((domain) => workforce.some((employee) => employee.id === domain.employeeId));
  const winner = scored.sort((a, b) => b.score - a.score)[0];
  // Sarah is the manager of the Caveworkers organization. She is accountable for
  // intake, delegation, approval visibility, and the user-facing final response.
  const manager = workforce.find((employee) => employee.id === 'sarah') || EMPLOYEE_CATALOG.find((employee) => employee.id === 'sarah') || workforce[0];
  const preferredLead = workforce.find((employee) => employee.id === preferredEmployeeId);
  const lead = preferredEmployeeId === '__whole_team__'
    ? (workforce.find((employee) => employee.id === (winner?.score ? winner.employeeId : 'alex')) || workforce.find((employee) => employee.id !== manager.id) || manager)
    : (preferredLead || workforce.find((employee) => employee.id === (winner?.score ? winner.employeeId : 'alex')) || manager);
  if (preferredEmployeeId === '__whole_team__') {
    return { manager, lead, collaborators: workforce.filter((employee) => employee.id !== lead.id && employee.id !== manager.id), workforce };
  }
  const leadPeers = (lead.collaborates_with || []).map((id: string) => workforce.find((employee) => employee.id === id)).filter(Boolean) as any[];
  const explicitMatches = scored.filter((domain) => domain.score > 0 && domain.employeeId !== lead.id && domain.employeeId !== manager.id).map((domain) => workforce.find((employee) => employee.id === domain.employeeId)).filter(Boolean) as any[];
  const collaborators: any[] = [];
  for (const employee of [...explicitMatches, ...leadPeers]) {
    if (employee.id !== lead.id && employee.id !== manager.id && !collaborators.some((entry) => entry.id === employee.id) && collaborators.length < 3) collaborators.push(employee);
  }
  return { manager, lead, collaborators, workforce };
}

interface WorkforceTaskContext { employee: any; tools: string[]; memory: string[]; connectors: string[]; live_tool_evidence: WorkforceLiveToolEvidence[]; }

async function loadWorkforceTaskContext(companyId: string, employee: any): Promise<WorkforceTaskContext> {
  const instance = (db.orgEmployees.get(companyId) || []).find((entry) => entry.id === employee.id);
  const [memory, connectors] = await Promise.all([loadEmployeeMemory(companyId, employee.id), loadMcpConnections(companyId, employee.id)]);
  const tools = instance?.tools?.length ? instance.tools : employee.default_tools || [];
  return { employee, tools: tools.slice(0, 8), memory: memory.slice(0, 4).map((entry) => entry.content), connectors: connectors.filter((connector) => connector.status === 'connected').slice(0, 5).map((connector) => connector.name), live_tool_evidence: [] };
}

function collaborationFinding(employee: any, question: string, context?: WorkforceTaskContext) {
  const topic = question.length > 110 ? `${question.slice(0, 110)}…` : question;
  const toolNote = context?.tools?.length ? ` Available permissioned tools: ${context.tools.join(', ')}.` : '';
  const connectorNote = context?.connectors?.length ? ` Connected tenant tools considered: ${context.connectors.join(', ')}.` : '';
  const memoryNote = context?.memory?.length ? ` Applied role memory: ${context.memory[0].slice(0, 180)}.` : '';
  const evidenceNote = context?.live_tool_evidence?.length ? ` Live MCP evidence: ${context.live_tool_evidence.map((entry) => `${entry.tool_name} (${entry.status}) — ${entry.summary.slice(0, 260)}`).join(' | ')}` : '';
  return `${employee.name} reviewed the ${employee.department.toLowerCase()} implications of “${topic}” and returned a permissioned recommendation for the lead’s decision brief.${toolNote}${connectorNote}${memoryNote}${evidenceNote}`;
}

async function handleTaskRoutingAsync(question: string, companyId: string, preferredEmployeeId?: string, existingTaskId?: number) {
  await hydrateTenantTasks(companyId);
  const taskId = existingTaskId || db.nextTaskId++;
  const existingTask = existingTaskId ? db.tasks.get(existingTaskId) : undefined;
  const now = new Date().toISOString();
  const { manager, lead, collaborators, workforce } = selectCollaborativeTeam(question || 'Operations review', companyId, preferredEmployeeId);
  const lowerQ = (question || '').toLowerCase();
  const executionTeam = [lead, ...collaborators].filter((employee, index, list) => list.findIndex((entry) => entry.id === employee.id) === index);
  const specialistContexts = await Promise.all(executionTeam.map((employee) => loadWorkforceTaskContext(companyId, employee)));
  await Promise.all(specialistContexts.map(async (context) => {
    context.live_tool_evidence = await executeEmployeeReadTools(companyId, context.employee, question);
  }));
  const contextByEmployeeId = new Map(specialistContexts.map((context) => [context.employee.id, context]));
  const knowList = db.knowledge.get(companyId) || [];
  const webResearch = await performWebResearch(question);
  const relevantDocs = knowList.filter((document) => lowerQ.includes(document.title.toLowerCase()) || document.content.toLowerCase().split(' ').some((word) => word.length > 4 && lowerQ.includes(word)));
  const knowText = relevantDocs.length ? relevantDocs.map((document) => `[${document.title}] ${document.content}`).join('\n').slice(0, 2400) : 'No matching workspace knowledge was found.';
  const webText = webResearch.length ? webResearch.map((source) => `[${source.title}] ${source.url}\n${source.snippet}\n${source.content_preview || ''}`).join('\n\n').slice(0, 4200) : 'No web research provider is enabled or no public sources matched.';
  const trace: any[] = [
    { kind: 'received', sender: 'Manager', receiver: 'Sarah', body: `New task: “${question}”`, created_at: now },
    { kind: 'team_context', sender: 'Sarah', receiver: lead.name, body: `I own this request. ${lead.name} is the delivery lead${collaborators.length ? `, supported by ${collaborators.map((employee) => employee.name).join(', ')}` : ''}. I will report the result and any approval or connector blocker back to you.`, created_at: new Date(Date.now() + 250).toISOString() },
    { kind: 'knowledge', sender: 'Workspace knowledge', receiver: lead.name, body: relevantDocs.length ? `Shared ${relevantDocs.length} relevant workspace reference${relevantDocs.length === 1 ? '' : 's'} with the team.` : 'No matching reference was found; the team will state assumptions clearly.', created_at: new Date(Date.now() + 500).toISOString() },
    ...(webResearch.length ? [{ kind: 'web_research', sender: 'Caveworkers research desk', receiver: 'Company workroom', body: `Collected ${webResearch.length} public source${webResearch.length === 1 ? '' : 's'} for the team. Sources remain linked in the task evidence panel.`, created_at: new Date(Date.now() + 650).toISOString() }] : [])
  ];
  collaborators.forEach((employee, index) => {
    trace.push({ kind: 'group_message', sender: 'Sarah', receiver: employee.name, body: `@${employee.name}, work with ${lead.name} on the ${employee.department.toLowerCase()} portion of this request. Return usable findings, constraints, evidence needed, and a safe next step.`, created_at: new Date(Date.now() + 900 + index * 600).toISOString() });
    trace.push({ kind: 'group_message', sender: employee.name, receiver: 'Sarah', body: collaborationFinding(employee, question, contextByEmployeeId.get(employee.id)), created_at: new Date(Date.now() + 1200 + index * 600).toISOString() });
  });
  specialistContexts.flatMap((context) => context.live_tool_evidence).forEach((evidence, index) => {
    trace.push({ kind: 'tool_execution', sender: evidence.employee_name, receiver: 'Caveworkers group', body: `${evidence.status === 'executed' ? 'Read tool executed' : 'Read tool failed'}: ${evidence.connector_name} / ${evidence.tool_name}. ${evidence.summary.slice(0, 500)}`, created_at: new Date(Date.now() + 650 + index * 120).toISOString() });
  });
  const teamBrief = `Public research evidence:\n${webText}\n\n` + specialistContexts.map((context) => `${context.employee.name}: ${context.employee.role} — ${context.employee.persona}\nGranted tools: ${context.tools.join(', ') || 'none'}\nConnected tenant tools: ${context.connectors.join(', ') || 'none'}\nRole memory: ${context.memory.join(' | ') || 'none'}\nLive MCP evidence: ${context.live_tool_evidence.map((entry) => `${entry.tool_name} [${entry.status}] ${entry.summary.slice(0, 900)}`).join(' | ') || 'none'}`).join('\n\n');
  const deliveryTeam = [lead, ...collaborators].filter((employee, index, list) => list.findIndex((entry) => entry.id === employee.id) === index);
  const narrative = await generateWorkforceNarrative(`Manager: ${manager.name} (${manager.role})\nDelivery lead: ${lead.name} (${lead.role})\nTask: "${question}"\n\nActive specialist evidence:\n${teamBrief}\n\nWorkspace knowledge:\n${knowText}\n\nWrite the direct final response to the manager. Start with the requested answer or a precise blocker. Then give a short "Work completed" list and a clear "Next action". Name the delivery lead and contributors. Do not claim that an email, write, payment, publication, access change, or other external action happened unless the execution evidence explicitly confirms it.`, companyId);
  let answer = narrative.text;
  if (!answer) {
    answer = `### Sarah’s manager update (Task #${taskId})\n\n**Your request:** ${question}\n\n**Delivery lead:** ${lead.name} — ${lead.role}\n\n**Work completed**\n${deliveryTeam.map((employee) => `- **${employee.name}:** ${employee.id === lead.id ? `assessed the primary ${employee.department.toLowerCase()} workstream and prepared the delivery response.` : collaborationFinding(employee, question, contextByEmployeeId.get(employee.id))}`).join('\n')}\n\n**Current result**\nThe request has been routed and recorded, but a production model response is unavailable for this task. I have not represented a simulated draft as completed work.\n\n**Next action**\nConfigure a valid OpenRouter or Gemini production model key, then rerun this task. Any external action will remain approval-gated and will report a verifiable outcome.`;
  }
  const isEmailAction = ['email', 'send email', 'gmail', 'mail '].some((term) => lowerQ.includes(term));
  const requiresApproval = isEmailAction || ['send', 'commit', 'hire', 'publish', 'recruit', 'payment', 'invoice', 'access', 'delete', 'post', 'write'].some((term) => lowerQ.includes(term));
  let execution: TaskRecord['execution'] = { action_type: isEmailAction ? 'gmail.send' : requiresApproval ? 'external.action' : 'none', status: 'not_required', summary: 'No external action was requested.', updated_at: new Date().toISOString() };
  if (requiresApproval) {
    const emailAction = isEmailAction ? await prepareSarahEmailAction(companyId, question, taskId) : null;
    execution = emailAction ? { action_type: 'gmail.send', status: emailAction.status, summary: emailAction.summary, updated_at: new Date().toISOString() } : { action_type: 'external.action', status: 'awaiting_approval', summary: 'The requested external action is prepared and awaiting your approval. No external action has been performed.', updated_at: new Date().toISOString() };
    const approvalId = db.nextApprovalId++;
    await persistApprovalRecord({ id: approvalId, company_id: companyId, task_id: taskId, employee_id: manager.id, tool_name: isEmailAction ? 'Gmail send' : lowerQ.includes('commit') ? 'Git Repository' : lowerQ.includes('access') ? 'Identity / ITSM' : 'External action', action_summary: emailAction?.summary || `${manager.name} requests manager sign-off for: "${question}"`, status: emailAction?.status === 'blocked' ? 'rejected' : 'pending', created_at: new Date().toISOString(), payload: { origin: 'workforce', action_type: isEmailAction ? 'gmail.send' : 'external.action', manager_id: manager.id, delivery_lead_id: lead.id, collaborators: collaborators.map((employee) => employee.id), ...(emailAction?.payload || {}) } });
    trace.push({ kind: emailAction?.status === 'blocked' ? 'blocked' : 'approval_required', sender: manager.name, receiver: 'Manager approval queue', body: emailAction?.summary || 'A consequential action was drafted and paused. No external tool has been called.', created_at: new Date(Date.now() + 3100).toISOString() });
  }
  trace.push({ kind: 'group_message', sender: manager.name, receiver: 'Manager', body: `I reviewed ${lead.name}’s delivery. ${execution.summary}`, created_at: new Date(Date.now() + 3400).toISOString() });
  trace.push({ kind: 'completed', sender: manager.name, receiver: 'Task ledger', body: requiresApproval ? `Work product completed; execution state: ${execution.status}.` : 'Work product completed with a tenant-scoped audit trace.', created_at: new Date(Date.now() + 3600).toISOString() });
  const liveToolEvidence = specialistContexts.flatMap((context) => context.live_tool_evidence);
  const taskRecord: TaskRecord = { id: taskId, company_id: companyId, question, owner: manager.id, status: execution.status === 'awaiting_approval' ? 'pending_approval' : execution.status === 'blocked' ? 'blocked' : 'completed', answer, plan: `1. Sarah intake → 2. Delegate ${lead.name} → 3. Specialist delivery${collaborators.length ? ` (${collaborators.map((employee) => employee.name).join(', ')})` : ''} → 4. Permissioned evidence → 5. Sarah manager response → 6. Approval-gated external execution when requested`, created_at: now, trace, participants: ['Manager', manager.name, ...deliveryTeam.map((employee) => employee.name).filter((name, index, list) => list.indexOf(name) === index)], collaboration_summary: `${manager.name} managed ${lead.name}${collaborators.length ? ` with ${collaborators.length} supporting specialist${collaborators.length === 1 ? '' : 's'}` : ''}.`, live_tool_evidence: liveToolEvidence, web_research: webResearch, queued_at: existingTask?.queued_at, started_at: existingTask?.started_at || now, completed_at: new Date().toISOString(), execution };
  db.tasks.set(taskId, taskRecord);
  await persistTaskRecord(taskRecord);
  await persistActivityLog(companyId, { id: Date.now(), sender: manager.name, receiver: lead.name, kind: 'task.managed', body: `Task #${taskId} was managed by Sarah with execution state ${execution.status}.`, created_at: now });
  return { id: taskId, company_id: companyId, question, status: taskRecord.status, owner: manager.id, participants: taskRecord.participants, plan: taskRecord.plan, answer, execution, trace, live_tool_evidence: liveToolEvidence, web_research: webResearch, collaboration_summary: taskRecord.collaboration_summary, workforce_size: workforce.length };
}

// This is deliberately absent outside the test runtime. It lets regression tests
// exercise the actual worker completion path without creating an HTTP backdoor.
export const workforceTestHooks = process.env.NODE_ENV === 'test'
  ? { handleTaskRoutingAsync, selectCollaborativeTeam }
  : undefined;

app.post('/api/task', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  if (!ALWAYS_ON_WORKER_ENABLED && process.env.NODE_ENV !== 'test') return res.status(503).json({ error: 'The workforce worker is disabled. Enable ALWAYS_ON_WORKER_ENABLED before assigning tasks.', code: 'worker_disabled', retryable: false });
  const { request: question, preferred_employee_id: preferredEmployeeId } = req.body || {};
  const normalizedQuestion = String(question || 'Operations review').trim().slice(0, 6000);
  if (!normalizedQuestion) return res.status(400).json({ error: 'A task request is required.' });
  const result = await enqueueWorkforceTask(companyId, normalizedQuestion, typeof preferredEmployeeId === 'string' ? preferredEmployeeId : undefined);
  res.status(202).json(result);
});

app.post('/api/tasks', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  if (!ALWAYS_ON_WORKER_ENABLED && process.env.NODE_ENV !== 'test') return res.status(503).json({ error: 'The workforce worker is disabled. Enable ALWAYS_ON_WORKER_ENABLED before assigning tasks.', code: 'worker_disabled', retryable: false });
  const { request: question, preferred_employee_id: preferredEmployeeId } = req.body || {};
  const normalizedQuestion = String(question || 'Operations review').trim().slice(0, 6000);
  if (!normalizedQuestion) return res.status(400).json({ error: 'A task request is required.' });
  const result = await enqueueWorkforceTask(companyId, normalizedQuestion, typeof preferredEmployeeId === 'string' ? preferredEmployeeId : undefined);
  res.status(202).json(result);
});

app.get('/api/tasks', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  await hydrateTenantTasks(companyId);
  const taskList = Array.from(db.tasks.values()).filter((task) => task.company_id === companyId).reverse().map((t: any) => {
    const ownerEmp = EMPLOYEE_CATALOG.find((e) => e.id === t.owner) || {
      id: t.owner,
      name: t.owner.toUpperCase(),
      role: 'AI Specialist',
      employee_code: `CW_${t.owner.toUpperCase()}`,
      color: '#3b82f6'
    };
    const pendingApproval = Array.from(db.approvals.values()).find((a) => a.company_id === companyId && a.task_id === t.id && a.status === 'pending');
    return {
      ...t,
      owner_info: ownerEmp,
      status: pendingApproval ? 'pending_approval' : t.status || 'completed',
      has_pending_approval: !!pendingApproval,
      approval_id: pendingApproval?.id
    };
  });
  res.json({
    total_count: taskList.length,
    completed_count: taskList.filter((t) => t.status === 'completed').length,
    pending_approval_count: taskList.filter((t) => t.status === 'pending_approval').length,
    tasks: taskList
  });
});

app.get('/api/approvals', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const analystApprovals = await loadAnalystApprovals(companyId);
  const approvals = [...Array.from(db.approvals.values()), ...analystApprovals].filter((approval, index, list) => list.findIndex((entry) => entry.id === approval.id && entry.company_id === approval.company_id) === index);
  res.json(approvals.filter((approval) => approval.company_id === companyId && approval.status === 'pending'));
});

app.post('/api/approvals/:id', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user?.company_id || DEFAULT_COMPANY_ID;
  const id = parseInt(req.params.id, 10);
  const requestedStatus = req.body?.status;
  if (requestedStatus !== 'approved' && requestedStatus !== 'rejected') return res.status(400).json({ error: 'Choose approved or rejected.' });
  await loadAnalystApprovals(companyId);
  const approval = db.approvals.get(id);
  if (!approval || approval.company_id !== companyId) return res.status(404).json({ error: 'Approval request not found' });
  if (approval.status !== 'pending') return res.status(409).json({ error: 'This approval has already been decided.', approval });
  approval.status = requestedStatus;
  approval.decided_at = new Date().toISOString();

  if (approval.payload?.origin === 'analyst') {
    await persistAnalystApproval(approval);
    await persistActivityLog(companyId, { id: Date.now(), sender: 'Manager', receiver: 'David', kind: approval.status === 'approved' ? 'analyst.action_authorized' : 'analyst.action_declined', body: approval.status === 'approved' ? `Approved analyst draft for ${approval.tool_name}. No external dispatch occurs until that connector is configured.` : `Declined analyst draft for ${approval.tool_name}.`, created_at: new Date().toISOString() });
    return res.json({ ok: true, approval, execution: { status: approval.status === 'approved' ? 'authorized' : 'cancelled' } });
  }

  if (approval.payload?.origin === 'workforce') {
    if (approval.status === 'rejected') {
      approval.payload = { ...(approval.payload || {}), execution_status: 'cancelled' };
      await persistApprovalRecord(approval);
      const summary = 'You declined this external action. Sarah kept the work product and did not perform any external change.';
      await recordWorkforceApprovalOutcome(approval, 'cancelled', summary);
      return res.json({ ok: true, approval, execution: { status: 'cancelled', summary } });
    }
    if (approval.payload?.action_type === 'gmail.send') {
      try {
        const result = await dispatchApprovedSarahEmail(approval);
        const summary = result?.message_id ? `Sarah sent the approved email to ${result.recipients}. Gmail message ID: ${result.message_id}.` : 'Sarah could not confirm an email delivery result.';
        await persistApprovalRecord(approval);
        await recordWorkforceApprovalOutcome(approval, result?.message_id ? 'succeeded' : 'failed', summary, result || undefined);
        return res.json({ ok: true, approval, execution: { status: result?.message_id ? 'succeeded' : 'failed', summary, result } });
      } catch (error: any) {
        approval.payload = { ...(approval.payload || {}), execution_status: 'failed', execution_error: String(error?.message || 'Gmail dispatch failed.').slice(0, 500) };
        await persistApprovalRecord(approval);
        const summary = `Sarah could not send the approved email. ${String(error?.message || 'Gmail dispatch failed.').slice(0, 500)} No delivery has been confirmed.`;
        reportOperationalFailure('workforce.gmail_dispatch', error, { tenant_hash: anonymizeIdentifier(companyId), approval_id: approval.id, task_id: approval.task_id });
        await recordWorkforceApprovalOutcome(approval, 'failed', summary);
        return res.status(502).json({ error: summary, approval, execution: { status: 'failed', summary } });
      }
    }
    approval.payload = { ...(approval.payload || {}), execution_status: 'blocked' };
    await persistApprovalRecord(approval);
    const summary = `You approved ${approval.tool_name}, but Caveworkers has no configured execution adapter for this action. Sarah did not perform an external change.`;
    await recordWorkforceApprovalOutcome(approval, 'blocked', summary);
    return res.status(409).json({ error: summary, approval, execution: { status: 'blocked', summary } });
  }

  await persistApprovalRecord(approval);
  res.json({ ok: true, approval });
});

// ── DATA ANALYST (DAVID) ───────────────────────────────────
app.get('/api/analyst/profile', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const analyst = EMPLOYEE_CATALOG.find((employee) => employee.id === 'david');
  const employee = (db.orgEmployees.get(companyId) || []).find((entry) => entry.id === 'david');
  const sources = await loadAnalystDataSources(companyId);
  const memory = await loadAnalystMemory(companyId, 'long_term');
  const connectors = await loadMcpConnections(companyId, 'david');
  res.json({ employee: analyst, active_in_workspace: Boolean(employee), configured_tools: employee?.tools || analyst?.default_tools || [], connectors: connectors.map(connectorPublicView), model: { provider: OPENROUTER_KEY_READY ? 'OpenRouter' : (genAIClient ? 'Gemini fallback' : 'Preview planner'), name: OPENROUTER_KEY_READY ? ANALYST_MODEL : 'Configure OPENROUTER_API_KEY for Qwen3' }, source_count: sources.length, memory_count: memory.length, safety: { read_only_by_default: true, external_actions_require_approval: true, tenant_scoped: true } });
});

app.get('/api/analyst/data-sources', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  res.json({ sources: await loadAnalystDataSources(companyId) });
});

app.post('/api/analyst/data-sources', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user?.company_id || DEFAULT_COMPANY_ID;
  const { kind, name, csv_text, sheet_url, database_label } = req.body || {};
  if (!['sql', 'google_sheets', 'csv'].includes(kind)) return res.status(400).json({ error: 'Data source type must be SQL, Google Sheets, or CSV.' });
  if (kind === 'csv' && (!csv_text || typeof csv_text !== 'string')) return res.status(400).json({ error: 'Choose a CSV file before importing it.' });
  if (kind !== 'csv' && !String(name || database_label || sheet_url || '').trim()) return res.status(400).json({ error: 'A source name is required.' });
  if (typeof csv_text === 'string' && csv_text.length > 300000) return res.status(413).json({ error: 'CSV import is limited to 300 KB in this workspace preview.' });
  let metadata: Record<string, any> = {}; let status: AnalystDataSource['status'] = 'needs_configuration'; let sourceName = String(name || database_label || sheet_url || '').trim();
  if (kind === 'csv') { try { metadata = parseCsvPreview(csv_text); status = 'connected'; sourceName = sourceName || 'Imported CSV'; } catch (error: any) { return res.status(400).json({ error: error.message || 'Unable to read this CSV.' }); } }
  else if (kind === 'google_sheets') {
    const connections = await loadMcpConnections(companyId, 'david');
    const sheetsConnection = connections.find((entry) => entry.connection_type === 'google_sheets' && entry.status === 'connected' && entry.tool_grants.some((grant) => grant.tool_name === 'sheets.read'));
    if (!sheetsConnection) return res.status(409).json({ error: 'Connect a Google Sheets account for David before registering a live Sheets source.' });
    metadata = { sheet_url: String(sheet_url || '').trim(), connection_id: sheetsConnection.id };
    status = 'connected';
  } else metadata = { database_label: String(database_label || name || '').trim() };
  const now = new Date().toISOString();
  const sourceRecord: AnalystDataSource = { id: `source_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, company_id: companyId, kind, name: sourceName, status, access_level: 'read_only', metadata, created_at: now, updated_at: now };
  await persistAnalystDataSource(sourceRecord);
  res.status(201).json({ ok: true, source: sourceRecord, notice: status === 'connected' ? (kind === 'google_sheets' ? 'Google Sheets is connected read-only and can be queried by David.' : 'CSV imported as a tenant-scoped read-only source.') : 'Connection shell saved. Add secure OAuth or read-only database credentials before live data can be queried.' });
});

app.delete('/api/analyst/data-sources/:id', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user?.company_id || DEFAULT_COMPANY_ID;
  const sources = await loadAnalystDataSources(companyId); const sourceId = req.params.id;
  if (!sources.some((entry) => entry.id === sourceId)) return res.status(404).json({ error: 'Data source not found.' });
  db.analystDataSources.set(companyId, sources.filter((entry) => entry.id !== sourceId));
  const collection = analystTenantCollection(companyId, 'data_sources'); if (collection) await collection.doc(sourceId).delete();
  res.json({ ok: true });
});

app.get('/api/analyst/memory', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const type = req.query.type === 'working' || req.query.type === 'long_term' ? req.query.type as AnalystMemory['memory_type'] : undefined;
  const memory = await loadAnalystMemory(companyId, type);
  res.json({ memory: memory.filter((entry) => !entry.expires_at || Date.parse(entry.expires_at) > Date.now()).slice(0, 40) });
});

app.post('/api/analyst/memory', async (req, res) => {
  const user = getAuthUser(req); if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user?.company_id || DEFAULT_COMPANY_ID; const { content, category } = req.body || {};
  if (!String(content || '').trim()) return res.status(400).json({ error: 'A memory note is required.' });
  if (String(content).length > 800) return res.status(400).json({ error: 'Keep a memory note under 800 characters.' });
  const allowed = ['preference', 'business_rule', 'metric_definition'];
  const memory: AnalystMemory = { id: `memory_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`, company_id: companyId, memory_type: 'long_term', category: allowed.includes(category) ? category : 'preference', content: String(content).trim(), confidence: 0.9, created_at: new Date().toISOString() };
  await persistAnalystMemory(memory); res.status(201).json({ ok: true, memory });
});

app.delete('/api/analyst/memory/:id', async (req, res) => {
  const user = getAuthUser(req); if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user?.company_id || DEFAULT_COMPANY_ID; const memoryId = req.params.id; const memory = await loadAnalystMemory(companyId);
  if (!memory.some((entry) => entry.id === memoryId && entry.memory_type === 'long_term')) return res.status(404).json({ error: 'Memory not found.' });
  db.analystMemory.set(companyId, memory.filter((entry) => entry.id !== memoryId));
  const collection = analystTenantCollection(companyId, 'long_term_memory'); if (collection) await collection.doc(memoryId).delete();
  res.json({ ok: true });
});

app.get('/api/analyst/runs', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const companyId = user.company_id || DEFAULT_COMPANY_ID; const cached = db.analystRuns.get(companyId);
  if (cached) return res.json({ runs: cached.slice(0, 12) });
  const collection = analystTenantCollection(companyId, 'analyst_runs'); if (!collection) return res.json({ runs: [] });
  try { const snapshot = await collection.orderBy('created_at', 'desc').limit(12).get(); const runs = snapshot.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) } as AnalystRun)); db.analystRuns.set(companyId, runs); res.json({ runs }); } catch (error) { console.warn('Could not load analyst runs:', error); res.json({ runs: [] }); }
});

app.get('/api/analyst/approvals', async (req, res) => {
  const user = getAuthUser(req); if (!user) return res.status(401).json({ error: 'Authentication required' });
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const approvals = await loadAnalystApprovals(companyId);
  res.json({ approvals: approvals.filter((approval) => approval.status === 'pending') });
});

app.post('/api/analyst/analyze', async (req, res) => {
  const user = getAuthUser(req); if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user?.company_id || DEFAULT_COMPANY_ID;
  try { const run = await runAnalystLoop({ companyId, managerName: user?.display_name || 'Workspace Manager', question: req.body?.question, sourceId: req.body?.source_id, outputFormat: req.body?.output_format }); res.status(201).json({ ok: true, run }); }
  catch (error: any) { res.status(400).json({ error: error?.message || 'David could not start the analysis.' }); }
});

app.get('/api/tools', (_req, res) => {
  res.json({
    'SQL workspace': 'Direct read-only or permissioned SQL queries on workspace database.',
    Gmail: 'Send & review business emails with explicit recipient authorization.',
    Notion: 'Manage documentation, roadmaps, and internal wikis.',
    Slack: 'Post internal updates and alert team channels.'
  });
});

app.get('/api/mcp-connectors', (_req, res) => {
  res.json([
    { id: 'sql_workspace', name: 'SQL Workspace', description: 'Query workspace relational databases', server: 'mcp://caveworkers/sql-workspace', default_access_level: 'read_only' },
    { id: 'gmail', name: 'Gmail Connector', description: 'Read/Write business emails via Google API', server: 'mcp://caveworkers/gmail', default_access_level: 'requires_approval' },
    { id: 'notion', name: 'Notion Workspace', description: 'Sync internal knowledge and docs', server: 'mcp://caveworkers/notion', default_access_level: 'read_write' },
    { id: 'slack', name: 'Slack Bot', description: 'Send channel alerts and operational notifications', server: 'mcp://caveworkers/slack', default_access_level: 'requires_approval' }
  ]);
});

app.get('/api/mcp/marketplace', (_req, res) => {
  res.json({
    servers: [
      { id: 'postgres', name: 'PostgreSQL Server', description: 'Direct SQL query engine', category: 'Database', icon: '🐘' },
      { id: 'github', name: 'GitHub Integration', description: 'Repo & PR management', category: 'Developer Tools', icon: '🐙' },
      { id: 'context7', name: 'Context7 Docs', description: 'Read-only documentation search', category: 'Knowledge', icon: '📚' }
    ]
  });
});

app.get('/api/employees/:id/mcp-connections', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const list = await loadMcpConnections(companyId, req.params.id);
  res.json(list.map(connectorPublicView));
});

app.post('/api/employees/:id/mcp-connections', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user?.company_id || DEFAULT_COMPANY_ID;
  const empId = req.params.id;
  const employee = EMPLOYEE_CATALOG.find((entry) => entry.id === empId);
  if (!employee) return res.status(404).json({ error: 'Employee not found.' });
  const activeEmployees = activeWorkforce(companyId);
  if (!activeEmployees.some((entry) => entry.id === empId)) return res.status(403).json({ error: 'This employee is not active in the workspace.' });
  const marketplace = ({
    postgres: { name: 'PostgreSQL Server', tools: [{ name: 'sql.query', description: 'Read-only SQL query', risk: 'read' as const }] },
    github: { name: 'GitHub Integration', tools: [{ name: 'github.repo.read', description: 'Read repository context', risk: 'read' as const }, { name: 'github.create_pr', description: 'Create a pull request', risk: 'write' as const }] },
    context7: { name: 'Context7 Docs', tools: [{ name: 'context7.search', description: 'Search documentation', risk: 'read' as const }] }
  } as Record<string, { name: string; tools: Array<{ name: string; description: string; risk: 'read' | 'write' }> }>)[String(req.body?.marketplace_id || '')];
  const connectionType = (marketplace ? 'custom_skill' : String(req.body?.connection_type || 'streamable_http')) as TenantConnector['connection_type'];
  const allowedTypes: TenantConnector['connection_type'][] = ['google_gmail', 'google_sheets', 'streamable_http', 'git_repository', 'custom_skill'];
  if (!allowedTypes.includes(connectionType)) return res.status(400).json({ error: 'Unsupported connector type.' });
  const name = String(req.body?.name || marketplace?.name || 'Custom Connector').trim().slice(0, 120);
  if (!name) return res.status(400).json({ error: 'A connector name is required.' });
  const gmailSendEnabled = connectionType === 'google_gmail' && empId === 'sarah' && req.body?.config?.gmail_send_enabled === true;
  let serverUrl: string | undefined;
  if (connectionType === 'streamable_http') {
    try { serverUrl = validateRemoteMcpUrl(req.body?.server_url); } catch (error: any) { return res.status(400).json({ error: error.message }); }
  }
  let encryptedToken: string | undefined;
  const authToken = String(req.body?.auth_token || '').trim();
  if (authToken) {
    try { encryptedToken = encryptConnectorCredentials({ access_token: authToken }); } catch (error: any) { return res.status(503).json({ error: error.message }); }
  }
  const now = new Date().toISOString();
  const connection: TenantConnector = {
    id: Date.now(), company_id: companyId, employee_id: empId, name, connection_type: connectionType,
    server_url: serverUrl, access_level: ['read_only', 'requires_approval', 'read_write'].includes(req.body?.access_level) ? req.body.access_level : 'requires_approval',
    status: marketplace ? 'connected' : 'needs_configuration',
    config: sanitizeConnectorConfig({ notes: req.body?.config?.notes, repo_path: req.body?.config?.repo_path, gmail_send_enabled: gmailSendEnabled, marketplace_id: req.body?.marketplace_id }),
    discovered_tools: marketplace?.tools || [], tool_grants: marketplace?.tools?.map((tool) => ({ tool_name: tool.name, access_level: req.body?.access_level === 'read_write' && tool.risk === 'read' ? 'read_write' : tool.risk === 'write' ? 'requires_approval' : 'read_only' })) || [], created_at: now, updated_at: now
  };
  await persistMcpConnection(connection);
    const employeeName = employee.name || empId;
    const googleNotice = connectionType === 'google_gmail'
      ? `Connector saved for ${employeeName}. Start Google OAuth${connection.config.gmail_send_enabled ? ' to grant read access and Sarah’s approval-gated Gmail send permission' : ' to grant read-only Gmail access'}.`
      : connectionType === 'google_sheets' ? `Connector saved for ${employeeName}. Start Google OAuth to grant read-only Sheets access.` : '';
    res.status(201).json({ ok: true, connection: connectorPublicView(connection), tools_discovered: false, notice: googleNotice || 'Connector saved. Discover tools and grant them per-tool before this employee can use the server.' });
});

app.get('/api/employees/:id/mcp-connections/:connectionId/google/start', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user?.company_id || DEFAULT_COMPANY_ID;
  const connectionId = Number(req.params.connectionId);
  const requestedType = String(req.query.service || '') as 'google_gmail' | 'google_sheets';
  const connections = await loadMcpConnections(companyId, req.params.id);
  const connection = connections.find((entry) => entry.id === connectionId && (entry.connection_type === requestedType || (!requestedType && ['google_gmail', 'google_sheets'].includes(entry.connection_type))));
  const type = connection?.connection_type as 'google_gmail' | 'google_sheets';
  if (!connection || !['google_gmail', 'google_sheets'].includes(type)) return res.status(400).json({ error: 'Choose Gmail or Google Sheets.' });
  if (!connection) return res.status(404).json({ error: 'Google connector not found.' });
  try {
    const state = oauthStateSign({ uid: user?.uid, company_id: companyId, employee_id: req.params.id, connection_id: connectionId, connection_type: type, iat: Date.now() });
    res.cookie('cw_google_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION, maxAge: 10 * 60 * 1000 });
    const oauth2 = googleOAuthClient();
    return res.redirect(oauth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: googleScopesFor(connection), state }));
  } catch (error: any) {
    return res.status(503).json({ error: error.message || 'Google OAuth is not configured.' });
  }
});

app.get('/api/google/oauth/callback', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).send('Your Caveworkers session expired. Return to the app and start Google connection again.');
  const state = String(req.query.state || '');
  const payload = oauthStateVerify(state);
  if (!payload || payload.uid !== user.uid || payload.company_id !== (user.company_id || DEFAULT_COMPANY_ID) || req.cookies?.cw_google_oauth_state !== state) return res.status(400).send('Google OAuth state validation failed. Please restart the connection from Caveworkers.');
  if (req.query.error) return res.redirect(`/settings?connector_error=${encodeURIComponent(String(req.query.error))}`);
  const code = String(req.query.code || '');
  if (!code) return res.status(400).send('Google did not return an authorization code.');
  try {
    const oauth2 = googleOAuthClient();
    const tokenResponse = await oauth2.getToken(code);
    const tokens = tokenResponse.tokens;
    const connections = await loadMcpConnections(payload.company_id, payload.employee_id);
    const connection = connections.find((entry) => entry.id === Number(payload.connection_id) && entry.connection_type === payload.connection_type);
    if (!connection) return res.status(404).send('The Google connector no longer exists.');
    let credentials = tokens as Record<string, any>;
    if (!credentials.refresh_token && connection.auth_token_encrypted) credentials = { ...(decryptConnectorCredentials(connection.auth_token_encrypted) || {}), ...credentials };
    connection.auth_token_encrypted = encryptConnectorCredentials(credentials);
    connection.auth_scopes = String(tokens.scope || '').split(' ').filter(Boolean);
    connection.status = 'connected';
    connection.last_error = undefined;
    connection.updated_at = new Date().toISOString();
    const defaultTool = payload.connection_type === 'google_gmail' ? 'gmail.search' : 'sheets.read';
    if (!connection.tool_grants.some((grant) => grant.tool_name === defaultTool)) connection.tool_grants.push({ tool_name: defaultTool, access_level: 'read_only' });
    if (payload.connection_type === 'google_gmail' && connection.config?.gmail_send_enabled && !connection.tool_grants.some((grant) => grant.tool_name === 'gmail.send')) connection.tool_grants.push({ tool_name: 'gmail.send', access_level: 'requires_approval' });
    try {
      oauth2.setCredentials(credentials);
      const identity = await google.oauth2({ version: 'v2', auth: oauth2 }).userinfo.get();
      connection.oauth_email = identity.data.email || undefined;
    } catch (_identityError) { /* identity is optional; the token remains valid for the requested API */ }
    await persistMcpConnection(connection);
    res.clearCookie('cw_google_oauth_state');
    return res.redirect(`/settings?connector=connected&service=${payload.connection_type === 'google_gmail' ? 'gmail' : 'sheets'}`);
  } catch (error: any) {
    console.warn('Google OAuth callback failed:', error?.message || error);
    return res.status(502).send('Google connection could not be completed. Check the OAuth client, redirect URI, and requested API scopes.');
  }
});

app.get('/api/employees/:id/mcp-connections/:connectionId/tools', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const connectionId = Number(req.params.connectionId);
  const connections = await loadMcpConnections(companyId, req.params.id);
  const connection = connections.find((entry) => entry.id === connectionId);
  if (!connection) return res.status(404).json({ error: 'MCP connection not found.' });
  if (connection.connection_type !== 'streamable_http') return res.json({ discovered: connection.discovered_tools || [] });
  try {
    const tools = await discoverMcpTools(connection);
    connection.discovered_tools = tools;
    connection.status = 'connected';
    connection.last_error = undefined;
    connection.updated_at = new Date().toISOString();
    await persistMcpConnection(connection);
    res.json({ discovered: tools.map((tool) => ({ name: tool.name, description: tool.description, risk: tool.risk })) });
  } catch (error: any) {
    connection.status = 'error';
    connection.last_error = String(error?.message || 'MCP discovery failed').slice(0, 240);
    connection.updated_at = new Date().toISOString();
    await persistMcpConnection(connection);
    res.status(502).json({ error: connection.last_error });
  }
});

app.post('/api/employees/:id/mcp-connections/:connectionId/tools/:toolName', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user?.company_id || DEFAULT_COMPANY_ID;
  const connection = (await loadMcpConnections(companyId, req.params.id)).find((entry) => entry.id === Number(req.params.connectionId));
  if (!connection) return res.status(404).json({ error: 'MCP connection not found.' });
  const toolName = decodeURIComponent(req.params.toolName);
  if (!connection.discovered_tools.some((tool) => tool.name === toolName) && !['gmail.search', 'gmail.send', 'sheets.read'].includes(toolName)) return res.status(400).json({ error: 'Discover this tool before granting it.' });
  if (toolName === 'gmail.send' && (connection.connection_type !== 'google_gmail' || connection.config?.gmail_send_enabled !== true)) return res.status(400).json({ error: 'Enable Gmail send during connection setup, then reconnect Google before granting this action.' });
  const accessLevel = ['read_only', 'requires_approval', 'read_write'].includes(req.body?.access_level) ? req.body.access_level : 'requires_approval';
  connection.tool_grants = connection.tool_grants.filter((grant) => grant.tool_name !== toolName);
  connection.tool_grants.push({ tool_name: toolName, access_level: accessLevel });
  connection.updated_at = new Date().toISOString();
  await persistMcpConnection(connection);
  res.json({ ok: true, connection: connectorPublicView(connection) });
});

app.delete('/api/employees/:id/mcp-connections/:connectionId/tools/:toolName', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const connection = (await loadMcpConnections(companyId, req.params.id)).find((entry) => entry.id === Number(req.params.connectionId));
  if (!connection) return res.status(404).json({ error: 'MCP connection not found.' });
  connection.tool_grants = connection.tool_grants.filter((grant) => grant.tool_name !== decodeURIComponent(req.params.toolName));
  connection.updated_at = new Date().toISOString();
  await persistMcpConnection(connection);
  res.json({ ok: true });
});

app.post('/api/employees/:id/mcp-connections/:connectionId/test', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const connection = (await loadMcpConnections(companyId, req.params.id)).find((entry) => entry.id === Number(req.params.connectionId));
  if (!connection) return res.status(404).json({ error: 'MCP connection not found.' });
  if (connection.connection_type === 'streamable_http') {
    try { const tools = await discoverMcpTools(connection); connection.discovered_tools = tools; connection.status = 'connected'; connection.last_error = undefined; await persistMcpConnection(connection); return res.json({ ok: true, message: `Connection healthy. ${tools.length} tools discovered.` }); }
    catch (error: any) { reportOperationalFailure('connector.health_check', error, { tenant_hash: anonymizeIdentifier(companyId), employee_id: req.params.id, connector_type: connection.connection_type, request_id: getRequestId(req) }); return res.status(502).json({ ok: false, error: String(error?.message || 'MCP health check failed').slice(0, 240), request_id: getRequestId(req) }); }
  }
  if (connection.connection_type === 'google_gmail' || connection.connection_type === 'google_sheets') return res.json({ ok: connection.status === 'connected', message: connection.status === 'connected' ? `Google ${connection.connection_type === 'google_gmail' ? 'Gmail' : 'Sheets'} connection is ready.` : 'Connect the Google account before testing.' });
  res.json({ ok: true, message: 'Connection configuration is saved.' });
});

app.delete('/api/employees/:id/mcp-connections/:connectionId', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const connectionId = Number(req.params.connectionId);
  const key = `${companyId}:${req.params.id}`;
  const list = await loadMcpConnections(companyId, req.params.id);
  if (!list.some((entry) => entry.id === connectionId)) return res.status(404).json({ error: 'MCP connection not found.' });
  db.mcpConnections.set(key, list.filter((entry) => entry.id !== connectionId));
  const collection = connectorCollection(companyId);
  if (collection) await collection.doc(`${req.params.id}_${connectionId}`).delete();
  res.json({ ok: true });
});

app.get('/api/analyst/connectors', async (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });
  const connections = await loadMcpConnections(user.company_id || DEFAULT_COMPANY_ID, 'david');
  res.json({ connections: connections.map(connectorPublicView) });
});

app.post('/api/analyst/google-sheets/read', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user?.company_id || DEFAULT_COMPANY_ID;
  try {
    const result = await readGoogleSheetValues(companyId, Number(req.body?.connection_id), String(req.body?.sheet_url || ''), req.body?.range);
    res.json({ ok: true, result });
  } catch (error: any) { reportOperationalFailure('connector.google_sheets_read', error, { tenant_hash: anonymizeIdentifier(companyId), request_id: getRequestId(req) }); res.status(502).json({ error: String(error?.message || 'Google Sheets read failed').slice(0, 240), request_id: getRequestId(req) }); }
});

app.post('/api/analyst/gmail/search', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user?.company_id || DEFAULT_COMPANY_ID;
  try {
    const result = await searchGmail(companyId, Number(req.body?.connection_id), String(req.body?.query || ''), req.body?.max_results);
    res.json({ ok: true, result });
  } catch (error: any) { reportOperationalFailure('connector.gmail_search', error, { tenant_hash: anonymizeIdentifier(companyId), request_id: getRequestId(req) }); res.status(502).json({ error: String(error?.message || 'Gmail search failed').slice(0, 240), request_id: getRequestId(req) }); }
});

app.post('/api/analyst/mcp/call', async (req, res) => {
  const user = getAuthUser(req);
  if (await enforceWorkspaceAccess(req, res)) return;
  const companyId = user?.company_id || DEFAULT_COMPANY_ID;
  const connectionId = Number(req.body?.connection_id);
  const toolName = String(req.body?.tool_name || '').trim();
  const connection = (await loadMcpConnections(companyId, 'david')).find((entry) => entry.id === connectionId && entry.status === 'connected');
  if (!connection || connection.connection_type !== 'streamable_http') return res.status(404).json({ error: 'Connected custom MCP server not found.' });
  const discovered = connection.discovered_tools.find((tool) => tool.name === toolName);
  const grant = connection.tool_grants.find((entry) => entry.tool_name === toolName);
  if (!discovered || !grant) return res.status(403).json({ error: 'David does not have permission for this MCP tool.' });
  const args = req.body?.arguments && typeof req.body.arguments === 'object' ? req.body.arguments : {};
  if (discovered.risk === 'write' || isLikelyWriteTool(toolName)) {
    const approvalId = db.nextApprovalId++;
    await persistAnalystApproval({ id: approvalId, company_id: companyId, task_id: 0, employee_id: 'david', tool_name: toolName, action_summary: `Run ${toolName} on ${connection.name}`, status: 'pending', payload: { origin: 'analyst', mode: 'mcp_tool_call', connector_id: connection.id, arguments: args }, created_at: new Date().toISOString() });
    return res.status(202).json({ ok: true, status: 'awaiting_approval', approval_id: approvalId, message: 'Write-capable MCP tools always pause for manager approval before execution.' });
  }
  try {
    const initialized = await mcpRpc(connection, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Caveworkers', version: '1.0.0' } });
    const result = await mcpRpc(connection, 'tools/call', { name: toolName, arguments: args }, initialized.sessionId);
    res.json({ ok: true, result: result.data?.result || result.data });
  } catch (error: any) { reportOperationalFailure('connector.mcp_tool_call', error, { tenant_hash: anonymizeIdentifier(companyId), employee_id: 'david', tool_name: toolName, request_id: getRequestId(req) }); res.status(502).json({ error: String(error?.message || 'MCP tool call failed').slice(0, 240), request_id: getRequestId(req) }); }
});

app.get('/api/knowledge', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const docs = db.knowledge.get(companyId) || db.knowledge.get(DEFAULT_COMPANY_ID) || [];
  res.json(docs);
});

app.post('/api/knowledge', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const { title, content, category } = req.body || {};
  if (!title || !content) {
    return res.status(400).json({ error: 'Title and content are required' });
  }

  const docs = db.knowledge.get(companyId) || [];
  const newDoc = { id: Date.now(), title, category: category || 'policy', content, created_at: new Date().toISOString() };
  docs.unshift(newDoc);
  db.knowledge.set(companyId, docs);

  res.json({ ok: true, doc: newDoc });
});

app.get('/api/activity', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  await hydrateTenantActivity(companyId);
  const logs = db.activity.get(companyId) || [];
  res.json({ messages: logs.filter((entry) => entry.company_id === companyId) });
});

app.post('/api/payments/create-order', async (req, res) => {
  const user = getAuthUser(req);
  const { tier } = req.body || {};
  const plan = SUBSCRIPTION_PLANS[tier || user.selected_tier || 'growth'];
  if (!plan || tier === 'free_trial') return res.status(400).json({ error: 'A paid plan is required to create a payment order.' });
  if (!razorpayClient || !RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) return res.status(503).json({ error: 'Payments are not configured on this server.' });

  const amountInPaise = Math.round((plan.price_inr || plan.price * 83) * 100);
  try {
    const order = await razorpayClient.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: `rcpt_${user.uid}_${Date.now()}`,
      notes: { uid: user.uid, company_id: user.company_id || DEFAULT_COMPANY_ID, tier: tier || user.selected_tier || 'growth' }
    });
    pendingPaymentOrders.set(order.id, { uid: user.uid, company_id: user.company_id || DEFAULT_COMPANY_ID, tier: tier || user.selected_tier || 'growth', amount: Number(order.amount), created_at: new Date().toISOString() });
    return res.json({ order_id: order.id, amount: order.amount, currency: order.currency, key_id: RAZORPAY_KEY_ID });
  } catch (err: any) {
    reportOperationalFailure('payments.order_create', err, { tenant_hash: anonymizeIdentifier(user.company_id || DEFAULT_COMPANY_ID), request_id: getRequestId(req), tier: String(tier || user.selected_tier || 'growth').slice(0, 32) });
    return res.status(502).json({ error: 'Could not create a payment order. Please try again.', request_id: getRequestId(req) });
  }
});

app.post('/api/payments/webhook', async (req, res) => {
  if (!RAZORPAY_WEBHOOK_SECRET) return res.status(503).json({ error: 'Payment webhooks are not configured.' });
  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody || Buffer.from(JSON.stringify(req.body || {}));
  const providedSignature = req.get('x-razorpay-signature') || '';
  const valid = verifyRazorpayWebhookSignature(rawBody, providedSignature, RAZORPAY_WEBHOOK_SECRET);
  if (!valid) return res.status(401).json({ error: 'Invalid payment webhook signature.' });

  const event = req.body?.event;
  if (!['payment.authorized', 'payment.captured'].includes(event)) return res.json({ received: true });
  const payment = req.body?.payload?.payment?.entity;
  const orderId = payment?.order_id;
  const paymentId = payment?.id;
  if (!orderId || !paymentId) return res.status(400).json({ error: 'Payment webhook payload is incomplete.' });

  try {
    let pending = pendingPaymentOrders.get(orderId);
    if (!pending && razorpayClient) {
      const order = await razorpayClient.orders.fetch(orderId);
      const notes = order.notes || {};
      if (notes.uid && notes.company_id && notes.tier) {
        pending = { uid: String(notes.uid), company_id: String(notes.company_id), tier: String(notes.tier), amount: Number(order.amount), created_at: new Date().toISOString() };
      }
    }
    if (!pending) return res.status(202).json({ received: true, reason: 'Payment order is not pending in this workspace.' });

    const company = await loadCompanyFromFirebase(pending.company_id) || db.companies.get(pending.company_id);
    if (company) {
      company.tier = pending.tier;
      company.status = 'active';
      company.payment_verified_at = new Date().toISOString();
      company.payment_id = paymentId;
      await persistCompany(company);
    }
    const linkedUser = await loadUserFromFirebase(pending.uid);
    if (linkedUser) {
      linkedUser.selected_tier = pending.tier;
      await persistUser(linkedUser, { payment_id: paymentId });
    }
    pendingPaymentOrders.delete(orderId);
    return res.json({ received: true });
  } catch (error) {
    reportOperationalFailure('payments.webhook_processing', error, { request_id: getRequestId(req), event_type: String(event || 'unknown').slice(0, 80), order_hash: anonymizeIdentifier(orderId) });
    return res.status(500).json({ error: 'Webhook processing failed.', request_id: getRequestId(req) });
  }
});

app.post('/api/payments/verify', async (req, res) => {
  const user = getAuthUser(req);
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !RAZORPAY_KEY_SECRET) return res.status(402).json({ error: 'A valid Razorpay payment is required.', payment_required: true });

  const pending = pendingPaymentOrders.get(razorpay_order_id);
  if (!pending || pending.uid !== user.uid) return res.status(403).json({ error: 'Payment order is invalid or does not belong to this account.' });

  try {
    const valid = verifyRazorpayPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, RAZORPAY_KEY_SECRET);
    if (!valid) return res.status(402).json({ error: 'Payment signature verification failed.', payment_required: true });

    const company = await loadCompanyFromFirebase(pending.company_id) || db.companies.get(pending.company_id);
    if (!company) return res.status(400).json({ error: 'Workspace not found for this payment.' });
    company.tier = pending.tier;
    company.status = 'active';
    company.payment_verified_at = new Date().toISOString();
    company.payment_id = razorpay_payment_id;
    await persistCompany(company);
    user.selected_tier = pending.tier;
    await persistUser(user, { payment_id: razorpay_payment_id });
    pendingPaymentOrders.delete(razorpay_order_id);
    return res.json({ status: 'verified', tier: pending.tier });
  } catch (error) {
    reportOperationalFailure('payments.signature_verification', error, { tenant_hash: anonymizeIdentifier(user.company_id || DEFAULT_COMPANY_ID), request_id: getRequestId(req), order_hash: anonymizeIdentifier(razorpay_order_id) });
    return res.status(502).json({ error: 'Payment verification could not be completed. Please contact support if you were charged.', request_id: getRequestId(req) });
  }
});

app.get('/api/roi', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const emps = db.orgEmployees.get(companyId) || db.orgEmployees.get(DEFAULT_COMPANY_ID) || [];
  const activeCount = emps.length || 3;

  const humanEquivalentMonthlySalary = activeCount * 4500; // $4,500/mo avg specialist
  const caveworkersPlanCost = activeCount <= 2 ? 0 : activeCount <= 3 ? 25 : activeCount <= 6 ? 85 : 180;
  const netMonthlySavings = humanEquivalentMonthlySalary - caveworkersPlanCost;
  const roiMultiplier = Math.round((humanEquivalentMonthlySalary / Math.max(1, caveworkersPlanCost)) * 10) / 10;

  res.json({
    active_employees: activeCount,
    human_equivalent_monthly_cost: `$${humanEquivalentMonthlySalary.toLocaleString()}`,
    caveworkers_subscription_cost: `$${caveworkersPlanCost.toLocaleString()}`,
    net_monthly_savings: `$${netMonthlySavings.toLocaleString()}`,
    roi_multiplier: `${roiMultiplier}x`,
    annual_projected_savings: `$${(netMonthlySavings * 12).toLocaleString()}`
  });
});

app.get('/api/office/status', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const emps = db.orgEmployees.get(companyId) || db.orgEmployees.get(DEFAULT_COMPANY_ID) || [];
  const pendingApprovals = Array.from(db.approvals.values()).filter((a) => a.status === 'pending');

  const office = emps.map((emp, index) => {
    let status = 'idle';
    let currentTask = 'Monitoring tools & awaiting assignment';
    let collaboratingWith = null;

    if (pendingApprovals.some((a) => a.employee_id === emp.id)) {
      status = 'awaiting_approval';
      currentTask = 'Paused — waiting for human sign-off on email/action';
    } else if (index === 0) {
      status = 'working';
      currentTask = 'Analyzing workspace hiring demand & candidate rubrics';
      collaboratingWith = 'David (Data Analyst)';
    } else if (index === 1) {
      status = 'working';
      currentTask = 'Querying Q3 SQL sales metrics & operating margins';
      collaboratingWith = 'Sarah (HR Manager)';
    }

    return {
      id: emp.id,
      name: emp.name,
      role: emp.role,
      department: emp.department,
      color: emp.color,
      status,
      current_task: currentTask,
      collaborating_with: collaboratingWith,
      autonomy_level: (EMPLOYEE_CATALOG.find((c) => c.id === emp.id)?.autonomy_level) || 'Level 3',
      tools: emp.tools || []
    };
  });

  res.json({
    company_name: user.company_name || 'Acme Operations',
    total_active_employees: emps.length,
    pending_approvals_count: pendingApprovals.length,
    office
  });
});

// Sentry must register after all routes and before Caveworkers' redacted fallback error response.
if (sentryEnabled) Sentry.setupExpressErrorHandler(app);
app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(error);
  const status = Number(error?.status || error?.statusCode);
  const safeStatus = Number.isInteger(status) && status >= 400 && status < 500 ? status : 500;
  const message = safeStatus === 500 ? 'An unexpected server error occurred.' : String(error?.message || 'Request failed.').slice(0, 240);
  console.error(JSON.stringify({ event: 'http_request_failure', request_id: getRequestId(req), method: req.method, path: req.path, status: safeStatus, error_name: error instanceof Error ? error.name : 'UnknownError' }));
  res.status(safeStatus).json({ error: message, request_id: getRequestId(req) });
});

process.on('unhandledRejection', (reason) => {
  reportOperationalFailure('process.unhandled_rejection', reason);
});
process.on('uncaughtExceptionMonitor', (error) => {
  reportOperationalFailure('process.uncaught_exception', error);
});

export { app, db, pendingPaymentOrders };

if (process.env.NODE_ENV !== 'test' && process.env.VITEST !== 'true') {
  app.listen(PORT, HOST, () => {
    console.log(`CaveWorkers backend running on http://${HOST}:${PORT}`);
    void startAlwaysOnWorker().catch((error) => reportOperationalFailure('worker.startup', error));
  });
}
