# Owned Google Cloud and OAuth checklist for Caveworkers

## Decision

Keep the current production service unchanged until a standard user-owned Google Cloud project is ready. Do not migrate tenant data or switch DNS during the first pass. Deploy a parallel `caveworkers` service in the new project, validate it, then cut over.

## 1. Create the owned project

Use the existing Google Cloud project while signed in as `ragul6191@gmail.com`. Choose a durable project ID because the project ID cannot be changed after creation. Link the project to a billing account if Google prompts for billing or if Cloud Run/Cloud Build/Firebase Functions deployment requires it.

Project selected for this migration:

- Project ID: `caveworkers-505714`
- Google Cloud/OAuth owner: `ragul6191@gmail.com`

Enable the following APIs in the new project:

- Cloud Run Admin API
- Cloud Build API
- Artifact Registry API
- Secret Manager API
- Service Usage API
- Gmail API
- Google Drive API
- Google Sheets API
- Firebase Management API and Firestore API if Firebase is used for the next persistence phase

## 2. Create OAuth credentials in the owned project

Open Google Cloud Console → APIs & Services → OAuth consent screen. Configure the app name as Caveworkers, add the support/developer contact email, and add `caveworkers.ai.studio` as an authorized domain if the production URL remains there.

Create an OAuth Client ID with application type **Web application**. Add the exact redirect URI:

`https://caveworkers.ai.studio/api/google/oauth/callback`

If the service is temporarily deployed at a new domain, add that exact callback URI as a second URI. Redirect URIs must match exactly, including scheme, hostname, path, and trailing slash behavior.

Use incremental Google permissions. Caveworkers currently distinguishes Gmail, Drive, and Sheets; do not request broad permissions until the corresponding connector is selected.

## 3. Store secrets in the owned project

Create Secret Manager secrets for at least:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `OAUTH_STATE_SECRET`
- `MCP_TOKEN_ENCRYPTION_KEY`
- `FLASK_SECRET` only if retained for backward-compatible OAuth state handling
- `SMTP_APP_PASSWORD` for the temporary Gmail SMTP fallback, if still used
- `OPENROUTER_API_KEY` or the chosen production model credentials
- Firebase Admin credentials only if the application uses Firebase Admin directly

Grant the Cloud Run service identity permission to access the required secret versions. Never commit secret values, put them in `.env.example`, or send them through chat.

For the temporary company mailbox, configure non-secret values separately:

`COMPANY_EMAIL=ragul6191@gmail.com`
`SMTP_ENABLED=false`
`SMTP_HOST=smtp.gmail.com`
`SMTP_PORT=587`
`SMTP_SECURE=false`
`SMTP_USER=ragul6191@gmail.com`

SMTP is intentionally disabled for this migration; Gmail, Drive, and Sheets use tenant-scoped Google OAuth instead.

## 4. Deploy Caveworkers from the owned project

Deploy the existing repository to a parallel Cloud Run service in the new project. Preserve the current Node.js 22 Dockerfile and application runtime first; do not combine a hosting migration with a database migration.

Set:

- `PUBLIC_APP_URL=https://caveworkers.ai.studio`
- `ALLOWED_ORIGINS=https://caveworkers.ai.studio`
- `COOKIE_SECURE=true`
- `GOOGLE_OAUTH_REDIRECT_URI=https://caveworkers.ai.studio/api/google/oauth/callback`
- all required Secret Manager references

For a custom temporary service hostname, use that hostname in `PUBLIC_APP_URL`, `ALLOWED_ORIGINS`, and the OAuth redirect URI during staging. After DNS cutover, replace those values with the final custom domain and update the OAuth client again.

## 5. Cutover and acceptance

Before switching the domain, test the new service using its temporary Cloud Run URL. Verify login, onboarding, tenant isolation, Company Room, task creation, approval queue, SMTP draft/send, and health checks. Complete Google OAuth for Gmail, Drive, and Sheets using the `ragulordis@gmail.com` account. Verify that a Gmail send returns a provider message ID, Drive search returns only authorized files, and Sheets access is read-only as configured.

Only after those checks pass should DNS or the custom domain be pointed to the new service. Keep the old service available for rollback until the new revision has passed at least one complete tenant acceptance run.

## Important distinction

The current managed project can host the app but does not give the user the IAM controls needed to create OAuth credentials and secrets. A standard user-owned project fixes that restriction. Firebase Auth/Firestore are optional data-plane components; they are not required to fix the current OAuth blocker. Migrate persistence separately after the owned Cloud Run deployment is stable.

## References

- Google Workspace Developers, Create a Google Cloud project: https://developers.google.com/workspace/guides/create-project
- Google Identity, Using OAuth 2.0 for Web Server Applications: https://developers.google.com/identity/protocols/oauth2/web-server
- Google Cloud, Deploy services from source code: https://docs.cloud.google.com/run/docs/deploying-source-code
- Google Cloud Billing, Enable, disable, or change billing for a project: https://docs.cloud.google.com/billing/docs/how-to/modify-project
