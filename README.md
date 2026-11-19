<img src="02-prototype/app/ui/logo.svg" alt="Requiro logo" width="64" height="64">

# Requiro requirements assistant

Requiro helps a product manager create, review, and revise a product requirements
document (PRD). It runs as a visual workspace on your computer. You copy the selected PRD and request
to your chosen AI chat, paste its reply back, and choose which suggested changes
to apply and save.

## Project materials

- [Presentation](final-presentation.html): product overview, prototype, evaluation, and metrics plan.
- The links below contain the assistant instructions, prototype, information and controls around the model, rules for its actions, and response-scoring guide.
- [Metrics plan](06-metrics/metrics-plan.md) and [reflection](06-metrics/reflection.md).
- [Verification evidence](submission/evidence/prototype-verification.json): tests of application behavior and the limits of those checks.

You review each suggestion before applying it. The metrics plan proposes a
small trial and the results needed to continue using Requiro; no time saving or
model-response quality result has been measured.

## Start the workspace

Requires Python 3.10 or newer. No additional software packages or AI service key are needed.

```sh
cd 02-prototype/app
python3 server.py
```

Open `http://127.0.0.1:8765` in a browser. The app accepts connections only from that
computer. Start with an empty library, create a PRD, or explicitly load the
fictional example. Use only invented content or explicitly approved
public, nonconfidential material. Exclude real employer, customer, personal, or
account information. You must make this check yourself: the app does not detect
confidential content or ask you to confirm that it is safe.

## Use a private GitHub Codespace

A Codespace runs the app on a GitHub-hosted computer that you access in a browser.

From the repository, choose **Code → Codespaces** and create a Codespace with
**2 cores**. The app starts automatically. In the **Ports** panel, check that
port **8765** says **Private**, then open its browser address. Sign in to the
GitHub account that owns the Codespace. Keep the port Private; other people
cannot use this personal workspace.

Restart the same Codespace to return to saved work. Its PRDs, comments, reviews,
and supporting evidence files stay in `data/prds/`, separate from the code and excluded from
Git version control. Existing data on another computer is not uploaded automatically.

Stopping the Codespace preserves saved data. Deleting it removes that data.
Inactive Codespaces may be deleted automatically. Before deleting one, stop the
app and download the complete `data/prds/` directory for recovery. Individual
PRD exports do not contain all comments, reviews, or saved versions.

Codespaces has monthly compute and storage allowances. Stop the Codespace when
finished; closing its browser tab does not stop it immediately. This setup does
not change billing settings or provide an always-running service.

## Create and maintain a PRD

1. Create or open a PRD. Work through Discover, Scope, Requirements, and Approval.
2. Fill sections using the information you have; mark missing information as
   unknown. Each requirement has an identifier (ID) that stays with it, a
   priority, the situation where it applies (use case), an intended outcome,
   the required behavior, and the checks it must pass (acceptance criteria).
3. Write a question in the chat panel and choose **Copy for assistant**. This
   saves your edits first, so the assistant sees the saved version (vN, where N is its version number).
4. Paste the text into your assistant chat. Copy the whole reply, choose
   **Paste assistant reply** and then **Check reply**. The app accepts replies inside Markdown code blocks and with short
   explanations before or after the JSON, the structured text reply format. Parts that cannot be used are listed with
   reasons; **Copy correction request** gives you a message to send back to the
   assistant. In **Check suggested changes**, compare the current and suggested
   wording, tick the sections and requirements you want, and choose
   **Apply selected**. Then save. Suggestions you have not decided on stay
   after a page reload.
5. Save a version (v1, v2, and so on). The button beside the status shows the
   next step: **Send for approval** for a Draft, **Approve vN** while it is
   **Awaiting approval**, and **Reopen** for an archived PRD. The approval
   dialog lists what **Blocks approval** and what is only **Advice**; Approve
   stays disabled until nothing blocks it. Approving creates the next version
   with the same content and records it as approved. Editing approved content
   creates a new draft while preserving the approved version.
6. Open **History** to inspect saved versions. Each one says what happened:
   Saved, Sent for approval, Approved, Restored, Archived, or Reopened. Restore
   a version as a new draft, archive or reopen documents, and export the PRD.

### Protect unsaved work

- **Ctrl+S** (or **Cmd+S** on a Mac) saves when no dialog is open.
- Opening another PRD, creating one, or importing one with unsaved edits asks you to
  **Save and continue**, **Discard**, or **Cancel**.
- Removing a requirement shows **Undo** until the next save.
- While you type, this browser keeps a copy of unsaved edits. It is never sent
  to the server. When you reopen the PRD, choose **Recover** or **Discard**. If
  the PRD was saved elsewhere since, choose **Download edits** to compare
  instead. Saving or discarding removes the browser copy.

