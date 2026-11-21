# MCP Server (`deepblock-mcp`)

**Status: proposal, not an implemented runtime.** Apply the [product principles](../project-analysis/mindful-self-direction.md) and current [planning/context contracts](planning-context-contracts.md).

## Why this document exists

DeepBlock's planning API serves the CLI and desktop UI. A proposed Model Context Protocol (MCP) adapter would expose that planning context to coding agents (Claude Code, Cursor) so the user's preferred agent can assist deliberate planning — without DeepBlock building any chat UI, cloud service, or proprietary AI layer.

The protocol contract follows the official [Model Context Protocol specification](https://modelcontextprotocol.io) (stdio transport, tool schema). The scope here is deliberately small.

## Goals

- Let a local agent read today's plan, propose revisions and blocks, and read available activity evidence
- Keep DeepBlock agent-legible without adding a chat interface or any hosted service
- Enable the "repairman agent" flow: _"I lost 40 minutes to a bug — revise my afternoon"_ from the terminal

## Transport and process model

- **stdio only.** No OAuth, no streamable-HTTP listener. The MCP server runs as a local child process of the MCP client and talks to DeepBlock's existing localhost REST API. Zero new network surface.
- Implementation preference: Rust with `rmcp`, shipped as a workspace crate next to `deepb` (keeps the single-toolchain, single-binary story). TypeScript with `@modelcontextprotocol/sdk` is an acceptable fallback if `rmcp` integration exceeds a weekend of effort.

## Tool surface (small on purpose)

| Tool                | Planning boundary                            | Notes                                                                             |
| ------------------- | -------------------------------------------- | --------------------------------------------------------------------------------- |
| `get_today_plan`    | `GET /plan/today`                            | Active revision and blocks                                                        |
| `propose_revision`  | Draft proposal against the current plan base | Explain proposed changes; a revision reason remains optional in the user workflow |
| `propose_block`     | Addition to the user's draft                 | No direct write to the active schedule                                            |
| `get_reality_audit` | Audit/review reads                           | Category mix, provenance, coverage, and variance; no objective attention claim    |

These are proposed tools, not new existing REST endpoints. Specify draft handoff and current optimistic preconditions before implementation. Preserve storage-generation fences and let the user commit or discard the proposal through the ordinary planning flow.

Start with these 4 tools. Do not grow the surface past low single digits without a concrete workflow demanding it — a sprawling tool surface is SaaS maintenance burden, not personal tooling.

## Philosophy guardrails

- Proposals explain their changes and preserve earlier intentions; users may add a reason without compulsory justification
- The MCP layer is a thin adapter over the existing REST API; no business logic moves into it
- Audit tools are read-only
- The agent proposes; the user's draft/commit revision flow decides

## Non-goals

- No OAuth, remote, or streamable-HTTP transports
- No agent autonomy over scheduling (no background self-replanning)
- No required AI conversation, scoring, or enforcement to use the planner
- Preserve the existing loopback, Host/Origin, and request-safety boundaries; connecting an agent does not grant desktop-control authority
