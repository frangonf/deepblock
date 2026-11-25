# Ratatui daily planner

**Status:** Proposal for an opt-in `deepb tui` subcommand. The first prototype is for people planning from a keyboard in a local terminal or over SSH to the machine running DeepBlock.

## Daily workflow

- Open the current day with the active revision in focus. Switch dates, move through time, and select blocks from a scrollable day grid. Use an agenda at narrow widths and preserve the selected block when the terminal resizes.
- Add, edit, delete, move, and resize blocks with keys and a small editor for direct time entry. Preview the new positions of affected blocks before saving. Keep the available keys and the unsaved state visible in the interface.
- Undo the last draft action, discard the draft, or save it explicitly as a single batch. Preserve staged edits when a save fails, and prompt before exiting with an unsaved draft.
- Browse saved revisions chronologically with the active revision selected first. Show side-by-side history when there is room, with older revisions to the left. Use a revision selector in the narrow agenda. Saved history and past days are read-only.

Use the [shared planner workflow](planner-grid-ux.md) as the reference for draft and revision behavior. Keep mouse drag and resize as follow-up work after trying the keyboard flow over SSH. Ratatui supports custom rendering and mouse input through [custom widgets](https://ratatui.rs/recipes/widgets/custom/).

## Reuse and state

Reuse `deepb` backend discovery, request handling, and shared Rust wire models. Extend the CLI client with the typed batch-save request for `POST /plan/replan`. Retain the active revision snapshot and dataset generation that the draft started from. On save, send the ordered operations, full base snapshot, and captured generation header. A stale revision or dataset leaves the draft in place for review and reload. Leave commit validation and revision creation with the server. See [optimistic drafts](../storage-and-request-safety.md#optimistic-drafts).

Keep preview and draft undo in terminal session state. Moving or resizing a block can displace later blocks, so exercise the terminal preview, web preview, and server commit with shared scheduling examples. Keep existing scripting commands unchanged.

## Prototype acceptance

- Over SSH, add a block, shift the afternoon, undo one shift, save once, and inspect the previous revision. Compare how quickly those tasks feel in the terminal and browser.
- Test the agenda at 80 × 24 and history in a wider terminal. Resizing and scrolling should preserve the user's place and keep the selected revision visible.
- Verify that saves match the displayed preview, stale drafts keep their edits, and acknowledgements clear only the submitted draft. Cover the initial revision, subsequent saves, and preview displacement.
- Check that reads and saves leave the terminal responsive and that normal exit, interruption, and errors restore terminal state.
