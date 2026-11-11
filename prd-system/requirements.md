# Requiro requirements

## Review completed work

A product requirements document (PRD) describes what a product must do.
Acceptance criteria describe what must work for a requirement to pass review.

After engineering work is finished, the team reviews each PRD requirement,
checks the proof, and records whether its acceptance criteria are met. The team
can then download a report with the proof files.

These are proposed **Must** requirements. Requiro records the team's verdict; it
does not run the tests or independently confirm the proof.

| ID | Requirement | Done when |
| --- | --- | --- |
| R-001 | Show every requirement in the selected PRD revision for the team to review. Include its acceptance criteria, engineering owners and review status. | Every requirement appears with these details. |
| R-002 | Assign one or more engineering owners to each requirement. | The owners remain saved when the PRD is reopened and appear in its report. |
| R-003 | Save an explanation of how each requirement's acceptance criteria were met. | The explanation can be reopened beside the correct requirement. |
| R-004 | Attach supporting files to a requirement and download them later. | Each file stays with the correct PRD and requirement and can still be downloaded after reopening. |
| R-005 | Let the team mark each requirement Complete, To discuss or Needs work. Save the date and any review notes. Complete and Needs work also require a reviewer role. | The status and review details remain saved when reopened and appear in the report. Complete requires an engineering owner, proof and acceptance criteria. Adding proof or files alone does not mark a requirement Complete. |
| R-006 | When a requirement's wording, acceptance criteria, use case or intended outcome changes, mark its earlier completion verdict as Needs recheck. Keep the earlier proof and review records. | An earlier Complete result for a changed requirement appears as Needs recheck, and the previous records remain available. Sending for approval, approving, archiving, reopening or editing other requirements does not reset an unchanged requirement's verdict. |
| R-007 | Download a report for the selected PRD revision together with its attached proof files. | The report includes every requirement, owner, proof explanation, status and review detail. It flags missing information and includes the attached files themselves. It describes the review as complete only when every requirement is Complete and its required information is present. |
| R-008 | Keep saved reviews and proof files separate from the interface. Preserve them when the interface changes. Do not share them externally automatically. | An interface update preserves saved owners, proof, files and reviews. No automatic external sharing occurs. |

**Statuses:** Not reviewed means no team verdict is recorded. Complete means the
team confirms the acceptance criteria are met. To discuss means the team has a
question or decision to resolve. Needs work means the team found work still
needed. Needs recheck means an earlier verdict must be reviewed again after the
PRD or its proof changed.

To discuss can be selected before owners, proof or a reviewer are recorded.
A discussion note is optional. The flag stays open when the PRD or its proof
changes, until the team chooses another status. It is counted as pending.

**Workflow:** Open the PRD, choose Verify delivery, add owners and proof, attach
supporting files where useful, record the team's verdict, then download the report.

The proposed report is one ZIP download containing a readable report and the
attached files. A supporting file is optional when written proof is enough.

## Keeping this document current

Add or revise requirements here when a Requiro feature is requested. Keep existing
IDs. Use plain English and a short Done when check. Mark proposals and open
choices clearly. Keep code, API details and database details in developer notes.

## Next improvements to team review

These are proposed Must additions. They are not implemented yet.

| ID | Requirement | Done when |
| --- | --- | --- |
| R-009 | Show a compact list of requirements, priorities, engineering owners and review statuses. Let the team search and filter the list and open an item for its full wording and proof. | The team can find and compare requirements without reading every long note or scrolling sideways to see the main review fields. Full details remain available. |
| R-010 | Record engineering's assessment and follow-up work separately from proof and the team's verdict. | Each requirement can show what engineering says works, what is still missing, the next action and who owns it. These notes do not change the requirement or mark it Complete. |
| R-011 | Keep checks for the overall PRD separate from checks of individual requirements. Let the team choose which checks apply. | The team can add a readiness check with an owner, result or proof, and remaining action. A check marked Does not apply needs a reason. Checks whose applicability is undecided remain visible and are not counted as complete. |

Readiness checks depend on the product and scope. Requiro must not assume that one
project's checklist applies to every PRD.

## PRD views

