# Caveworkers Redesign Notes

## Repository and runtime

- Repository: `ragulyogesh7-cloud/mycaveworkers`
- Primary branch: `main`
- Runtime: TypeScript + Express + EJS, launched with `tsx server.ts`.
- Static assets are served from `/static`; templates are served from `/templates`.
- The server mounts `/` to `deskforce.html`, `/login`, `/onboarding`, `/command`, `/settings`, `/terms`, and `/privacy`.

## Product surfaces

- Public landing page: `deskforce.html`.
- Authenticated command center: `templates/command.html`.
- Login flow: `templates/login.html` + `static/login.css`.
- Onboarding flow: `templates/onboarding.html` + `static/onboarding.css` + `static/onboarding.js`.
- Settings: `templates/settings.html` with inline styling and behavior.

## Command-center behavior contracts

- Preserve load-bearing IDs: `#run`, `#request`, `#conversation-employees`, `#chat-employee-avatar`, `#chat-employee-name`, `#chat-employee-role`, `#chat-employee-tools`, `#conversation-messages`, `#conversation-form`, `#conversation-input`, `#conversation-send`, `#approvals-list`, `#approvals-status-text`, `#approval-count-badge`, `#tools-catalog`, `#knowledge-form`, `#knowledge-list`, `#digital-office-roster`, `#office-count-tag`, ROI metric IDs, `#task-dashboard-grid`, task filter/search IDs, `#activity`, `#refresh`, `#results`, `#result-title`, `#result-answer`, and `#trace-steps`.
- Existing client behavior is data-backed and should remain intact: health, employees, direct conversations, approvals, connectors, knowledge, office status, ROI, tasks, activity, task routing, and result trace.
- Keep the existing section anchors used by the side rail: `#command`, `#task-dashboard-section`, `#team`, `#approvals-section`, `#tools-section`, `#activity-panel`, `#knowledge-section`.

## Design direction

- Replace the current dark mineral theme with a premium liquid-glass control-plane UI.
- Use a deep ink/indigo canvas, translucent layered surfaces, soft specular borders, restrained electric-lime and cyan accents, and subtle ambient blobs/grid texture.
- Add motion through CSS transitions and small progressive reveals; keep animations under ~300ms where possible and respect `prefers-reduced-motion`.
- Maintain responsive layouts and keyboard-visible focus states.

## Browser validation — desktop

- `/` renders successfully with the redesigned dark liquid-glass hero, control-plane navigation, task-routing route card, workflow cards, product-surface preview, connector grid, and final CTA.
- `/login` renders successfully with the preserved Google and demo sign-in controls inside the redesigned liquid-glass sign-in card.
- Desktop browser checks performed on the local server on 2026-08-13; no visible layout overflow or missing primary controls were observed in the initial viewport.

- `/command` was accessed through the project’s existing local demo sign-in control and rendered the redesigned command center successfully. The task-routing form, crew roster, conversation area, approvals, tool cards, knowledge form, task search/filter controls, task trace controls, refresh action, and sign-out action were all present.
- The visual result is a layered ink-and-indigo control plane with translucent panels, responsive card hover states, entry reveals, and cursor-responsive highlights on the primary glass surfaces.

- `/settings` renders the liquid-glass connector-management view successfully, including the tab navigation, employee selectors, permission controls, marketplace configuration, and custom MCP connection form.
- Validation exposed a pre-existing catalog-rendering mismatch: the frontend expected optional `icon` and `description` fields that are absent from the current server catalog. The renderer now falls back to an employee initial and the system prompt or department, eliminating visible `undefined` labels.
- A refreshed `/settings` load completed successfully after the renderer correction, with connector, marketplace, and custom-connection controls intact.
- The corrected employee catalog now renders intentional initial avatars and meaningful role descriptions for every listed employee; no `undefined` labels remain.
- `/onboarding` renders the first of four setup steps inside the redesigned liquid-glass wizard, preserving the company, industry, team-size, and continuation controls.

The browser console was checked after landing, sign-in, command-center, settings, and onboarding validation; it reported no client-side errors.
