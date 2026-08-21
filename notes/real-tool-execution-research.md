# Real-tool execution research

## Official MCP Tools specification
Source: https://modelcontextprotocol.io/specification/2025-06-18/server/tools

Key findings:

- MCP tools are model-controlled, but implementations may expose any user interaction model.
- Clients discover tools with `tools/list`; the operation supports pagination.
- A tool includes a unique name, description, `inputSchema`, optional `outputSchema`, and optional annotations.
- Clients invoke tools with `tools/call` and must handle both structured and unstructured results.
- Tool failures can be protocol errors or tool execution results with `isError: true`.
- Servers must validate inputs, enforce access controls, rate-limit calls, and sanitize outputs.
- Clients should confirm sensitive operations, show tool inputs before calling, validate results, enforce timeouts, and log tool usage for auditing.

Implications for Caveworkers:

- The tool catalog must store pagination state or continue discovery until all tools are loaded.
- The approval preview must show the resolved tool name and sanitized input arguments before a write call.
- Execution success must be based on a valid MCP response and, where available, structured output—not on an employee narrative.
- `isError: true` must produce a failed/blocked task state and never a completed state.
- Tool schemas should drive argument collection rather than a generic keyword filler for writes.
- Every call needs tenant, employee, connector, task, approval, timeout, and result audit metadata.

## GitHub official MCP setup guidance
Source: https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server

Key findings:

- GitHub MCP is available to all GitHub users, but individual MCP tools inherit access requirements from the corresponding GitHub feature.
- GitHub’s official documentation points users to the GitHub MCP server repository and toolset configuration guidance.
- Caveworkers should therefore guide users through the provider’s authentication and repository-permission choices rather than pretending every tool is universally available.

Design direction:

- Offer provider presets such as GitHub, Gmail, Google Workspace, Slack, Notion, and Custom MCP.
- Prefer provider OAuth when supported; offer PAT/API-key form only when the provider requires or the tenant explicitly selects it.
- After authentication, show the discovered toolsets and let the tenant grant individual tools to selected employees with read-only or approval-required access.
- Keep write tools disabled until the tenant selects the exact tool and approval policy.

## GitHub MCP server
Source: https://github.com/github/github-mcp-server

Key findings:

- The official remote endpoint is `https://api.githubcopilot.com/mcp/`.
- GitHub documents both OAuth and GitHub PAT authentication for remote MCP hosts.
- When no toolsets are specified, the remote server uses its default toolsets; toolset configuration is available for more precise exposure.
- GitHub’s MCP server covers repository management, code, issues, pull requests, actions, releases, and other GitHub capabilities. Individual tools inherit the access requirements of the corresponding GitHub feature.
- Caveworkers should not hard-code one guessed write tool. It should discover the provider’s actual tools and use the returned `inputSchema` to collect and validate arguments.
- A GitHub connector preset can safely prefill the official endpoint and explain that the tenant must select the repository and grant the minimum Contents/Metadata access needed for the intended action.

Browser note: one keyword lookup timed out, so no additional tool-name claim is made beyond the official repository documentation.
