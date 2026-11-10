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

1. Create or open a PRD. Work through Discover, Scope, Requirements and Review.
2. Fill supported sections; leave missing information explicit. Each requirement
   has a stable ID, priority, applicability, outcome and acceptance criteria.
3. Ask a question in the guided chat pane and copy the context packet.
4. Paste the packet into your assistant chat. Copy its JSON response back into
   Requiro. Review the proposed replacements and apply only the changes you want.
5. Save a revision. Review and approve through separate explicit actions.
   Editing approved content creates a new draft while preserving the baseline.
6. Inspect historical revisions, restore content as a new draft, archive or
   reopen documents, and export the current PRD as Markdown or JSON.

The app does not generate AI responses itself or call a model API. Copying a
packet is a deliberate user handoff to the chosen chat service. No document is
sent automatically. The assistant's reply cannot approve a document or save it.

## Read the same PRD in two views

Choose **Document** for the full PRD with headings and paragraphs. Choose
**Table** to compare requirements, owners and review statuses. Open a row's
details to read its acceptance criteria, proof and other metadata.

Both views use the same PRD and requirement records. Switching views creates no
copy, saves no revision and preserves unsaved edits. Choose **Edit** beside a
text section to open its field in **Guided edit**. In Table view, first expand
**Other PRD sections**. Acknowledge the material-use statement to enable editing,
then choose **Save changes** when ready. Archived PRDs must be reopened first.
Click a **review status** or **Change** under Action to select
Complete, To discuss or Needs work. Add a reviewer and notes where needed, then
choose **Save status**. **Open full review** opens the owners, proof and attachment
editor. Both views use this same review flow.
When there are unsaved edits, **Save + change** saves the draft before review.
Saved proof needs a fresh verdict after the PRD changes.

## Discuss requirement wording

Select words in a saved requirement's wording, acceptance criteria, use case or
outcome, then choose **Comment on selected text**. In Table view, expand a row's
details to select its full text. Enter an author label and a comment or suggested
wording, then post it.

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

Library titles are followed by badges for their saved status, revision and stage.

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

Open a PRD and choose **Verify delivery**. For each requirement, add engineering
owners, explain the proof, and attach supporting files where useful. Then record
the team's verdict, reviewer role and notes. Choose **Mark complete** when the
team confirms the acceptance criteria are met. Complete requires an engineering
owner, proof and a reviewer role. Proof alone never marks a requirement Complete.

Choose **To discuss** to flag a question or decision, with an optional note.
Owners, proof and a reviewer can be added later. The flag stays open until the
team chooses another status and counts as pending in the view and report.
**Needs work** records that the team found work still needed.

A changed PRD version requires a fresh completion verdict. Earlier proof and review records
remain available under **Previous reviews**. Completion review is separate from
approval of the PRD's wording. It records the team's decision; Requiro does not run
your tests or independently establish that the work is correct.

Choose **Download report with proofs** for a ZIP containing the readable report,
the current PRD and the actual attachment files. Pending requirements and gaps
remain visible in the report. Ordinary PRD JSON/Markdown exports contain the
authoring document, not the completion records or proof files.

## Storage and portability

Document records and immutable revision history live in
`data/prds/juno.sqlite3`, excluded from version control.
The existing `juno.sqlite3` filename and `JUNO_DATA_DIR` setting are kept for
compatibility. The name change does not move or rewrite saved records.

Keep this directory when restarting the server. Completion records are in the
same database, and original proof files are under `data/prds/attachments/`. Saved documents survive browser
reloads. Markdown/JSON exports contain the selected document's current revision;
they do not include the full history database. An imported JSON document becomes
a new isolated Draft with a new identity and no imported approval authority.
Export important current documents for portability. Archive is reversible;
there is no permanent-delete action.

The local application record is authoritative. Downloaded files and assistant
responses are copies or proposals. A second tab with an old revision cannot
silently overwrite a newer save. Browser sessions using the same running app
share comments. Remote team access, cloud synchronization and external
integrations are not configured.

## Data and UI separation

```text
02-prototype/app/ui/          HTML, JavaScript and CSS
02-prototype/app/server.py    Local HTTP/API adapter
02-prototype/app/prd_store.py PRD model, validation, storage and export
examples/reading-list.json    Fictional demonstration PRD
data/prds/juno.sqlite3       Saved PRDs and revision history (not in version control)
```

The UI reads and writes PRDs through the API. It contains no saved PRDs or
embedded example document. The document module accepts an explicit storage
directory and has no UI or HTTP dependency. Replacing the UI files does not
replace the data. `JUNO_DATA_DIR` can point the server to an existing separate
data directory; an explicitly configured directory is never silently migrated.

Stop all older Requiro server instances before upgrading this version. On the first
start with default settings, a recognized legacy `02-prototype/app/.juno-data`
directory is validated, moved whole to `data/prds`, and verified again. The move
preserves documents, revisions and any database sidecars. If both locations
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
```

Behavioral evaluations are fictional and bounded. They do not establish time
savings or that a real product's requirements are correct or complete.
