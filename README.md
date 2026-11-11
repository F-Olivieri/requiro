<img src="02-prototype/app/ui/logo.svg" alt="Requiro logo" width="64" height="64">

# Requiro PRD assistant

Requiro helps a product manager create a PRD through a guided conversation, review
requirements, and manage revisions in a visual workspace.

## Start the workspace

Requires Python 3.10 or newer. No package installation or model key is needed.

```sh
cd 02-prototype/app
python3 server.py
```

Open `http://127.0.0.1:8765` in a browser. The server binds only to the local
computer. Start with an empty library, create a PRD, or explicitly load the
fictional example. Confirm that all inputs are synthetic or approved public
nonconfidential course material without real employer, customer, personal or
account information. This confirmation is a user responsibility, not automatic
confidentiality detection.

## Use a private Codespace

From the repository, choose **Code → Codespaces** and create a Codespace with
**2 cores**. The app starts automatically. In the **Ports** panel, check that
port **8765** says **Private**, then open its browser address. Sign in to the
GitHub account that owns the Codespace. Keep the port Private; other people
cannot use this personal workspace.

Restart the same Codespace to return to saved work. Its PRDs, comments, reviews
and proof files stay in `data/prds/`, separate from the code and excluded from
Git. Existing data on another computer is not uploaded automatically.

Stopping the Codespace preserves saved data. Deleting it removes that data.
Inactive Codespaces may be deleted automatically. Before deleting one, stop the
app and download the complete `data/prds/` directory for recovery. Individual
PRD exports do not contain all comments, reviews or revision history.

Codespaces has monthly compute and storage allowances. Stop the Codespace when
finished; closing its browser tab does not stop it immediately. This setup does
not change billing settings or provide an always-running service.

## Create and maintain a PRD

1. Create or open a PRD. Work through Discover, Scope, Requirements and Approval.
2. Fill supported sections; leave missing information explicit. Each requirement
   has a stable ID, priority, use case, intended outcome, the requirement itself
   and acceptance criteria.
3. Write a question in the chat panel and choose **Copy for assistant**. This
   saves your edits first, so the assistant sees the saved version (vN).
4. Paste the text into your assistant chat. Copy the whole reply, choose
   **Paste assistant reply** and then **Check reply**. Code fences and short
   text around the reply are fine. Parts that cannot be used are listed with
   reasons; **Copy correction request** gives you a message to send back to the
   assistant. In **Check suggested changes**, compare the current and suggested
   wording, tick the sections and requirements you want, and choose
   **Apply selected**. Then save. Suggestions you have not decided on stay
   after a page reload.
5. Save a version (v1, v2 and so on). The button beside the status shows the
   next step: **Send for approval** for a Draft, **Approve vN** while it is
   **Awaiting approval**, and **Reopen** for an archived PRD. The approval
   dialog lists what **Blocks approval** and what is only **Advice**; Approve
   stays disabled until nothing blocks it. Approving creates the next version
   with the same content and records it as approved. Editing approved content
   creates a new draft while preserving the approved version.
6. Open **History** to inspect saved versions. Each one says what happened:
   Saved, Sent for approval, Approved, Restored, Archived or Reopened. Restore
   a version as a new draft, archive or reopen documents, and export the PRD.

### Protect unsaved work

- **Ctrl+S** (or **Cmd+S** on a Mac) saves when no dialog is open.
- Opening another PRD, creating or importing one with unsaved edits asks you to
  **Save and continue**, **Discard** or **Cancel**.
- Removing a requirement shows **Undo** until the next save.
- While you type, this browser keeps a copy of unsaved edits. It is never sent
  to the server. When you reopen the PRD, choose **Recover** or **Discard**. If
  the PRD was saved elsewhere since, choose **Download edits** to compare
  instead. Saving or discarding removes the browser copy.

The app does not generate AI responses itself or call a model API. **Copy for
assistant** is a deliberate user handoff to the chosen chat service. No document
is sent automatically. The assistant's reply cannot approve a document or save
it. Questions and pasted replies are kept in the conversation without creating a
version or changing the PRD status, so asking about an approved PRD leaves it
approved. **Clear conversation** removes the messages after a confirmation; the
PRD content, version and status stay the same.

## Read the same PRD in two views

Choose **Document** for the full PRD with headings and paragraphs. Choose
**Table** to compare requirements, owners and delivery statuses. Open a row's
details to read its acceptance criteria, proof and other metadata.

Both views use the same PRD and requirement records. Switching views creates no
copy, saves no revision and preserves unsaved edits. Choose **Edit** beside a
text section to open its field in **Guided edit**. In Table view, first expand
**Other PRD sections**. Tick the data-use confirmation to enable editing,
then choose **Save changes** when ready. Archived PRDs must be reopened first.
Click a **delivery status** or **Change** under Action to select
Complete, To discuss or Needs work. Add a reviewer and notes where needed, then
choose **Save status**. **Open delivery review** opens the owners, proof and
attachment editor. Both views use this same flow.
When there are unsaved edits, **Save + change** saves the draft before review.
Saved proof needs a fresh verdict after the PRD changes.

