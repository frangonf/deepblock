# Mindful self-direction and product principles

**Status: agreed product direction, 2026-10-09.** These principles guide the existing planning experience and future recording, assessment, and assistance. They do not establish that proposed capabilities are implemented or that behavioral benefits have been validated.

## Purpose

DeepBlock helps people make deliberate choices about their time, adapt those choices as circumstances change, and reflect honestly on how the day unfolded. Its starting point is a notebook: choose a realistic day, work, scribble a revision when needed, and keep whatever notes help you understand it later.

Mindful self-direction is the purpose. Goals, completed tasks, time totals, and activity measurements provide context for that reflection. A person may decide to rest, explore, change a goal, or abandon a commitment. The user defines what matters and interprets their own life; the application supports that judgment.

DeepBlock is an MIT open-source project. Its product decisions serve the usefulness of this experience. App engagement, collection volume, compliance with prompts, and dependence on an assistant are insufficient measures of success.

## The everyday experience

1. **Choose the day briefly.** Aim for an ordinary planning pass of about five minutes. This is a usability target to validate, not a timer or enforced ritual. Choose a few commitments, estimate their duration, and leave room for interruptions and unallocated time. Projects and goals remain optional.
2. **Keep the work together.** The backlog or future compact Kanban holds possible work; the timetable expresses chosen time commitments; Markdown notes hold context, discoveries, and obstacles. These surfaces share references instead of making the user maintain copies in several applications. The current backlog exists; the fuller Kanban lifecycle remains proposed.
3. **Work with little administration.** Keep the current commitment easy to find. Put detailed history, classifications, and optional controls behind deliberate access. Users can use the planner and notes without a tracker, model, or daily feedback form.
4. **Adapt like a notebook.** Revising a plan is an ordinary response to changing circumstances. Preserve the earlier intention and allow a brief reason when useful. Avoid requiring a justification for every edit or interpreting replanning itself as failure.
5. **Reflect when useful.** Offer a short review of what changed, what happened, and what the person wants to adjust. Feedback remains voluntary. An observation, a self-report, and an inferred assessment retain distinct meanings and coverage.

The planner, task reservoir, notes, and review should form one coherent daily experience. Internal APIs and optional workers remain orthogonal so that integration does not make the basic experience fragile or expensive.

## Open time and life outside the screen

Unscheduled time is neutral. A future recorder may describe digital activity outside planned blocks, but an alignment judgment requires an applicable intention chosen by the user. An empty calendar is not an instruction to classify the whole day as distraction or fill every available minute.

Computer observations cover only part of life. Missing evidence, an idle computer, or a closed application does not establish wasted time. Offline work, rest, relationships, and ordinary life need no compulsory logging. Users may add notes when doing so helps them.

The current ActivityWatch audit covers planned block windows. A neutral timeline outside those windows is future recording work, not an existing feature.

## Feedback and assistance

Capture can reduce reporting effort and help users reconstruct behavior that memory makes difficult to review. Collect enough relevant context for the chosen workflow, keep sources and gaps visible, and let users choose exclusions, retention, processing location, and pause controls. Broad coverage is an engineering capability to justify through usefulness, not an obligation placed on users.

Activity category mix, continuity, and context switches can support reflection. They do not establish cognitive depth, moral worth, or completed work. Favor descriptions and evidence over a headline productivity grade. A low category match may indicate a different context, necessary research, or incomplete evidence; its interpretation belongs in review.

Retrospective feedback is the starting point. Optional nudges should explain the commitment and observation, then offer understandable choices such as continue, revise, take a break, or dismiss. A user may deliberately choose reversible workspace assistance with explicit scopes and cooldowns. Their override remains authoritative.

AI can summarize, suggest a next step, or help examine a pattern. Users retain ordinary controls and can continue planning and reflection with AI disabled. Support can stay useful over time or become quieter as the user chooses; stronger enforcement is not an automatic progression.

Financial penalties, conditioned rewards, threatening contact with other people, compulsory checkout, and an AI permission gate for ordinary user control are outside this direction. The experience must remain usable without streaks, points, or pressure to return to the application.

## Acceptance through real use

The [completed planning foundations](pre-advanced-roadmap.md) provide the current implementation and technical evidence. Continue evaluating the everyday experience, and validate future production recording against its own technical and experience requirements. Record the workload, participants, friction, and limits of each evaluation. Passing reliability tests does not demonstrate mindful use or lasting behavioral benefit.

Evaluate whether:

- an ordinary day can be chosen in about five minutes without mandatory project setup or filling every gap;
- a changed plan can be revised briefly while keeping earlier intentions and optional reasons;
- tasks, scheduled work, and notes can be used without copying them across external tools;
- voluntary review yields a useful observation or deliberate adjustment, including with tracking disabled;
- unscheduled and offline time remain neutral, and missing feedback is not interpreted as failure;
- recording reduces recollection or reporting effort without demanding constant timeline inspection;
- inferred judgments are understandable and correctable with a modest burden;
- assistance has few false interruptions and remains easy to dismiss, pause, or disable;
- users report clearer choices or more confidence in their own judgment, rather than only more completed tasks.

Use representative ordinary days before claiming the basic experience meets these targets. Revisit them during advanced phases. Measure interaction burden and useful reflection alongside technical accuracy and resource costs. User-selected persistent support can be valuable; frequent interaction alone does not demonstrate value.

## References and scope

The [current planner](../features/planner-grid-ux.md) and [revision philosophy](../features/automatic-revisions.md) supply the notebook foundation. The [advanced vision](advanced-deepblock-vision.md) defines optional evidence, context, and assistance behind independent contracts.

Other products provide design references, not proof of effectiveness or an unserved market:

- [Intend](https://intend.do/features): intentions, outcomes, and optional partner accountability.
- [Focusmate](https://support.focusmate.com/en/articles/9110188-getting-started): a bounded session with an opening intention and closing report.
- [Boss as a Service](https://bossasaservice.com/): follow-up on commitments and evidence from a human accountability partner.
- [Summit](https://help.summit.im/): ongoing AI goal support and remembered conversational context.
- [Hawser](https://gethawser.com/): task-aware screen feedback and user-selected assistance.
- [Overlord](https://overlord.app/docs/): goal-related monitoring and enforcement mechanisms. Its penalties and control emphasis are outside DeepBlock's product direction.

Choose reusable technology and references by their fit with these principles. Assess product behavior rather than inferring intent or effectiveness from founders' previous employers, investment, or marketing claims.