These are requested Must requirements. Document and Table show the same PRD.

| ID | Requirement | Done when |
| --- | --- | --- |
| R-012 | Offer a Document view with headings and readable paragraphs, and a Table view for comparing requirements. | The user can switch views for the same PRD. Document shows the complete PRD. Table shows a compact requirement list with full details available for each item. |
| R-013 | Use the same saved PRD and requirement records for both views. Keep wording, priorities, owners, review statuses, proof and attachments linked to stable requirement IDs. | A change saved through the shared editing or review flow appears in both views. Switching views creates no second copy and does not change the PRD revision. |
| R-014 | Preserve unsaved edits when switching views. Make it clear when displayed proof belongs to an earlier saved revision. | Both views show the current draft without saving it automatically. The user can return to editing with the same changes. Earlier completion proof does not mark an edited draft Complete. |

## Requiro name and logo

These are requested Must requirements.

| ID | Requirement | Done when |
| --- | --- | --- |
| R-015 | Use Requiro as the product name throughout the app and its documentation. | The browser title, navigation, chat, import and export labels, downloaded draft filenames and documentation use Requiro. |
| R-016 | Show the Requiro logo in the app and browser tab. | The logo is visible beside the product name and in the browser tab. The home link has an accessible name. |
| R-017 | Rename the existing private repository to requiro and include the renamed app, logo and documentation. | The repository has the new name, keeps its history and remains private. Saved PRDs, proof files and personal or confidential information are excluded. |
| R-018 | Preserve existing PRDs, revisions, owners, reviews, proof and attachments when the product name changes. Continue to accept earlier JSON exports and storage settings. | Existing saved records remain available without new identities or revisions. Earlier JSON exports can still be imported as new drafts. |

## Workspace display

These are requested Must requirements.

| ID | Requirement | Done when |
| --- | --- | --- |
| R-019 | Let the user hide or show the PRD library and chat separately with compact icon controls at the left and right edges of the workspace. Keep both controls available when panels are hidden. | The controls have readable accessible names and keyboard focus. Hiding a panel gives the PRD more room and preserves unsaved edits. Panel choices are remembered after reloading this browser. |
| R-020 | Provide readable dark and light themes with an icon control for switching between them. | Both PRD views, guided editing, chat and dialogs use the selected theme. The icon has an accessible name that identifies the next theme. The choice is remembered in this browser and does not change PRD data or revisions. |
| R-021 | Let the user select Complete, To discuss or Needs work by clicking a requirement's review status or its Action control in either PRD view. | Both controls open a status chooser for that requirement. The saved choice appears in both views. Complete still requires an owner, proof, acceptance criteria and a reviewer. Unsaved PRD edits and conflicts are preserved. |
| R-022 | Provide Settings for theme and panel visibility. | Settings opens from an accessible icon control. Changes appear immediately, remain after reloading this browser, and preserve PRD and chat contents. Settings can be closed with its close control or Escape. |
| R-023 | Show each library title followed immediately by visual badges for its status, version and stage. Use v1, v2 and so on for short version labels throughout the workspace. | Labels use the document's existing version number. Badges stay beside the title when space permits and wrap without clipping long titles on narrow screens. |

## Projects and reused requirements

These are requested Must requirements.

| ID | Requirement | Done when |
| --- | --- | --- |
| R-024 | Create projects and link each PRD to zero, one or several projects. A project can contain several PRDs. | New project names must be distinct. Existing projects remain saved, with a distinguishing label if names repeat. Project selections remain saved after reopening. The library can show the PRDs linked to a selected project. Removing a link preserves the project and PRD. |
| R-025 | Let the user select requirements from an existing PRD and import them into another PRD. Show the source revision and full requirement wording before importing. | Selected requirements receive new IDs in the destination. Their wording, acceptance criteria and priority are copied, with priority agreement reopened for the destination. The source stays unchanged. Owners, proof, completion verdicts and comments are not copied. Unsaved edits must be saved before importing. |
| R-026 | Show where imported requirements came from and which PRDs reuse requirements from the current PRD. | Each relationship identifies both PRDs, both requirement IDs and the source revision. The user can open the related PRD and inspect the original source revision. Later source edits do not silently change imported requirements. |
| R-027 | Preserve saved PRDs, revisions and reviews when adding projects and requirement reuse. | Existing documents still open with their content and reviews intact. Conflicting edits and stale import selections are rejected without losing local edits. Importing creates a new destination revision; project links alone do not change requirement content or its revision. |

