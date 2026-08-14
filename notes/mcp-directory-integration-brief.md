# MCP Directory integration brief

## Decision
Caveworkers will use the official MCP Registry as the machine-readable discovery source and link results to MCP.Directory detail pages for human-readable installation context. MCP.Directory is treated as a catalog, not as a trusted execution provider.

## User flow
1. A tenant manager opens Settings > MCP Directory.
2. Caveworkers searches the official Registry using a bounded query and cursor pagination.
3. Results are normalized to a small safe metadata shape: name, description, repository, version, remotes, required header names/descriptions, and an MCP.Directory detail URL.
4. The manager chooses a streamable HTTP remote, reviews the endpoint and required secrets, and supplies the tenant-owned endpoint/token or OAuth details. Caveworkers never imports or invents credentials from catalog metadata.
5. The server validates the remote URL with the existing SSRF guard, encrypts the supplied token, performs a bounded MCP initialize/tools/list health check, and persists a tenant-owned connector in Firestore.
6. The manager grants discovered tools to one employee, a selected group, or the full active employee roster. Read tools may be granted read-only; write/destructive tools remain approval-required regardless of the client request.
7. Every employee can use only connectors and tools granted to that employee and tenant. Sarah remains the accountable manager for workforce tasks, and write-capable tool calls create durable approvals and realtime outcomes.

## Safety boundaries
The Registry is read-only discovery. Registry records are untrusted metadata and are not executed. Only HTTPS streamable HTTP remotes are eligible for directory-assisted connection. Private IPs, localhost, link-local, unsupported schemes, unbounded redirects, and missing endpoint validation remain blocked. Secrets are accepted only from the manager’s connection form, encrypted at rest, and never returned in public connector views. Catalog search is bounded by query length, result count, response size, and timeout.

## Persistence and audit
Registry metadata is cached only as a bounded, non-secret discovery cache. Tenant connectors, encrypted credentials, grants, and connection state remain tenant-scoped in Firestore. Discovery, registration, grant changes, tool execution, approval, and failure outcomes are logged through the existing operational/audit path.

## Explicit limitations
A catalog listing does not guarantee that its remote is available, safe for a tenant’s data, or compatible with its advertised installation instructions. The user must review the provider, supply credentials, and approve external write actions. MCP OAuth or provider-specific provisioning is not automatically inferred; the first implementation supports explicit tenant-provided HTTPS endpoint and token/header configuration, while preserving the existing Google OAuth flows.

## Official reference
- Official MCP Registry API: https://github.com/modelcontextprotocol/registry/blob/main/docs/reference/api/official-registry-api.md
- Registry endpoint: https://registry.modelcontextprotocol.io/v0.1/servers
- MCP.Directory catalog: https://mcp.directory/

Created 2026-08-15.
