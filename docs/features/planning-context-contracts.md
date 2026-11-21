# Planning and context contracts v1

The Rust definitions in `apps/server/src/context.rs` are the implemented
versioned serialization contract, backed by SQLite persistence and UI/CLI workflows.

## Identity, ownership and intent

Projects have UUID identities, a nonempty name and `personal`, `employer` or
`client` ownership. Goals have UUID identities and a nonempty outcome label;
they can span projects. A block optionally associates `metadata.project_id`
and `metadata.goal_id`; unassigned existing blocks remain valid. Associations
must resolve in the catalog. Identities cannot be renamed by changing their ID.
Catalog updates preserve referenced entries, and snapshots embed their labels
and ownership so later renaming does not rewrite earlier intention.

The stable legacy block reference is `(date, block_id)` and a revision reference
is `(date, revision_id)`. Neither component alone is globally unique. A snapshot
has its own UUID version and a UTC RFC3339 `recorded_at`. Its persisted insertion
sequence resolves equal timestamps; an effective-at query returns the last
snapshot recorded at or before the requested instant. Empty days have no
committed intent until persisted. Legacy naive timestamps remain verbatim;
import does not invent timezone offsets or reconstruct overwritten commitments.

Every change to the active scheduling/context representation creates a snapshot,
including updates to a mutable revision head and undo/redo. A snapshot includes
block identity, label, scheduling, type/status, next action, artifact references,
and resolved project/goal context. Outcomes, sensor annotations, unrelated
metadata and Markdown notes do not change intent. Successful persistence precedes
notification; consumers resynchronize through dated snapshot queries.

## Operation matrix

| Operation               | Dates                                     | Revision behavior                                 | Intent                               | Clear versus omit                        |
| ----------------------- | ----------------------------------------- | ------------------------------------------------- | ------------------------------------ | ---------------------------------------- |
| UI draft commit         | Today/future                              | First pristine A or one new revision              | New version when changed             | Explicit changed fields                  |
| Individual CLI/API edit | CLI today; dated API supports valid dates | Existing manual/timed/every_change/never strategy | New version when changed             | Nullable fields distinguish omitted/null |
| UI context association  | Today/future                              | Existing configured strategy                      | New version when changed             | Omit preserves; null clears              |
| Notes                   | Any valid date                            | No revision                                       | Preserved                            | Full text replacement                    |
| Outcome API / dated CLI | Today/past, live blocks                   | No revision                                       | Preserved                            | Omit preserves; null clears              |
| Undo/redo               | Today                                     | Existing retained history                         | New version when intent changes      | Restores full prior plan                 |
| Catalog update          | All dates                                 | No scheduling revision                            | Refreshes affected effective context | Full validated catalog replacement       |

Dedicated CLI feedback: `deepb outcome BLOCK --date YYYY-MM-DD`, optional
`--actual-duration`, `--focus-rating`, `--completed`; separate `--clear-*` flags
produce null and conflict with setting the same field. An empty update is
rejected. Zero actual minutes is reported evidence; missing minutes is absent
evidence. Completion alone does not establish time, focus or task execution.

## Compatibility fixtures

The contract test exercises an unassigned block, a mutable head, reported zero
and completion without new intent. Integration fixtures cover personal/employer
projects, a cross-project goal, null clearing, immutable context renaming, and
dated snapshot lookup. Existing serialized block fields and revision letters
remain unchanged. No full task-management or mandatory checkout workflow is added.