Imported requirements are independent copies with a recorded source. Changes are
reviewed and saved separately in each PRD; they do not update other PRDs automatically.

## Comments on requirement text

These are requested Must requirements.

| ID | Requirement | Done when |
| --- | --- | --- |
| R-028 | Let a team member select a saved requirement's wording, acceptance criteria, use case or intended outcome and start a comment about that text. | Document and Table views offer Comment on selected text. The thread identifies the requirement, field, selected words and saved PRD revision. A selection across different fields or requirements is rejected. |
| R-029 | Share requirement comments and replies with everyone using the same workspace. | Each message shows its author label and date. New messages appear for other people with the thread open without reloading the PRD. Simultaneous replies are retained, and incoming messages do not erase an unfinished reply. |
| R-030 | Let team members suggest replacement wording and mark a discussion resolved or open again. | A message can include suggested wording that can be copied into normal PRD editing. Posting a suggestion or resolving a discussion does not change the requirement, approval or delivery verdict. If another person changed the discussion's status, show a conflict message and keep the user's unfinished text. |
| R-031 | Keep comments attached to stable requirement IDs and retain the original selected words when wording changes. | Both PRD views open the same threads. A thread whose source field has changed is clearly marked and keeps its original quote and PRD revision. The PRD's Comments list still opens discussions for removed requirements. |
| R-032 | Store comments with the shared PRD data, separately from the UI. | Comments and replies remain after closing and reopening the app. Existing PRDs, revisions, owners, proof and attachments remain intact. Before closing or switching a discussion with unfinished text, ask whether to discard it. Cancel keeps the text. |

An author label identifies a message; it does not verify a person's identity.
A shared workspace means one running app with one PRD library.
Open choice: how team members will access the shared app from other computers.

## Private personal access in Codespaces

These are requested Must requirements for personal course use.

| ID | Requirement | Done when |
| --- | --- | --- |
| R-033 | Run Requiro in a private GitHub Codespace that only its owner can access after signing in to GitHub. | The app port is Private. The signed-in owner can use the app. A signed-out browser cannot read the app or its saved data. Local use still works, and requests from unrelated websites remain blocked. |
| R-034 | Start the app when its Codespace starts and preserve saved PRDs, comments, reviews and proof when the same Codespace stops and restarts. | The app opens from a browser link. Saved records and an attached proof file remain available after a restart. Runtime data stays out of Git. The setup explains that deleting the Codespace removes data that has not been exported. |

This setup is for the owner's private use. It does not provide access for other
team members. Use only fictional or approved public nonconfidential course data.

## Edit PRD text sections

This is a requested Must requirement.

| ID | Requirement | Done when |
| --- | --- | --- |
| R-035 | Show an Edit button beside each PRD text section in Document view and under Other PRD sections in Table view. | Edit opens Guided edit at the matching field, including The problem, Who it is for and The intended outcome. Existing unsaved changes remain intact. Opening the editor does not save or create a revision. If the material-use checkbox is unchecked, explain what is needed and focus it. Archived PRDs show that they must be reopened before editing. |

## Use the Requiro storage name

This is a requested Must requirement.

| ID | Requirement | Done when |
| --- | --- | --- |
| R-036 | Use Requiro names for the saved database and its storage setting. | Existing saved work moves to the new database name without changing PRDs, revision history, comments, reviews, project links or proof files. The old storage setting still opens the same library. If files or settings conflict, or the database is busy, stop and explain how to continue. Never replace existing work with an empty library. |

## Choose use cases by description

These are requested Must requirements.

