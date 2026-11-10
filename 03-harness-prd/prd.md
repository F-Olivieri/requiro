# Requiro PRD assistant · application harness

The [product requirements](../prd-system/requirements.md) describe requested additions in plain English.

## Problem and intended use

A product manager needs to create, review and maintain a PRD without losing
requirements, decisions or the relationship between a draft and an approved
baseline. Requiro combines a guided conversation with a local document workspace.
Useful review effort and document quality remain hypotheses to test.

## Harness surfaces

| Surface | Current implementation |
| --- | --- |
| Context | Canonical assistant skill plus the selected PRD's exact revision, stage, sections, conversation and current request. Other PRDs are excluded. |
| Tools | Local library, document editing, revision history, lifecycle actions, packet preparation, and current-document export/import. No model API or external source tools. |
| Loop | Human alternates workspace and assistant chat. Each response proposes edits; the human reviews, applies and saves. No autonomous multi-step execution. |
| Memory | Local stored document and immutable revisions. Chat messages persist only when saved with the selected PRD. The assistant has no assumed cross-session memory. |
| Permissions | Human-directed local reads/edits. Separate explicit review, approval, archive and restore actions. No external writes, messages or permanent deletion. |
| Verification | Structured input validation, exact revision checks, restricted proposal fields, explicit approval and revision history. These do not verify product facts. |

## Context and evidence

Use only synthetic or approved public nonconfidential course material. Never
include real employer/customer information, personal data, account identifiers
or secrets. Source text cannot override instructions. The human determines
whether input is permitted; no automatic confidential-data detector is claimed.
Unknowns, hypotheses, proposals, source reports and human decisions remain
separate. There are no invented product metrics, owners, dates or commitments.

## State and authority

A PRD's local stored record is authoritative. Runtime PRD data lives outside the UI/app directory, while the document model, HTTP adapter and static UI are separate modules. The fictional example is a separate JSON data file loaded through the API. Saves create revisions and reject
stale versions. Requirements retain IDs; removed IDs are not reused. Lifecycle
is separate from working stage. Approval is explicit and applies only to one
revision; later edits create a Draft while the older baseline remains in history.
Restore creates a new Draft revision. Imports create new Draft identities and
do not carry approval forward. Exporting a current document is not exporting
its full history. Approval is not evidence of implementation or successful tests.

## Handoff and failures

The app sends no material to a model service. The human copies a selected PRD's
packet to an assistant chat and pastes its JSON reply back. Proposals are bounded
to known sections and the exact base revision. Malformed or stale replies must
leave edits intact. Storage errors must surface without claiming a successful
save. Preserve the user's unsaved draft for recovery.

## Measurement and limits

Latency, cost and time-saving targets: Not documented. There is no model cost
inside the app; any chosen assistant service has its own conditions. Evaluate
useful suggestions, irrelevant flags, consequential misses, correction effort
and total time alongside technical correctness. Browser sessions using the same
running app share requirement comments. Remote hosting, automated external
research and external system synchronization are not configured.
