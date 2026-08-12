# Caveworkers

Control plane for the Caveworkers AI workforce. It serves the landing page at
`/` and the live command center at `/command`.

## What works now

- Firebase-verified authentication. Only cryptographically verified session
  cookies and ID tokens establish identity — there is no unverified fallback.
- Per-workspace tenant isolation. Every request resolves the caller's own org;
  no endpoint falls back to a shared default workspace.
- A persistent employee directory with least-privilege tool grants (a tool is
  granted at its own declared access level, not blanket write).
- A SQLite-backed communication bus (`agent_messages`), task ledger, and
  approval queue, all foreign-key enforced and WAL-enabled for concurrency.
- Rule-based routing with cross-departmental collaboration.
- Real connector integrations (Gmail, Slack, Notion, read-only SQL). An
  unconfigured connector reports that plainly; it never returns invented data.
- Human-in-the-loop approval before any outbound or mutating action.

## Honesty guarantees

These are load-bearing product properties, not nice-to-haves:

- A specialist whose model backend is down returns **503**. It never invents an
  audit finding, a recommendation, or an assurance.
- A tool without credentials returns `requires_configuration`. It never claims
  an email was sent, a page was created, or a message was posted.
- The SQL workspace accepts a single read-only `SELECT`/`WITH` statement,
  opened with a driver-level read-only handle.
- Caveworkers will not compose an email recipient or body on your behalf.

## Setup

```powershell
copy .env.example .env
# Fill in Firebase, Razorpay, and connector values.
python -c "import secrets; print(secrets.token_urlsafe(48))"                      # FLASK_SECRET
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # MCP_TOKEN_ENCRYPTION_KEY
pip install -r requirements.txt
```

Store the Firebase service account JSON **outside** the repository and point
`FIREBASE_SERVICE_ACCOUNT_PATH` at it. Never commit credentials; `.gitignore`
blocks the common filenames, but the safest place is outside the tree.

## Run locally

Five terminals from `C:\Users\umara\Documents`:

```powershell
python .\data_analyst\app.py     # David  :5000
python .\HR\arav\start_hr.py     # Sarah  :5001
python .\auditor\app.py          # Aisha  :5002
python .\developer\app.py        # Alex   :5003
python .\caveworkers\app.py      # Control plane :5050
```

Then open `http://127.0.0.1:5050`. Specialists use Ollama with the model named
in `OLLAMA_MODEL`; each exposes the same `/api/ask` contract plus `/api/health`
so you can see whether an employee can actually work right now.

## Run in production

The app refuses to start the Flask development server when
`CAVEWORKERS_ENV=production`. Use a real WSGI server behind HTTPS:

```powershell
waitress-serve --port=5050 caveworkers.app:app
```

Set `CAVEWORKERS_ENV=production`, `COOKIE_SECURE=true`, a real
`ALLOWED_ORIGINS`, and per-workspace `SPECIALIST_*_URL` values.

Read [DEPLOYMENT.md](DEPLOYMENT.md) before exposing the service. Production
requires workspace memberships, private member memory/ledger/connector views,
verified payment activation, and approval-gated MCP calls. The bundled SQLite
database remains a local/private-alpha store; use managed Postgres plus an
external queue/rate limiter before a public multi-instance launch.

## Verify

```powershell
python .\caveworkers\test_phase1.py                 # data model + routing
python .\caveworkers\test_phase2.py                 # tools + HITL gate
python .\caveworkers\test_phase3.py                 # communication bus
python .\caveworkers\test_phase4.py                 # RAG store
python .\caveworkers\verify_master_plan.py          # all five phases
python .\caveworkers\verify_production_upgrade.py   # security posture (needs :5050 running)
```

`verify_production_upgrade.py` asserts the auth bypass stays closed, CSRF and
cross-origin protection engage, security headers are present, and connectors
never fabricate output.

## Security model

| Control | Implementation |
|---|---|
| Identity | Firebase session cookie / ID token, signature verified, revocation checked |
| Tenancy | `require_org()` resolves the caller's own workspace; no shared default |
| CSRF | Double-submit `cw_csrf` cookie + `X-CSRF-Token` header on all unsafe methods |
| Origin | Cross-origin state changes rejected against `ALLOWED_ORIGINS` |
| Secrets | Environment-only; startup fails loudly when required values are missing |
| Billing | Tier read from the server-side order record, amount confirmed with Razorpay, settled once |
| Tool access | Grants stored per employee; a task cannot widen its own privileges |
| Writes | Gmail/Slack/Notion/Git are approval-gated before execution |
| Rate limits | Per-identity sliding window on login, tasks, chat, and payments |

## Next milestones

1. Move the task ledger to Postgres and add a queue/worker layer.
2. Add role management within a workspace (admin vs. member).
3. Ship an immutable audit export for compliance review.
4. Add per-connector scope narrowing and short-lived credentials.
