# Company Room tool-access diagnosis

- The newer repository is `/home/ubuntu/caveworkers-upstream` and remains the source of truth for employee tools, Firebase sessions, connectors, approvals, and the 37-test suite.
- `server.ts` `propagateCompanyGoogleConnection` previously updated existing employee copies only when grants/tools were empty. Existing legacy copies could therefore have OAuth tokens but stale `gmail_send_enabled`, missing grants, or stale discovered tools.
- The Company Room `/api/mcp/directory` response previously marked a catalog connector `connected` from any name match, without requiring `status === connected`, encrypted credentials, or a usable grant.
- `static/command.js` treated `connected` as reusable, sent users away without showing per-employee readiness, and created Gmail connections with `gmail_send_enabled: false` plus `gmailSendEnabled: false`, disabling send capability from the room.
- The read-tool path now requires explicit read/read-write grants for Gmail (`gmail.search`), Drive (`drive.files.read`), and Sheets (`sheets.read`); provider exceptions are reported as failed evidence instead of synthetic success. Sheets now performs a real read when given a URL or spreadsheet ID.
- The Company Room directory backend now repairs legacy Google employee copies from the first connected/granted source and returns `ready`, `ready_employee_ids`, `connection_states`, `granted_tools`, and readiness counts.
- The Company Room UI now distinguishes ready vs connected-but-needs-attention, displays grant/readiness detail, routes incomplete connections to Settings, and enables Gmail send opt-in during room setup while preserving approval gating.
- Pending work: run build/tests, add focused regression tests for propagation/read grants/directory readiness/room Gmail setup, visually verify Company Room, then commit and push.
