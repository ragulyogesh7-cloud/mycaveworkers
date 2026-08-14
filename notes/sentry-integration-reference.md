# Sentry integration reference

Source consulted on 2026-08-14: [Sentry for Express](https://docs.sentry.io/platforms/javascript/guides/express/).

The official guide specifies the following implementation constraints for the Node/Express service:

1. Install `@sentry/node`.
2. Initialize Sentry before application modules that should be auto-instrumented. For ESM, load a dedicated instrumentation module with Node's `--import` option before the application entry module.
3. Register `Sentry.setupExpressErrorHandler(app)` after application routes and before other Express error-handling middleware.
4. Use the SDK to capture unexpected errors and retain a normal application error responder so clients receive a redacted response.
5. Keep Sentry configuration optional when `SENTRY_DSN` is absent and avoid sending credentials, cookies, authorization headers, request bodies, or sensitive tenant values.

Caveworkers implementation target: `instrument.ts` initializes the SDK from `SENTRY_DSN`; production start uses `node --import ./dist/instrument.js dist/server.js`; `server.ts` adds request correlation, component-level structured reporting for worker/connector/payment failures, health visibility, Express error capture, and process-level failure capture.