The app has no direct connection to an AI model. With **Copy for assistant**,
you copy the selected document and request to your chosen AI chat yourself.
No document is sent automatically. The assistant's reply cannot approve a document or save
it. Questions and pasted replies are kept in the conversation without creating a
version or changing the PRD status, so asking about an approved PRD leaves it
approved. **Clear conversation** removes the messages after a confirmation; the
PRD content, version, and status stay the same.

## Read the same PRD in two views

Choose **Document** for the full PRD with headings and paragraphs. Choose
**Table** to compare requirements, owners, and delivery statuses. Open a row's
details to read its acceptance criteria, supporting evidence, and other saved
information about that requirement.

Both views use the same PRD and requirement records. Switching views creates no
copy, saves no new version, and preserves unsaved edits. Choose **Edit** beside a
text section to open its field in **Guided edit**. In Table view, first expand
**Other PRD sections**. Edit the text, then choose **Save changes** when ready. Archived PRDs must be reopened first.
Click a **delivery status** or **Change** under Action to select
Complete, To discuss, or Needs work. Add a reviewer and notes where needed, then
choose **Save status**. **Open delivery review** opens the editor for owners, supporting evidence, and
attachments. Both views use this same flow.
When there are unsaved edits, **Save + change** saves the draft before review.
After the PRD changes, review the saved evidence again and record a new delivery
decision.

Use **Use case** in Guided edit to choose a description from the PRD's use-case
list. Write one situation per line in **Scope → Use cases**. Choose
**Write a description / several use cases** for a custom scope. Choosing and
saving a description updates the shared requirement.

Both views, source previews, print, and delivery reports show use-case
descriptions. Older codes remain as secondary references so existing comments
keep their selected text. Copied requirements use their original source
revision. A missing or conflicting definition is marked **Use case description
missing**; Requiro does not guess its meaning. Displaying a description does
not rewrite the PRD, its approval, or its supporting evidence.

## Discuss requirement wording

Choose **Comment** on a saved requirement to discuss its whole wording; no
selection is needed. To discuss a few words, select them in the requirement,
acceptance criteria, use case, or intended outcome, then choose **Comment on
selected text**. In Table view, expand a row's details to select its full text.
Enter an author label and a comment or suggested wording, then post it.

Use a requirement's **Comments** button to reply, copy suggested wording, or
resolve and reopen a discussion. The header's **Comments** button shows all
discussions, including those for removed requirements. Changed wording keeps the
original quote with a clear warning. Comments and suggestions preserve the PRD,
approval, and delivery review; use normal editing to apply wording changes.

Browser sessions connected to the same running app share discussions and receive
new messages while comments are open. The app displays the author label entered by the commenter; it does not verify
their identity. The
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

Library titles are followed by badges for their saved status, version, and stage.
The status filter lists Draft, Awaiting approval, Approved, and Archived.

## Projects and requirement reuse

Use **Manage projects** in the library to create projects. Open a PRD and choose
**Projects & reuse** to select its projects, then **Save project links**. A PRD
can belong to several projects, and a project can contain several PRDs. Use the
project filter in the library to find them. Changing these links does not create
a PRD revision.

In **Projects & reuse**, choose a source PRD and inspect its saved requirements.
Select the requirements to copy, then choose **Import selected requirements**.
Save any current PRD edits first. Importing creates a new destination draft
revision with fresh requirement IDs. Wording, acceptance criteria, and priority
are copied; priority agreement must be reviewed again. Owners, proof, reviews, and comments
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
the team's delivery decision, reviewer role, and notes. Choose **Mark complete** when the
team confirms the acceptance criteria are met. Complete requires an engineering
owner, supporting evidence, and a reviewer role. Adding evidence alone does not
mark a requirement Complete.

Choose **To discuss** to flag a question or decision, with an optional note.
Owners, proof, and a reviewer can be added later. The flag stays open until the
team chooses another status and counts as pending in the view and report.
**Needs work** records that the team found work still needed.

A changed PRD version requires a new delivery review. Changing owners, proof,
or attachments turns Complete or Needs work into Needs recheck; To discuss stays
until you change it. Earlier proof and review records remain available under
**Previous reviews**. Delivery review is separate from approval of the PRD's
wording. It records the team's decision. Requiro does not run the product tests or verify
that the implementation meets the requirement.

Choose **Download delivery report with proofs**, or **Delivery report with
proofs** under **Export**, for a ZIP containing the readable report, the saved
PRD, and the actual attachment files. Pending requirements and gaps remain
visible in the report. Ordinary PRD JSON/Markdown exports contain the authoring
document, not the delivery reviews or proof files.

