# Caveworkers hosting and ownership research

## Official findings reviewed on 2026-08-15

- Vercel supports Express with zero configuration, but an Express deployment becomes a single Vercel Function. Static files should be placed under `public/**`; `express.static()` is ignored. Vercel Functions limitations apply to the Express application.
  Source: https://vercel.com/docs/frameworks/backend/express
- Vercel Functions handle each incoming request as an invocation, scale down to zero, and have function lifecycle and duration limitations. This is compatible with request/response APIs but needs care for durable background workers and long-running approval workflows.
  Source: https://vercel.com/docs/functions
- Cloud Run recommends Secret Manager for sensitive values. Secrets can be exposed as environment variables or mounted volumes. The Cloud Run runtime service account needs Secret Manager Secret Accessor; deployment requires Cloud Run and service-account permissions.
  Source: https://docs.cloud.google.com/run/docs/configuring/services/secrets
- A Firebase project is also a Google Cloud project. Firebase and Google Cloud share IAM, billing, project identifiers, and resource hierarchy. Firebase can be added to a user-owned Google Cloud project, but adding Firebase is not fully reversible.
  Source: https://firebase.google.com/docs/projects/use-firebase-with-existing-cloud-project

## Architecture implication

Caveworkers is a Node.js/TypeScript/Express multi-tenant SaaS with Firestore, encrypted connector credentials, approval-gated MCP execution, and worker/background behavior. For this workload, a user-owned Google Cloud project plus Cloud Run is the lower-risk production architecture. Vercel can host the frontend or a request/response API, but moving the existing monolithic Express backend and worker behavior to Vercel would require a larger serverless refactor and separate durable job infrastructure.

## Recommended ownership model

The user should create or own a Google Cloud billing account/project, add Firebase to that project, configure a dedicated runtime service account, keep Secret Manager in the same project, and deploy Cloud Run from a GitHub-connected pipeline or a user-controlled CI identity. The user should retain project Owner/Billing Admin authority and use narrower runtime/deployment roles for day-to-day operations.

## Migration cautions

Do not delete the current Firebase project or Cloud Run service before exporting Firestore data, checking Authentication users, reviewing Storage, recording OAuth redirect URIs, preserving MCP_TOKEN_ENCRYPTION_KEY, and validating Razorpay webhooks. A new project is a migration, not a simple hosting switch. The current public domain can be cut over only after a staging deployment and DNS/domain mapping verification.

## Provider credentials that must be re-created or moved

- Firebase Admin runtime identity/service account
- Google OAuth Web client ID and secret with exact production redirect URI
- Secret Manager secrets: `FLASK_SECRET`, `MCP_TOKEN_ENCRYPTION_KEY`, `OPENROUTER_API_KEY`, Google OAuth secret, Firebase Admin values if not using ADC
- Razorpay live credentials and webhook secret
- Sentry DSN and optional web-search provider key
- Domain DNS and Cloud Run/Vercel custom-domain configuration

## Key recommendation

Keep Cloud Run for the backend and workers, create or recover a fully user-owned Google Cloud project, add Firebase to that project, and use Vercel only if the user later wants a separate frontend/static hosting layer. Do not create a new project merely to fix the IAM screen until the user verifies whether the current `verdant-lotus-g46tg` project is owned by their Google account or by Google AI Studio's managed deployment flow.

## References

1. https://vercel.com/docs/frameworks/backend/express
2. https://vercel.com/docs/functions
3. https://docs.cloud.google.com/run/docs/configuring/services/secrets
4. https://firebase.google.com/docs/projects/use-firebase-with-existing-cloud-project

— Manus AI

End of note.

Sources are informational and do not override the user's project permissions or provider terms.

## Starter Tier and billing findings added on 2026-08-15

- Google Cloud Starter Tier resources are provisioned in a fully managed Google Cloud project. Google manages the project and configuration, including IAM roles, quotas, organization policies, API enablement, region limits, and the simplified console. Starter Tier does not require a billing account.
  Source: https://docs.cloud.google.com/docs/starter-tier
