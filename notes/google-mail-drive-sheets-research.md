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
