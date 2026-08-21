# Caveworkers deployment gate

Caveworkers must not be exposed publicly until all conditions below are true.

1. Set `CAVEWORKERS_ENV=production`, a public HTTPS `ALLOWED_ORIGINS`, and a managed secret-injection path. Never bake `.env` into an image.
2. Rotate the Firebase Admin credential, OAuth state secret, Razorpay API/webhook secrets, Google connector OAuth client secret, OpenRouter key, Sentry DSN if applicable, and connector encryption key according to [`SECURITY_ROTATION.md`](SECURITY_ROTATION.md).
3. Deploy the single Node.js/TypeScript Express service from the repository Dockerfile. All employee roles execute inside this service; no external employee endpoints are required.
4. Use Firestore with backups and restore testing for the durable records supported by the application. Users, companies, tasks, approvals, activity logs, tenant connectors, employee memory, and workforce jobs use Firestore when configured; presence, request limits, and SSE connections still have process-local components that must be migrated or kept behind a controlled single-worker deployment.
5. Use an external rate limiter, shared queue lease/realtime layer, and idempotency strategy before running multiple active instances.
6. Configure Sentry or an equivalent error monitor, availability checks, alert routing, an incident owner, a support inbox, and a restore drill.
7. Complete legal review for Terms, Privacy Policy, DPA, retention/deletion/export, model-data handling, and subprocessor disclosure.

## Safe release checks

```bash
npm ci
npm run lint
npm test
npm run build
```

After the service is running, verify `/api/health`, Google sign-in, session logout, onboarding, trial expiry, Razorpay signature and webhook rejection, tenant-scoped task reads, CSRF rejection, and connector approval gates. The application fails closed in production when required payment secrets are missing and protected APIs require verified Firebase sessions. Tenant-scoped OAuth/MCP connections are the only supported connector configuration; legacy global Slack, Notion, SQL, Ollama, and specialist-service variables are not part of the runtime.

## Google sign-in and Firebase profile persistence

Before enabling user login, activate **Google** under Firebase Authentication providers, create or confirm the Firestore database, and add the deployed HTTPS hostname to Firebase Authentication’s authorized domains. Local development should use `localhost`.

The server accepts one of these credential configurations: `FIREBASE_SERVICE_ACCOUNT_PATH` pointing to a service-account JSON file, the environment trio `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`, or `GOOGLE_APPLICATION_CREDENTIALS` for application-default credentials. Keep these values in the deployment secret store; do not commit them.

After a successful Google sign-in, the server verifies the Firebase ID token, writes the account profile to `users/{firebase_uid}` in Firestore with merge semantics, creates or updates the related `companies/{company_id}` document, and issues a Firebase session cookie. The client no longer accepts email or display-name values as a substitute for a verified Google token.

## Specialist workforce and OpenRouter production configuration

Caveworkers uses the OpenRouter-compatible chat-completions API when `OPENROUTER_API_KEY` is present. Inject the key through Cloud Run or Google AI Studio Secret Manager/environment configuration; never place it in `.env`, the Docker image, client-side code, GitHub files, browser storage, or a command-line argument. The current source defaults were validated against OpenRouter's live Models API on 2026-08-20 and remain environment-overridable.

The default specialist roster is role-specific: David uses `google/gemini-3.1-pro-preview` for long-context analysis; Mike uses `openai/gpt-5.3-codex` for repository, API, and infrastructure work; Iris uses `anthropic/claude-sonnet-5` for security and compliance reasoning; Priya uses `openai/gpt-5.4` for structured finance and operations; Olivia uses `anthropic/claude-sonnet-5` for sales operations; Maya uses `google/gemini-3.7-flash` for fast growth work; Emma uses `anthropic/claude-haiku-4.5` for responsive support; Arav uses `anthropic/claude-sonnet-5` for sensitive people operations; Alex uses `google/gemini-3.7-flash` for workflow coordination; and Sarah uses `anthropic/claude-sonnet-5` for executive and workforce planning. Each role has a current-model fallback. Every model can be overridden with `SARAH_MODEL`, `DAVID_MODEL`, `ALEX_MODEL`, `MIKE_MODEL`, `EMMA_MODEL`, `ARAV_MODEL`, `OLIVIA_MODEL`, `MAYA_MODEL`, `PRIYA_MODEL`, or `IRIS_MODEL`; `WORKFORCE_MODEL` overrides the full roster only when an operator intentionally needs a temporary common model.

