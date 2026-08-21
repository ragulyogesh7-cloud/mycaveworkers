# Caveworkers production strategy implementation plan

## Scope

This plan applies to the updated `caveworkers` repository at commit `4182872`. The repository already contains Firestore-backed company and workforce persistence, isolated memory synchronization, onboarding and pricing flows, Google and MCP connector handling, Company Room orchestration, approval-gated external actions, structured operational reporting, and a 41-test security/routing suite. The implementation must preserve those flows while strengthening the production layer described in the strategy brief.

## Delivery principles

1. Tenant identity is derived from verified authentication and server-side session state. Request-body company identifiers are treated as untrusted input.
2. Connector access remains least-privilege and employee-scoped. No change may bypass Gmail send approvals, tenant boundaries, or token encryption.
3. External content is data, not instructions. Content-originated requests to change plans, permissions, recipients, or tool behavior must be flagged and routed to review.
4. Every external action has a durable audit event containing tenant, employee, connector/tool, risk, approval, outcome, and correlation identifiers without storing raw access tokens.
5. Long-running work is represented as idempotent jobs with observable state. The current synchronous path remains a compatibility fallback until a production queue is configured.
6. Every new safeguard receives a focused regression test and at least one cross-tenant negative test.

## Priority matrix

| Priority | Capability | Current implementation signal | First implementation outcome | Acceptance measure |
|---|---|---|---|---|
| P0 | Tenant isolation | Firestore helpers, authenticated session, company-scoped route checks | Centralize company derivation and add Firestore rules/config plus leak tests | All protected reads/writes use verified tenant identity; cross-tenant tests fail closed |
| P0 | Token lifecycle | Encrypted connector token fields and Google OAuth routes | Add expiry-aware refresh/revocation state and safe error classification | Expired/revoked tokens become reconnect-required; plaintext tokens never enter logs or audit records |
| P0 | Audit log | Activity persistence and operational failure reporting | Add immutable action/audit records with request, approval, and provider evidence | Every tool preparation, approval, execution, block, and failure creates a tenant-scoped event |
| P0 | Prompt-injection defense | Employee operating contracts and limited untrusted-content markers | Add content sanitization/classification before agent planning and approval escalation | Injection-like external content cannot silently alter recipients, tools, permissions, or approval state |
| P1 | Reliability | Task/approval persistence and worker-like helpers | Add idempotency keys, retry metadata, durable job status, and dead-letter state | Retries do not duplicate approved external actions; failed jobs are visible and replayable |
| P1 | Entitlements/metering | Plans, employee-slot enforcement, billing contract | Add server-side connector/autopilot/action/usage limits | Tier limits are enforced in routes and workers, not only in UI |
| P1 | AI evaluations | Routing and execution regression tests | Add golden routing/risk/tool-selection fixtures and evaluator command | Every prompt/risk change can run deterministic regression cases |
| P2 | RBAC | User/company role fields exist | Define owner/admin/member/approver permissions and enforce approval authority | Members cannot approve their own restricted actions or administer tenant security |
| P2 | Activation analytics | ROI and task/activity evidence | Add funnel events and activation definition | Signup, onboarding, connector, first task, first approval, and first verified action are measurable |
| P2 | Trust/compliance | Terms, Privacy, deletion-related routes/documentation | Add retention/deletion policy primitives and a subprocessor/security surface | Tenant export/deletion is explicit, auditable, and documented |

## Implementation order

### Stage A: security and trustworthy execution

Implement the centralized tenant resolver, Firestore rule/configuration artifacts, token lifecycle state, immutable audit event model, prompt-injection classifier, and regression tests first. These changes protect all later features and directly support the product’s governance positioning.

### Stage B: durable work and economics

Implement idempotent job records and a queue adapter with a local/in-process fallback, then add usage metering and entitlement checks around employee count, connectors, autopilot, external actions, and model/tool usage. Keep provider-specific queue deployment configuration separate from deterministic application behavior.

### Stage C: quality, access, and growth

Add golden task evaluations, approval-risk test cases, RBAC enforcement, activation funnel events, ROI evidence aggregation, tenant deletion/export workflows, and trust documentation. Add UI surfaces only after the server contracts are stable.

## Acceptance checklist

- Existing Firestore memory, onboarding, connector modal, login, Company Room, approval, and 41 regression tests remain green.
- A request cannot select another tenant by changing `company_id` in its JSON body, URL, query, or employee identifier.
- A connected tool is shown as configured only when its token, grant, provider state, and entitlement are valid.
- A tool call from untrusted content cannot create a new recipient, permission, connector, or external write without the normal approval path.
- Every external action can be reconstructed from audit events without exposing secrets.
- A retried job has one idempotency identity and cannot dispatch the same external action twice.
- The service reports degraded, reconnect-required, blocked, awaiting-approval, failed, and completed states distinctly.
- The final commit includes tests, deployment notes, and explicit configuration boundaries for Firestore rules, Secret Manager, queue credentials, and billing webhooks.