## Storage and portability

Documents and their saved-version history, whose earlier versions remain
unchanged, live in
`data/prds/requiro.sqlite3`, excluded from version control.
Stop all older Requiro servers before upgrading. On startup, an existing
`juno.sqlite3` is checked, renamed, and checked again. The rename preserves all
records and supporting evidence files. If both database names exist, or files used by SQLite to recover an interrupted write
remain, startup stops without replacing data. Let the old version finish
recovery and close before retrying; do not delete recovery files.

Keep this directory when restarting the server. Delivery reviews are in the
same database, and original proof files are under `data/prds/attachments/`. Saved documents survive browser
reloads. **Export** states what each format includes and leaves out:

- **Markdown**: every section and requirement of the saved version. Leaves out
  the conversation, comments, delivery reviews, project and reuse links, and
  version history.
- **Requiro JSON**: every section, requirement, and the conversation. Leaves out
  comments, delivery reviews and proof, project and reuse links, and version
  history.
- **Print or save as PDF**: every section and requirement, with unsaved edits
  clearly marked as not saved or approved.
- **Delivery report with proofs**: a ZIP of the saved PRD, each requirement's
  delivery status and proof, and the proof attachments.

An imported JSON document becomes
a new isolated Draft with a new identity and no approval carried over from the imported document.
Export important current documents for portability. Archive is reversible;
there is no permanent-delete action.

The copy saved in the running app is the current document. Downloaded files and assistant
replies are copies or suggestions. A second tab with an old revision cannot
silently overwrite a newer save. Browser sessions using the same running app
share comments. Remote team access, cloud synchronization, and external
integrations are not configured.

## Keep documents separate from the user interface

```text
02-prototype/app/ui/          HTML, JavaScript and CSS
02-prototype/app/server.py    Local HTTP/API adapter
02-prototype/app/prd_store.py PRD model, validation, storage and export
examples/reading-list.json    Fictional demonstration PRD
data/prds/requiro.sqlite3    Saved PRDs and revision history (not in version control)
```

The user interface (UI) reads and saves PRDs through the app’s programming
interface (API). Its source files contain no saved PRDs or embedded example
document. The separate document-handling module accepts a specified storage
folder and does not depend on the UI or web server. Replacing the UI files
does not replace saved documents. `REQUIRO_DATA_DIR` can point the server to an existing separate
data directory. `JUNO_DATA_DIR` remains a compatible alias. If both settings are
present, they must identify the same directory. A configured directory stays
in place; only its old database filename is migrated.

Stop all older Requiro server instances before upgrading this version. On the first
start with default settings, a recognized legacy `02-prototype/app/.juno-data`
directory is validated, moved whole to `data/prds`, and verified again. The move
preserves documents, saved versions, and supporting evidence files. If both locations
exist, or a directory contains an unrecognized/corrupt store, startup stops
rather than choosing one or creating an empty replacement. This storage move does not reimport documents or change their IDs or approval
history.

## Guided chat without the workspace

Load [`01-prompting/skill-file.md`](01-prompting/skill-file.md) into an assistant
and say, for example: “Help me create a PRD for a fictional request tracker.”
Requiro asks focused questions, drafts supported sections, and keeps open decisions
visible. In chat alone, save the resulting document yourself; the instructions do
not save documents or remember them across separate chat sessions.

## Files

- [Product requirements](prd-system/requirements.md). Plain-English requirements for requested additions.

- [PRD assistant skill](01-prompting/skill-file.md)
- [Document and lifecycle contract](prd-system/document-contract.md)
- [Workspace and prototype notes](02-prototype/prototype.md)
- [Review of ambiguous requirement wording](02-prototype/spec-clarity-checker.md)
- [Information and controls around the model](03-harness-prd/prd.md)
- [Agent Control Panel](04-agentic-workflows/agent-control-panel.md)
- [Human evaluation rubric (scoring guide)](05-evals/human-rubric.md)
- [PRD assistant evaluation cases](05-evals/prd-assistant-cases.md)
- [Spec clarity evaluation cases](05-evals/spec-clarity-cases.md)

## Mock PRDs

Three fictional PRD source examples are included for import into the local library:

- **Community tool library:** early review with open questions and a simulated booking error.
- **Workshop signup and waitlist:** a mix of Complete, Needs work, To discuss, and Not reviewed requirements.
- **Shared garden task board:** five requirements marked Complete, with simulated proof for a finished-review report.

All delivery decisions and proof in these examples are invented. No actual
product tests support those sample decisions, and no real organization, customer,
or person is represented. Each title begins with Mock.
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

The prompt-evaluation cases use fictional inputs. They specify what to check;
they are not completed model evaluations or measured time-saving results.
