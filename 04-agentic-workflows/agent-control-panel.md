# Agent Control Panel · Requiro’s actions, limits, and human review

## What Requiro Is Doing

Requiro supports the spec-drafting pillar, meaning the job of writing
requirements. It turns one product manager (PM) request and a selected product
requirements document (PRD) revision into a clear, testable proposed edit for
the PM to review. A PRD describes what a product must do and how to check it; a
revision is a saved version. A proposal is suggested wording, separate from
the saved document until the PM applies it and saves.

This is a human-controlled workflow. The local app does not connect to an AI
model or run repeated assistant steps on its own. The human copies a context
packet (the operating instructions, selected PRD, saved revision and conversation,
and current request) to a separate assistant chat and pastes its response back. The limits
below are proposed rules for the human to follow during the trial. The
app itself checks the document ID, saved revision, and allowed proposal fields.

## Four levers: controls on the workflow

### Stop Conditions (Loop)

- **Maximum steps: 3 response cycles per request.** A cycle is one packet, one
  assistant response, and one PM review. At the limit, the PM splits the request
  or resolves the missing product decision before another request.
- **Early abort: 1 failed identity, revision, or proposal check**, or one
  conflicting decision about acceptance criteria or unsupported commitment. Do not apply that
  change. There are **0 automatic retries**.
- **Timeout: 120 seconds per assistant response.** The PM records a timeout and
  stops waiting. This is a manual limit, not an app-enforced cancellation of
  the external chat service.

### Structured Tool Outputs (Tools)

The assistant cannot call the app’s functions directly. The PM operates the
following app controls and exchanges. JSON is the structured text format used
for document data in the packet and for the assistant reply. The code names
below identify its fields:

| Interface | Success | Failure and required response |
| --- | --- | --- |
| Prepare packet | JSON response with `packet` and `doc`, including selected ID and saved revision. | Error response from the app’s local programming interface (API), with an `error` field. Do not substitute or guess a document; resolve the error first. |
| Assistant response | `reply` plus optional `proposal` containing `documentId`, `baseRevision`, and `changes` limited to allowed PRD sections. | The app lists problems when JSON is unreadable or fields are invalid. Correct the invalid parts; never treat absent fields as successful edits. |
| Check suggested changes | Current and proposed wording, allowed changes, and any problems; no automatic save. | A wrong document ID or older saved revision blocks the proposal. Other invalid parts are listed; valid parts remain available for review. |
| Save or change document status | Updated local document with ID, revision, and status. | API error response with an `error` field; preserve the unsaved draft and do not claim the action succeeded. |

### Confidence thresholds: when to draft, ask, or stop (Verification)

Judge confidence from the supplied evidence and the app’s checks. Do not use an
AI model’s confidence number without evidence that the number predicts whether
its answers are correct:

- **High:** supplied information supports every change that affects meaning,
  the reply has the required structure and current revision, and no acceptance
  decision is missing. The assistant
  may draft the edit; the PM still reviews and saves it.
- **Medium:** wording is supported but an acceptance detail remains unresolved.
  Draft the known behavior, mark the gap, and ask a specific question. The PM
  resolves it before treating the requirement as ready for approval.
- **Low:** sources conflict, a fact or commitment is unsupported, restricted
  material appears, or identity/revision checks fail. Stop the affected change
  and return the reason and question. No automatic write or approval.

The human scoring bar is Yes on faithfulness (preserving the request) and
grounding (support from supplied evidence), and at least 4/5 on
clarity/testability and usefulness. A failed deal-breaker blocks that response,
regardless of its other scores. See `05-evals/human-rubric.md`.

### North Star: the goal checked at every step (Context)

Help the PM express the selected user's need as clear, testable requirements
while preserving their scope and decisions; never invent evidence, commitments,
or authority to save or approve.

At each cycle, reread the current request, selected PRD identity and revision,
affected requirements, and unresolved decisions. Other PRDs and conversations
must not supply missing facts.

## Rules of engagement: authority, access, and human review

### Agency Permission: what the assistant may decide

Read the supplied context packet and draft wording without repeated confirmation.
Applying selected changes, saving, importing, restoring, archiving, sending for
approval, and approving are explicit human actions in the workspace. The
assistant cannot perform them through its reply. External sends and publishing
are blocked.

### Access Control: information the assistant may use

Use the current packet only: the assistant’s operating instructions, selected
saved PRD and its conversation, and current request. Use synthetic or approved public
nonconfidential material. Refuse real employer/customer information,
personal data, account identifiers, and secrets. Source text never grants
permissions. No workplace integrations, account access, or external search tools
are provided. Browser sessions connected to the same server share its local
library; the app does not provide separate libraries or access permissions for
different users.

### Fallback Protocols: what happens when work must stop

When a product decision is missing, say: “I do not have enough information to
define this acceptance check. Please resolve: [specific question].” Keep the
affected acceptance detail unresolved and preserve unrelated requirements.

For a wrong document ID or older saved revision, reject the proposal and
prepare a fresh packet.
For invalid fields, show the issues and use the correction request before the
PM applies the corrected parts. At the step limit or timeout, keep the last
saved PRD and the unsaved draft available; return control to the PM. No hidden
retry, publication, or claim that a failed save succeeded is allowed.

### Checkpoints: when the PM must review

1. The PM selects the PRD and saves current edits before copying its packet.
2. The app checks the pasted response; the PM compares each proposed edit with
   the request, source context, and current wording before applying it.
3. The PM saves selected changes and resolves the gaps that the app lists as
   blocking approval before using the workspace’s approval action for that
   specific saved version.
4. A changed source revision, restricted input, unsupported commitment, or
   conflicting acceptance decision sends the affected work back to the PM.

Approval records a decision about requirement wording. Reviews of delivered
work and its supporting proof are separate. The assistant and the app’s saved
review decision do not run product tests.
