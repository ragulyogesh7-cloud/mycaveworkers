# Google Mail, Drive, and Sheets setup research

## Official sources reviewed

1. Gmail API scopes: https://developers.google.com/workspace/gmail/api/auth/scopes
   - `https://www.googleapis.com/auth/gmail.send` allows sending email on the user’s behalf and is classified as sensitive.
   - `https://www.googleapis.com/auth/gmail.readonly` is restricted and allows viewing messages and settings.
   - Google recommends requesting the narrowest scope needed. Public applications using sensitive or restricted scopes may require OAuth verification; restricted-scope apps that store or transmit restricted data may require a security assessment.

2. Drive API scopes: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
   - `https://www.googleapis.com/auth/drive.file` is the recommended non-sensitive per-file scope for files selected or created by the app.
   - `https://www.googleapis.com/auth/drive.readonly` and `https://www.googleapis.com/auth/drive` are restricted broad-access scopes.
   - OAuth scopes must be declared in the Google Cloud consent screen and requested in application code; refresh tokens must be stored securely for long-term access.

3. Sheets API scopes: https://developers.google.com/workspace/sheets/api/scopes
   - `https://www.googleapis.com/auth/spreadsheets.readonly` allows viewing all Sheets spreadsheets and is sensitive.
   - `https://www.googleapis.com/auth/spreadsheets` allows editing/creating/deleting all Sheets spreadsheets and is sensitive.
   - `https://www.googleapis.com/auth/drive.file` is the recommended non-sensitive per-file scope where applicable.

4. OAuth setup: https://support.google.com/googleapi/answer/6158849?hl=en
   - A web OAuth client ID is required; the current Google Help page points to the current Manage OAuth Clients documentation.
   - Client secrets must be protected and rotated if disclosed.

## Caveworkers implementation implication

Caveworkers currently uses Gmail OAuth with `gmail.readonly` and optional `gmail.send`, and Google Sheets OAuth with `spreadsheets.readonly`. Google Drive is currently represented by a catalog entry mapped to the Sheets connection type, so Drive is not a first-class OAuth capability yet. The safest initial company-mail setup is Gmail API OAuth for `ragulordis@gmail.com`, not an SMTP password. The user must authorize the account in the browser; no email or external file mutation should occur without explicit confirmation. A future business-domain migration can reconnect the company connector to the new mailbox while preserving the tenant-level policy and approval model.

## User-provided production account

Initial company account requested: `ragulordis@gmail.com`.

No OAuth client ID/secret or Google Cloud project credentials were provided in the current request. The existing live deployment previously lacked Google OAuth client credentials, so the operator must inject them into the Cloud Run revision before OAuth can work.

## Gmail SMTP research

- Gmail Help: https://support.google.com/mail/answer/185833?hl=en — App passwords are 16-digit passcodes and require 2-Step Verification. Google may not expose App Passwords for some account configurations, including certain organization-managed accounts or Advanced Protection.
- Gmail SMTP documentation: https://developers.google.com/workspace/gmail/imap/imap-smtp — Gmail supports SMTP; `smtp.gmail.com` supports port 465 for SSL and port 587 for TLS. Google also documents OAuth/XOAUTH2 as the modern authorization mechanism.
- Google Workspace administrator guidance: https://knowledge.workspace.google.com/admin/gmail/send-email-from-a-printer-scanner-or-app — For app-based Gmail SMTP, use `smtp.gmail.com`, port 465 with SSL or 587 with TLS, authenticate with the full mailbox address and an app password, and observe Gmail sending limits. Google recommends SMTP relay for managed Workspace organizations, but the temporary personal Gmail setup uses authenticated Gmail SMTP.

Implementation decision: SMTP is an optional deployment-level fallback, not a per-tenant password field. The app password is read only from `SMTP_APP_PASSWORD`, never returned by health or connector APIs, and never committed to Git. Gmail OAuth remains the preferred transport when a tenant Gmail send connection exists; SMTP is used only when the approved company-mail SMTP configuration is enabled and no OAuth Gmail send connection is available. All SMTP sends remain approval-gated unless the existing explicit autopilot policy authorizes the action.
