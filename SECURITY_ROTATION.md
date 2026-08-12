# Secret Rotation Guide

Rotate **all** credentials listed below before any production deployment
and whenever a team member with access leaves the project.

## 1. Flask Secret Key

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Update `FLASK_SECRET` in your secret store / `.env`.

## 2. Firebase Service Account

1. Open the Firebase Console → Project Settings → Service Accounts.
2. Generate a new private key.
3. Replace the JSON file referenced by `FIREBASE_SERVICE_ACCOUNT_PATH`.
4. Delete the old key from the Firebase Console.

## 3. Razorpay Credentials

1. Log in to [Razorpay Dashboard](https://dashboard.razorpay.com).
2. Navigate to Settings → API Keys → Generate Key.
3. Update `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
4. For webhooks, go to Settings → Webhooks → copy the new secret.
5. Update `RAZORPAY_WEBHOOK_SECRET`.
6. Deactivate the old API key.

## 4. MCP Token Encryption Key (Fernet)

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Update `MCP_TOKEN_ENCRYPTION_KEY`.

> **Warning**: Rotating this key invalidates all stored OAuth tokens.
> Users will need to re-authorize their Google/Gmail connections.

## 5. Google OAuth Credentials

1. Open [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials.
2. Create a new OAuth 2.0 Client ID (or rotate the secret on the existing one).
3. Update `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`.

## 6. Connector Tokens (Slack, Notion, etc.)

- **Slack**: Regenerate Bot Token in [Slack API](https://api.slack.com/apps). Update `SLACK_BOT_TOKEN`.
- **Notion**: Create new integration at [Notion Developers](https://www.notion.so/my-integrations). Update `NOTION_API_KEY`.

## Post-Rotation Checklist

- [ ] Verify application starts without errors
- [ ] Test authentication (login/logout)
- [ ] Test payment flow (create order → verify)
- [ ] Test MCP connections (if OAuth tokens were reset)
- [ ] Confirm old credentials no longer work
- [ ] Update any CI/CD secret stores
