# Caveworkers

Caveworkers is a multi-tenant SaaS control plane for a monitored AI workforce. It combines a server-rendered Express/EJS application with Firebase Authentication, Firestore persistence, tenant-scoped connectors, approval gates, and a collaborative employee workroom. The service is designed for Indian SMB and mid-market teams with INR plans: a three-day free trial, Starter at ₹1,999, Growth at ₹6,999, and Enterprise at ₹14,999.

> **Production boundary:** Caveworkers keeps external writes approval-gated. Employees can analyze, plan, retrieve bounded evidence, and collaborate, but they must not silently send messages, mutate customer systems, publish content, or make purchases.

## Current architecture

| Layer | Current implementation |
|---|---|
| Runtime | Node.js 22, TypeScript, native ESM |
| HTTP application | Express with EJS templates and vanilla browser JavaScript/CSS |
| Identity | Firebase Google sign-in, Firebase Admin ID-token verification, revocation-checked session cookies |
| Durable system of record | Firestore for verified users, companies, tenant connectors, employee memory, tasks, approvals, activity logs, and workforce jobs when Firebase is configured |
| Tenant boundary | The verified Firebase user resolves the company ID; tenant collections and API reads/writes are scoped to that company |
| AI analyst | OpenRouter-compatible chat completions with Qwen as the preferred provider and Gemini fallback |
| Payments | Razorpay order creation, server-side signature verification, webhook HMAC verification, and trial/plan enforcement |
| Connectors | Tenant-scoped Gmail, Google Sheets, and HTTPS custom MCP connections with encrypted bearer tokens and per-tool grants |
| Workforce | A bounded process worker with Firestore-backed queue claims, task traces, employee presence, and SSE workroom updates |
| Hosting | Dockerized Node service suitable for Google Cloud Run / Google AI Studio deployment |

The main application entry point is [`server.ts`](server.ts). It currently contains the route layer, middleware, Firebase adapters, employee catalog, connector logic, workroom worker, and payment handlers. The production notes in [`DEPLOYMENT.md`](DEPLOYMENT.md) describe the current single-process worker boundary and the requirements for horizontal scaling.

## Local setup

Caveworkers requires **Node.js 22 or newer** and npm. Confirm the runtime before installing dependencies:

```bash
node --version
npm --version
```

Create a local environment file and install the locked dependency tree:

```bash
# macOS/Linux
cp .env.example .env
npm ci

# Windows PowerShell
Copy-Item .env.example .env
npm ci
```

Generate high-entropy secrets with Node.js rather than Python tooling:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Use one generated value for `FLASK_SECRET` (the historical environment-variable name retained for OAuth-state compatibility) and a separate generated value for `MCP_TOKEN_ENCRYPTION_KEY`. Never reuse either value, commit `.env`, or place credentials in a Docker build argument.

### Firebase configuration

Create or select the Firebase project, enable Google under Firebase Authentication, create the Firestore database, and add the local or deployed hostname to Firebase Authentication authorized domains. For the server-side Admin SDK, use exactly one of these configurations:

1. `FIREBASE_SERVICE_ACCOUNT_PATH` pointing to a service-account JSON file outside the repository.
2. `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY` injected by the runtime secret store.
3. `GOOGLE_APPLICATION_CREDENTIALS` for an application-default credential supplied by the hosting platform.

The browser Firebase configuration is public client configuration. The Admin SDK credential and private key are not public and must never be placed in templates, browser code, GitHub, or the image filesystem.

### Minimum local environment

