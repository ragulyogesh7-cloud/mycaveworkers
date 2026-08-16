# Caveworkers hosting migration assessment

## Current runtime

Caveworkers is a Node.js 22 native-ESM Express application. The main backend starts an HTTP listener, serves static files, persists tenant/workforce state through the current server persistence helpers, and starts an always-on worker that polls queued jobs every `WORKER_POLL_MS` (currently 1,500 ms). The application also owns OAuth callbacks, encrypted connector-token handling, approval workflows, SMTP dispatch, and real-time Company Room reconciliation.

## Platform evidence reviewed

1. Vercel Express documentation: https://vercel.com/docs/frameworks/backend/express — Vercel can deploy an Express application as one Vercel Function, but `express.static()` is ignored and static files must be served from `public/**`. The app must therefore be adapted before moving the current repository unchanged.
2. Vercel Function limits: https://vercel.com/docs/functions/limitations — Function invocations have bounded durations. Current documentation lists a 300-second maximum on Hobby, 800 seconds on Pro/Enterprise, and an extended 1,800-second beta option for some configurations. A 1.5-second polling loop is not an appropriate persistent worker model.
3. Firebase Cloud Functions: https://firebase.google.com/docs/functions — Firebase Functions can respond to HTTPS, Firestore, Auth, Storage, and Cloud Scheduler events and use the Firebase Admin SDK. Deploying Functions requires the Firebase project to be on the Blaze pay-as-you-go plan.
4. Firebase scheduled functions: https://firebase.google.com/docs/functions/schedule-functions — `onSchedule` uses Cloud Scheduler and can invoke queue-processing logic on a schedule. Scheduler jobs are billed, with a documented allowance of three jobs per Google account at no charge; Functions still require Blaze billing.

## Recommendation

Do not perform a blind “Cloud Run to Vercel” move. The lowest-risk split is: Vercel for the web/API surface only, Firestore for durable tenant and job state, Firebase Auth for customer identity if the existing auth contract is migrated, and Firebase Cloud Functions/Cloud Tasks for the workforce worker and long-running or retryable external actions. Google Cloud remains necessary for the OAuth client, Gmail/Drive/Sheets API enablement, callback URI, OAuth consent, and secret storage. Moving the frontend to Vercel does not remove that requirement.

The first migration milestone should be a staging branch with a Firestore adapter and a deployable Vercel entrypoint. Existing PostgreSQL/in-memory persistence, session cookies, connector encryption, and worker state should remain in production until data migration and parity tests pass. The SMTP app password should be stored as a Vercel encrypted environment variable or Firebase/Google secret for the worker only, never in Firestore or the browser. Gmail/Drive/Sheets access still requires per-tenant Google OAuth; SMTP grants email sending only and cannot grant Drive or Sheets access.

## Decision boundary

Firebase Hosting plus Firebase Functions is a more natural all-in-one target for this workload than Vercel plus Firebase because the worker, Firestore triggers, scheduler, and Auth are in one user-owned Google project. Vercel is still suitable for the UI and request API if the user strongly prefers it, but it would require a separate Firebase Functions worker or another persistent execution service. No production migration has been performed yet.
