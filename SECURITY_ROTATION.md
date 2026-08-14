# Caveworkers secret rotation guide

Rotate **all active credentials** before the first production deployment, after a suspected disclosure, and whenever a person with access leaves the project. Generate replacements in a trusted shell, update the managed secret store, deploy the new revision, verify the health and smoke checks, and revoke the old credential only after the new revision is serving.

Do not paste secrets into GitHub, issue trackers, chat, task payloads, Docker build arguments, or shell commands that will be retained in history. The checked-in `.env.example` contains names only and must remain credential-free.

## Secret-generation command

Generate random application secrets with Node.js 22:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Use different values for `FLASK_SECRET` and `MCP_TOKEN_ENCRYPTION_KEY`. `FLASK_SECRET` is a historical environment-variable name used to sign the short-lived Google connector OAuth state; it is not a Flask runtime dependency.

## 1. Firebase Admin credentials

1. Open **Firebase Console → Project settings → Service accounts**.
2. Generate a new private key, or issue a replacement credential according to the organization’s identity policy.
3. Store the JSON credential in the managed secret store or replace the file referenced by `FIREBASE_SERVICE_ACCOUNT_PATH` outside the repository.
4. Deploy and confirm Google sign-in, session-cookie creation, Firestore profile persistence, and `/api/health`.
5. Revoke or delete the previous service-account key after the new revision is healthy.

Do not rotate the public browser configuration (`FIREBASE_API_KEY`, `FIREBASE_APP_ID`, and related values) as if it were an Admin credential. Treat the Admin private key and client email as sensitive.

## 2. Firebase and Google OAuth connector client

The Google connector client is separate from Firebase Authentication’s browser configuration.

1. Open [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials.
2. Create a replacement **OAuth 2.0 Web application** client or rotate the existing client secret according to the organization’s policy.
3. Preserve the exact callback URI `${PUBLIC_APP_URL}/api/google/oauth/callback` in the replacement client.
4. Update `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, and, if needed, `GOOGLE_OAUTH_REDIRECT_URI` in the managed secret/runtime configuration.
5. Deploy and complete a tenant-scoped Gmail read-only and Google Sheets read-only connection test.
6. Disable the previous OAuth client or client secret after confirming no intended tenant workflow still depends on it.

If the OAuth consent screen is in testing mode, review test-user membership and token expiry before inviting production customers. Publishing/verification and restricted-scope review are Google operator actions; they cannot be completed by code in this repository.

## 3. Razorpay API and webhook credentials

1. Log in to the [Razorpay Dashboard](https://dashboard.razorpay.com).
2. Generate replacement live or test API credentials in the intended mode.
3. Update `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET` in the managed secret store.
4. In Razorpay Webhooks, create or rotate the webhook secret and update `RAZORPAY_WEBHOOK_SECRET`.
5. Deploy and test order creation, server-side payment signature verification, duplicate webhook delivery, and invalid-signature rejection.
6. Revoke the previous API credential and remove the old webhook secret only after the new delivery path has been verified.

Never switch to live mode solely by changing the browser key. Confirm the server-side key pair, webhook secret, amount/plan mapping, settlement/reconciliation process, refund procedure, and finance owner together.

## 4. OpenRouter and fallback model credentials

The OpenRouter key was previously supplied in chat, so treat that value as exposed even if it is no longer present in this repository. Revoke it in the OpenRouter dashboard and issue a new key before production use.

1. Create a replacement key in [OpenRouter](https://openrouter.ai/).
2. Store it only as `OPENROUTER_API_KEY` in the managed secret store.
3. Keep `OPENROUTER_BASE_URL`, `ANALYST_MODEL`, `OPENROUTER_TIMEOUT_MS`, and `ANALYST_MAX_TOKENS` as non-secret runtime configuration.
4. If Gemini fallback is enabled, rotate `GEMINI_API_KEY` separately through Google AI Studio or the organization’s Google Cloud secret process.
5. Deploy and verify a bounded analyst request, provider-failure fallback, timeout behavior, and redacted logs.
6. Revoke the previous OpenRouter or Gemini key after the new revision is healthy.

The service must never put model keys in browser code, EJS data, task traces, logs, GitHub files, or command-line arguments.

## 5. Connector token encryption key

Generate a new high-entropy value with the Node command above and update `MCP_TOKEN_ENCRYPTION_KEY` in the managed secret store.

> **Important:** Rotating this key immediately makes existing encrypted Google refresh tokens and custom MCP bearer tokens unreadable unless a re-encryption migration is performed. Plan one of the following before changing the runtime value: decrypt and re-encrypt every stored tenant token during a controlled migration, or intentionally invalidate the stored tokens and require tenants to reconnect.

Use a staged deployment or maintenance window for this change. Verify connector reads, token refresh, tenant isolation, and reconnect behavior before retiring the old key. Never log plaintext tokens while migrating.

## 6. OAuth state secret

Generate a replacement value for `FLASK_SECRET` with the Node command above. Deploy it during a controlled window because in-flight Google connector OAuth state values signed with the previous value will no longer validate. Confirm that new OAuth start/callback flows work and that a callback from another tenant or user is rejected.

## 7. Sentry error-reporting DSN

If the Sentry project or environment is changed, create a replacement DSN in [Sentry](https://sentry.io/), update `SENTRY_DSN`, deploy, and trigger a controlled test error in a non-production environment. Confirm that event payloads contain a request ID and useful stack context but do not contain authorization headers, cookies, raw OAuth tokens, payment secrets, or model keys. Revoke or retire the previous DSN after the new one is confirmed.

A DSN is an ingestion identifier, not an authorization credential, but it still should not be embedded in places where it could be confused with a private secret or used to disclose operational metadata.

## Post-rotation checklist

- [ ] The new value is stored only in the managed secret/runtime configuration.
- [ ] The service starts and `/api/health` reports expected Firebase, payments, worker, and observability status.
- [ ] `npm run lint`, `npm test`, and `npm run build` pass.
- [ ] Google sign-in and logout work.
- [ ] Tenant-scoped Google connector OAuth works with the intended read-only scopes.
- [ ] Payment order, signature verification, webhook HMAC, duplicate delivery, and trial enforcement work.
- [ ] Existing encrypted connector tokens were migrated or tenants were deliberately asked to reconnect.
- [ ] Sentry receives a redacted test event and logs do not contain secrets.
- [ ] The old credentials are revoked or disabled after the new revision is healthy.
- [ ] CI/CD and Cloud Run/Google AI Studio secret stores are updated consistently.

## References

- [1] [Firebase service accounts](https://firebase.google.com/docs/admin/setup)
- [2] [Google OAuth 2.0 for web server applications](https://developers.google.com/identity/protocols/oauth2/web-server)
- [3] [Razorpay webhooks](https://razorpay.com/docs/webhooks/)
- [4] [OpenRouter API keys](https://openrouter.ai/settings/keys)
- [5] [Sentry Node SDK](https://docs.sentry.io/platforms/javascript/guides/node/)
