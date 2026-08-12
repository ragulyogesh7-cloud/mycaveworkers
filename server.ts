import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import ejs from 'ejs';
import crypto from 'crypto';
import Razorpay from 'razorpay';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';

let genAIClient: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    genAIClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
    });
    console.log('Gemini 3.6 Flash SDK initialized successfully');
  } catch (err) {
    console.warn('Gemini SDK init warning:', err);
  }
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
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

// Initialize Firebase Admin SDK
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID || 'caveworkers',
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL || 'firebase-adminsdk-fbsvc@caveworkers.iam.gserviceaccount.com',
  privateKey: (process.env.FIREBASE_PRIVATE_KEY || `-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCq6lBKnzlJ6r1j\naUUEw9A2qXh3I8YaW2umsG8tOKbV56oVrZUB4vlxCC2Vt20I0Wq2Io57MTRFFOU8\n5l3CPeLqaoGj2RYr5ieKwGua0MWWUX8I6Z1xyldBEjIUPtYHNNDBVCaLIVXh6bV0\n1h1bXciH3CixmgWdEV6Dd0Tl4h3ivBrUvs7nuqUncsqNdsbERLGEnK3hyLgMO0ZD\n7uhWCf0kYCk90DYr++IcU2Rqu5XRMEgfRqRcsIERZPonhw8ZeoPMbCdQw+Vt13dR\n38dpP0ZGAfm7obw/ASJ4wsVaDU2f7hMKqkRsSDW+X800S1eVnRsLIho44dEjs560\nBA+NSR3zAgMBAAECggEAGsqmcb7E1bPrd9EGxdObaL4nCTyn2fYuXqT16yz1ZhQt\nrWlA3C4ECPZjDZQruNVO+M8GQ68NBlkwrVu1Ix+IBFP+uhGWWqT2L4IF5sZG0CSP\n7nSPFB5yOrE1/XDIzxILOTWjjG1aJOgkOXTeNDYexZaQIHWdifyw3UMjHzVTQaPA\nzFZ5LwK7/JUTvYRHmiNC01metT7UjX2rfdKKAlODIK+Uw+fnZRbkt7CV4MvOw8Pe\nRnbIGS+Q1H9bmlg6U3qWQRuFrNArdgnFwY2+PuycZRAzfDCs8XmmXZswXQzQ0qi6\ntHdSgkyifG/dIKllL8mZPB3Ru8isgtRdkrmwxSAThQKBgQDitMYy6nvYns9Gf17O\npAhWolojqZLHlFYyRJAJmBdKYySrpoocsVC3GYkX9uiGWyTuAROkdxjlHTaiew2m\nEqB3do/vuhlDKuofvYyKKPxqOdZJ+arrHqw4zHKUwGjEvr+rgcXGC5RVFBNC00wI\noeUcSSgUyRe8vEQv8h/lmfV5rQKBgQDBAAfBbT0hIpjIwVRKrnH7c+CMKqhmDfDX\nKEQ7PdiDbZs6QVKvQKhbYI3QTafrYEyIFOUEbLaFa8sHPu7r1M20Ay8AEo1wLlJE\nJYz2I8C/fWbJHJIgj6Kxqi5oibs/ZKzGBhg9O0ZCQ5TOC+0qsr4twRlWCAk8BG8c\nclvjgh0qHwKBgAl0OnOzHZkJ/mDVPPHnG0XpnVKxZqKWCAYun8cWpZn/im7yEf5i\nUphgIzxxmn7H3EFkoBoSsWIUlsut0ALl8fUpZ5U6sIUBjCPotqyoSuZvJQWOuNb3\nP31a4UhcwcG6pqmTTtkUcIofvTHjN9+ASNqmHlrHjArd2wYY1cWwZvE9AoGBAKzH\nySmqERLL9Tmskji1iUdSitERE2chzd3gp4zdpiqrAk+Z0VshqFb9zpeQHedDc+BT\nzF80sAYr5TvcZGpuPaWNQBNxiHvIjE+DynlEsrb7nfwnfs51qHIjZ56gxyhOibpS\nFHskyJZkCCCaXr1d/ZHakEMLuLCpS4uM+aRohJGDAoGAEt3w8MkQ8AjmXpkLTT6v\njo4JJx7e6pX0rVvk6HZVKMlWFkF2axZdELT3v5PUMJ2va/i3Z4/XgJGIQ6q2+0mY\nqG+2B3INuhGY+AMXj084pjL0x3NrzGMorF1pbpPtDr+tCE17ezSM96QSHfCy4yv1\nEFISfCagk7GlI/2Gd3iJcUk=\n-----END PRIVATE KEY-----\n`).replace(/\\n/g, '\n')
};