David's Analyst Lab uses `ANALYST_MODEL=google/gemini-3.1-pro-preview` by default. Configure `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`, `OPENROUTER_TIMEOUT_MS=30000`, `ANALYST_MAX_TOKENS=900`, and `PUBLIC_APP_URL=https://mycaveworkers.ai.studio`. OpenRouter requests include attribution headers and a one-way tenant hash as the provider `user` identifier; raw company IDs are never sent. The server records provider, model, latency, and usage metadata without recording the API key or prompt content in operational failure reports.

The API key supplied in chat is exposed and must be revoked in OpenRouter key settings before production use. Create a replacement and store it only in the managed secret store. For the user-controlled Google Cloud project, use `caveworkers-505714` and configure Cloud Run without putting the secret value in shell history or CI logs:

```bash
printf '%s' "$NEW_OPENROUTER_API_KEY" | gcloud secrets versions add openrouter-api-key --project caveworkers-505714 --data-file=-
gcloud run services update caveworkers \
  --project caveworkers-505714 \
  --region asia-southeast1 \
  --set-secrets OPENROUTER_API_KEY=openrouter-api-key:latest \
  --set-env-vars ANALYST_MODEL=google/gemini-3.1-pro-preview,OPENROUTER_BASE_URL=https://openrouter.ai/api/v1,OPENROUTER_TIMEOUT_MS=30000,ANALYST_MAX_TOKENS=900,PUBLIC_APP_URL=https://mycaveworkers.ai.studio
```

Grant the Cloud Run runtime service account `roles/secretmanager.secretAccessor` first. OpenRouter provider routing should remain compatible with tool-bearing requests, and any provider data-retention policy must be reviewed against customer contracts. External email, Slack, Sheets writes, and arbitrary MCP write actions remain approval-gated. Live Google OAuth and custom MCP transport must be attached through tenant-scoped connectors before those tools can be enabled.

## Trial, payment, and request controls

New workspaces start with a three-day `free_trial` window when onboarding is completed. The command center displays the remaining time, and expired trial workspaces receive `402` responses with `upgrade_required: true` for protected workspace actions. Paid plan activation requires a real Razorpay order and a server-verified signature; missing or invalid payment data never activates a paid tier.

Configure `RAZORPAY_WEBHOOK_SECRET` in the deployment secret store and register `https://YOUR_DOMAIN/api/payments/webhook` in Razorpay. The webhook validates `X-Razorpay-Signature`, accepts captured or authorized payment events, and synchronizes payment status to the Firestore company and user records. The client-side payment verification remains an immediate response path, while the webhook provides an idempotent provider confirmation path.

Payment orders are durable documents in the root `payments/{order_id}` collection, not only in process memory. Each order records `uid`, `company_id`, `tier`, `amount`, `currency`, `status`, timestamps, and an optional `idempotency_key`; the status moves from `created` to `verified` or `failed`. The create-order API authenticates before checking Razorpay configuration, persists the order to Firestore before returning it to the browser, and accepts the same endpoint aliases used by the onboarding and Settings clients (`/api/payments/create-order` and `/api/create-order`, plus `/api/payments/verify` and `/api/verify-payment`). Verification and webhook handlers recover orders from Firestore when another Cloud Run instance created them, reject cross-tenant ownership, and treat duplicate verification as safe and idempotent. Deploy the payment collection rule with the rest of `firestore.rules`; do not grant broad signed-in-user access to root payment documents.

The server checks the `X-CSRF-Token` header against the `cw_csrf` cookie for unsafe API methods, restricts credentialed CORS to `ALLOWED_ORIGINS`, and applies local-process rate limits to login, task, payment, and analyst execution endpoints. The limiter is not shared between instances; use an external edge limiter or shared limiter before horizontal scaling.

## Data durability and worker recovery

Users and companies are persisted to Firestore. Tenant tasks, approvals, activity logs, workforce queue jobs, employee memory, and direct employee conversations are also written to Firestore and rehydrated/claimed when Firebase is configured. The production strategy additionally persists immutable audit events, monthly usage ledgers, and idempotent activation events. Company Room SSE connections, employee presence, connector discovery caches, knowledge snapshots, and local rate-limit windows retain process-local components in this release. Use a controlled single-worker deployment for those realtime paths or complete the shared datastore/realtime migration before horizontal scaling.

### Firestore rules and strategy collections

