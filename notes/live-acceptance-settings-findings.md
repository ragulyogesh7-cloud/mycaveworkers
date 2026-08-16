# Live acceptance-test Settings findings

Captured from the authenticated My Browser session at https://caveworkers.ai.studio/settings#integrations.

- Tenant workspace shown: `nothern enterprices`.
- Current plan shown: `Free Trial`; UI reports `4 of 2 employee slots in use`.
- Employee selector currently set to `Sarah · Talent & HR Manager`.
- Connection type currently set to `Google Gmail`.
- Google account field shows `Google OAuth required after saving`.
- Access level is `Read only`.
- Sarah Gmail send permission checkbox was enabled for approval-gated sending.
- Save connection button is visible.
- Connected-app list currently shows 7 connections, including Sarah entries marked `NEEDS_CONFIGURATION` for Google Gmail, a Git repository, and other tools; a separate `GitHub Integration` custom skill is marked `CONNECTED`.
- Sarah’s existing Git repository card points to `https://github.com/ragulyogesh7-cloud/caveworkers-employee-mcp-test.git` and exposes `Request commit`.
- The Company Room live task previously reached an approval gate for Gmail and GitHub actions; both actions were confirmed by the user.

This file records only visible UI state from the live tenant session and does not contain credentials or tokens.

Source: live authenticated browser page, captured during the confirmed Sarah client acceptance test.
Date: 2026-08-16

Next intended action: save the Sarah Google Gmail connection, then complete Google OAuth if the live deployment is configured, return to the task, approve the pending external actions, and verify Gmail delivery plus GitHub evidence.
## Save result

After enabling the Sarah Gmail send-permission checkbox and selecting Save connection, the live Settings page now reports `8 connected` instead of 7. The new connection remains configured with Google OAuth required after saving and approval-gated send permission enabled. No credential or token was entered. The next action is to use Sarah’s visible `Connect Google` control to launch the live OAuth flow.
## Live OAuth result

The newly saved Sarah Gmail connection used the production route:

`https://caveworkers.ai.studio/api/employees/sarah/mcp-connections/1786768468828/google/start?service=google_gmail`

The live endpoint returned HTTP success with JSON error content:

`{"error":"Google OAuth client credentials are not configured."}`

This is a deployment configuration blocker, not a browser-selection problem. The Caveworkers code reached the correct Sarah connector route and normalized the service value successfully, but the Cloud Run deployment does not currently expose `GOOGLE_OAUTH_CLIENT_ID` and/or `GOOGLE_OAUTH_CLIENT_SECRET` to the running revision. No email was sent and no GitHub write was authorized or executed at this point.

Source: authenticated My Browser production page, exact URL preserved above.
Date: 2026-08-16
## Task #122 approval state

After returning to `/command`, the live Company Room contains Sarah’s Task #122 final answer stating: `I need your approval to send the Northern Enterprises onboarding report to ragulyogesh7@gmail.com and commit the file to the ragulyogesh7-cloud/mycaveworkers GitHub repository.` The same task shows Sarah’s prior employee introductions, Mike/Emma/Alex handoffs, and Sarah’s final delivery review.

A page keyword search for `Approve` returned no text. The approval action is not surfaced in the current page-level extraction, so the next step is to inspect the task card/container itself rather than assume that an approval occurred.
## Approval queue mismatch

The live Company Room rendered Sarah’s Task #122 final answer requesting approval for Gmail delivery and GitHub commit, but the right-side `Your turn` panel showed `Needs review` and `Nothing needs your approval. Your team will always pause consequential actions.` A page-level keyword search for `Approve` found no approval control. This is a client-facing mismatch: Sarah’s answer describes pending external actions, but no actual approval record/action is available to the user. The acceptance test is blocked both by missing deployed Google OAuth credentials and by the missing approval UI/state for Task #122.

Source: authenticated production Company Room at `https://caveworkers.ai.studio/command`, Task #122, live screenshot/text extraction, 2026-08-16.
