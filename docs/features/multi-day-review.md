# Multi-day review

Review includes a date-range section, defaulting to seven days ending on the
selected date. `GET /review/range?start=YYYY-MM-DD&end=YYYY-MM-DD` accepts an
inclusive range of 1–31 days. The response identifies its baseline as
`final_active_revision`: use each day's last saved revision once, never add all
revisions as if they represented additional work.

Planned minutes include non-cancelled blocks, including breaks. Reported minutes
sum only explicitly entered values: zero remains zero, and absence remains null
when no block has feedback. Every aggregate includes eligible and reported block
counts. Focus is an unweighted mean of recorded block ratings across the range;
it is not an average of per-day means. Completion coverage includes explicit
true/false annotations and legacy `done` status, with explicit annotations taking
precedence. Completion alone supplies neither time nor focus evidence.

Each date includes its baseline revision (null for no saved plan), per-field
coverage, and available revision reasons. Missing dates stay visible. The first
increment does not aggregate by project, infer missing feedback, consume tracker
activity, or make an objective attention/distraction claim. The existing daily
review and outcome editor remain available.

Rust/API and Playwright fixtures cover revised plans, cancelled blocks, absent
days, unequal daily focus coverage, reported zero and missing feedback.
