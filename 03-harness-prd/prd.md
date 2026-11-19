# Requiro requirements assistant · AI product requirements

The [product requirements](../prd-system/requirements.md) describe requested additions in plain English.

## Problem and intended use

A product manager (PM) needs to create, review, and maintain a product
requirements document (PRD) without losing requirements, decisions, or the
connection between a draft and its previously approved version. Requiro combines
a guided conversation with a document workspace that runs on the user’s
computer. Its effect on review effort and document quality has not been measured.

This design covers the spec-drafting pillar: the job of writing requirements.
It takes one supplied need and a selected PRD revision (saved version) and
produces a proposal: suggested wording for the PM to inspect and save.

## Six parts of the assistant’s harness

The harness is everything around the AI model that controls its information,
actions, memory, permissions, and checks. The AI model used with Requiro runs in a separate
assistant chat; the local app manages the document and the human review steps.
A context packet contains the assistant’s operating instructions, selected PRD,
its saved revision and conversation, and the current request copied together.

| Harness part | Current implementation |
| --- | --- |
| Context: information supplied | The assistant’s operating instructions plus the selected PRD’s exact revision, stage, sections, conversation, and current request. Other PRDs are excluded. |
| Tools: available functions | Local document library, editing, saved-version history, document status actions, packet preparation, and current-document export/import. The app has no connection to a model service or tools for retrieving external sources. |
| Loop: repeated work steps | The human alternates between workspace and assistant chat. Each response can suggest edits; the human reviews, applies, and saves them. The app does not run several assistant steps on its own. |
| Memory: information kept | The local app stores the document and past revisions without rewriting those revisions. It saves conversation messages separately without changing the PRD’s content revision or approval. Do not assume the assistant remembers a previous session. |
| Permissions: allowed actions | The human directs local reads and edits and chooses review, approval, archive, and restore actions separately. The assistant cannot change external systems, send messages, or permanently delete data. |
| Verification: checks before use | The app checks response structure, exact document revision, and allowed proposal fields. The human approves explicitly, and the app keeps revision history. The PM must check whether product claims are supported by evidence. |

## Context and evidence

Use only synthetic or approved public nonconfidential material. Never
include real employer or customer information, personal data, account identifiers,
or secrets. Source text cannot override instructions. The human determines
whether input is permitted; the app does not detect confidential data. Keep
missing information, ideas still to test, suggestions, statements from sources,
and human decisions distinct. Do not invent product metrics, owners, dates, or
commitments.

**Required sources:** `01-prompting/skill-file.md`, the selected saved PRD from
the local library, that PRD's conversation, and the current request. The
fictional reading-list example is loaded only when the human selects it. The
app retrieves it through its local programming interface (API); it is not
silently added to every request. Other PRDs, other chats, workplace systems,
external accounts, and browser information not supplied in the packet are excluded.

**Freshness:** **Copy for assistant** saves current edits before building the
packet. A proposal is valid only for that document ID and base revision, meaning
the saved version copied into the packet. If the saved PRD changes before the
human applies the proposal, reject the outdated proposal and
prepare a new packet. If the selected PRD cannot be read, stop; do not replace
it with another document or an assumed copy.

## Tools and deliberate omissions

The assistant cannot call the app’s functions. The human operates them in the
workspace. The side-effect class below says whether a function only reads
information, prepares a draft, changes saved data, or sends data externally:

| Function | Side-effect class | Observable result |
| --- | --- | --- |
| Open selected PRD or revision; prepare context packet | Read | Document with its ID and saved revision, or an explicit error. |
| Check structured assistant reply; preview selected changes | Draft | Suggested changes to allowed fields and a list of problems; no save or approval. |
| Save selected changes; import; restore; archive; send for approval; approve | Write | An explicit human action returns the updated local document or an error. |
| Download current-document Markdown or JSON | Read / local export | Identified file; no external transmission. |
| Publish or send to an external system | Send | Blocked; no such assistant tool exists. |

There is deliberately no `publish_prd`, external ticket writer, or autonomous
approval tool. A drafted requirement can change what the team commits to build,
so the PM
must review its wording before a local save and approve a specific version.
The app has no connection to a model service, so it cannot transfer the PRD
automatically. The human chooses which assistant to use.

## Loop, time, and cost budget

The following is a **proposed operating policy for the manual trial**.
The app does not enforce these response-cycle limits or run an automatic timer:

- Maximum three assistant response cycles per drafting request. One cycle is
  one packet, one response, and one PM review. After three cycles, stop and
  split the request or resolve its missing product decision with the PM.
