# Owned-project live health check — 2026-08-16

The new deployment at `https://mycaveworkers.ai.studio/` is reachable and serves the Caveworkers landing page. The live health endpoint `https://mycaveworkers.ai.studio/api/health` returns `status: healthy` and reports `database: unconfigured`, `payments: unconfigured`, `firebase: unconfigured`, `analyst: gemini_fallback`, `google_oauth: unconfigured`, `smtp: unconfigured`, `mcp_bus: active`, and `observability.sentry: unconfigured`.

This confirms the new service is serving the Caveworkers code and the MCP bus is active, but the Google OAuth credentials, Firebase/database persistence, and SMTP are not configured in the new deployment. SMTP remains intentionally disabled. No connector action was executed during this check.

The custom-domain root and health endpoint are now reachable; this differs from the previous `caveworkers.ai.studio` domain, which returned 404.
