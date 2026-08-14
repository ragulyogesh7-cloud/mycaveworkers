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

## David analyst / OpenRouter production configuration

David uses the OpenRouter-compatible chat-completions API when `OPENROUTER_API_KEY` is present. Inject the key through the Cloud Run or Google AI Studio secret manager/environment configuration; never place it in `.env`, the Docker image, client-side code, GitHub files, or a command-line argument. Configure `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`, `ANALYST_MODEL=qwen/qwen3-30b-a3b`, `OPENROUTER_TIMEOUT_MS=30000`, `ANALYST_MAX_TOKENS=900`, and `PUBLIC_APP_URL=https://YOUR_DOMAIN`. The request includes OpenRouter attribution headers and a one-way tenant hash as the provider `user` identifier; raw company IDs are never sent.

The server applies a bounded request timeout, limits narrative tokens, records provider/latency/usage metadata without recording the API key, and falls back to Gemini or a deterministic preview when the provider is unavailable. External email, Slack, Notion, and WhatsApp actions remain approval-gated and are not dispatched by the analyst MVP. Live Google Sheets OAuth and custom MCP transport must be attached through tenant-scoped connectors before those tools can be enabled.

The API key was supplied in chat, so treat it as exposed: revoke it in OpenRouter key settings and create a replacement before production deployment. Store the replacement only in the managed secret store. For Cloud Run, create or update a Secret Manager secret and attach it to the service rather than using a literal value:

```bash
printf '%s' "$NEW_OPENROUTER_API_KEY" | gcloud secrets versions add openrouter-api-key --data-file=-
gcloud run services update caveworkers \
  --project verdant-lotus-g46tg \
  --region asia-southeast1 \
  --set-secrets OPENROUTER_API_KEY=openrouter-api-key:latest \
  --set-env-vars ANALYST_MODEL=qwen/qwen3-30b-a3b,OPENROUTER_BASE_URL=https://openrouter.ai/api/v1,OPENROUTER_TIMEOUT_MS=30000,ANALYST_MAX_TOKENS=900,PUBLIC_APP_URL=https://YOUR_DOMAIN
```

Grant the Cloud Run runtime service account `roles/secretmanager.secretAccessor` first. Do not put `$NEW_OPENROUTER_API_KEY` in shell history or CI logs.

## Trial, payment, and request controls

New workspaces start with a three-day `free_trial` window when onboarding is completed. The command center displays the remaining time, and expired trial workspaces receive `402` responses with `upgrade_required: true` for protected workspace actions. Paid plan activation requires a real Razorpay order and a server-verified signature; missing or invalid payment data never activates a paid tier.

Configure `RAZORPAY_WEBHOOK_SECRET` in the deployment secret store and register `https://YOUR_DOMAIN/api/payments/webhook` in Razorpay. The webhook validates `X-Razorpay-Signature`, accepts captured or authorized payment events, and synchronizes payment status to the Firestore company and user records. The client-side payment verification remains an immediate response path, while the webhook provides an idempotent provider confirmation path.

The server checks the `X-CSRF-Token` header against the `cw_csrf` cookie for unsafe API methods, restricts credentialed CORS to `ALLOWED_ORIGINS`, and applies local-process rate limits to login, task, payment, and analyst execution endpoints. The limiter is not shared between instances; use an external edge limiter or shared limiter before horizontal scaling.

## Data durability and worker recovery

Users and companies are persisted to Firestore. Tenant tasks, approvals, activity logs, and workforce queue jobs are also written to Firestore and rehydrated/claimed when Firebase is configured. Conversations, connector discovery caches, knowledge snapshots, employee presence, local rate-limit windows, and SSE connections retain process-local components in this release. Use a controlled single-worker deployment for those paths or complete the shared datastore/realtime migration before horizontal scaling.

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

## Current operational boundary

The employee experience supports automatic queued task progression, persistent task traces while a worker is processing, manager-visible company-room updates, bounded research evidence, and approval-aware completion. It does not provide unrestricted autonomous mutation of customer systems. This boundary is intentional and should remain in place until each connector has a documented action policy, idempotency strategy, approval path, and rollback behavior.

## References

- [1] [Firebase Admin setup](https://firebase.google.com/docs/admin/setup)
- [2] [Cloud Run documentation](https://cloud.google.com/run/docs)
- [3] [Razorpay webhooks](https://razorpay.com/docs/webhooks/)
- [4] [Google OAuth 2.0 for web-server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [5] [OpenRouter API documentation](https://openrouter.ai/docs)
