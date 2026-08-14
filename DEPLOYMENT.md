# Caveworkers deployment gate

Caveworkers must not be exposed publicly until all conditions below are true.

1. Set `CAVEWORKERS_ENV=production`, a public HTTPS `ALLOWED_ORIGINS`, and a managed secret-store injection path. Never bake `.env` into an image.
2. Rotate the Firebase service account, Flask secret, Razorpay secret/webhook secret, OAuth client secret, encryption key, and any connector tokens before the first deployment.
3. Deploy the control plane and specialist services separately. Keep specialist traffic on a private network and authenticate service-to-service calls.
4. Use managed durable storage with tested backups and point-in-time recovery. The bundled SQLite store is for local development and private alpha only; migrate it to managed Postgres before a public multi-instance launch.
5. Use an external rate limiter and task queue for multiple instances. The bundled in-memory limiter is intentionally local-process only.
6. Configure error monitoring, availability checks, alert routing, a support inbox, incident response ownership, and a restore drill.
7. Complete legal review for Terms, Privacy Policy, DPA, retention/deletion/export, model-data handling, and subprocessor disclosure.

## Safe release checks

```powershell
python -m compileall -q .
python .\test_phase1.py
python .\test_phase2.py
python .\test_phase3.py
python .\test_phase4.py
python .\test_production_controls.py
python .\test_route_controls.py
```

The application fails closed in production when public origins, required identity configuration, token encryption, or a configured payment webhook secret are missing. Global Slack, Notion, and SQL credentials are disabled in production; attach employee/workspace-scoped OAuth or MCP connections instead.


## Google sign-in and Firebase profile persistence

Before enabling user login, activate **Google** under Firebase Authentication providers, create or confirm the Firestore database, and add the deployed HTTPS hostname to Firebase Authentication’s authorized domains. Local development should use `localhost`.

The server accepts one of these credential configurations: `FIREBASE_SERVICE_ACCOUNT_PATH` pointing to a service-account JSON file, the environment trio `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`, or `GOOGLE_APPLICATION_CREDENTIALS` for an application-default credential. Keep these values in the deployment secret store; do not commit them.

After a successful Google sign-in, the server verifies the Firebase ID token, writes the account profile to `users/{firebase_uid}` in Firestore with merge semantics, creates or updates the related `companies/{company_id}` document, and issues a Firebase session cookie. The client no longer accepts email or display-name values as a substitute for a verified Google token.

## David analyst / OpenRouter production configuration

David uses the OpenRouter-compatible chat-completions API when `OPENROUTER_API_KEY` is present. Inject the key through the Cloud Run or Google AI Studio secret manager/environment configuration; never place it in `.env`, the Docker image, client-side code, GitHub files, or a command-line argument. Configure `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`, `ANALYST_MODEL=qwen/qwen3-30b-a3b`, `OPENROUTER_TIMEOUT_MS=30000`, `ANALYST_MAX_TOKENS=900`, and `PUBLIC_APP_URL=https://YOUR_DOMAIN`. The request includes OpenRouter attribution headers and a one-way tenant hash as the provider `user` identifier; raw company IDs are never sent.

The server applies a bounded request timeout, limits narrative tokens, records provider/latency/usage metadata without recording the API key, and falls back to Gemini or a deterministic preview when the provider is unavailable. External email, Slack, Notion, and WhatsApp actions remain approval-gated and are not dispatched by the analyst MVP. Live Google Sheets OAuth, SQL credentials, MCP transport, and E2B execution must be attached through tenant-scoped connectors before those tools can be enabled.

The API key was supplied in chat, so treat it as exposed: revoke it in OpenRouter key settings and create a replacement before production deployment. Store the replacement only in the managed secret store. For Cloud Run, create or update a Secret Manager secret and attach it to the service rather than using a literal value: `printf '%s' "$NEW_OPENROUTER_API_KEY" | gcloud secrets versions add openrouter-api-key --data-file=-`, then `gcloud run services update caveworkers --region asia-southeast1 --set-secrets OPENROUTER_API_KEY=openrouter-api-key:latest --set-env-vars ANALYST_MODEL=qwen/qwen3-30b-a3b,OPENROUTER_BASE_URL=https://openrouter.ai/api/v1,OPENROUTER_TIMEOUT_MS=30000,ANALYST_MAX_TOKENS=900,PUBLIC_APP_URL=https://YOUR_DOMAIN`. Grant the Cloud Run runtime service account `roles/secretmanager.secretAccessor` first. Do not put `$NEW_OPENROUTER_API_KEY` in shell history or CI logs.