The repository includes `firebase.json` and `firestore.rules` for tenant-scoped database isolation. Deploy the rules from an authenticated operator environment with the user-controlled project selected:

```bash
firebase use caveworkers-505714
firebase deploy --project caveworkers-505714 --only firestore:rules
```

The Firebase CLI deployment itself does not require application environment variables. The running service still needs a service account or application-default credential with Firestore access, plus `FIREBASE_PROJECT_ID=caveworkers-505714` when the runtime does not infer the project automatically. Keep `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, or `GOOGLE_APPLICATION_CREDENTIALS` in the managed secret/runtime configuration; never commit them. Firestore client rules protect browser access, while the Express API must continue enforcing verified sessions and tenant membership because Firebase Admin SDK writes bypass client security rules.

In production, `/api/health` performs a Firestore readiness probe and returns HTTP `503` with `status: "degraded"` and `ready: false` when Firestore is missing or the probe fails. Persistence helpers report the operational failure and refuse to fall back to process-local state. An unconfigured Firestore is intentionally tolerated only in non-production development and test runs; before accepting traffic, require an HTTP 200 health response with `components.database.status: "active"`.

The following records are created under `tenants/{company_id}` and must be included in backup, retention, and tenant-erasure procedures:

| Collection | Purpose | Identifier and isolation rule |
| --- | --- | --- |
| `audit_events` | Immutable security, queue, prompt-injection, RBAC, and connector action evidence | Document ID is a generated event ID; every document carries immutable `company_id` |
| `usage_ledger` | Current-period task, completion, tool-call, external-action, and estimated-token counters | One document per tenant and `YYYY-MM` period |
| `activation_events` | Idempotent activation funnel milestones such as first task created/completed | Document ID is `{company_id}:{event_name}`; duplicate writes are ignored |
| `connectors`, `employees`, `tasks`, `approvals`, `activity`, and `knowledge` | Existing tenant workforce state and connector configuration | Nested below the tenant document; secrets remain encrypted and are never returned to clients |
| `employee_memory` and `conversations` | Durable specialist memory and direct employee-to-user conversation history | Nested below the tenant document; employee ID is part of the document path and messages are bounded server-side |

Workforce queue jobs are stored in the top-level `workforce_jobs` collection. Each job carries `company_id`, an idempotency key where supplied, retry/dead-letter metadata, and a claim status. Before horizontal scaling, migrate the remaining process-local realtime and rate-limit components and add shared queue lease monitoring.

## David connectors: Gmail, Google Sheets, and custom MCP

David’s connector registry is tenant-scoped. A connector is stored under `tenants/{company_id}/connectors`, while OAuth tokens and custom MCP bearer tokens are encrypted before persistence with `MCP_TOKEN_ENCRYPTION_KEY`. The API never returns the encrypted token or raw credentials to the browser.

Create a Google OAuth 2.0 **Web application** client and add the exact callback URL `https://YOUR_DOMAIN/api/google/oauth/callback` to its authorized redirect URIs. Configure `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `PUBLIC_APP_URL`, and `GOOGLE_OAUTH_REDIRECT_URI` in the managed secret/runtime configuration. The default callback is `${PUBLIC_APP_URL}/api/google/oauth/callback` when `GOOGLE_OAUTH_REDIRECT_URI` is omitted.

Gmail uses the restricted read-only scope `https://www.googleapis.com/auth/gmail.readonly`; Google Sheets uses `https://www.googleapis.com/auth/spreadsheets.readonly`. Users grant access to their own Google account through the OAuth consent screen. Caveworkers stores the refresh token encrypted and exposes only connection status, granted scopes, and optional account email to the tenant workspace. Configure the OAuth consent screen, publishing status, authorized domains, and Google API enablement in Google Cloud before inviting customers.

Custom MCP servers must be registered with an HTTPS Streamable HTTP endpoint in production. Private-network hosts, localhost, embedded URL credentials, and unencrypted HTTP are rejected in production. Optional bearer tokens are encrypted at rest and never shown again after submission. David can discover tools, but tool grants are per-connector and per-tool. Read tools may execute only after an explicit read grant; write-capable tools always create a pending human approval record and are not dispatched automatically by the current release.

To enable durable connector credentials, create a high-entropy secret and inject it as `MCP_TOKEN_ENCRYPTION_KEY`. Rotating this key without a migration plan makes previously stored connector tokens unreadable, so rotate through a controlled re-encryption or reconnect procedure. Before public multi-instance deployment, move the in-process connector cache to the same managed datastore/queue used for the rest of the control plane and add external rate limiting.