- The official Starter Tier documentation says that if capabilities beyond Starter Tier are required, the project must be upgraded to a standard Google Cloud project. Upgrading from the product interface prompts acceptance of standard terms and Cloud Billing setup, preserves application state, databases, and deployment URLs, and gives full IAM control and ownership. Standard usage pricing then applies.
  Source: https://docs.cloud.google.com/docs/starter-tier
- Google's 2026 Starter Tier overview says Starter Tier is intended for prototyping, while standard Google Cloud projects provide full platform access and fine-grained IAM. It states the same Starter Tier project can be upgraded by adding a billing account, or a separate standard project can be created via the Free Trial/standard Cloud path.
  Source: https://cloud.google.com/blog/topics/developers-practitioners/the-starter-tier-for-google-ai-studio-explained
- Gemini API billing documentation says upgrading to paid tiers requires linking a Cloud Billing account; users can create a project or import an existing project. Depending on billing plan and account, prepay/postpay conditions may apply, and Gemini API credits are separate from general Cloud service costs.
  Source: https://ai.google.dev/gemini-api/docs/billing
- Changing a project's billing account is a sensitive action and requires both project and billing-account permissions; a project Owner alone may not be enough if billing-account access is missing.
  Source: https://docs.cloud.google.com/billing/docs/how-to/modify-project

## Decision implication

The Gemini explanation is directionally correct about Starter Tier restrictions, but the statement that upgrading automatically makes the current signed-in account the Owner should be treated as a product-flow outcome to verify in the actual upgrade screen, not as an unconditional IAM rule. Official Google documentation does confirm that upgrading the managed Starter Tier project to a standard project preserves app state and gives full IAM control and ownership.

For Caveworkers, the two viable paths are:

1. Upgrade the existing Starter Tier project `verdant-lotus-g46tg` through Google AI Studio, if preserving the live deployment URL, Firestore, and authentication with the least migration risk is the priority. Before confirming, verify the billing account owner, payment method, expected billing model, and post-upgrade IAM ownership.
2. Create a separate user-owned standard Google Cloud project, add or migrate Firebase, redeploy Caveworkers, and cut over only after staging validation. This gives the cleanest ownership boundary but requires a real migration and does not automatically transfer databases, users, OAuth, secrets, or domains.

The current recommended path is to upgrade the existing Starter Tier project only if the user personally controls the billing account and the upgrade screen explicitly confirms the project will become a standard project under that account. Otherwise, create a separate user-owned project and migrate.

End of appended findings.

## GitHub MCP findings added on 2026-08-15

- GitHub maintains an official remote MCP server at https://api.githubcopilot.com/mcp/. It supports OAuth or PAT authentication and exposes repository/file, issue, pull-request, workflow, and related tools according to the authenticated GitHub account and approved scopes.
  Sources: https://github.com/github/github-mcp-server/blob/main/README.md ; https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server
- The official GitHub MCP documentation states that the remote server is available to GitHub users regardless of plan, while individual tools inherit the requirements of their corresponding GitHub features. Remote OAuth can be used without creating a PAT in compatible MCP hosts; PAT authentication is also supported.
- GitHub fine-grained PAT permissions are endpoint-specific. Repository file create/update operations require repository access and contents write permission; the exact permissions should be confirmed against the tool/API endpoint. Tokens must be tenant-scoped, stored encrypted, never committed, and used with approval gates for write tools.
  Source: https://docs.github.com/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens

## Product implication

The previous Caveworkers test used the test-only workforce hook and the sandbox agent's GitHub integration to create/push the test repository. It did not use a live tenant-owned GitHub MCP connector. To make the user's employees genuinely push files, Caveworkers must connect the tenant's GitHub account to the official GitHub MCP server or a tenant-owned GitHub App, discover the repository/file tools, grant them per employee, require approval for writes, execute the tool through the normal task path, and record verified commit/response metadata.

End of appended GitHub MCP findings.