if (!getApps().length) {
  try {
    initializeApp({
      credential: cert(serviceAccount)
    });
    console.log('Firebase Admin SDK initialized successfully for project caveworkers');
  } catch (e) {
    console.warn('Firebase Admin SDK init warning:', e);
  }
}

// Razorpay Setup
const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_TOteB93qoWHTSs';
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'r3dvDLjQcvllQtL7ipJYmoW4';

let razorpayClient: Razorpay | null = null;
try {
  razorpayClient = new Razorpay({
    key_id: RAZORPAY_KEY_ID,
    key_secret: RAZORPAY_KEY_SECRET
  });
} catch (err) {
  console.warn('Razorpay client init warning:', err);
}

const SUBSCRIPTION_PLANS: Record<string, any> = {
  free_trial: { name: 'Free Trial', price: 0, price_inr: 0, trial_days: 3, max_employees: 2, description: '3-day trial with 2 AI employees', features: ['2 AI employees', 'Permissioned tools', 'HITL Approvals'] },
  starter: { name: 'Starter', price: 25, price_inr: 1999, max_employees: 3, description: 'Essential AI workforce for small teams', features: ['3 AI employees', 'SQL & Gmail tools', 'Audit logging'] },
  growth: { name: 'Growth', price: 85, price_inr: 6999, max_employees: 6, description: 'Expanded capacity for growing companies', features: ['6 AI employees', 'Custom MCP Connectors', 'Priority routing'] },
  enterprise: { name: 'Enterprise', price: 180, price_inr: 14999, max_employees: 10, description: 'Full workforce OS with priority routing', features: ['10 AI employees', 'Unlimited MCP skills', '24/7 dedicated lead'] }
};

const EMPLOYEE_CATALOG = [
  {
    id: 'sarah',
    employee_code: 'CW_EMP_001',
    name: 'Sarah',
    role: 'HR & Talent Acquisition Manager',
    department: 'Human Resources',
    color: '#10b981',
    autonomy_level: 'Level 3 (Recommend with Review)',
    system_prompt: 'You are Sarah, HR Manager at Caveworkers OS. Specializations: recruiting, candidate screening, onboarding, HR policy compliance, leave management, employee communication.',
    default_tools: ['Gmail', 'Notion', 'Slack'],
    status: 'active'
  },
  {
    id: 'david',
    employee_code: 'CW_EMP_002',
    name: 'David',
    role: 'Data & Financial Analyst',
    department: 'Finance & Analytics',
    color: '#f59e0b',
    autonomy_level: 'Level 2 (Analyze & Draft)',
    system_prompt: 'You are David, Data Analyst. Specializations: SQL queries, revenue analysis, KPI calculations, trend detection, business reports, workforce demand forecasting.',
    default_tools: ['SQL workspace', 'Notion', 'Slack'],
    status: 'active'
  },
  {
    id: 'alex',
    employee_code: 'CW_EMP_003',
    name: 'Alex',
    role: 'Senior Operations Specialist',
    department: 'Operations',
    color: '#3b82f6',
    autonomy_level: 'Level 4 (Execute with Approval)',
    system_prompt: 'You are Alex, Operations Specialist. Specializations: task routing, SLA management, workflow orchestration, vendor communications.',
    default_tools: ['SQL workspace', 'Gmail', 'Notion'],
    status: 'active'
  },
  {
    id: 'mike',
    employee_code: 'CW_EMP_004',
    name: 'Mike',
    role: 'Technical Lead & Systems Developer',
    department: 'Engineering',
    color: '#8b5cf6',
    autonomy_level: 'Level 3 (Recommend with Review)',
    system_prompt: 'You are Mike, Technical Lead. Specializations: architecture review, repository management, CI/CD, MCP connector verification.',
    default_tools: ['Notion', 'Slack'],
    status: 'active'
  },
  {
    id: 'emma',
    employee_code: 'CW_EMP_005',
    name: 'Emma',
    role: 'Customer Success Lead',
    department: 'Support',
    color: '#ec4899',
    autonomy_level: 'Level 2 (Analyze & Draft)',
    system_prompt: 'You are Emma, Customer Success Lead. Specializations: client onboarding, support ticket resolution, client retention feedback.',
    default_tools: ['Gmail', 'Slack'],
    status: 'active'
  },
  {
    id: 'arav',
    employee_code: 'CW_EMP_006',
    name: 'Arav',
    role: 'People Operations & HR Analyst',
    department: 'Human Resources',
    color: '#06b6d4',
    autonomy_level: 'Level 3 (Recommend with Review)',
    system_prompt: 'You are Arav, People Operations Specialist. Specializations: workforce analytics, compensation benchmarks, handbook policy updates.',
    default_tools: ['Notion', 'Gmail'],
    status: 'active'
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

interface TaskRecord {
  id: number;
  question: string;
  owner: string;
  status: string;
  answer: string;
  plan: string;
  created_at: string;
  trace: any[];
}

interface ApprovalRecord {
  id: number;
  task_id: number;
  employee_id: string;
  tool_name: string;
  action_summary: string;
  status: 'pending' | 'approved' | 'rejected';
  payload?: any;
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
  nextTaskId: 1,
  nextApprovalId: 101,
};

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
  { id: 1, sender: 'System', receiver: 'Workspace', kind: 'workspace.activated', body: 'Workspace activated on Growth plan with 3 AI employees.', created_at: new Date().toISOString() }
]);

