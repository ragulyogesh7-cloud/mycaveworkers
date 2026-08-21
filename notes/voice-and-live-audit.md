# Caveworkers live audit and employee voice update

Date: 2026-08-16
Published commit: `f81149734cf5e0141d8a781ba4220d46b81f478a`

## Live acceptance result

The email was **not sent successfully**. Sarah’s Gmail connector remains unauthenticated because the deployed Cloud Run revision returns:

```json
{"error":"Google OAuth client credentials are not configured."}
```

No provider message ID, delivery receipt, or inbox evidence exists. The GitHub report was also **not committed in the live acceptance run**: no commit SHA was visible, and the repository connector remains `needs_configuration`.

The authenticated live tenant currently exposes four active employees—Alex, Emma, Mike, and Sarah—while the Free Trial plan permits two. The billing API itself reports `active_employees: 4`, `max_employees: 2`, and `quota_remaining: 0`. The existing employee-add/select routes enforce the cap for new additions, so the evidence supports a pre-existing over-cap roster rather than a current add-employee bypass. The code now exposes `overage_count`, `legacy_overage`, and `enrollment_locked`, and Settings displays an explicit legacy-overage explanation instead of the confusing sentence “4 of 2 employee slots in use.”

The live connector inventory showed the following evidence:

| Connector | Live status | Evidence |
|---|---|---|
| Sarah Gmail | `needs_configuration` | OAuth missing; send permission record exists but `auth_configured` is false |
| PostgreSQL custom skill | `connected` | Read-only SQL grant and discovered tool present |
| GitHub Integration custom skill | `connected` | Read and create-PR grants present; no verified commit result from this acceptance run |
| Git repository | `needs_configuration` | Repository URL present; no auth configured |
| Streamable HTTP / GitHub Copilot MCP | `needs_configuration` | No discovered tools |
| Google Calendar-labelled record | `needs_configuration` | No Google authentication |

The regression suite’s Gmail and GitHub success scenarios use deterministic mocks; they verify the approval and dispatch contracts, not real-world delivery.

## Published product changes

The connector directory now returns the Caveworkers logo at `/static/logo.jpeg` and renders a branded “WORKFORCE” mark on each Company Room connector card.

Company Room now includes opt-in voice mode. Every employee has a distinct voice profile with its own locale, voice-name preferences, speaking rate, pitch, and role-matched label:

| Employee | Voice profile |
|---|---|
| Sarah | Warm Indian English |
| David | Measured British English |
| Alex | Calm American English |
| Mike | Clear Australian English |
| Emma | Bright British English |
| Arav | Confident Indian English |
| Olivia | Polished Australian English |
| Maya | Energetic American English |
| Priya | Grounded Indian English |
| Iris | Precise British English |

The implementation uses the browser’s Web Speech API, prefers installed natural/neural/online voice packs where available, and falls back safely when a particular device does not provide the preferred voice. Voice is off by default, can be enabled from the Company Room header, automatically reads new employee final answers while enabled, and provides a per-message Voice button. A server-side neural TTS provider would be a separate deployment decision if Caveworkers needs identical voices across every browser and device.

## Validation

The final code passed **33/33 regression tests**, TypeScript lint, production build, JavaScript syntax validation, and `git diff --check`. The working tree is clean and `origin/main` points to commit `f811497`.

## Deployment gate

The new code is published to GitHub but is not automatically live at `caveworkers.ai.studio`. A new Cloud Run/AI Studio revision must be deployed from `f811497`. Before repeating the acceptance run, inject the Google OAuth client ID and secret, OAuth state secret, production redirect URI, Firebase Admin access, and connector-token encryption key into the revision. Then complete Sarah’s Gmail OAuth, approve the pending Gmail and GitHub actions, and verify a real Gmail provider message ID, inbox receipt, and GitHub commit SHA.
