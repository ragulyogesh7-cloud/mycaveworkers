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