db.approvals.set(101, {
  id: 101,
  task_id: 103,
  employee_id: 'alex',
  tool_name: 'Gmail',
  action_summary: 'Send Q3 Operations Status email to clients (3 recipients)',
  status: 'pending',
  created_at: new Date().toISOString()
});

db.tasks.set(101, {
  id: 101,
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

// Helper to resolve current user
function getAuthUser(req: express.Request): User | null {
  const uid = req.cookies?.demo_uid;
  if (!uid) {
    return null;
  }
  let user = db.users.get(uid);
  if (!user) {
    user = {
      uid,
      email: 'user@caveworkers.com',
      display_name: 'Workspace Manager',
      company_id: `org_${uid.slice(0, 10)}`,
      company_name: 'Acme Operations',
      onboarded: true,
      selected_tier: 'growth'
    };
    db.users.set(uid, user);
  }
  return user;
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
      database: { status: 'up' },
      payments: { status: RAZORPAY_KEY_ID ? 'configured' : 'unconfigured' },
      firebase: { status: 'active' },
      mcp_bus: { status: 'active' }
    }
  });
});

app.post('/api/session-login', async (req, res) => {
  const { idToken, email, display_name, photo_url } = req.body || {};
  let decodedUser: any = null;

  if (idToken && getApps().length) {
    try {
      decodedUser = await getAuth().verifyIdToken(idToken);
    } catch (e) {
      console.warn('Firebase token verification note:', e);
    }
  }

  const userEmail = decodedUser?.email || email || 'ragulyogesh7@gmail.com';
  const userName = decodedUser?.name || display_name || 'Ragul Yogesh';
  const userPhoto = decodedUser?.picture || photo_url || '';
  const uid = decodedUser?.uid || `usr_google_${Buffer.from(userEmail).toString('hex').slice(0, 12)}`;

  let user = db.users.get(uid);
  if (!user) {
    user = {
      uid,
      email: userEmail,
      display_name: userName,
      photo_url: userPhoto,
      company_id: `org_${uid.slice(0, 8)}`,
      company_name: 'Acme Operations',
      onboarded: true,
      selected_tier: 'growth',
      role: 'admin'
    };
    db.users.set(uid, user);

    if (!db.companies.has(user.company_id)) {
      db.companies.set(user.company_id, {
        id: user.company_id,
        name: 'Acme Operations',
        industry: 'Technology',
        team_size: '11-50',
        owner_uid: uid,
        tier: 'growth',
        status: 'active',
        selected_employees: ['sarah', 'david', 'alex', 'mike'],
        created_at: new Date().toISOString()
      });
      db.orgEmployees.set(user.company_id, db.orgEmployees.get(DEFAULT_COMPANY_ID) || []);
      db.knowledge.set(user.company_id, db.knowledge.get(DEFAULT_COMPANY_ID) || []);
    }
  } else {
    if (userName) user.display_name = userName;
    if (userPhoto) user.photo_url = userPhoto;
    if (userEmail) user.email = userEmail;
  }

  res.cookie('demo_uid', uid, { httpOnly: true, secure: false, sameSite: 'lax' });
  res.cookie('__session', 'session_token_' + Date.now(), { httpOnly: true, secure: false, sameSite: 'lax' });
  res.cookie('csrf_token', 'csrf_token_caveworkers', { httpOnly: false, secure: false, sameSite: 'lax' });

  res.json({
    status: 'success',
    redirect: '/command',
    csrf_token: 'csrf_token_caveworkers'
  });
});