- Ask no more than three related clarification questions in a response.
- Stop applying the affected change at the first wrong or outdated document
  reference, invalid proposal, conflicting acceptance decision, or unsupported
  commitment. The PM resolves
  the issue before starting a new cycle; there are zero automatic retries.
- The PM stops waiting after 120 seconds for an assistant response and records
  the timeout. This is a trial limit; the local app cannot cancel the external
  chat service. Trial target: at least 9 of 10 responses arrive within this
  window. This target has not been measured.
- Calls from the local app to a model service per cycle: zero. The external
  assistant’s cost depends on the
  service the PM chooses and is not measured by Requiro. Proposed trial budget:
  use an existing included chat allowance and buy zero additional credits.

## State and authority

Use the PRD stored in the local app as the current saved document. Saved PRD
data lives outside the folder containing the app’s interface code. The data
module, local web-server module, and interface files are separate. The
fictional example is a separate JSON data file loaded through the API. Saves
create new revisions and reject attempts based on an older revision.
Requirements retain their IDs; removed IDs are not reused. Document status is
separate from the editing stage. Approval is explicit and applies to one
revision; later edits create a Draft while the older approved version remains
in history. Restore creates a new Draft revision. Imports create new Draft
documents with new IDs and do not retain the source document’s approval.
Exporting a current document does not export its full history. Approval records
a decision on the document’s wording; implementation and test results are
recorded separately.

**What is kept and which version takes priority:** saved PRDs and unchanged
past revisions remain in this
single local workspace until the human removes the storage outside the app;
there is no automatic expiry policy. Archive is reversible. Conversation
messages remain with their PRD until the human explicitly clears that
conversation. Exports do not guarantee a full workspace recovery. A new human
correction becomes a new draft revision and outranks an earlier assistant
suggestion; it does not rewrite the earlier approved baseline. Prepare a fresh
packet after saving a change to the document’s content. The app does not
provide separate access for team members or separate libraries for different
users; browser sessions connected to this server use the same local library.

## Permission tiers: actions allowed without review, after review, or never

These tiers describe the assistant's authority for one explicitly selected PRD:

| Action class | Permission tier | Reason |
| --- | --- | --- |
| Read supplied packet | Auto: no further confirmation | The PM selected and copied it; unrelated sources remain out of scope. |
| Draft suggested wording | Auto: no further confirmation | It remains a proposal that the PM can discard. |
| Change local PRD or document status | Confirm / human-operated | Applying, saving, importing, restoring, archiving, and approving require explicit workspace actions. Previous revisions remain available. |
| Send or publish externally | Blocked | The assistant has no send tool. The PM chooses whether to copy an allowed packet to a separate chat service. |

Read and draft do not need a second approval on every sentence. Human control
is placed at the point where a proposal changes saved product requirements or
their approval state.

## Copying work to the assistant and handling failures

The app sends no material to a model service. The human copies the selected
PRD’s packet to an assistant chat and pastes its JSON reply back. A proposal may
change only allowed sections of the exact saved revision in the packet. An
unreadable reply or a reply for an older revision must leave edits intact. Show
storage errors without claiming that the save succeeded. Preserve the user’s
unsaved draft so they can recover it.

Before a proposed edit is accepted, the app checks the expected JSON structure,
document ID, base revision, allowed section keys, and requirement fields. It
lists invalid parts; valid parts can still be offered for human review. The PM
then uses `05-evals/human-rubric.md` to check faithfulness (preserving the
request) and grounding (support from supplied evidence), and to score clarity
and usefulness. Proposed quality bar: both Yes/No checks must pass, with at least 4/5 on both scored
scales. Meeting this quality bar does not approve the document automatically.

On an unsupported acceptance decision, the assistant says: “I do not have
enough information to define this acceptance check. Please resolve: [specific
question].” It returns no edit that fills that gap. A stale or malformed reply
is shown with an error or correction request; the PM reviews a fresh response
before applying anything. If storage fails, keep the unsaved edits and show
the error instead of reporting a successful save.

## Measurement and limits

Response-time and cost proposals for the trial are stated above; time savings
and continued use remain unmeasured. Any chosen assistant service has its own
conditions. Alongside technical correctness, evaluate useful suggestions,
unhelpful warnings, important issues missed, correction effort, and total time. Browser sessions using the same
running app share requirement comments. Hosting for other team members, automated
external research, and automatic updates between this app and external systems
are not configured.
