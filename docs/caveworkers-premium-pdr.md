# Caveworkers Premium Workforce Control Plane

## Product Requirements Document

**Status:** Implementation baseline  
**Owner:** Caveworkers product team  
**Product:** Caveworkers  
**Primary audience:** Indian SMB and mid-market operators who need reliable AI-assisted execution across business tools  
**Design ambition:** A premium, high-trust AI workforce product with the polish of a leading $10,000 enterprise software engagement—not a superficial visual reskin

---

## 1. Executive summary

Caveworkers is an AI workforce control plane for businesses that want to assign outcomes to a coordinated team of AI employees and have the work completed inside approved company tools. The product must feel as immediate as a modern collaboration room, as capable as a coding agent, and as structured as an automation platform, while remaining understandable to non-technical business users.

The product promise is simple:

> **Describe the outcome. Caveworkers coordinates the right employees, uses only the tools your company approves, pauses for human approval when an action matters, and shows evidence when the work is truly complete.**

The redesign turns the existing company room into the primary product surface. The user does not begin with a dashboard of disconnected metrics. They enter a living workforce room, assign work in natural language, watch Sarah coordinate specialists, see employees exchange context, review tool calls and approvals, and receive a verifiable result such as a commit SHA, message ID, document URL, calendar event, or spreadsheet range.

The premium experience is built around a critical distinction: **animation communicates activity, while evidence communicates truth**. Animated employees, ambient sound, and cinematic transitions create presence and delight. Approval cards, connector scope, execution logs, external identifiers, and failure states create trust.

---

## 2. Product thesis and differentiation

Caveworkers should not be positioned as ten independent chatbots. It is a **company operating room staffed by AI employees**. The workforce is coordinated, visible, permissioned, and accountable.

The product differentiates itself through five connected capabilities:

| Capability | User value | Product expression |
|---|---|---|
| Outcome-based delegation | Users describe what they want without designing every step | One prominent “Assign work” composer with natural-language routing |
| Visible workforce coordination | Users understand who is working and why | Sarah’s routing message, employee-to-employee thread, presence states, and role colors |
| Tool execution | Work finishes in the systems the business already uses | Guided connectors, scoped tool grants, real MCP calls, and execution progress |
| Human control | Important writes do not happen invisibly | Approval gates, exact arguments, risk labels, and approve/reject actions |
| Verifiable completion | Users know whether work really happened | External IDs, commit SHAs, links, read-back checks, and honest failure states |

Caveworkers saves businesses time by reducing repetitive coordination, lowers operational risk by enforcing tool and approval boundaries, and lets a small team access specialist capability without building a separate workflow for every recurring operation.

---

## 3. Goals

### 3.1 Primary goals

1. Make the company room the clearest and most valuable first screen after login.
2. Make assigning a multi-step AI workforce task feel as simple as sending a message.
3. Make real-tool execution visible from request through verified completion.
4. Make connector setup understandable to non-technical users through service-first guided onboarding.
5. Give every employee a distinct visual identity and a calm, readable presence in the group room.
6. Add premium motion and optional sound without compromising speed, accessibility, or focus.
7. Preserve the existing authentication, onboarding, billing, tenant isolation, connector encryption, approval gates, SSE workroom updates, and production deployment model.
8. Make failures explicit and actionable rather than presenting simulated or narrative completion.

### 3.2 Success criteria

| Measure | Target for the first release |
|---|---:|
| Time from command-center load to first understandable action | Under 10 seconds for a first-time user |
| Time to connect a guided GitHub or Gmail connector | Under 3 minutes excluding third-party authentication |
| Successful task submissions with no validation error | At least 98% in controlled QA |
| Tasks with clear final status | 100% of queued tasks show queued, running, approval required, completed, failed, or blocked |
| Consequential writes without explicit approval | 0 |
| Completed external actions with evidence attached | 100% of successful write executions |
| Critical client-side console errors in smoke tests | 0 |
| Reduced-motion layout regressions | 0 known regressions |

These are product acceptance targets, not claims about current production performance. They must be measured after deployment with real tenant workflows.

---

## 4. Non-goals for this redesign

The first premium redesign will not replace the existing Express/EJS architecture with a new frontend framework, rewrite the Firestore data model, introduce a new identity provider, or remove the existing MCP transport and approval model. It will not pretend that animation equals intelligence, and it will not add autonomous external writes without tenant scope and approval policy.

Scheduled automations, webhook-triggered workflows, long-running retry workers, and organization-wide analytics are important follow-on capabilities. The redesigned UI should provide a clear home for them, but they are not required to become fully configurable in the first premium release unless their existing backend contracts already support them.

---

## 5. Target users and key jobs

### 5.1 Owner or operator

The owner wants to assign a business outcome, understand the cost and risk of the action, and see a reliable result without learning MCP, OAuth, JSON-RPC, or repository APIs.