For a useful authenticated local run, configure Firebase Admin credentials, `FIREBASE_PROJECT_ID`, a local `PUBLIC_APP_URL`, `ALLOWED_ORIGINS`, `FLASK_SECRET`, and `MCP_TOKEN_ENCRYPTION_KEY`. Razorpay, OpenRouter, Google connector OAuth, and web-research values are optional locally, but the corresponding capability remains unavailable until configured. Production startup additionally requires payment webhook secrets and secure tenant configuration; see [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Run, check, and build

Start the development server with hot reload:

```bash
npm run dev
```

The default local URL is `http://localhost:3000` unless `PORT` is set. Run the compiler checks and production build before committing:

```bash
npm run lint
npm test
npm run build
```

Run the compiled service exactly as the container does:

```bash
npm run build
npm start
```

The health endpoint is public and should return component status without exposing secrets:

```bash
curl http://localhost:3000/api/health
```

## Main application routes

| Route | Purpose | Authentication |
|---|---|---|
| `/` | Public landing page | Public |
| `/login` | Google sign-in entry point | Public |
| `/onboarding` | Workspace and plan onboarding | Verified Firebase session |
| `/command` | Tenant command center and company workroom | Verified Firebase session |
| `/analyst` | David’s data-analysis workspace | Verified Firebase session |
| `/employee/:id` | Employee-specific workspace | Verified Firebase session |
| `/settings` | Tenant connector and workspace settings | Verified Firebase session |
| `/api/health` | Liveness/configuration summary | Public |
| `/api/workforce/workroom` | Tenant-scoped workroom snapshot | Verified Firebase session and active trial/plan |
| `/api/workforce/stream` | Tenant-scoped Server-Sent Events stream | Verified Firebase session and active trial/plan |
| `/api/payments/webhook` | Razorpay provider callback | Public endpoint with HMAC verification |

Unsafe API methods require the double-submit CSRF token (`cw_csrf` cookie plus `X-CSRF-Token` header), except for the explicitly public session and Razorpay webhook paths. Credentialed cross-origin requests are restricted to the normalized `ALLOWED_ORIGINS` list and same-origin requests.

## Tenancy and data safety

Every protected request begins with a Firebase session cookie. The server resolves the user’s company ID and uses it to scope tasks, approvals, memory, connectors, workroom events, and employee activity. A request cannot select another company by passing a company ID in the body or query string. The service also rejects unverified or non-Google sign-in tokens.

Firestore tenant data follows the `tenants/{company_id}/...` pattern. Tasks, approvals, activity logs, and workforce jobs are written to Firestore when configured. Tasks and queued jobs are hydrated during tenant access and worker startup; stale processing leases are returned to the queue after the recovery threshold. Process-local caches remain for low-latency reads, employee presence, rate-limit windows, and SSE connections; the caches are not a substitute for a shared datastore in a multi-instance rollout.

### Durability boundary and migration path

| Record or runtime state | Current source of truth | Multi-instance status | Next hardening step |
|---|---|---|---|
| Users and companies | Firestore with bounded process cache | Durable | Add scheduled restore drills and retention policy checks |
| Tasks and approvals | Firestore tenant subcollections with process cache | Durable when Firebase is configured | Add archival/TTL policy and reconciliation metrics |
| Activity logs | Firestore tenant activity subcollection with process cache | Durable when Firebase is configured | Add immutable audit export and retention controls |
| Workforce jobs | Firestore `workforce_jobs` collection with transactional claims | Recoverable and claim-safe | Add lease metrics, dead-letter handling, and a dedicated worker service |
| Employee presence | Process memory | Single-instance only | Move presence and heartbeats to a shared realtime store |
| SSE connections | Process memory | Instance-local | Use a shared pub/sub fan-out or managed realtime gateway |
| Request rate limits | Process memory | Instance-local | Use a shared rate-limit store such as Redis or a managed equivalent |
| Conversations, knowledge, connector discovery, and analyst caches | Process memory or tenant adapters depending on record type | Not uniformly durable | Migrate each collection behind the tenant Firestore adapter before horizontal scale |

Do not scale the worker horizontally until queue leasing, realtime event delivery, rate limiting, and the remaining operational caches have a managed shared implementation.

## Authentication, plans, and payments

New workspaces receive a three-day `free_trial` window during onboarding. Trial expiry is enforced server-side: protected workspace actions return HTTP `402` with `upgrade_required: true` after the recorded trial end time. Paid activation uses a server-created Razorpay order, checks the expected plan and amount, verifies the Razorpay payment signature with the server secret, and records provider confirmation through the webhook path. Client input never chooses a paid tier after verification.

Configure the Razorpay key pair and webhook secret through the managed secret store. Use Razorpay live credentials only after completing a live-mode test with a real webhook delivery, idempotency review, refund procedure, and financial reconciliation process. The product plans and INR amounts are defined in `server.ts`; update pricing deliberately and review payment tests whenever they change.

## Employee workroom and connectors

The always-on worker accepts manager tasks, claims one job at a time, updates the task trace and employee presence, routes collaboration among the employee catalog, and emits tenant-scoped SSE events. Web research is opt-in, bounded, retrieval-only, and protected by HTTPS/private-network URL checks. It must not be treated as an authorization channel.

David can use tenant-configured Gmail read-only, Google Sheets read-only, and custom HTTPS MCP connections. Google OAuth refresh tokens and custom MCP bearer tokens are encrypted with `MCP_TOKEN_ENCRYPTION_KEY`. Tool grants are per connector and per tool. Read operations require an explicit read grant; mutating tools create a pending human approval record and are not dispatched automatically by the current release.

For Google connector OAuth, create a Google OAuth 2.0 Web application client and add the exact callback `${PUBLIC_APP_URL}/api/google/oauth/callback` to the authorized redirect URIs. The required scopes are Gmail read-only and Sheets read-only. For custom MCP, production endpoints must use HTTPS and must not resolve to localhost, private-network addresses, or embedded URL credentials.

## Environment reference

The checked-in [`.env.example`](.env.example) contains only variables read by the current Node service. The important groups are:

| Group | Variables |
|---|---|
| Runtime/security | `CAVEWORKERS_ENV`, `PORT`, `ALLOWED_ORIGINS`, `COOKIE_SECURE`, `FLASK_SECRET`, `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE` |
| Firebase | `FIREBASE_*`, `FIREBASE_SERVICE_ACCOUNT_PATH`, `GOOGLE_APPLICATION_CREDENTIALS` |
| Payments | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` |
| Analyst | `OPENROUTER_API_KEY`, `OPENROUTER_BASE_URL`, `ANALYST_MODEL`, `OPENROUTER_TIMEOUT_MS`, `ANALYST_MAX_TOKENS`, optional `GEMINI_API_KEY`, `PUBLIC_APP_URL` |
| Google connectors | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` |
| Connector encryption | `MCP_TOKEN_ENCRYPTION_KEY` |
| Worker/research | `ALWAYS_ON_WORKER_ENABLED`, `WORKER_POLL_MS`, `WORKER_INSTANCE_ID`, `WEB_RESEARCH_ENABLED`, optional `TAVILY_API_KEY`, `BRAVE_SEARCH_API_KEY` |

Use a managed secret store for private values in Cloud Run. Do not copy production secrets into `.env.example`, GitHub Actions logs, browser JavaScript, task payloads, or container build arguments.

## Production deployment

Read [`DEPLOYMENT.md`](DEPLOYMENT.md) before exposing the service. A production deployment must use HTTPS, verified Google OAuth configuration, a managed secret injection path, Firestore backups and restore testing, Sentry or equivalent alerting, an external rate limiter, and an operational owner for incidents and data deletion requests.

For the configured Google AI Studio / Cloud Run target, build the container with the repository [`Dockerfile`](Dockerfile), deploy it to project `verdant-lotus-g46tg` in region `asia-southeast1`, and keep the service name `caveworkers` unless the environment requires a deliberate change. The runtime service account needs Firestore access and Secret Manager access only to the secrets it requires. Configure the deployed public URL in `PUBLIC_APP_URL`, `ALLOWED_ORIGINS`, Firebase authorized domains, Google OAuth redirect URIs, and Razorpay webhook settings.

Cloud Run may create more than one instance. The current process-local SSE stream, presence cache, activity cache, request limiter, and parts of the task cache therefore require a shared service or sticky single-worker deployment. A controlled single-instance alpha is acceptable while this migration is completed; a public multi-instance release must not rely on independent in-memory queues.

## Security rotation

Use [`SECURITY_ROTATION.md`](SECURITY_ROTATION.md) for the ordered rotation procedure. Rotate Firebase service-account credentials, Razorpay credentials and webhook secret, Google OAuth client secret, OpenRouter API key, `FLASK_SECRET`, and `MCP_TOKEN_ENCRYPTION_KEY` through the deployment secret store. Rotating the connector encryption key requires a controlled re-encryption or tenant reconnect process because existing encrypted connector tokens cannot be decrypted with a new key.

## References

- [1] [Node.js documentation](https://nodejs.org/en/docs)
- [2] [Express documentation](https://expressjs.com/)
- [3] [Firebase Admin SDK documentation](https://firebase.google.com/docs/admin/setup)
- [4] [Cloud Firestore documentation](https://firebase.google.com/docs/firestore)
- [5] [Cloud Run documentation](https://cloud.google.com/run/docs)
- [6] [Razorpay webhook documentation](https://razorpay.com/docs/webhooks/)
- [7] [Google OAuth 2.0 web-server documentation](https://developers.google.com/identity/protocols/oauth2/web-server)