| ID | Requirement | Done when |
| --- | --- | --- |
| R-037 | Let people choose a requirement's use case by its description. | The editor offers named use cases and lets people write their own description, including several use cases. Document view, Table details, source previews, print and completion reports show the description. Older codes appear only as a secondary reference. |
| R-038 | Preserve the meaning of existing use-case references. | Copied requirements use their original source context. Missing or conflicting descriptions are clearly identified instead of guessed. Displaying names does not change saved wording, approval, comments or proof. Only an explicit edit and save changes the requirement. |

## Workspace usability

These are requested Must requirements. Status names stored with each PRD stay
the same; only their displayed labels may change.

| ID | Requirement | Done when |
| --- | --- | --- |
| R-039 | Asking the assistant must not invalidate its own reply or change approval. | Copying a context packet and then saving does not change the PRD revision or status. A reply prepared from that packet can still be reviewed after the save. Saving only the conversation never turns an approved PRD into a draft. |
| R-040 | Accept assistant replies in the forms chat services usually return them. | A reply wrapped in code fences or surrounded by short text is read correctly. Valid fields are offered for review and invalid fields are listed with plain reasons. The user can copy a correction request that explains the problems to the assistant. |
| R-041 | Show proposed changes so the user can judge them. | Each proposed field shows the current and proposed wording side by side or one above the other, in readable text. Each new, changed or removed requirement can be accepted separately. An unapplied proposal remains after reloading the page. |
| R-042 | Show the next approval step in every view. | The header shows the PRD status with its next action, such as Send for approval, Approve or Reopen. Gaps that block approval are listed separately from advice, in plain words. Approve is unavailable while blocking gaps remain. |
| R-043 | Label versions and history clearly. | Versions appear as v1, v2 and so on everywhere. History entries use plain labels such as Saved, Sent for approval, Approved and Restored. The approval confirmation says which version it creates. |
| R-044 | Protect unsaved work. | Unsaved edits can be recovered after an unexpected close of this browser. Leaving a PRD with unsaved edits offers Save and continue, Discard and Cancel. Removing a requirement can be undone until the next save. |
| R-045 | Use one name for each concept. | The data-use confirmation, the review of delivered work, the approval step and the requirement wording each have one name, used in every view, dialog and message. |
| R-046 | Make the workspace readable and usable with a keyboard. | Text and focus indicators meet WCAG 2.2 AA contrast in both themes. Body text is at least 12 px and labels at least 11 px at every screen width. Dialogs place focus in their first field. Ctrl+S or Cmd+S saves. A requirement comment can be started without selecting text with a mouse. |
| R-047 | Give the PRD most of the screen. | The header uses at most two compact rows. Secondary actions are grouped in a More menu. The data-use confirmation takes one short line and is remembered for the browser session. The PRD uses the available width up to a readable line length, without nested frames. |
| R-048 | Make exports and helpful actions easy to find and describe them accurately. | Export states what each format includes and leaves out, and also offers Print and the delivery report. The welcome screen offers the fictional example. The conversation can be cleared after an explicit confirmation. |
| R-049 | Show feedback where the action happens. | Messages about the assistant appear in the chat panel. Success messages disappear after a few seconds. Error messages remain until dismissed and have a close control. Saving a delivery status and downloading an export each confirm briefly. Old messages clear when the user edits or opens another PRD. |
| R-050 | Make Requiro usable on a phone. | At 390 px wide, the user can switch between Library, PRD and Chat without long scrolling. Opening a PRD shows it. Requirements and the Table view appear as stacked cards without sideways scrolling or words broken mid-word. Long titles wrap. |
| R-051 | Make documents, files and dates easy to recognize. | Loading the fictional example again offers to open the existing copy. Lists and history identify PRDs by title rather than internal ID. Export filenames use the PRD title. Dates appear in the user's local time in a readable format. |
| R-052 | Keep keyboard focus where the user expects it. | After creating a PRD, focus moves to its first empty field. Closing a dialog returns focus to the control that opened it. The data-use confirmation is reached before the library in keyboard order. |
| R-053 | Keep requirement displays compact and consistent. | Each requirement shows its status badge once. Empty optional details are summarized rather than listed as repeated Not recorded rows. Table details do not repeat the requirement text. Disabled Edit links look disabled. Comment buttons show the number of open threads. Export headings use the same section names as the app. |