**Job:** “Send the correct customer follow-up, update our tracker, and show me exactly what changed.”

### 5.2 Operations manager

The operations manager coordinates repetitive work across sales, support, finance, and administration. They need a shared view of work in motion and pending approvals.

**Job:** “Give the right AI employee this task, let specialists collaborate, and surface anything I must review.”

### 5.3 Technical lead

The technical lead wants an AI employee to work with GitHub or other engineering tools while retaining repository scope and review control.

**Job:** “Create the requested file in the approved repository, show me the exact patch, and only push after I approve it.”

### 5.4 Finance or compliance reviewer

The reviewer cares about provenance, permissions, and auditability more than visual novelty.

**Job:** “Show which employee acted, which connector was used, what arguments were sent, who approved it, and what external ID proves the result.”

---

## 6. Product experience architecture

### 6.1 Primary navigation

The product uses a focused left rail on desktop and a compact bottom or drawer navigation on mobile.

| Destination | Purpose |
|---|---|
| Company room | Assign work, watch collaboration, review approvals, and inspect evidence |
| Employee workspace | Inspect one employee’s role, history, tools, and current work |
| Data lab | David’s focused analyst surface for data tasks and insights |
| Settings | Workspace, team, connectors, permissions, billing, and security |
| Sign out | End the authenticated session safely |

### 6.2 Company room layout

The company room has three layers:

1. **Conversation stage:** A large, readable, realtime group thread showing manager requests, Sarah’s routing, employee collaboration, tool activity, approvals, and final results.
2. **Execution rail:** A compact progress surface showing the current task phase, active connectors, tool calls, approval state, and evidence availability.
3. **Work composer:** A persistent, high-contrast input dock for assigning work, selecting Auto-route, Whole team, or an individual employee, and submitting the request.

The secondary context rail contains presence, recent tasks, approvals, and connector health. On narrow screens it collapses below the conversation rather than squeezing the thread.

### 6.3 Settings information architecture

Settings uses four clear sections: Workspace, Team, Integrations, and Billing. Integrations leads with service cards rather than technical protocol fields.

The guided connector flow is:

1. Select a service such as GitHub, Gmail, Google Sheets, or Custom MCP.
2. Authenticate or enter the tenant-owned credential in the secure form.
3. Choose the scope, such as repositories, mail actions, or spreadsheet access.
4. Choose employees or the whole team who may use the connection.
5. Choose the policy: read-only, approval required, or disabled.
6. Test the connection and discover tools.
7. Review the discovered tool list and finalize grants.

The user should see technical details only when they are useful, with advanced protocol fields available under an expandable “Advanced connection details” area.

---

## 7. AI employee workflow

### 7.1 Canonical task lifecycle

Every task must have a visible lifecycle:

```text
Submitted
  → Understanding
  → Routed
  → Collaborating
  → Waiting for approval (when needed)
  → Executing approved tools
  → Verifying external result
  → Completed with evidence

Failure branches:
  → Blocked by missing connector, permission, scope, or approval
  → Failed with actionable reason and retry guidance
```

The UI must never show “completed” when the system only generated a plan or a narrative answer. A completed external action requires a recorded result from the connector or a deterministic verification step.

### 7.2 Employee roles

Each employee has a stable color, role label, avatar/orb silhouette, status vocabulary, and preferred task category. The first release retains the current ten employees:

| Employee | Primary identity | Suggested accent |
|---|---|---|
| Sarah | Workforce coordinator and HR manager | Electric cyan |
| David | Data analyst and insight specialist | Violet |
| Alex | Product and research specialist | Amber |
| Mike | Engineering and systems specialist | Blue |
| Emma | Marketing and communications specialist | Coral |
| Arav | Finance and planning specialist | Lime |
| Olivia | Operations and workflow specialist | Mint |
| Maya | Customer and people specialist | Rose |
| Priya | Legal and compliance support specialist | Gold |
| Iris | Executive assistant and knowledge specialist | Lavender |

The avatars should feel like friendly floating furry companions rather than realistic humans. They should be simple enough to render in CSS and remain legible at small sizes. A future asset pass may replace CSS orbs with consistent generated character assets, but the identity contract must remain stable.

### 7.3 Communication model

The group thread distinguishes manager messages, coordinator routing, employee messages, tool activity, approval requests, system updates, failures, and final answers. The sender, receiver, employee color, timestamp, task reference, and status must remain visible.

Employees may communicate internally about company work, but the conversation is still tenant-scoped. The frontend must not expose data from another workspace through cached events, stale DOM state, or broad client-side arrays.

---

## 8. Real-tool and connector requirements

### 8.1 Connector principles

