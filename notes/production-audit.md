# Caveworkers production audit checklist

## Confirmed findings

- README.md is stale Python/Flask documentation and describes SQLite and specialist services that are not present in the current Node/TypeScript Express service.
- package.json has no automated test script and the repository contains no maintained test suite.
- server.ts is approximately 3,000 lines and contains the application, persistence adapters, worker, connectors, and route handlers in one module.
- Most runtime state remains in in-memory Maps/caches; Firestore is used selectively, so restart durability and horizontal scaling are not complete.
- SENTRY_DSN exists in .env.example but is not wired into application error reporting.
- Several legacy Python-era environment variables remain in .env.example.
- Production startup correctly fails closed when Razorpay secrets are absent; deployment still requires external confirmation of live Razorpay mode and Google OAuth publishing/verification.

## Production target for this release

1. Replace README with accurate Node/TypeScript setup, build, start, health, connector, worker, and test instructions.
2. Remove stale environment variables and keep only variables read by server.ts, documenting optional values clearly.
3. Add a dependency-light automated regression suite covering health, auth fail-closed behavior, CSRF/origin gates, Razorpay webhook verification, trial/payment invariants, and tenant boundaries.
4. Wire SENTRY_DSN through a small dependency-free structured error reporter with redaction and request IDs; do not log secrets or personal tokens.
5. Add runtime readiness metadata and explicit production checks for Firebase, Razorpay, session security, encryption, worker mode, and web research.
6. Improve durability with Firestore-backed persistence where current maps are used for high-risk tasks/approvals/rooms, or clearly fail closed if the durable store is unavailable in production.
7. Keep public launch claims accurate: external Google OAuth verification, live Razorpay mode, legal review, and persistent hosting remain operator-side confirmations.

## Constraints

- Preserve existing authentication, billing, connector, approval, and dashboard contracts.
- Never commit credentials.
- Maintain tenant isolation and approval-gated external writes.
- Do not claim a 10/10 score until automated checks and runtime/deployment requirements pass.

## Latest verified connector review — 2026-08-16

- The connector directory total is now derived from the curated catalog at runtime; the product no longer presents the screenshot-derived `1,870` value.
- Google connectors use the existing OAuth flow. Registry-backed and custom MCP connectors now present an explicit secure-configuration step before connection instead of attempting an unauthenticated connection and falling back silently.
- The directory remains a curated tenant-facing catalog, not a complete marketplace inventory. External provider OAuth implementations and credentials remain provider-specific work and are not claimed as complete.
- A credential or service-account private key previously exposed to a chat session must be rotated by the project operator and replaced in the deployment secret store. The repository cannot safely rotate an external credential without access to the owning provider account.
- Durable persistence, Cloud Run IAM/Secret Manager configuration, Google OAuth publishing, Razorpay live-mode verification, and legal review remain launch-gate actions outside this code change.

The production claim remains intentionally conservative: automated repository checks can validate security and isolation invariants, but they cannot prove that external cloud permissions, provider verification, payment mode, or legal content are configured in a live deployment.
