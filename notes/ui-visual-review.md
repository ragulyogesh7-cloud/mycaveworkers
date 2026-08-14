# UI visual review — local preview

## Company room desktop review

The redesigned `/command` screen renders as a focused two-column workspace. The left rail has a restrained workspace navigation, the main panel places the realtime Company room conversation first, and the right context column keeps presence, approvals, and recent work visible without competing with the primary composer.

The visual hierarchy is clear: the title and purpose statement lead into a single large glass chat surface; the assignment composer remains anchored at the bottom of that surface; and the user can choose auto-routing or the explicit whole-team route. The existing liquid-glass visual language is retained through deep indigo surfaces, aqua highlights, compact uppercase utility labels, and non-distracting animation/loading states.

The preview intentionally has no live API backend, so empty/error states appear for employee presence, approvals, and activity. Those states are legible and retain their contextual actions. No structural overlap, horizontal clipping, or collapsed primary controls were observed at the desktop viewport.

## Settings desktop review

The redesigned `/settings` page renders as a focused management console with a stable global rail and a local settings navigator. The workspace panel gives profile fields, a visible privacy status, and a short security posture summary, rather than a long undifferentiated form. At desktop width, the title, current-plan card, navigation, and primary panel remain readable without overlap or horizontal clipping.

The local Settings navigation switches to the Team panel correctly and updates the URL fragment to `#team`. The team view has a clear active-workforce area, a path back to the company room, and a separate catalog section, so active roles and available roles do not compete visually. The local preview has no live API data, therefore it correctly displays the designed loading/empty states instead of inventing employee data.

## Integrations and billing review

The Integrations panel keeps connector setup in a single, controlled surface. Its three-step overview establishes the connection lifecycle before the forms: attach a capability, discover and grant, then review continuously. Connection fields are grouped by purpose (employee, connection type, access level, optional token, and notes), while marketplace, direct-grant, and connected-capability sections remain visible as separate actions. This supports least-privilege administration without the previous dense dashboard presentation.

The Billing panel uses three compact, comparable INR plan cards with a clear selected visual treatment for Growth. The copy explicitly states that Razorpay is server-verified before a plan is applied. The local preview has no billing API response, so it correctly retains its loading state rather than presenting simulated account data. Both panels render with balanced desktop spacing and without clipped controls.
