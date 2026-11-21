# Advanced module boundaries v1

The implemented module boundary provides versioned processing contracts, bounded disposable-worker supervision,
capability/health discovery and fault fixtures. Production recording, inference,
assessment and workspace control are not connected. `GET /modules` reports all
four modules as unconfigured by default; Settings displays that state independently
of planning. Tests register mock processors explicitly.

## Ownership and transport

Planning owns its SQLite connection, date/backlog locks and immutable intent
snapshots. Optional processors receive only `ProcessingTask`; their interface
has no planning writer or desktop executor. Recorder/evidence storage must be a
separate writer/file with independent retention and deletion. Provider adapters
cannot open planning tables. Initial mock transport is in-process Rust messages;
future signed native helpers and remote endpoints implement the same versioned
envelopes and require compatibility tests before connection.

The stable module IDs are recording, processing, assessment and assistance.
Capability discovery identifies API version, supported execution locations,
provider identity and truthful health; an unavailable capability is not advertised
as active. Native collection remains device-local regardless of processing location.

## Processing and routing

`ProcessingTask` v1 contains a request UUID, bounded idempotency key, optional
intent UUID, explicitly selected execution location, relative deadline and payload.
`ProcessingReply` v1 echoes the request and records provider/location provenance.
Both payloads are bounded at 64 KiB. A reply with mismatched version/request/provider/
location is rejected. Errors, unresolved results and absence of evidence remain
explicit; no provider result is interpreted as a planning mutation or action.

A host advertises its supported locations and receives an independent transmission
policy. Device-local work is permitted; self-hosted/hosted work requires an
explicit configured destination permission. There is no local-to-external
fallback, upload on failure or automatic location switching. Future policy must
also specify permitted evidence fields, retention and credentials outside portable
user-data exports before real endpoints are connected. Identical retained
idempotency keys return the same job; a different task under the key is rejected.
Terminal results are bounded to 128 jobs, so clients must not assume indefinite
or across-restart deduplication.

## Lifecycle and failure behavior

Each host starts disabled. Enable, pause/resume, disable and shutdown are
independent of planning. Pause/disable cancel outstanding jobs; shutdown closes
admission, cancels work and drains queued tickets into explicit cancelled states.
Jobs transition through queued/running to completed, failed, expired or cancelled.
Queue residence counts toward the deadline. Cancellation or deadline expiry
aborts the async attempt; late replies cannot publish a completed result.

A separate OS thread and Tokio runtime supervise the optional processor, with
one blocking-pool thread, one active async attempt, a 1–64 bounded queue and 128
retained result records. Admission rejects overload rather than blocking a save.
A crashed task becomes failed; later tasks start fresh after bounded backoff.
Health exposes failures and queue occupancy. Background/quit behavior is explicit:
the current app has no configured background collector, and dropping a host requests
shutdown. Real native/model integrations must use supervised helper processes for
uninterruptible blocking calls, native crashes, hard termination and CPU/GPU limits;
the mock runtime does not certify those properties.

## Future evidence, assessment and assistance envelopes

Recording transport must declare source UUID/session, source sequence, observation
and collection timestamps, monotonic timing where available, freshness, coverage
and provenance. Unknown/unavailable intervals remain explicit. Replay uses a source
cursor and bounded pages; reconnect never implies uninterrupted coverage. Stable
evidence references connect through APIs rather than shared database transactions.

Assessment requests reference an effective intent UUID plus evidence/context
versions and freshness limits. Replies distinguish unresolved, insufficient and
attributed evidence, include provenance/confidence and expiry, and accept user
corrections without rewriting original observations. Assistance proposals reference
a fresh assessment, user policy, scoped target/actions and explicit inverse actions.
The action executor remains separate, checks expiry/policy again at execution,
and reports applied, refused, failed or reversed. These are required contracts for
the advanced implementation backlog; no recording/action HTTP endpoints are
presented as implemented in this preparation stack.

## Measured budgets and evidence

Same Linux x86_64 Ryzen 5 3600 host as the original planning baseline. Post-SQLite storage benchmark:
plan/history save p50 374 µs, p95 454 µs; Markdown note p50 77 µs, p95 106 µs.
Mock saturation fixture: 30 combined plan-create and note-save endpoint pairs,
p95 29 ms. The regression ceiling is 250 ms for the pair on the local fixture;
it is deliberately distinct from a production GUI latency guarantee.

`module_isolation.rs` covers overload, stalled processors, deadline expiry,
cancelled queued/running work, task panics, subsequent-job recovery, modest CPU
work, duplicate/conflicting keys, policy rejection and truthful module state.
`module-independence.spec.ts` checks successful UI planning when optional module
status is unavailable. Actual native helper load, GPU/memory pressure, signed
installation and end-to-end browser latency under native capture require capability-specific validation
before enabling production recording.

## Advanced implementation backlog and macOS research

Build on the completed foundation with recording → project context
→ calibrated intent assessment → reversible assistance. First tasks:

- Implement native event/source envelopes and separate evidence storage/replay.
- Prototype a signed macOS helper, permissions, install/upgrade and quit behavior.
- Investigate exact macOS 27 Vision/Foundation Models and own-model APIs on matching
  hardware; record capability, offline behavior, permissions, signing and resource
  costs. No framework/model availability is inferred from this Linux validation.
- Implement compatible local/self-hosted/hosted adapters with explicit field-level
  transmission policy, cancellation and hard process/resource limits.
- Validate terminal/SSH/tmux/editor project transitions against explicit context.
- Gather consented labeled examples and calibrate assessment before action control.

See the canonical advanced vision for detailed acceptance criteria. Research
prototypes and these mock workers do not enable production capture.
