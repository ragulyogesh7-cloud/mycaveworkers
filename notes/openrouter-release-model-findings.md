# OpenRouter release model findings

Research date: 2026-08-20.

Sources:
- https://openrouter.ai/api/v1/models
- https://openrouter.ai/docs/guides/routing/provider-selection
- https://openrouter.ai/docs/overview/models

Key findings:
- OpenRouter's public Models API exposes current model IDs, aliases, canonical slugs, context length, pricing, supported parameters, expiration dates, and tool support metadata.
- The provider-selection guide states that OpenRouter load-balances across healthy providers by default and supports provider options such as allow_fallbacks, require_parameters, data_collection, ZDR, only/ignore provider filters, throughput/latency sorting, and max_price.
- OpenRouter documents `:nitro` as a throughput-prioritization shortcut and `:floor` as a price-prioritization shortcut.
- The current catalog returned newer families than the repository's existing Claude 3.5 and Gemini 2.5 defaults, including `google/gemini-3.7-flash`, `z-ai/glm-5.3`, and `qwen/qwen3.8-27b`; because the catalog is dynamic, model IDs should be resolved/validated from the live API or pinned to documented canonical slugs before deployment.
- The submitted OpenRouter credential must not be stored in this file, source code, Git history, browser storage, or user-visible configuration. It should be revoked/rotated and then injected server-side as `OPENROUTER_API_KEY` through Cloud Run Secret Manager.

Release implication:
- Prefer a small, durable roster of validated canonical model IDs per employee, with environment overrides and provider fallback policy. Add a startup health check that validates configured IDs against OpenRouter's model catalog without logging the credential or prompt content.
- Configure tool-capable routing and explicit fallback behavior for connector-using tasks; never claim an external action succeeded without provider evidence.