Use **Use case** in Guided edit to choose a description from the PRD's use-case
list. Write one situation per line in **Scope → Use cases**. Choose
**Write a description / several use cases** for a custom scope. Choosing and
saving a description updates the shared requirement.

Both views, source previews, print and delivery reports show use-case
descriptions. Older codes remain as secondary references so existing comments
keep their selected text. Copied requirements use their original source
revision. A missing or conflicting definition is marked **Use case description
missing**; Requiro does not guess its meaning. Displaying a description does
not rewrite the PRD, approval or proof.

## Discuss requirement wording

Choose **Comment** on a saved requirement to discuss its whole wording; no
selection is needed. To discuss a few words, select them in the requirement,
acceptance criteria, use case or intended outcome, then choose **Comment on
selected text**. In Table view, expand a row's details to select its full text.
Enter an author label and a comment or suggested wording, then post it.

Use a requirement's **Comments** button to reply, copy suggested wording, or
resolve and reopen a discussion. The header's **Comments** button shows all
discussions, including those for removed requirements. Changed wording keeps the
original quote with a clear warning. Comments and suggestions preserve the PRD,
approval and delivery review; use normal editing to apply wording changes.

Browser sessions connected to the same running app share discussions and receive
new messages while comments are open. An author label is self-reported. The
app can run on your computer or in a private Codespace. The Codespace owner can
access it from another computer after signing in to GitHub. Access for other
team members needs a separate hosting decision.
Comments stay in the app's shared data store. Standalone PRD JSON exports do not
include discussion history.

## Workspace display

Use the compact chevrons at the left and right workspace edges to hide or show
the library and chat independently. They remain available when panels are hidden.
The sun or moon icon switches themes. The gear opens **Settings** for theme and
panel visibility. These choices are remembered in this browser when storage is
available. They preserve unsaved edits and do not change PRD data.

Library titles are followed by badges for their saved status, version and stage.
The status filter lists Draft, Awaiting approval, Approved and Archived.

## Projects and requirement reuse

Use **Manage projects** in the library to create projects. Open a PRD and choose
**Projects & reuse** to select its projects, then **Save project links**. A PRD
can belong to several projects, and a project can contain several PRDs. Use the
project filter in the library to find them. Changing these links does not create
a PRD revision.

In **Projects & reuse**, choose a source PRD and inspect its saved requirements.
Select the requirements to copy, then choose **Import selected requirements**.
Save any current PRD edits first. Importing creates a new destination draft
revision with fresh requirement IDs. Wording, acceptance criteria and priority
are copied; priority agreement must be reviewed again. Owners, proof, reviews and comments
are not copied.

The same panel shows imported requirements and PRDs that reuse this PRD's
requirements. Each relationship identifies the source revision and both
requirement IDs. Open the related PRD or view the original requirement as it was
when imported. Copies can be edited independently; later source changes never
update them automatically. Project links and reuse relationships stay in the
local workspace; standalone JSON exports contain the document, not these links.

## Verify completed work

Open a PRD and choose **Delivery review**. For each requirement, add engineering
owners, explain the proof, and attach supporting files where useful. Then record
the team's verdict, reviewer role and notes. Choose **Mark complete** when the
team confirms the acceptance criteria are met. Complete requires an engineering
owner, proof and a reviewer role. Proof alone never marks a requirement Complete.

Choose **To discuss** to flag a question or decision, with an optional note.
Owners, proof and a reviewer can be added later. The flag stays open until the
team chooses another status and counts as pending in the view and report.
**Needs work** records that the team found work still needed.

A changed PRD version requires a fresh delivery verdict. Changing owners, proof
or attachments turns Complete or Needs work into Needs recheck; To discuss stays
until you change it. Earlier proof and review records remain available under
**Previous reviews**. Delivery review is separate from approval of the PRD's
wording. It records the team's decision; Requiro does not run your tests or
independently establish that the work is correct.

Choose **Download delivery report with proofs**, or **Delivery report with
proofs** under **Export**, for a ZIP containing the readable report, the saved
PRD and the actual attachment files. Pending requirements and gaps remain
visible in the report. Ordinary PRD JSON/Markdown exports contain the authoring
document, not the delivery reviews or proof files.

## Storage and portability

Document records and immutable revision history live in
`data/prds/requiro.sqlite3`, excluded from version control.
Stop all older Requiro servers before upgrading. On startup, an existing
`juno.sqlite3` is checked, renamed and checked again. The rename preserves all
records and proof files. If both database names exist, or SQLite recovery files
remain, startup stops without replacing data. Let the old version finish
recovery and close before retrying; do not delete recovery files.