## Trial, payment, and request controls

New workspaces start with a three-day `free_trial` window when onboarding is completed. The command center displays the remaining time, and expired trial workspaces receive `402` responses with `upgrade_required: true` for protected workspace actions. Paid plan activation requires a real Razorpay order and a server-verified signature; missing or invalid payment data never activates a paid tier.

Configure `RAZORPAY_WEBHOOK_SECRET` in the deployment secret store and register `https://YOUR_DOMAIN/api/payments/webhook` in Razorpay. The webhook validates `X-Razorpay-Signature`, accepts captured or authorized payment events, and synchronizes the payment status to the Firestore company and user records. The client-side payment verification remains as an immediate response path, while the webhook provides an idempotent provider confirmation path.

The server now checks the `X-CSRF-Token` header against the `cw_csrf` cookie for unsafe API methods, restricts credentialed CORS to `ALLOWED_ORIGINS`, and applies local-process rate limits to login, task, payment, and analyst execution endpoints. The bundled limiter is not shared between instances; use an external edge limiter or Redis-backed limiter before horizontal scaling.

Core operational Maps remain process-local in this release. Users and companies are persisted to Firestore, while tasks, approvals, conversations, connector state, knowledge entries, and activity logs still require a later Firestore or Postgres migration before multi-instance production deployment.


## David connectors: Gmail, Google Sheets, and custom MCP

David’s connector registry is tenant-scoped. A connector is stored under `tenants/{company_id}/connectors`, while OAuth tokens and custom MCP bearer tokens are encrypted before persistence with `MCP_TOKEN_ENCRYPTION_KEY`. The API never returns the encrypted token or raw credentials to the browser.

Create a Google OAuth 2.0 **Web application** client and add the exact callback URL `https://YOUR_DOMAIN/api/google/oauth/callback` to its authorized redirect URIs. Configure `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `PUBLIC_APP_URL`, and `GOOGLE_OAUTH_REDIRECT_URI` in the managed secret/runtime configuration. The default callback is `${PUBLIC_APP_URL}/api/google/oauth/callback` when `GOOGLE_OAUTH_REDIRECT_URI` is omitted.

Gmail uses the restricted read-only scope `https://www.googleapis.com/auth/gmail.readonly`; Google Sheets uses `https://www.googleapis.com/auth/spreadsheets.readonly`. Users grant access to their own Google account through the OAuth consent screen. Caveworkers stores the refresh token encrypted and exposes only connection status, granted scopes, and optional account email to the tenant workspace. Configure the OAuth consent screen, publishing status, authorized domains, and Google API enablement in Google Cloud before inviting customers.

Custom MCP servers must be registered with an HTTPS Streamable HTTP endpoint in production. Private-network hosts, localhost, embedded URL credentials, and unencrypted HTTP are rejected in production. Optional bearer tokens are encrypted at rest and never shown again after submission. David can discover tools, but tool grants are per-connector and per-tool. Read tools may execute only after an explicit read grant; write-capable tools always create a pending human approval record and are not dispatched automatically by the current release.

To enable durable connector credentials, create a high-entropy secret and inject it as `MCP_TOKEN_ENCRYPTION_KEY`. Rotating this key without a migration plan makes previously stored connector tokens unreadable, so rotate through a controlled re-encryption or reconnect procedure. Before public multi-instance deployment, move the in-process connector cache to the same managed datastore/queue used for the rest of the control plane and add external rate limiting.

The connector API is available from David’s data lab and Workspace Settings. The current integration includes bounded Gmail metadata search and Google Sheets preview reads. Gmail sending, Sheets writes, arbitrary MCP write calls, scheduled autonomous execution, and background task dispatch remain approval-gated infrastructure work rather than silently enabled actions.
