# Caveworkers Client-Perspective Scenario Report

**Date:** 16 August 2026

**Scope:** Client-perspective validation of the Company Room, ten-employee routing, tenant isolation, connector access, approval gates, billing contract, OAuth entry point, and live message behavior.

## Executive assessment

Caveworkers passed the repository-level client scenario suite and the Company Room interaction fixes were applied on the spot. The Company Room now behaves as a shared workplace timeline rather than a collection of rounded message bubbles. During answer generation, unchanged task-update events no longer replace the message DOM, so the feed does not visibly refresh or jump while employees are working. When a new message or status actually arrives, the feed reconciles it while preserving the user’s scroll position unless the user is already at the latest message.

The connector scenarios use the existing mocked MCP transport and verified route contracts. They validate tenant isolation, encrypted connection storage, employee grants, read-only execution for all active employees, approval-gated Gmail preparation and dispatch, and a verified GitHub write. They do not claim that a live Google, Gmail, GitHub, or custom MCP account was used in this sandbox run; live provider verification still requires the deployed environment and tenant credentials.

## Scenario matrix

| # | Client scenario | Result | Evidence |
|---:|---|---|---|
| 1 | A manager assigns a task to the whole team. | Passed | Only active employees in the authenticated tenant are queued. |
| 2 | A manager asks Sarah to lead a request. | Passed | Sarah owns the final result and returns a visible manager response. |
| 3 | An operations request is routed to Alex. | Passed | Specialist routing and safe public capability metadata are exposed. |
| 4 | An engineering and GitHub incident is routed to Mike. | Passed | Mike’s specialist route and metadata are correct. |
| 5 | A customer-success request is routed to Emma. | Passed | Emma receives the expected specialist route. |
| 6 | A people-operations request is routed to Arav. | Passed | Arav receives the expected specialist route. |
| 7 | A sales pipeline request is routed to Olivia. | Passed | Olivia receives the expected specialist route. |
| 8 | A marketing and growth request is routed to Maya. | Passed | Maya receives the expected specialist route. |
| 9 | A finance-operations request is routed to Priya. | Passed | Priya receives the expected specialist route. |
| 10 | An IT and security request is routed to Iris. | Passed | Iris receives the expected specialist route. |
| 11 | Employees introduce themselves and hand work to one another. | Passed | Addressed handoffs and employee communication remain visible in the curated Company Room trace. |
| 12 | A user deletes a Company Room message. | Passed | Deletion is tenant-scoped and the private audit trace remains protected. |
| 13 | Sarah attempts email delivery without Gmail capability. | Passed | The system truthfully blocks delivery instead of pretending the email was sent. |
| 14 | A user searches the official MCP Registry. | Passed | Registry results are normalized and include a safe detail link. |
| 15 | A user opens the connector directory. | Passed | The curated catalog exposes tenant connection state without encrypted credentials. |
| 16 | A registry advertises a private or unsafe remote. | Passed | The remote is rejected before any connection attempt. |
| 17 | A tenant connects tools for active employees. | Passed | Connections are limited to active employees in the authenticated tenant, encrypted, and approval-gated. |
| 18 | Every active employee executes a granted read-only MCP tool. | Passed | The mocked MCP transport confirms read-only execution for all active employees. |
| 19 | Every active employee prepares a Gmail action. | Passed | Gmail preparation remains approval-gated. |
| 20 | Every active employee dispatches an approved Gmail message. | Passed | The mocked dispatch returns verified results for each employee. |
| 21 | A tenant performs a GitHub MCP write. | Passed | The write remains approval-gated and returns a verified commit SHA. |
| 22 | A user starts Google OAuth from the Company Room. | Passed | The start route emits a signed state cookie and preserves the Company Room return path. |
| 23 | A user views billing plans. | Passed | The authenticated billing contract exposes ₹5, ₹10, and ₹15 plans. |
| 24 | A tenant views ROI/value evidence. | Passed | Metrics are tenant-scoped and expose transparent assumptions. |
| 25 | A user sends an unsafe state-changing request. | Passed | CSRF validation rejects requests without a matching cookie and header. |
| 26 | One tenant attempts to read another tenant’s work. | Passed | Tasks and approvals remain isolated by authenticated company. |
| 27 | The user manually refreshes or reconnects the Company Room. | Passed | Deleted messages remain filtered through the client tombstone set and server projection. |
| 28 | The worker reports health and request correlation. | Passed | Health exposes component readiness and a request correlation ID. |

## Fixes applied during this run

The previous Company Room renderer replaced the entire message DOM whenever a task update arrived, even when the visible messages had not changed. That caused the user’s perception of auto-refresh while employees were generating answers and could disturb scroll position. The renderer now computes a stable message signature and performs no DOM replacement for unchanged content. When content changes, it reconciles the timeline while preserving the previous scroll position unless the user is already at the bottom.

The message presentation was also flattened. Rounded bubble backgrounds, message-body borders, shadows, and alternating bubble colors were removed. Messages now appear as a clean workplace activity feed with employee avatars, sender metadata, status labels, subtle separators, flat content, and restrained state accents for introductions, handoffs, completed work, failures, and approvals.

## Validation result

The final repository checks passed:

- `npm run lint`
- `npm test` — **32/32 tests passing**
- `npm run build`
- `git diff --check`

## Remaining live limitations

This report validates the application and connector contracts using the existing test transport. It does not replace live provider verification. A customer pilot still requires valid tenant credentials, exact Google OAuth redirect configuration, Firebase Admin credentials, MCP encryption secrets, Razorpay environment configuration, and a Cloud Run deployment with reliable background-worker availability.

External writes remain approval-gated by design. A connector that is not actually configured must continue to report that limitation rather than simulate completion. This behavior is intentional and is part of the client trust contract.