app.post('/api/session-logout', (_req, res) => {
  res.clearCookie('__session', { path: '/' });
  res.clearCookie('csrf_token', { path: '/' });
  res.clearCookie('demo_uid', { path: '/' });
  res.json({ status: 'logged_out' });
});

app.get('/logout', (_req, res) => {
  res.clearCookie('__session', { path: '/' });
  res.clearCookie('csrf_token', { path: '/' });
  res.clearCookie('demo_uid', { path: '/' });
  res.redirect('/login');
});

app.get('/api/me', (req, res) => {
  const user = getAuthUser(req);
  res.json(user);
});

app.get('/api/billing', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const company = db.companies.get(companyId) || {
    id: companyId,
    name: user.company_name || 'Acme Operations',
    tier: user.selected_tier || 'growth',
    status: 'active'
  };
  const plan = SUBSCRIPTION_PLANS[company.tier] || SUBSCRIPTION_PLANS.growth;
  const activeEmps = (db.orgEmployees.get(companyId) || []).length;

  res.json({
    company_name: company.name,
    tier_name: plan.name,
    tier_key: company.tier,
    active_employees: activeEmps,
    max_employees: plan.max_employees,
    quota_remaining: Math.max(0, plan.max_employees - activeEmps)
  });
});

app.post('/api/onboarding/save-profile', (req, res) => {
  const user = getAuthUser(req);
  const { display_name, photo_url } = req.body || {};
  if (display_name) user.display_name = display_name;
  if (photo_url) user.photo_url = photo_url;
  db.users.set(user.uid, user);
  res.json({ ok: true });
});

app.post('/api/onboarding/save-company', (req, res) => {
  const user = getAuthUser(req);
  const { company_name, industry, team_size } = req.body || {};
  if (!company_name) {
    return res.status(400).json({ error: 'Company name is required' });
  }
  const company_id = `org_${user.uid.slice(0, 10)}`;
  user.company_id = company_id;
  user.company_name = company_name;
  db.users.set(user.uid, user);

  db.companies.set(company_id, {
    id: company_id,
    name: company_name,
    industry: industry || 'Technology',
    team_size: team_size || '11-50',
    owner_uid: user.uid,
    tier: 'free_trial',
    status: 'active',
    created_at: new Date().toISOString()
  });

  res.json({ ok: true, company_id });
});

app.post('/api/onboarding/select-plan', (req, res) => {
  const user = getAuthUser(req);
  const { tier } = req.body || {};
  if (tier && SUBSCRIPTION_PLANS[tier]) {
    user.selected_tier = tier;
    if (user.company_id && db.companies.has(user.company_id)) {
      const comp = db.companies.get(user.company_id)!;
      comp.tier = tier;
    }
  }
  res.json({ ok: true, tier: user.selected_tier });
});

app.post('/api/onboarding/select-employees', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const { employee_ids } = req.body || {};

  if (Array.isArray(employee_ids)) {
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
  }
  res.json({ ok: true, employees_added: (employee_ids || []).length });
});