The connector API is available from David’s data lab and Workspace Settings. The current integration includes bounded Gmail metadata search and Google Sheets preview reads. Gmail sending, Sheets writes, arbitrary MCP write calls, and scheduled autonomous execution remain approval-gated rather than silently enabled actions.

## Always-on employee worker and company workroom

The current release includes a bounded always-on worker loop inside the Node service. New manager tasks enter a tenant-scoped Firestore-backed queue when Firestore is configured, the worker claims one job at a time, updates employee presence, emits company-workroom events, and persists task progress and collaboration traces. The command center consumes the authenticated workroom snapshot and Server-Sent Events stream at `/api/workforce/workroom` and `/api/workforce/stream`.

For a persistent deployment, set `ALWAYS_ON_WORKER_ENABLED=true`, choose `WORKER_POLL_MS` between 500 and 10000 milliseconds, and optionally set a stable `WORKER_INSTANCE_ID` for logs. The worker uses a Firestore transaction when Firestore is configured to reduce duplicate claims across instances. The process-local event stream is instance-local, so a multi-instance rollout needs a shared realtime broker or sticky routing for complete cross-instance event delivery.

The hosting option should run the Node service and worker with automatic restart, health checks, encrypted runtime secrets, structured logs, and bounded concurrency. Do not run multiple unmanaged copies with separate local queues. Before inviting production customers at horizontal scale, use a managed queue/lease store, an external rate limiter, idempotency keys, dead-letter handling, retry backoff, and an operator alert when jobs remain processing beyond their lease.

## Controlled internet research

Set `WEB_RESEARCH_ENABLED=true` only after configuring either `TAVILY_API_KEY` or `BRAVE_SEARCH_API_KEY` in the managed secret store. The worker sends a bounded question to one provider, limits the result count, allows only HTTPS result URLs, rejects localhost and private-network hosts after DNS resolution, fetches a bounded page excerpt, and stores title, URL, snippet, and fetched evidence in the tenant task trace. The manager can see the source metadata in the company workroom.

Internet research is retrieval-only. It does not grant an employee permission to send messages, change records, make purchases, publish content, or call arbitrary private endpoints. External writes remain connector-specific and approval-gated. Treat web pages as untrusted data: employees may summarize retrieved content, but page instructions must never be executed as system commands or connector authorization.

A suitable deployment must also provide a process supervisor, TLS, outbound egress controls, request timeouts, provider quotas, audit retention, and a restart/recovery test. The current worker is appropriate for a controlled alpha or single-worker deployment; a public multi-instance deployment should complete the shared queue/realtime migration before relying on unattended execution.

## Worker environment reference

```text
ALWAYS_ON_WORKER_ENABLED=true
WORKER_POLL_MS=1500
WORKER_INSTANCE_ID=<stable-instance-label>
WEB_RESEARCH_ENABLED=false
TAVILY_API_KEY=<managed-secret-if-used>
BRAVE_SEARCH_API_KEY=<managed-secret-if-used>
```

Keep `WEB_RESEARCH_ENABLED=false` until a provider key, domain policy, monitoring, and retention policy are approved. Never place provider keys in browser code, committed files, Docker build arguments, or task payloads.

## Scheduled workflows and Cloud Scheduler

Caveworkers supports tenant-scoped one-time and recurring scheduled workflows through `POST /api/workflows/scheduled`. Each workflow stores its tenant, prompt, timezone, schedule type, next-run timestamp, run count, status, and idempotency metadata. Cron schedules use standard five-field expressions and are validated before persistence. Prompt-injection instructions are rejected before a schedule is stored. Each due run is claimed idempotently and converted into the existing workforce queue, so a retried scheduler tick cannot create duplicate tasks.

For a controlled single-worker deployment, the service can poll due workflows internally. Configure the following managed runtime values:

```text
WORKFLOW_SCHEDULER_POLL_MS=60000
SCHEDULER_TICK_SECRET=<high-entropy-managed-secret>
TENANT_DELETION_GRACE_DAYS=14
```

`WORKFLOW_SCHEDULER_POLL_MS` is bounded by the application between 30 seconds and 10 minutes. `SESSION_COOKIE_MAX_AGE_MS` is bounded between one and 90 days and defaults to 30 days; keep it aligned with your security policy. Browser static assets use ETags and a one-day cache policy, while authenticated API responses remain tenant-scoped and are not browser-cached. `SCHEDULER_TICK_SECRET` is required in production for the signed internal endpoint. Do not expose `/api/internal/workflows/tick` publicly without an authenticated scheduler identity or an equivalent network control.