Keep this directory when restarting the server. Delivery reviews are in the
same database, and original proof files are under `data/prds/attachments/`. Saved documents survive browser
reloads. **Export** states what each format includes and leaves out:

- **Markdown**: every section and requirement of the saved version. Leaves out
  the conversation, comments, delivery reviews, project and reuse links, and
  version history.
- **Requiro JSON**: every section, requirement and the conversation. Leaves out
  comments, delivery reviews and proof, project and reuse links, and version
  history.
- **Print or save as PDF**: every section and requirement, with unsaved edits
  clearly marked as not saved or approved.
- **Delivery report with proofs**: a ZIP of the saved PRD, each requirement's
  delivery status and proof, and the proof attachments.

An imported JSON document becomes
a new isolated Draft with a new identity and no imported approval authority.
Export important current documents for portability. Archive is reversible;
there is no permanent-delete action.

The local application record is authoritative. Downloaded files and assistant
replies are copies or suggestions. A second tab with an old revision cannot
silently overwrite a newer save. Browser sessions using the same running app
share comments. Remote team access, cloud synchronization and external
integrations are not configured.

## Data and UI separation

```text
02-prototype/app/ui/          HTML, JavaScript and CSS
02-prototype/app/server.py    Local HTTP/API adapter
02-prototype/app/prd_store.py PRD model, validation, storage and export
examples/reading-list.json    Fictional demonstration PRD
data/prds/requiro.sqlite3    Saved PRDs and revision history (not in version control)
```

The UI reads and writes PRDs through the API. It contains no saved PRDs or
embedded example document. The document module accepts an explicit storage
directory and has no UI or HTTP dependency. Replacing the UI files does not
replace the data. `REQUIRO_DATA_DIR` can point the server to an existing separate
data directory. `JUNO_DATA_DIR` remains a compatible alias. If both settings are
present, they must identify the same directory. A configured directory stays
in place; only its old database filename is migrated.

Stop all older Requiro server instances before upgrading this version. On the first
start with default settings, a recognized legacy `02-prototype/app/.juno-data`
directory is validated, moved whole to `data/prds`, and verified again. The move
preserves documents, revisions and proof files. If both locations
exist, or a directory contains an unrecognized/corrupt store, startup stops
rather than choosing one or creating an empty replacement. Migration never
passes documents through import or changes their identities or approval history.

## Guided chat without the workspace

Load [`01-prompting/skill-file.md`](01-prompting/skill-file.md) into an assistant
and say, for example: “Help me create a PRD for a fictional request tracker.”
Requiro asks focused questions, drafts supported sections and keeps open decisions
visible. In chat alone, save the resulting document yourself; the prompt does
not provide storage or cross-session memory.

## Files

- [Product requirements](prd-system/requirements.md). Plain-English requirements for requested additions.

- [PRD assistant skill](01-prompting/skill-file.md)
- [Document and lifecycle contract](prd-system/document-contract.md)
- [Workspace and prototype notes](02-prototype/prototype.md)
- [Bounded spec clarity review](02-prototype/spec-clarity-checker.md)
- [Application harness](03-harness-prd/prd.md)
- [PRD assistant evaluation cases](05-evals/prd-assistant-cases.md)
- [Spec clarity evaluation cases](05-evals/spec-clarity-cases.md)

The later agent-control-panel and human-rubric files remain course templates.
No final presentation has been created.

## Mock PRDs

Three fictional PRDs are available in the local library:

- **Community tool library:** early review with open questions and a simulated booking error.
- **Workshop signup and waitlist:** a mix of Complete, Needs work, To discuss and Not reviewed requirements.
- **Shared garden task board:** five requirements marked Complete, with simulated proof for a finished-review report.

All sample verdicts and proof are invented. No real tests were run and no real
organization, customer or person is represented. Each title begins with Mock.
Document and Table show the same saved sample data.

The source PRDs are under `examples/mock-prds/`. Each PRD JSON file can be
imported as a new draft. JSON import includes the PRD wording and requirements;
it does not import completion reviews or proof files. `reviews.json` and the
three text files hold the separate simulated review inputs and proof examples.

## Checks

```sh
cd 02-prototype/app
python3 -m unittest -v
node --check ui/app.js
node test_ui.mjs
node test_completion.mjs
node test_prd_views.mjs
node test_workspace_controls.mjs
node test_requirement_status.mjs
node test_connections.mjs
node test_comments.mjs
node test_use_cases.mjs
node test_lifecycle.mjs
node test_format.mjs
```

Behavioral evaluations are fictional and bounded. They do not establish time
savings or that a real product's requirements are correct or complete.
