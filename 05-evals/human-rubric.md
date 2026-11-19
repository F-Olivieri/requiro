# Human Evaluation Rubric · Requiro

## What the reviewer scores

- **What you’re scoring:** One complete Requiro reply that drafts or revises requirements in a product requirements document (PRD).
- **Value proposition:** Turn the product manager’s need into clear, testable requirements without inventing facts or making decisions for that person. Compare the complete reply with the request and the current PRD supplied to the assistant. If that review context is missing, mark the reply Not scorable and obtain the missing context before scoring it. Review a reply that only asks a question, or correctly refuses a request, separately; it does not fail for lacking a draft.

## Scoring questions

| Scoring criterion | Question | Scale | No / scores 1–2 | Scores 3–4 | Yes / score 5 |
|---|---|---|---|---|---|
| Faithfulness to the request (a No fails the reply) | Does the reply preserve the requested users, behavior, scope, and constraints? | Yes / No | Omits, contradicts, or silently changes a requested user, behavior, scope, or constraint. | Not used for Yes / No | Preserves the requested behavior and constraints; unrelated requirements stay unchanged. Extra ideas are labeled Proposed. |
| Grounding in supplied evidence (a No fails the reply) | Are facts and commitments supported by the supplied context? | Yes / No | Invents or misrepresents evidence, targets, owners, deadlines, or approvals. | Not used for Yes / No | Claims match the evidence; unknowns remain explicit and suggestions are labeled Proposed. |
| Clarity and testability | Could a product manager and engineer agree on what to build and how to check it? | 1 to 5 | 1: No observable behavior or acceptance check. 2: Intent is recognizable, but essential behavior or acceptance is vague or missing. | 3: The main behavior can be checked, but an important condition still has more than one meaning. 4: The known behavior and its acceptance criteria are clear; specific questions identify the unresolved details. Inventing a target does not earn a higher score. | 5: All decisions needed to accept the work are resolved, including what should happen in relevant failure cases. |
| Usefulness | How much editing does the product manager need before the draft is ready for review? | 1 to 5 | 1: Discard it and restart. 2: Substantial rewrite. | 3: Useful starting point, but needs a material correction. 4: Minor wording edits; changes and open decisions are easy to find. | 5: Ready for review as written; the next decision is clear. |

## Planned reviews and agreement on scores

- **How many answers you’ll score, and how often:** Proposed: five drafting responses each week, covering routine requests, missing information, and revisions.
- **Who scores them with you:** Proposed: the product owner and one engineer score the same responses independently; each score includes a quote and a short reason.
- **If the reviewers disagree:** Compare the quoted evidence with the score definitions and record the agreed score. If the disagreement remains, leave the result pending, clarify the requirement, and score it again.

## Minimum scores for a pass

Yes on faithfulness and grounding, and at least 4 on both scales. Correct a failed reply and review it again. PRD approval and review of implemented work remain separate human decisions.

**The reply fails if any of these occurs, regardless of other scores:**

- Faithfulness: any "no"
- Grounding: any "no"
- Any invented fact or commitment, restricted information disclosed, or an unauthorized action or false claim of saving, testing, or approval.

## Evaluation status

This is the scorecard and planned process for checking that reviewers use it consistently. The product owner and an engineer have not yet scored a shared sample. No model-output evaluation or real-world impact study has been completed for Requiro. Automated application checks are reported separately; they exercise workspace behavior and do not score assistant replies.