For Cloud Run deployments that may scale to zero or multiple instances, configure Cloud Scheduler or an equivalent managed scheduler to call the internal tick endpoint at least once per minute. The request must include the secret in `X-Caveworkers-Scheduler-Secret` and should use a small timeout with retry enabled. Example shape:

```bash
gcloud scheduler jobs create http caveworkers-workflow-tick \
  --project caveworkers-505714 \
  --location asia-southeast1 \
  --schedule="* * * * *" \
  --uri="https://YOUR_DOMAIN/api/internal/workflows/tick" \
  --http-method=POST \
  --headers="X-Caveworkers-Scheduler-Secret=$SCHEDULER_TICK_SECRET" \
  --attempt-deadline=30s
```

For production, store the scheduler secret in Secret Manager and use a managed authentication mechanism or a private ingress path where available. The internal endpoint does not accept a tenant identifier or task payload; it only processes already-persisted due schedules, which prevents it from becoming an external task-submission backdoor.

Scheduled task execution remains subject to workspace status, trial state, monthly quotas, prompt-injection controls, connector readiness, approval gates, audit logging, and idempotency. A workspace in deletion status cannot receive new scheduled work.

## Workspace export, deletion, and retention controls

Owners can request a tenant export from `GET /api/tenant/:companyId/export` and request deletion through `DELETE /api/tenant/:companyId`. The export is tenant-scoped and redacts encrypted connector credentials. The deletion request immediately marks the company as `deletion_requested`, revokes locally stored connector credentials, pauses operational routes, and schedules hard deletion after `TENANT_DELETION_GRACE_DAYS` days. The default grace period is 14 days and is bounded by the application between 1 and 30 days.

The export and deletion status routes remain available during the grace period so an owner can retrieve the export and inspect the scheduled erasure time. Cancellation is intentionally an operator-controlled process in this release; configure a support contact and document identity verification before processing cancellation or restoration requests. Hard deletion removes the company, users, employee records, tasks, approvals, connectors, schedules, queue jobs, audit data, usage records, activation records, and other tenant-scoped records from the configured durable store. Test the cascade against a backup copy before enabling customer-facing deletion.

## Trust center and activation visibility

The public trust center is available at `/trust`. It describes the current security boundary, encryption-at-rest approach, tenant isolation, audit evidence, incident response expectations, subprocessors, deletion rights, and the fact that Caveworkers does not claim SOC 2 or ISO certification unless separately obtained. Review the page with counsel before treating it as a contractual compliance statement.

The Company Room now displays activation progress and monthly task/tool-call utilization using `GET /api/usage`. The activation panel is an operational onboarding aid, not a billing guarantee; entitlement enforcement remains server-side through the quota and workspace-access guards.

## Continuous integration release gate

The repository’s `.github/workflows/ci.yml` now uses Node.js 22 and blocks merges or main-branch releases unless `npm ci`, `npm run build`, `npm run lint`, `npm test`, and `git diff --check` pass. Keep the workflow environment free of production credentials. Connector, Firebase, Razorpay, and provider acceptance tests that require real accounts must remain separate from this deterministic CI gate.

The current `npm audit --omit=dev` report contains six moderate transitive `uuid` findings through the Google/Firebase dependency tree. Do not run `npm audit fix --force` blindly: the suggested remediation would downgrade `firebase-admin` across a breaking major-version boundary. Track this as a dependency-upgrade item, validate the Firebase Admin migration in a branch, and only then update the lockfile.

## Current operational boundary

The employee experience supports automatic queued task progression, persistent task traces while a worker is processing, manager-visible company-room updates, bounded research evidence, and approval-aware completion. It does not provide unrestricted autonomous mutation of customer systems. This boundary is intentional and should remain in place until each connector has a documented action policy, idempotency strategy, approval path, and rollback behavior.

## References

- [1] [Firebase Admin setup](https://firebase.google.com/docs/admin/setup)
- [2] [Cloud Run documentation](https://cloud.google.com/run/docs)
- [3] [Razorpay webhooks](https://razorpay.com/docs/webhooks/)
- [4] [Google OAuth 2.0 for web-server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [5] [OpenRouter API documentation](https://openrouter.ai/docs)