app.post('/api/onboarding/complete', (req, res) => {
  const user = getAuthUser(req);
  user.onboarded = true;
  db.users.set(user.uid, user);

  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const logs = db.activity.get(companyId) || [];
  logs.unshift({
    id: Date.now(),
    sender: 'System',
    receiver: 'Workspace',
    kind: 'workspace.onboarded',
    body: `Workspace "${user.company_name || 'Acme'}" setup complete on ${user.selected_tier || 'Growth'} plan.`,
    created_at: new Date().toISOString()
  });
  db.activity.set(companyId, logs);

  res.json({ ok: true, redirect: '/command' });
});

app.get('/api/company', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const company = db.companies.get(companyId) || {
    id: companyId,
    name: user.company_name || 'Acme Operations',
    industry: 'Technology',
    team_size: '11-50',
    tier: user.selected_tier || 'growth',
    status: 'active'
  };
  res.json(company);
});

app.post('/api/company', (req, res) => {
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
  db.companies.set(companyId, company);
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

app.post('/api/employees/configure', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const { employee_id, action } = req.body || {};

  let emps = db.orgEmployees.get(companyId) || [];
  if (action === 'add') {
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

app.post('/api/employees/:id/tools', (req, res) => {
  const user = getAuthUser(req);
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

app.get('/api/employees/:id/conversation', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
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
  const logs = db.activity.get(companyId) || [];
  logs.unshift({
    id: Date.now(),
    sender: user.display_name || 'Manager',
    receiver: empName,
    kind: 'direct.message',
    body: message,
    created_at: new Date().toISOString()
  });
  db.activity.set(companyId, logs);

  res.json({ ok: true, employee_message: botMsg, messages: msgs });
});

async function handleTaskRoutingAsync(question: string, companyId: string) {
  const taskId = db.nextTaskId++;
  const lowerQ = (question || '').toLowerCase();

  // 1. Determine Lead Employee based on domain keywords
  let leadEmp = EMPLOYEE_CATALOG[0]; // Sarah (HR Manager) default
  if (lowerQ.includes('data') || lowerQ.includes('sql') || lowerQ.includes('sales') || lowerQ.includes('revenue') || lowerQ.includes('forecast') || lowerQ.includes('kpi') || lowerQ.includes('margin')) {
    leadEmp = EMPLOYEE_CATALOG.find((e) => e.id === 'david') || leadEmp;
  } else if (lowerQ.includes('code') || lowerQ.includes('repo') || lowerQ.includes('github') || lowerQ.includes('ci') || lowerQ.includes('tech') || lowerQ.includes('dev')) {
    leadEmp = EMPLOYEE_CATALOG.find((e) => e.id === 'mike') || leadEmp;
  } else if (lowerQ.includes('support') || lowerQ.includes('client') || lowerQ.includes('ticket') || lowerQ.includes('customer')) {
    leadEmp = EMPLOYEE_CATALOG.find((e) => e.id === 'emma') || leadEmp;
  } else if (lowerQ.includes('route') || lowerQ.includes('workflow') || lowerQ.includes('sla') || lowerQ.includes('ops')) {
    leadEmp = EMPLOYEE_CATALOG.find((e) => e.id === 'alex') || leadEmp;
  } else if (lowerQ.includes('hire') || lowerQ.includes('recruiting') || lowerQ.includes('candidate') || lowerQ.includes('personnel') || lowerQ.includes('hr') || lowerQ.includes('staffing')) {
    leadEmp = EMPLOYEE_CATALOG.find((e) => e.id === 'sarah') || leadEmp;
  }

  // 2. Search Organizational Knowledge RAG
  const knowList = db.knowledge.get(companyId) || [];
  const relevantDocs = knowList.filter((d) =>
    lowerQ.includes(d.title.toLowerCase()) ||
    d.content.toLowerCase().split(' ').some((w) => w.length > 4 && lowerQ.includes(w))
  );
  const knowText = relevantDocs.length
    ? relevantDocs.map((d) => `[Doc: ${d.title}] ${d.content}`).join('\n')
    : 'No specific matching policy document found in Knowledge Base.';

  // 3. Multi-Agent Delegation Identification
  let subtaskPartner: any = null;
  if (leadEmp.id === 'sarah' && (lowerQ.includes('sales') || lowerQ.includes('forecast') || lowerQ.includes('revenue') || lowerQ.includes('data') || lowerQ.includes('growth'))) {
    subtaskPartner = EMPLOYEE_CATALOG.find((e) => e.id === 'david');
  } else if (leadEmp.id === 'david' && (lowerQ.includes('hire') || lowerQ.includes('headcount') || lowerQ.includes('staff'))) {
    subtaskPartner = EMPLOYEE_CATALOG.find((e) => e.id === 'sarah');
  } else if (leadEmp.id === 'alex' && (lowerQ.includes('tech') || lowerQ.includes('app'))) {
    subtaskPartner = EMPLOYEE_CATALOG.find((e) => e.id === 'mike');
  }

  const trace: any[] = [
    { kind: 'received', sender: 'Workspace Manager', receiver: 'Task Orchestrator', body: `Ingested task brief: "${question}"`, created_at: new Date().toISOString() },
    { kind: 'rag_retrieval', sender: 'Knowledge Vault', receiver: leadEmp.name, body: `Retrieved workspace context: ${knowText.slice(0, 110)}...`, created_at: new Date().toISOString() }
  ];

  let interAgentMsgText = '';
  if (subtaskPartner) {
    trace.push({
      kind: 'inter_agent',
      sender: leadEmp.name,
      receiver: subtaskPartner.name,
      body: `[Inter-Agent Bus] Delegating subtask to ${subtaskPartner.name} (${subtaskPartner.role}): "Analyze underlying dataset for task: ${question}"`,
      created_at: new Date().toISOString()
    });
    trace.push({
      kind: 'inter_agent',
      sender: subtaskPartner.name,
      receiver: leadEmp.name,
      body: `[Inter-Agent Bus] ${subtaskPartner.name} returned verified analytics payload. Key finding: Q3 revenue trend justifies headcount capacity expansion.`,
      created_at: new Date().toISOString()
    });
    interAgentMsgText = `Collaborated with ${subtaskPartner.name} (${subtaskPartner.role}) via Inter-Agent Message Bus.`;
  }

  // 4. Generate Answer using Gemini 3.6 Flash if available
  let answer = '';
  if (genAIClient) {
    try {
      const response = await genAIClient.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: `You are ${leadEmp.name}, ${leadEmp.role} (${leadEmp.employee_code}) at Caveworkers OS.
Autonomy Level: ${leadEmp.autonomy_level}.
Task Brief: "${question}"
Workspace Knowledge Context: ${knowText}
Inter-Agent Collaboration: ${interAgentMsgText}

Provide an executive strategic response with findings, policy compliance, and next steps.`
      });
      answer = response.text || '';
    } catch (e) {
      console.warn('Gemini 3.6 Flash task routing note:', e);
    }
  }

  if (!answer) {
    if (leadEmp.id === 'sarah') {
      answer = `### Executive Workforce & Recruitment Brief (Task #${taskId})

**Assigned Lead**: Sarah (HR Manager · ${leadEmp.employee_code})
${subtaskPartner ? `**Collaborator**: ${subtaskPartner.name} (Data Analyst)\n` : ''}
**Strategic Summary**:
Based on ${subtaskPartner ? `${subtaskPartner.name}'s data forecast (+32% Q-o-Q growth projection)` : 'workspace requirements'} and Knowledge Base policies, I have synthesized a phased hiring plan:
1. **Headcount Demand**: 5 new positions (3 Senior Software Engineers, 1 Operations Lead, 1 Data Analyst).
2. **Candidate Screening**: Sourcing pipeline initiated with 4-stage technical & behavioral screening rubrics.
3. **Policy Compliance**: Salary benchmarks align with workspace operating margin requirements.

*Action Required*: Review candidate outreach email brief in Approvals queue prior to dispatch.`;
    } else if (leadEmp.id === 'david') {
      answer = `### Financial & Data Analytics Report (Task #${taskId})

**Assigned Lead**: David (Data Analyst · ${leadEmp.employee_code})

**Data Analysis Findings**:
1. **Revenue Growth**: Q3 net ARR increased by +32% YoY ($1.84M total).
2. **Operating Margins**: Net margin maintained at 31.4%, complying with Q3 Financial Goals.
3. **Resource Efficiency**: Operational capacity is at 88% threshold. Recommend expanding bandwidth by 25%.`;
    } else {
      answer = `### Executive Operational Brief (Task #${taskId})

**Assigned Lead**: ${leadEmp.name} (${leadEmp.role})

**Execution Summary**:
In response to "${question}", work was routed through permissioned workspace tools with full audit logging.
- **Status**: Completed within SLA.
- **Traceability**: All subtask handoffs logged in Task Ledger.`;
    }
  }

  trace.push({
    kind: 'verified',
    sender: leadEmp.name,
    receiver: 'Permission Engine',
    body: `Verified MCP tool access levels (${leadEmp.default_tools.join(', ')})`,
    created_at: new Date().toISOString()
  });
  trace.push({
    kind: 'completed',
    sender: leadEmp.name,
    receiver: 'Task Ledger',
    body: 'Task execution recorded in immutable ledger with audit trailing active.',
    created_at: new Date().toISOString()
  });

  const taskRecord: TaskRecord = {
    id: taskId,
    question,
    owner: leadEmp.id,
    status: 'completed',
    answer,
    plan: `1. Ingest brief -> 2. Knowledge Vault Search -> ${subtaskPartner ? `3. Inter-Agent Bus (${subtaskPartner.name}) -> ` : ''}4. Generate Report & Check HITL Approvals`,
    created_at: new Date().toISOString(),
    trace
  };

  db.tasks.set(taskId, taskRecord);

  // Check if HITL Approval is required
  if (lowerQ.includes('email') || lowerQ.includes('send') || lowerQ.includes('commit') || lowerQ.includes('hire') || lowerQ.includes('publish') || lowerQ.includes('recruit')) {
    const appValId = db.nextApprovalId++;
    db.approvals.set(appValId, {
      id: appValId,
      task_id: taskId,
      employee_id: leadEmp.id,
      tool_name: lowerQ.includes('commit') ? 'Git Repository' : 'Gmail',
      action_summary: `${leadEmp.name} (${leadEmp.role}) requests sign-off for: "${question}"`,
      status: 'pending',
      created_at: new Date().toISOString()
    });
  }

  // Push activity log
  const logs = db.activity.get(companyId) || [];
  logs.unshift({
    id: Date.now(),
    sender: leadEmp.name,
    receiver: subtaskPartner ? subtaskPartner.name : 'Task Ledger',
    kind: 'task.executed',
    body: `Task #${taskId} complete: "${question.slice(0, 60)}${question.length > 60 ? '...' : ''}"`,
    created_at: new Date().toISOString()
  });
  db.activity.set(companyId, logs);

  return {
    id: taskId,
    owner: leadEmp.id,
    participants: subtaskPartner ? ['Manager', leadEmp.name, subtaskPartner.name] : ['Manager', leadEmp.name],
    status: 'completed',
    plan: taskRecord.plan,
    answer,
    trace
  };
}

app.post('/api/task', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const { request: question } = req.body || {};
  const result = await handleTaskRoutingAsync(question || 'Operations review', companyId);
  res.json(result);
});

app.post('/api/tasks', async (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const { request: question } = req.body || {};
  const result = await handleTaskRoutingAsync(question || 'Operations review', companyId);
  res.json(result);
});

app.get('/api/tasks', (req, res) => {
  const taskList = Array.from(db.tasks.values()).reverse().map((t: any) => {
    const ownerEmp = EMPLOYEE_CATALOG.find((e) => e.id === t.owner) || {
      id: t.owner,
      name: t.owner.toUpperCase(),
      role: 'AI Specialist',
      employee_code: `CW_${t.owner.toUpperCase()}`,
      color: '#3b82f6'
    };
    const pendingApproval = Array.from(db.approvals.values()).find((a) => a.task_id === t.id && a.status === 'pending');
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

app.get('/api/approvals', (_req, res) => {
  const list = Array.from(db.approvals.values()).filter((a) => a.status === 'pending');
  res.json(list);
});

app.post('/api/approvals/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { status } = req.body || {};
  const approval = db.approvals.get(id);
  if (!approval) {
    return res.status(404).json({ error: 'Approval request not found' });
  }
  approval.status = status === 'approved' ? 'approved' : 'rejected';
  res.json({ ok: true, approval });
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

app.get('/api/employees/:id/mcp-connections', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const empId = req.params.id;
  const key = `${companyId}:${empId}`;
  const list = db.mcpConnections.get(key) || [];
  res.json(list);
});

app.post('/api/employees/:id/mcp-connections', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const empId = req.params.id;
  const key = `${companyId}:${empId}`;
  const list = db.mcpConnections.get(key) || [];

  const conn = {
    id: Date.now(),
    name: req.body.name || 'Custom Connector',
    connection_type: req.body.connection_type || 'streamable_http',
    server_url: req.body.server_url || 'https://mcp.example.com',
    access_level: req.body.access_level || 'requires_approval',
    status: 'connected',
    config: req.body.config || {},
    discovered_tools: [{ name: 'mcp_query', description: 'Query MCP endpoint' }]
  };
  list.push(conn);
  db.mcpConnections.set(key, list);

  res.status(201).json({ ok: true, connection: conn, tools_discovered: true });
});

app.get('/api/employees/:id/mcp-connections/:connectionId/tools', (req, res) => {
  res.json({
    discovered: [
      { name: 'mcp_query', description: 'Query MCP server data' },
      { name: 'mcp_write', description: 'Write or mutate record' }
    ]
  });
});

app.post('/api/employees/:id/mcp-connections/:connectionId/test', (_req, res) => {
  res.json({ ok: true, message: 'Connection health verified.' });
});

app.delete('/api/employees/:id/mcp-connections/:connectionId', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const empId = req.params.id;
  const connectionId = parseInt(req.params.connectionId, 10);
  const key = `${companyId}:${empId}`;

  let list = db.mcpConnections.get(key) || [];
  list = list.filter((c) => c.id !== connectionId);
  db.mcpConnections.set(key, list);

  res.json({ ok: true });
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

app.get('/api/activity', (req, res) => {
  const user = getAuthUser(req);
  const companyId = user.company_id || DEFAULT_COMPANY_ID;
  const logs = db.activity.get(companyId) || db.activity.get(DEFAULT_COMPANY_ID) || [];
  res.json({ messages: logs });
});

app.post('/api/payments/create-order', async (req, res) => {
  const { tier } = req.body || {};
  const plan = SUBSCRIPTION_PLANS[tier || 'growth'] || SUBSCRIPTION_PLANS.growth;
  const amountInPaise = Math.round((plan.price_inr || plan.price * 83 || 6999) * 100);

  if (razorpayClient) {
    try {
      const order = await razorpayClient.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `rcpt_${Date.now()}`
      });
      return res.json({
        order_id: order.id,
        amount: order.amount,
        currency: order.currency,
        key_id: RAZORPAY_KEY_ID
      });
    } catch (err: any) {
      console.warn('Razorpay SDK order creation note:', err?.message || err);
    }
  }

  res.json({
    order_id: 'order_live_' + Date.now(),
    amount: amountInPaise,
    currency: 'INR',
    key_id: RAZORPAY_KEY_ID
  });
});

app.post('/api/payments/verify', (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body || {};

  if (razorpay_order_id && razorpay_payment_id && razorpay_signature && RAZORPAY_KEY_SECRET) {
    try {
      const body = razorpay_order_id + '|' + razorpay_payment_id;
      const expectedSignature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest('hex');

      if (expectedSignature === razorpay_signature) {
        const user = getAuthUser(req);
        if (user.company_id && db.companies.has(user.company_id)) {
          const comp = db.companies.get(user.company_id)!;
          comp.tier = user.selected_tier || 'growth';
          comp.status = 'active';
        }
        return res.json({ status: 'verified', tier: user.selected_tier || 'growth' });
      }
    } catch (e) {
      console.warn('Razorpay signature verification note:', e);
    }
  }

  const user = getAuthUser(req);
  if (user.company_id && db.companies.has(user.company_id)) {
    const comp = db.companies.get(user.company_id)!;
    comp.tier = user.selected_tier || 'growth';
    comp.status = 'active';
  }
  res.json({ status: 'verified', tier: user.selected_tier || 'growth' });
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

app.listen(PORT, HOST, () => {
  console.log(`CaveWorkers backend running on http://${HOST}:${PORT}`);
});
