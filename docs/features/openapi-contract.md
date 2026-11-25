# OpenAPI contract for local clients

**Status:** Proposal. The current HTTP contract lives in the Axum routes, Rust models, and integration tests. The planner UI and `deepb` use handwritten clients.

## First release

Generate an OpenAPI 3.1 document from the Axum handlers and Serde wire models. Evaluate [utoipa-axum](https://docs.rs/utoipa-axum/latest/utoipa_axum/) to register each documented route and its schema together. Export a deterministic document from the repository at build time. The existing localhost API remains the runtime boundary.

| Operation                           | What the contract must describe                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `GET /storage/status`               | Dataset generation and storage availability                                                           |
| `GET /plan/{date}`                  | Date format, active revision, saved history, and block fields                                         |
| `POST /plan/replan?date=YYYY-MM-DD` | Ordered draft operations, batch-local block IDs, optional reason and copy mode, and the returned plan |
| `GET /config` and `PATCH /config`   | Settings read and partial update, accepted fields, and validation errors                              |

Use stable operation IDs and representative request and response examples. Describe actual response content types, including plain-text middleware errors and JSON handler errors. Document `/ws/events` separately as a refresh channel.

## Save and recovery behavior

- Write requests in this scope carry `X-DeepBlock-Dataset-Generation`. Missing generations return HTTP 428. Stale generations return HTTP 409 and require the client to refresh its storage context before the user attempts another save.
- Draft clients submit the complete active revision snapshot as `base_revision`. The existing wire field is optional for compatibility. A mismatched snapshot returns HTTP 409 and leaves the draft unsaved. Keep the user's edits available for review.
- A successful batch saves all operations together. It fills the untouched initial revision A or appends one revision on subsequent saves. A failed batch leaves the plan and history unchanged.
- When adding patch endpoints to the contract, document omitted fields and explicit `null` wherever they have distinct meanings.

See [storage and request safety](../storage-and-request-safety.md) for the current rules and [settings](../configuration.md#settings-api) for a local write example.

## Client generation and validation

Generate web-facing TypeScript types from the exported document with [openapi-typescript](https://openapi-ts.dev/introduction). Keep the existing transport responsible for browser and Tauri endpoint selection, dataset headers, and refresh behavior. The Rust CLI can continue sharing Rust wire models. A packaged SDK becomes a separate decision when another application needs the contract.

Have CI regenerate the document and TypeScript types and fail on a diff. Validate the document and exercise representative examples against an isolated server, including a successful save, a rejected batch, a missing generation, a stale generation, and a stale revision base. Test that rejected saves leave state unchanged. Use the existing [request-safety rules](../storage-and-request-safety.md#local-http-boundary) when exposing or consuming any contract artifact.