A connector belongs to the tenant, not to Caveworkers globally. Credentials must remain encrypted at rest, never be returned to the browser after creation, and never appear in logs or approval cards. Each connection must expose an understandable scope and a list of discovered tools.

### 8.2 Tool policy

Each discovered tool receives a risk and access policy:

| Policy | Behavior |
|---|---|
| Read-only | May execute automatically when granted to the employee and allowed by the task router |
| Requires approval | May be prepared, but execution waits for a human approval record |
| Disabled | Must not execute |

Write, send, delete, publish, update, push, commit, create, or other consequential operations default to **Requires approval** unless the tenant explicitly changes policy through a future privileged setting.

### 8.3 Approval card requirements

An approval card must show the service, tool name, employee, tenant-safe scope, risk level, and the exact user-relevant arguments. Secrets, access tokens, and hidden authorization headers must be excluded.

The approval response must show a transition to Approved, Executing, Completed, Failed, or Blocked. Successful completion must include relevant evidence such as a commit SHA, message identifier, document link, event identifier, or read-back verification.

### 8.4 Connector-health experience

Each connection card displays Connected, Needs attention, Disconnected, or Permission limited. A “Test connection” action must report the result honestly and identify whether the failure is authentication, scope, discovery, grant, or execution related.

---

## 9. Premium visual system

### 9.1 Brand direction

The visual concept is **Cave Glass Control Plane**: a deep ink canvas, indigo atmospheric depth, translucent layered surfaces, specular highlights, restrained electric cyan and lime status colors, and warm accents for human review.

The product should feel calm, expensive, and operational. It should not look like a generic neon cyberpunk dashboard or a noisy game HUD.

### 9.2 Design tokens

| Token | Direction |
|---|---|
| Canvas | Near-black ink with indigo and cyan radial atmosphere |
| Surfaces | Layered translucent navy glass with soft inner highlights |
| Primary accent | Electric cyan for active navigation and tool flow |
| Success accent | Soft lime for verified completion and healthy systems |
| Review accent | Warm amber for approvals and human attention |
| Failure accent | Rose-pink with enough contrast for clear errors |
| Text | Bright chalk for primary copy, cool gray-blue for secondary copy |
| Typography | Space Grotesk or similar display sans for hierarchy; DM Mono for metadata and system states |
| Radius | 14px control radius, 20–28px premium panels, pill status chips |
| Shadows | Large low-opacity atmospheric shadows rather than harsh black borders |
| Borders | Hairline white-blue specular borders at low opacity |

### 9.3 Information hierarchy

The primary task request and current execution state must be the largest visual items. Metadata must stay compact. The UI should never make the user search through decorative animation to find the task status, approval action, or final evidence.

---

## 10. Motion system

Motion is functional, not ornamental. It should help the user understand state transitions.

| Interaction | Motion |
|---|---|
| Page entry | 220–300ms opacity and translate reveal for the primary panel |
| New message | 180ms slide/fade with 30–60ms stagger for grouped entries |
| Employee working | Slow floating and subtle aura pulse, paused when idle |
| Tool invocation | A thin signal line or connector pulse moves from employee to execution rail |
| Approval required | Warm amber ring and a one-time attention pulse; no infinite flashing |
| Completed result | Short lime confirmation sweep and evidence card reveal |
| Drawer or inspector | 220ms transform/opacity transition from the trigger edge |
| Button press | 100–160ms scale to 0.97 and return |

All non-essential animation must be disabled or simplified under `prefers-reduced-motion: reduce`. Motion should use transform and opacity whenever possible and remain interruptible.

---

## 11. Sound system

Sound is opt-in and off by default until the user enables it. The first release uses lightweight synthesized interface cues or small licensed audio assets rather than a continuous soundtrack.

| Event | Sound character |
|---|---|
| Task submitted | Short, soft ascending confirmation |
| Employee begins work | Low-volume airy pulse |
| Approval required | Warm two-note attention cue |
| Tool completed | Brief glassy chime |
| Failure | Muted descending tone, never an alarm |
| New employee message | Optional soft tick, rate-limited |

The sound setting must be available from the command-center header or Settings. The product must respect browser autoplay restrictions, provide a mute control, avoid sound during reduced-motion or reduced-transparency preferences when appropriate, and never use audio as the only communication channel.

The initial implementation may use the Web Audio API to synthesize tiny cues so the app does not require large static media files. A later asset pass may replace these cues with branded audio files.

---

## 12. Functional requirements

### 12.1 Command center

- The company room loads with the authenticated tenant’s company name and live service status.
- Users can submit a natural-language task with Auto-route, Whole team, or employee assignment.
- The submitted request appears optimistically as a manager message, then reconciles with realtime server events.
- The room shows routing, collaboration, approvals, execution, verification, completion, failure, and blocked states.
- The context rail shows live presence, task summaries, approval count, and connector health.
- The room supports keyboard navigation, visible focus styles, screen-reader labels, and a jump-to-latest control when the user is reading older messages.

