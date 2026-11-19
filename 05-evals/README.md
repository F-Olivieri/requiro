# Human evaluation

The evaluation rubric is `human-rubric.md`. The standalone `human-rubric.html` gives the same questions, score definitions, minimum passing scores, and review plan.

- Score one complete assistant reply against the request and current product requirements document (PRD).
- Fail any response that changes the requested scope, invents facts or commitments, discloses restricted information, or takes an unauthorized action.
- Pass only with Yes on faithfulness and grounding, and at least 4 on both clarity/testability and usefulness. A No on either Yes / No question fails the reply.
- The review schedule is planned. Human reviewers have not yet scored a shared sample to check that they interpret the rubric the same way, and no model-output evaluation has been run.

`prd-assistant-cases.md` and `spec-clarity-cases.md` are fictional test inputs and expectations for a future prompt evaluation. They are not results.

Run the offline rubric structure check from the repository root:

```sh
python3 -B 05-evals/_tooling/check-human-rubric.py
```

Logs from automated checks of the local application are in `submission/evidence/`, with their coverage limits. These checks exercise workspace behavior; they do not score assistant replies or measure business impact.
