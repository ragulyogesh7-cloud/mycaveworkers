# Cloud production setup sources

## Official Firebase Admin SDK setup
Source: https://firebase.google.com/docs/admin/setup

Key findings: Firebase Admin SDK requires a Firebase project and an Admin service account. The official guidance recommends Application Default Credentials in Google-managed environments such as Cloud Run. The Node Admin SDK initializes with `initializeApp()` when default credentials are available. Service-account JSON credentials are privileged and must not be placed in public repositories.

## Official Cloud Run secrets configuration
Source: https://docs.cloud.google.com/run/docs/configuring/services/secrets

Key findings: Cloud Run recommends Secret Manager for API keys, passwords, and certificates. Secrets can be exposed as environment variables or mounted as files. The Cloud Run service identity needs `roles/secretmanager.secretAccessor` on each referenced secret. Deployment/configuration changes create a new revision. Cloud Run checks access during deployment for environment-variable secrets.

## Official Google OAuth web-server setup
Source: https://developers.google.com/identity/protocols/oauth2/web-server

Key findings: Create an OAuth 2.0 client of type Web application and register exact authorized redirect URIs. Client secrets must not be stored in public source repositories. Google APIs must be enabled for the project, and sensitive/restricted scopes may require verification for public production use.

## Official OpenRouter documentation
Source: https://openrouter.ai/docs

Key findings: OpenRouter requests use a Bearer API key at `https://openrouter.ai/api/v1/chat/completions`. API keys must remain server-side. The Caveworkers runtime uses `OPENROUTER_API_KEY` and an OpenRouter-compatible base URL.

## Probe result for attached Firebase service account
Date: 2026-08-15

The attached service-account file identifies project `caveworkers` and was used only in a redacted permission probe; no private key material was printed. Results:

- Firebase project `caveworkers`: HTTP 200.
- Target Cloud Run project `verdant-lotus-g46tg`: HTTP 403, caller lacks permission.
- Target Cloud Run service lookup: HTTP 404/non-JSON response from the service endpoint, not treated as proof of existence or access.
- Secret Manager in `verdant-lotus-g46tg`: HTTP 403, organization constraint `gcp.restrictServiceUsage` disallows use of Secret Manager for this caller/project.

The attached service account is therefore not sufficient to configure the target Cloud Run service or Secret Manager, and its private key should be rotated/revoked after use because it was uploaded in chat.
