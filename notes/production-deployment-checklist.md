# Caveworkers production deployment checklist

**Repository:** `ragulyogesh7-cloud/mycaveworkers`

**Production URL:** `https://caveworkers.ai.studio`

**Cloud Run project:** `verdant-lotus-g46tg`

**Region:** `asia-southeast1`

## Current code status

The approval lifecycle and Company Room approval visibility fixes are published on `main` at commit `6e81dc9`.

The implementation now keeps blocked connector actions out of the approval queue, records a blocked audit trace, prefixes Sarah’s task answer with `BLOCKED —`, hydrates tenant approvals before task and Company Room reads, and attaches the real pending approval id to Sarah’s final-answer message and task snapshot. The regression suite contains 32 passing tests.

## Cloud Run variables and secrets

Add these values to a new Cloud Run revision for the `caveworkers` service. Store credentials and high-entropy secrets in Secret Manager rather than plain-text revision variables wherever the platform permits.

| Variable | Required value | Purpose |
|---|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth 2.0 Web application client ID | Starts Gmail/Sheets OAuth |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Matching Google OAuth client secret | Exchanges the OAuth code |
| `GOOGLE_OAUTH_REDIRECT_URI` | `https://caveworkers.ai.studio/api/google/oauth/callback` | Exact callback used by the application |
| `OAUTH_STATE_SECRET` | New high-entropy random secret | Signs and validates OAuth state |
| `PUBLIC_APP_URL` | `https://caveworkers.ai.studio` | Canonical public application URL |
| `ALLOWED_ORIGINS` | `https://caveworkers.ai.studio` | CORS allow-list |
| `COOKIE_SECURE` | `true` | Secure production cookies |
| `ALWAYS_ON_WORKER_ENABLED` | `true` | Enables the workforce worker |
| `FIREBASE_PROJECT_ID` | `caveworkers` | Firebase Admin project identity |
| Firebase Admin credential | Workload Identity or Secret Manager-backed service-account credential | Firestore, authentication, and tenant persistence |
| `MCP_TOKEN_ENCRYPTION_KEY` | A separate high-entropy key preserved across revisions | Decrypts tenant connector credentials |
| `OPENROUTER_API_KEY` or Gemini provider credentials | A valid production model credential | Generates workforce narratives and task responses |
| Razorpay credentials | Operator-managed test or live credentials | Billing and payment verification |

Generate a fresh OAuth state secret locally with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Do not reuse an exposed secret or commit any credential to the repository. If a Firebase service-account private key was previously shared outside the intended secret store, rotate it before production use.

## Google Cloud OAuth configuration

In Google Cloud Console, open **APIs & Services → Credentials → the OAuth 2.0 Web Client** and add this exact authorized redirect URI:

```text
https://caveworkers.ai.studio/api/google/oauth/callback
```

Add `caveworkers.ai.studio` to the authorized domains. Enable the Gmail API and, if Sheets connections will be used, the Google Sheets API. The OAuth consent screen must include the scopes required by the selected connector and must be published or otherwise available to the intended test users.

## Deploy and smoke-test sequence

Deploy a new Cloud Run revision with the variables and secrets above. Confirm the health endpoint reports the expected Firebase, model, and OAuth readiness rather than `unconfigured` or `degraded` for components required by the test.

Sign in to the production Caveworkers tenant, open **Settings → Tools**, select Sarah, add a Google Gmail connection, enable send permission, save it, and use **Connect Google**. The browser should reach Google consent and return to the Company Room without a missing-client-credentials response.

Then submit this test request in the Company Room:

```text
Sarah, prepare a concise company report for nothern enterprices, send it to ragulyogesh7@gmail.com using your connected Gmail after approval, and commit the report to ragulyogesh7-cloud/mycaveworkers.
```

Verify the following sequence: Sarah’s task reaches `pending_approval`; the right-side queue shows the Gmail and/or GitHub action; Sarah’s final-answer message contains an **Approve** control tied to the same approval id; approving Gmail produces a confirmed provider message id; approving the GitHub action produces a confirmed commit SHA; and the task answer is updated with the final execution result. If a connector is not configured, the task must instead be visibly `BLOCKED` with no phantom approval item.

## Remaining operator-owned launch gates

The code and regression tests do not create Google OAuth credentials, Firebase Admin access, Cloud Run IAM ownership, production payment credentials, or third-party connector tokens. Those are deployment configuration gates. Until the new revision is deployed with them, the live acceptance test remains blocked by the production response:

```json
{"error":"Google OAuth client credentials are not configured."}
```

The source-level approval mismatch is fixed and published in commit `6e81dc9`; the deployed service must be rebuilt from `main` before rerunning the test.
