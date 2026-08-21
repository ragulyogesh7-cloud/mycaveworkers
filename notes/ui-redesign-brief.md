# Caveworkers workspace UI redesign brief

## Product direction

The command center becomes a single manager-visible company room rather than a dashboard made of separate panels. The user arrives in one realtime conversation where they can assign a task, see the routing decision, follow employee-to-employee collaboration, and review approvals without leaving the room.

The visual language remains Caveworkers’ liquid-glass system: deep ink canvas, indigo translucent surfaces, cyan/lime status accents, strong readable type, compact monospace metadata, and short transform/opacity transitions. The layout should feel like a focused operations messenger, not an analytics dashboard.

## Command center information architecture

The desktop layout uses a compact left rail for only four destinations: Company room, David’s data lab, Settings, and Sign out. The main area has a sticky room header, a single large message timeline, and a composer dock. A narrow context rail sits beside the timeline on wide screens and collapses below the room on mobile.

The room header contains the workspace identity, realtime connection state, active employee avatars, and a clear “Assign work” affordance. The timeline merges manager messages, task routing, employee collaboration events, task updates, approval requests, and completion summaries. Existing `/api/workforce/workroom` snapshot data and `/api/workforce/stream` SSE events remain the source of truth; no tenant data is moved client-side between workspaces.

The composer supports a free-form task request and an assignment target. The target control defaults to “Auto-route” and offers “Whole team” plus every active employee. Submitting a task posts `{ request, preferred_employee_id }` to `/api/tasks`; the whole-team choice posts no preferred employee so the existing collaboration router can coordinate the workforce. The UI shows a local optimistic manager message, then replaces it with live task events from the stream. Consequential actions remain represented as approval cards in the same timeline.

The context rail shows live employee presence, a lightweight task summary, and a compact approval queue. It is supportive context only; task search, knowledge, and connector management move to Settings or the employee workspaces so the primary room remains uncluttered.

## Settings information architecture

Settings becomes a full-width management console with a clear heading, workspace identity, plan status, and persistent tab navigation. Sections are: Workspace, Team, Integrations, and Billing. Each tab has a short description, clear save/action states, accessible labels, and destructive actions separated from routine actions.

Workspace contains company profile fields and security posture. Team contains active employees and the catalog with add/remove controls. Integrations contains employee-scoped permissions, marketplace servers, custom MCP connections, tool discovery, OAuth connection actions, safe testing, and Git approval actions. Billing contains current plan, usage/quota summary, trial/renewal status, and INR plan cards using the server-provided plan values.

All existing Settings DOM action functions are preserved behind the redesigned markup, so connector APIs, employee configuration, company profile saving, Razorpay checkout, OAuth links, and CSRF handling remain unchanged. Feedback is shown through an inline status region rather than relying only on browser alerts. Destructive actions retain confirmation prompts.

## Motion and accessibility

Use CSS transitions under 220ms with transform and opacity only, stagger room cards by 30–60ms, animate new timeline entries with a short slide/fade, and respect `prefers-reduced-motion`. Every interactive control has visible focus styling, a text label or accessible name, and keyboard-safe tab navigation. Realtime status is announced through an `aria-live` region without forcing scroll when the user is reading older messages.

## Implementation boundaries

The redesign is intentionally frontend-first. Backend routes remain unchanged except where a small payload compatibility adjustment is required. Existing tenant filters, CSRF middleware, approval gates, and SSE event handling must remain intact. The deliverable includes updated `templates/command.html`, `static/command.js`, `static/command.css`, `templates/settings.html`, and `static/settings.css`, plus any small dedicated Settings script only if extracting inline behavior materially improves maintainability.
