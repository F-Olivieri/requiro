# Metrics plan · Requiro

## Decision and scope

Decide whether to continue using Requiro to draft and revise requirements for
small, fictional features. For quality and consistency, score one complete
assistant reply against its request and current product requirements document
(PRD), using the [human rubric](../05-evals/human-rubric.md). For time savings,
measure the whole task, including every reply and correction needed to produce
review-ready requirements.

The current prototype uses a human-controlled handoff: the user copies context
to a chosen assistant and pastes the reply back. It does not connect directly to an AI model.
The pilot below is proposed. Its targets are criteria for deciding what to do
next; they are not measured results or production commitments.

## Goal

Reduce the product manager's active working time from reading a supplied feature
request to producing review-ready requirements. Include prompting, copying and
pasting, checking, and correction. Preserve the requested behavior and avoid
invented facts or commitments.

## Baseline: the current workflow without Requiro

Not measured. Collect timings for five fictional tasks completed without
Requiro and five comparable tasks completed with it. Match them into five pairs
with comparable scope, reviewer, and acceptance criteria. Within each pair, use
comparable variants and alternate which workflow is tried first. Record the
order so that learning from the first task is visible. Collect the timings for
all five pairs before calculating improvement.

For both workflows, record active minutes from reading the request to a draft
that meets the same rubric's minimum passing scores. Record interruptions
separately. Application-test duration, an assumed time saving, or an estimate
cannot substitute for the unmeasured baseline.

## Targets and review date

Proposed review: December 3, 2026. If the baseline or pilot is incomplete, report
which observations are missing and extend the study. Do not claim improvement.

- **Efficiency:** at least 20% median time reduction across five matched task
  pairs. For each pair, calculate
  `(baseline active minutes - Requiro active minutes) / baseline active minutes`.
  Express each result as a percentage, sort the five percentages, and take the
  middle value. Exclude and investigate a pair with a zero or missing baseline;
  five complete pairs are needed for this decision.
- **Quality:** at least 12 of 15 complete drafting replies pass the human rubric.
  Use five fixed fictional requests, with three fresh attempts per request.
  Keep the assistant/model settings, input revision, and prompt unchanged within
  a batch. A changed prompt or model starts a new batch. Keep every attempt,
  including failures. Report the overall pass rate and each request's result.
- **Consistency:** at least four of the five requests pass on all three
  attempts. Each reply must satisfy the same requirements; its wording may vary.
- **Safety:** zero invented facts or commitments, restricted disclosures,
  unauthorized actions, or false claims of saving, testing, or approval.

These small samples support a decision about the next pilot. They do not
estimate general model reliability. The proposed 20% time reduction should make
the manual copy, paste, and review work worthwhile; review that threshold after
the first batch. The 80% response pass rate allows some replies to need
correction. The separate safety condition allows no critical failure.

## Usage metric

During a two-week pilot, record every fictional requirements-drafting task for
which Requiro could be used, and whether the user chose to use it. Proposed
target: use on at least 60% of all eligible tasks, with at least five observations
and use in both weeks. Report the number of tasks using Requiro, the total number
of eligible tasks, and reasons for bypassing it. Fewer than five eligible tasks
means there is too little usage evidence to decide; it does not mean zero use.

## Early warning pattern

Watch for the same request alternating between pass and fail across repeated
attempts, or for checking and correction to erase the apparent drafting saving.
Record the scoring question that failed, the exact output quote, and the input
revision. Check the prompt, missing context, and copy/paste steps before
expanding the workflow. Keep failed attempts; do not retry until one passes and
report only that reply.

## Continue, fix, or stop

| Decision | Proposed condition | Action |
| --- | --- | --- |
| Continue the pilot | Efficiency, quality, consistency, usage, and safety criteria all met | Try a larger fictional task set; keep human approval. |
| Fix and repeat | No critical safety failure, but a non-safety target is missed | Change one prompt or workflow element, then run a new complete batch. |
| Stop the affected workflow | Any critical safety failure, or the median time reduction is zero or negative after one correction batch | Return to the current workflow without Requiro and investigate before reuse. |

## Collect and review the observations

Use the adjacent CSV templates. Record the assistant/model/version, prompt
revision, document revision, full reply, active working time, reviewer scores,
and a short reason. Store only fictional content. The proposed reviewers
are the product owner and one engineer. They score the same replies independently
before resolving disagreements as defined by the rubric. They have not yet run
this study. An AI review may help find omissions but does not count as either
human score.

Count one final agreed result per unique case and attempt in the 15-response
batch. Independent reviewer rows do not increase that total. Set
`review_stage` to `independent` or `final-agreed`. If reviewers cannot agree,
leave the result pending and do not count it as passed. This initial consistency
batch is separate from the rubric's proposed routine monitoring of five replies
each week.

The CSV column names are kept unchanged so records can be compared:

- In the timing template, `pair_id` groups the two comparable tasks. `condition`
  identifies the workflow, with or without Requiro. `trial_order` records which
  was tried first. `active_minutes` includes checking and correction;
  `correction_minutes` is part of that total and must not be added again.
  `interruption_minutes` is recorded separately from active working time.
  `meets_review_bar` records whether the draft meets the rubric's minimum scores.
- In the quality template, `case_id` identifies the fixed fictional request and
  `attempt` identifies its repeat. `response_file` points to the saved full reply.
  The two `yes_no` scores and two `1_to_5` scores follow the rubric.
  `critical_failure` records a breach of the safety condition; `pass_yes_no`
  records the overall result. `evidence_quote` and `reason` explain the score.
- In the usage template, `eligible_yes_no` records whether the task could use
  Requiro; `requiro_used_yes_no` records whether it was used. `date`,
  `fictional_task`, and `reason` preserve when, for what, and why.
- Wherever present, `assistant_model_version`, `prompt_revision`, and
  `document_revision` identify the assistant and input used. `reviewer` identifies
  the scorer. `notes` records relevant context. Leave unknown details explicit
  rather than inventing them.

Results as of November 19, 2026: no timing baseline, human/model evaluation,
usage study, or measured business impact is available. The separate technical
checks exercise application behavior using fictional test data.
