# MCP Directory integration research

## Findings

- MCP.Directory (`https://mcp.directory/`) is a public catalog of MCP servers and skills. The public page advertises browsing, server detail pages, one-click install for several clients, manual configuration for MCP-compatible clients, server categories, publishers, and curated lists. The public content reviewed did not expose a documented tenant-facing API contract for server discovery or provisioning.
- The official MCP Registry documentation (`https://registry.modelcontextprotocol.io/docs`) describes a community-driven registry service for MCP servers and links its GitHub documentation. This is a registry/discovery service, not a replacement for the MCP client transport or tenant credential management.
- The official MCP documentation (`https://modelcontextprotocol.io/docs`) defines MCP as a standard for AI applications to connect to external data sources, tools, and workflows. Caveworkers should remain an MCP client: discover metadata separately, then connect to approved remote servers through the existing server-side transport with tenant-scoped credentials and grants.

## Integration boundary

Do not scrape MCP.Directory or invent an undocumented API. The safe first implementation is a curated/discovery adapter that consumes verified server metadata or explicit server URLs, records provenance, and hands only approved remote endpoints to Caveworkers' existing custom-MCP registration flow. Directory entries must not automatically grant tools, credentials, or external write authority.

## Source URLs

1. https://mcp.directory/
2. https://registry.modelcontextprotocol.io/docs
3. https://modelcontextprotocol.io/docs

## Security implications

Every discovered server still requires SSRF validation, HTTPS and DNS/IP policy checks, encrypted tenant credential storage, employee-specific grants, approval gates for external writes, bounded timeouts, redacted logs, and tenant-scoped audit events. Public directory popularity or publisher status is not a security authorization signal.

## Official Registry API findings

- Official API base: `https://registry.modelcontextprotocol.io`.
- Public read-only discovery is available at `GET /v0.1/servers`; server detail and version history are available at `GET /v0.1/servers/{serverName}/versions/{version}` and `/versions`. Server names and versions in path parameters must be URL-encoded.
- The list API supports cursor pagination (`limit`, `cursor`), `search`, `updated_since`, `version=latest`, and `include_deleted`. The API is unauthenticated for read-only aggregation; publishing uses separate namespace authentication and is not needed by Caveworkers.
- Registry entries use standardized `server.json` metadata including a unique name, title/description, version, packages/transports, and other installation/configuration data. A catalog entry is metadata only; it does not grant Caveworkers credentials or permission to invoke tools.
- Official documentation says the Registry is currently in preview, may have breaking changes or data resets, and does not provide uptime or data durability guarantees. Aggregators are advised to sync infrequently and persist their own copy. Therefore Caveworkers should use short-lived cached discovery results with a graceful fallback, never depend on Registry availability at task-execution time, and keep tenant connections in Firestore.
- Official documentation also says the Registry is primarily for downstream aggregators, while host applications should consume a downstream marketplace/subregistry. Caveworkers can still use the read-only Registry endpoint for initial discovery because it is the stable machine-readable upstream, while MCP.Directory remains the human-facing detail link and curation context.

## Sources

4. https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md
5. https://modelcontextprotocol.io/registry/registry-aggregators
6. https://modelcontextprotocol.io/registry/about
7. https://blog.modelcontextprotocol.io/posts/2025-09-08-mcp-registry-preview/