### 12.2 Workflow inspector

- Selecting a task opens a detail state without losing the current conversation position.
- The inspector shows task request, assigned employees, current lifecycle step, tool calls, approval history, output, and evidence.
- If a task fails, the inspector explains the next action: connect a service, grant a tool, approve the action, correct parameters, or retry.

### 12.3 Integrations

- Users begin from familiar service cards.
- Users can connect GitHub, Gmail, Google Sheets, or a custom MCP endpoint.
- Connection scope is visible before saving.
- Employees and grants are selected after connection creation.
- Read-only and approval-required policies are visually distinct.
- Tool discovery, test connection, revoke, and disconnect actions preserve existing backend contracts.

### 12.4 Employee presence

- Each employee has a stable color and avatar representation.
- Presence states include idle, coordinating, working, reviewing, waiting for approval, completed, failed, and offline.
- The UI does not imply an employee is working when no server event supports that state.

---

## 13. Reliability, security, and privacy requirements

The redesign must preserve tenant isolation at every server route and every data hydration path. Frontend arrays are presentation state only and cannot be treated as an authorization boundary. All state-changing requests continue to use CSRF protection.

The application must fail closed for missing Firebase, billing, OAuth, or connector configuration where the existing server already does so. Approval payloads must remain secret-safe. Error messages shown to users should be actionable without exposing access tokens, stack traces, or internal credentials.

The real-tool executor must record enough evidence to answer: which tenant acted, which employee acted, which connector and tool were used, which approval permitted the action, whether the external system accepted it, and what external identifier proves the result.

---

## 14. Instrumentation and product analytics

The first release should emit privacy-safe operational events for:

- `workspace_loaded`
- `task_submitted`
- `task_routed`
- `approval_viewed`
- `approval_approved`
- `approval_rejected`
- `tool_execution_started`
- `tool_execution_completed`
- `tool_execution_failed`
- `connector_connected`
- `connector_tested`
- `sound_enabled`
- `reduced_motion_detected`

Events must use tenant-safe identifiers or hashes and must not include connector secrets, full message bodies, or sensitive customer content.

---

## 15. Implementation strategy

The work is intentionally incremental so the production application remains usable throughout the redesign.

### Release A — Product foundation

Write this PDR, establish the premium tokens, define lifecycle states, and add stable hooks for sound, workflow state, and evidence rendering.

### Release B — Premium command room

Upgrade the company room hierarchy, workflow composer, employee presence, execution rail, approval cards, evidence states, responsive behavior, and motion system. Preserve the existing element IDs and realtime API contracts.

### Release C — Guided integrations

Strengthen service-first connector onboarding, scope selection, employee assignment, grant policy, health checks, and tool discovery. Keep advanced MCP fields available but secondary.

### Release D — Durable workflow depth

Add a first-class workflow inspector, resumable task runs, retries with idempotency, scheduled/event-triggered workflow configuration, and organization-level operational reporting.

### Release E — Brand asset pass

If desired, replace the CSS furry-orb avatars with a consistent generated character asset family and replace synthesized sound cues with branded short audio assets. This pass must preserve the accessible text and state system.

---

## 16. Acceptance criteria for this redesign

The redesign is ready for deployment when all of the following are true:

1. The product has a coherent premium visual system across landing, login, onboarding, command center, employee workspace, and settings.
2. The company room is understandable without training: a new user can identify where to assign work, who is active, whether the room is connected, and whether approval is required.
3. A real-tool task never reports success without a connector result or verification evidence.
4. A consequential tool write cannot execute without the configured approval policy being satisfied.
5. Connector setup begins with service selection and ends with visible scope, grants, and connection health.
6. Every employee has a distinct color, animated presence state, and accessible name/role.
7. Sound is optional, muted by default, rate-limited, and never the only status indicator.
8. All existing security and tenant-isolation tests pass.
9. TypeScript lint, production build, and smoke tests pass.
10. The redesigned public URL is checked after deployment on desktop and mobile widths, including reduced-motion mode.

---

## 17. Open decisions for the next release

The product team should later decide whether autonomous writes may ever be enabled for selected low-risk tools, whether employees can create reusable workflows directly from a completed task, whether sound preferences should be stored per user or per browser, and whether the employee characters should remain CSS-rendered or become a branded asset library.

Those decisions should be made after observing real tenant behavior. The premium release should first earn trust through clear execution and evidence, then add deeper autonomy where the boundaries are measurable.

---

## 18. Definition of done

Caveworkers is not done when the interface looks expensive. It is done when the interface makes the real product behavior obvious: users can ask for an outcome, employees can coordinate, approved tools can execute, humans can intervene, and the final answer is backed by evidence.
