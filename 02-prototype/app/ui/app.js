import {openCompletion} from './completion.js';
import {renderPrdView} from './prd-views.js';
import {initWorkspaceControls} from './workspace-controls.js';
import {openRequirementStatus} from './requirement-status.js';
import {openConnections, projectLabel} from './connections.js';
import {openComments} from './comments.js';

const stages = ['Discover', 'Scope', 'Requirements', 'Review'];
const fields = {
  problem: ['The problem', 'What happens today, and what does it prevent people from doing?', 'Describe the situation, its consequence, and why it matters.'],
  users: ['Who it is for', 'Who experiences this problem? What do they need to accomplish?', 'Name the user group and their task. Use fictional or general descriptions.'],
  outcomes: ['The intended outcome', 'What should become better for these users?', 'Describe the change you want, without assuming a solution or inventing a target.'],
  useCases: ['Use cases', 'Describe the situations this product will support.', 'Give each use case a name or ID so requirements can refer to it.'],
  scope: ['In scope', 'What will this version do?', 'Include the supported users, workflows, and conditions.'],
  nonGoals: ['Out of scope', 'What are you deliberately leaving out?', 'Keep future ideas separate from the current commitment.'],
  inputsOutputs: ['Inputs and outputs', 'What does the user provide, and what should the product return?', 'Include important format, permission, and error conditions.'],
  quality: ['Quality and constraints', 'What must be true beyond the core behavior?', 'Consider accessibility, reliability, latency, privacy, and failure recovery. Mark unknowns clearly.'],
  metrics: ['Success measures', 'How will you know whether the intended outcome was achieved?', 'Document the measure, baseline, target, and method when known. Do not invent missing values.'],
  risks: ['Risks and dependencies', 'What might prevent this from working or shipping?', 'State the impact and what needs to be resolved.'],
  decisions: ['Open decisions', 'What still needs a decision before the team can proceed?', 'Record the question, who should decide, and the consequence of leaving it open.'],
  evidence: ['Evidence and assumptions', 'What supports this PRD, and what is still an assumption?', 'Separate observations from hypotheses. Use synthetic examples or approved nonconfidential evidence.'],
};
const stageFields = {Discover: ['problem', 'users', 'outcomes'], Scope: ['useCases', 'scope', 'nonGoals', 'inputsOutputs'], Requirements: ['quality'], Review: ['metrics', 'risks', 'decisions', 'evidence']};
const stageDescriptions = {Discover: 'Start with the people and the problem.', Scope: 'Draw a clear boundary around this version.', Requirements: 'Describe behavior people can build and test.', Review: 'Check the gaps before making a commitment.'};
const starterQuestions = {Discover: 'Who runs into this problem, and what are they unable to do today?', Scope: 'Which use case must work in the first version, and what can wait?', Requirements: 'For one use case, what should happen and how would we test that it worked?', Review: 'Which requirement or assumption is least clear, and what evidence would resolve it?'};
const $ = selector => document.querySelector(selector);
const clone = value => JSON.parse(JSON.stringify(value));
const state = {docs: [], doc: null, saved: null, composeDrafts: {}, stage: 'Discover', view: 'document', verification: null, verificationRequest: 0, verificationLoading: false, verificationError: '', consent: false, busy: false, proposal: null, proposalBaseline: null, pendingAction: null};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function dirty() { return Boolean(state.doc && JSON.stringify(state.doc) !== JSON.stringify(state.saved)); }
// 2026-11-09: keep unsent questions with their PRD instead of clearing them on save.
function rememberCompose() { if (state.doc) state.composeDrafts[state.doc.id] = $('#chat-message').value; }
function hasUnsentCompose() {
  rememberCompose();
  return Object.values(state.composeDrafts).some(value => value.trim());
}
function editable() { return Boolean(state.doc && state.doc.status !== 'Archived' && state.consent && !state.busy); }
function documented(value) { return !['', 'not documented', 'unknown', 'unresolved', 'tbd', 'tbc'].includes(value.trim().toLowerCase()); }
function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, {month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'});
}
function message(text, error = false) {
  const node = $('#global-message');
  node.textContent = text;
  node.classList.toggle('error', error);
  node.hidden = !text;
}
function inlineError(id, text = '') { const node = $(id); node.textContent = text; node.hidden = !text; }
function discardIfNeeded() {
  return !dirty() || window.confirm('Discard unsaved edits to this PRD? The last saved revision will remain available.');
}
function requireConsent() {
  if (state.consent) return true;
  message('Acknowledge the material-use statement above before creating, editing, importing, or preparing a handoff.');
  $('#privacy-consent').focus();
  return false;
}
async function api(path, method = 'GET', data) {
  const response = await fetch(path, {method, headers: data ? {'Content-Type': 'application/json'} : {}, body: data ? JSON.stringify(data) : undefined, credentials: 'same-origin'});
  let result;
  try { result = await response.json(); } catch { throw new Error('The local server returned an unreadable response. Your unsaved edits are still here.'); }
  if (!response.ok) {
    const error = new Error(result.error || 'The request could not be completed.');
    error.status = response.status;
    if (response.status === 409) error.message += ' Your unsaved edits are preserved. Download a local draft from Export before reopening the saved document.';
    throw error;
  }
  return result;
}
async function run(task, errorId) {
  if (state.busy) return;
  state.busy = true;
  updateControls();
  try { await task(); } catch (error) {
    if (errorId) inlineError(errorId, error.message);
    else message(error.message, true);
  } finally { state.busy = false; updateControls(); }
}
function updateSummary(doc) {
  const summary = {id: doc.id, title: doc.title, status: doc.status, revision: doc.revision, stage: doc.stage, updatedAt: doc.updatedAt, projectIds: state.docs.find(item => item.id === doc.id)?.projectIds || []};
  state.docs = [summary, ...state.docs.filter(item => item.id !== doc.id)];
  renderLibrary();
}
function acceptSaved(doc) {
  rememberCompose();
  state.doc = clone(doc);
  state.saved = clone(doc);
  state.stage = stages.includes(doc.stage) ? doc.stage : 'Discover';
  state.proposal = null;
  state.verification = null;
  state.verificationError = '';
  updateSummary(doc);
  renderDocument();
  refreshVerification();
}
function markDirty() {
  updateControls();
  if (state.view !== 'edit') renderPreview();
}
async function refreshVerification() {
  const {id, revision} = state.saved;
  const request = ++state.verificationRequest;
  const current = () => state.verificationRequest === request && state.saved?.id === id && state.saved.revision === revision;
  state.verificationLoading = true;
  renderPreview();
  try {
    const result = await api(`/api/prds/${encodeURIComponent(id)}/verification`);
    if (!current()) return;
    if (result.documentId !== id || result.prdRevision !== revision) throw new Error('The saved PRD changed. Reopen it to load its current reviews.');
    state.verification = result;
    state.verificationError = '';
  } catch (error) {
    if (current()) { state.verification = null; state.verificationError = error.message; }
  } finally {
    if (current()) { state.verificationLoading = false; renderPreview(); }
  }
}
async function reviewDelivery(requirementId) {
  if (dirty() && !requireConsent()) return;
  await save();
  await openCompletion({doc: clone(state.saved), api, consent: () => state.consent, requirementId});
  await refreshVerification();
}
async function commentRequirement({requirementId, anchor} = {}) {
  if (!state.saved) return;
  if ((anchor && dirty()) || (requirementId && !state.saved.sections.requirements.some(req => req.id === requirementId))) {
    message('Save your requirement edits before starting a comment. Your draft is preserved.');
    $('#save-prd').focus();
    return;
  }
  await openComments({doc: clone(state.saved), requirementId, anchor, api, consent: () => state.consent});
}
async function changeReviewStatus(requirementId, {saveDraft = false} = {}) {
  if (dirty()) {
    if (!saveDraft) {
      message('Save your draft before changing its review status. Your unsaved edits are preserved.');
      $('#save-prd').focus();
      return;
    }
    if (!requireConsent()) return;
    await save();
  }
  const result = await openRequirementStatus({doc: clone(state.saved), requirementId, api, consent: () => state.consent});
  if (result.fullReview) await openCompletion({doc: clone(state.saved), requirementId, api, consent: () => state.consent});
  await refreshVerification();
}
async function save() {
  if (!state.doc || !dirty()) return;
  const proposal = state.proposal;
  const candidate = {...state.doc, stage: state.stage};
  const doc = await api(`/api/prds/${encodeURIComponent(state.doc.id)}`, 'PUT', {expectedRevision: state.saved.revision, doc: candidate});
  acceptSaved(doc);
  if (proposal) message('Saved a new revision. The earlier proposal is now stale; request a fresh response before applying more changes.');
  else message(`Saved revision ${doc.revision}.`);
}
function renderLibrary() {
  const container = $('#doc-list');
  container.replaceChildren();
  $('#doc-count').textContent = state.docs.length;
  const search = $('#search').value.trim().toLocaleLowerCase();
  const status = $('#status-filter').value;
  const project = $('#project-filter').value;
  const docs = state.docs.filter(doc => (!search || doc.title.toLocaleLowerCase().includes(search)) && (!status || doc.status === status) && (!project || doc.projectIds?.includes(project)));
  if (!docs.length) {
    container.append(el('p', 'library-empty', state.docs.length ? 'No PRDs match this search.' : 'Your next product idea starts here. Create a PRD to begin.'));
    return;
  }
  for (const doc of docs) {
    const button = el('button', `doc-item${state.doc?.id === doc.id ? ' active' : ''}`);
    if (state.doc?.id === doc.id) button.setAttribute('aria-current', 'page');
    const title = el('span', 'doc-item-title', doc.title || 'Untitled PRD');
    const status = el('span', 'status-pill', doc.status);
    status.dataset.status = doc.status;
    button.append(title, status, el('span', 'doc-item-badge', `v${doc.revision}`), el('span', 'doc-item-badge doc-item-stage', doc.stage));
    button.disabled = state.busy;
    button.addEventListener('click', () => run(async () => {
      if (!discardIfNeeded()) return;
      const opened = await api(`/api/prds/${encodeURIComponent(doc.id)}`);
      acceptSaved(opened);
      message('');
    }));
    container.append(button);
  }
}
function updateControls() {
  const changed = dirty();
  const hasDoc = Boolean(state.doc);
  const canEdit = editable();
  $('#new-prd').disabled = state.busy;
  $('#welcome-new').disabled = state.busy;
  $('#demo-prd').disabled = state.busy;
  $('#import-prd').disabled = state.busy;
  $('#manage-projects').disabled = state.busy;
  $('#connections-prd').disabled = state.busy || !hasDoc;
  $('#comments-prd').disabled = state.busy || !hasDoc;
  for (const button of document.querySelectorAll('#doc-list button')) button.disabled = state.busy;
  for (const id of ['edit-tab', 'document-tab', 'table-tab']) $(`#${id}`).disabled = state.busy;
  for (const button of document.querySelectorAll('#prd-visualization button')) button.disabled = state.busy || (changed && !state.consent) || button.dataset.commentSelection === 'true' && button.dataset.selectionValid !== 'true';
  if (!hasDoc) {
    $('#copy-packet').disabled = true;
    $('#paste-response').disabled = true;
    $('#chat-message').disabled = true;
    $('#use-starter').disabled = true;
    return;
  }
  $('#document-title').disabled = !canEdit;
  $('#save-prd').disabled = !canEdit || !changed;
  $('#save-prd').textContent = state.doc.status === 'Approved' ? 'Save as new draft' : 'Save changes';
  $('#save-state').textContent = changed ? 'Unsaved changes' : `Saved revision ${state.doc.revision}`;
  $('#save-state').classList.toggle('dirty', changed);
  $('#export-prd').textContent = changed ? 'Export / recover ↓' : 'Export ↓';
  $('#history-prd').disabled = state.busy;
  $('#verify-delivery').disabled = state.busy || (changed && !state.consent);
  $('#verify-delivery').textContent = changed ? 'Save + verify delivery' : 'Verify delivery';
  $('#export-prd').disabled = state.busy;
  $('#archive-prd').disabled = !state.consent || state.busy || changed;
  $('#archive-prd').textContent = state.doc.status === 'Archived' ? 'Reopen draft' : 'Archive';
  $('#copy-packet').textContent = changed ? 'Save + copy context packet ↗' : 'Copy context packet ↗';
  $('#copy-packet').disabled = !canEdit;
  $('#paste-response').disabled = !canEdit;
  $('#chat-message').disabled = !canEdit;
  $('#use-starter').disabled = !canEdit;
  $('#handoff-state').textContent = state.doc.status === 'Archived' ? 'Reopen this PRD to continue editing or chatting.' : !state.consent ? 'Acknowledge the material-use statement to continue.' : changed ? 'Preparing a packet saves your current edits first. Replies stay pending until you apply them.' : `Packet uses saved revision ${state.doc.revision}. Replies never change fields automatically.`;
  for (const input of document.querySelectorAll('#editor-content input, #editor-content textarea, #editor-content select, #editor-content button[data-edit]')) input.disabled = !canEdit;
  for (const button of document.querySelectorAll('[data-document-action]')) {
    const validStatus = button.dataset.documentAction === 'review' ? state.doc.status === 'Draft' : state.doc.status === 'In review';
    button.disabled = !canEdit || changed || !validStatus;
  }
  for (const button of document.querySelectorAll('#proposal button')) button.disabled = !canEdit;
}
function renderStageNav() {
  const nav = $('#stage-nav');
  nav.replaceChildren();
  for (const [index, stage] of stages.entries()) {
    const button = el('button', `stage-button${stage === state.stage ? ' active' : ''}${stageIsComplete(stage, state.doc) ? ' complete' : ''}`);
    button.append(el('span', 'stage-number', String(index + 1)), el('span', '', stage));
    if (stage === state.stage) button.setAttribute('aria-current', 'step');
    button.addEventListener('click', () => setStage(stage));
    nav.append(button);
  }
}
function setStage(stage) {
  if (state.busy) return;
  state.stage = stage;
  renderStageNav();
  renderEditor();
  renderStageFooter();
  renderPreview();
  $('#starter-question').textContent = starterQuestions[stage];
  markDirty();
}
function renderStageFooter() {
  const index = stages.indexOf(state.stage);
  $('#previous-stage').disabled = index === 0;
  $('#next-stage').disabled = index === stages.length - 1;
  $('#stage-counter').textContent = `Step ${index + 1} of ${stages.length}`;
  $('#stage-subtitle').textContent = stageDescriptions[state.stage];
}
function sectionCard(number, title, description) {
  const card = el('section', 'section-card');
  const heading = el('div', 'section-card-header');
  const copy = el('div');
  copy.append(el('h2', '', title), el('p', '', description));
  heading.append(el('span', 'section-number', number), copy);
  card.append(heading);
  return card;
}
function field(key) {
  const [label, placeholder, hint] = fields[key];
  const group = el('div', 'field-group');
  const heading = el('div', 'field-heading');
  const name = el('label', '', label);
  name.htmlFor = `field-${key}`;
  heading.append(name);
  const input = el('textarea');
  input.id = `field-${key}`;
  input.value = state.doc.sections[key];
  input.placeholder = placeholder;
  input.maxLength = 20000;
  input.rows = key === 'evidence' || key === 'decisions' ? 4 : 3;
  input.setAttribute('aria-describedby', `hint-${key}`);
  input.addEventListener('input', () => { state.doc.sections[key] = input.value; markDirty(); });
  const note = el('p', 'field-hint', hint);
  note.id = `hint-${key}`;
  group.append(heading, input, note);
  return group;
}
function renderEditor() {
  const container = $('#editor-content');
  container.replaceChildren();
  if (state.stage === 'Discover') {
    const card = sectionCard('01', 'Make the problem worth solving clear.', 'A useful PRD starts with a real need, before it describes a solution.');
    stageFields.Discover.forEach(key => card.append(field(key)));
    container.append(card, el('p', 'stage-note', 'Uncertain is okay. Record what you know and label assumptions so they can be tested.'));
  } else if (state.stage === 'Scope') {
    const card = sectionCard('02', 'Choose what this version will do.', 'Use cases connect the user’s situation to the requirements that follow.');
    stageFields.Scope.forEach(key => card.append(field(key)));
    container.append(card);
  } else if (state.stage === 'Requirements') {
    renderRequirements(container);
    const quality = sectionCard('03', 'Set the quality bar.', 'Describe the constraints that apply across your requirements.');
    quality.append(field('quality'));
    container.append(quality);
  } else {
    renderReview(container);
    const card = sectionCard('04', 'Record what remains uncertain.', 'Keep success measures, risks, decisions, and supporting evidence visible.');
    stageFields.Review.forEach(key => card.append(field(key)));
    container.append(card);
  }
  updateControls();
}
function requirementControl(req, key, label, kind = 'textarea') {
  const wrapper = el('div');
  const name = el('label', '', label);
  const id = `${req.id}-${key}`;
  name.htmlFor = id;
  const input = el(kind);
  input.id = id;
  if (kind === 'select') for (const priority of ['Must', 'Nice to have']) input.append(new Option(priority, priority));
  if (kind !== 'select') input.maxLength = 20000;
  input.value = req[key];
  if (kind === 'textarea') input.rows = 3;
  input.addEventListener(kind === 'select' ? 'change' : 'input', () => { req[key] = input.value; markDirty(); });
  wrapper.append(name, input);
  return wrapper;
}
function renderRequirements(container) {
  const card = sectionCard('03', 'Turn the scope into testable behavior.', 'Each requirement has a stable ID, a use case, an intended outcome, and an acceptance test.');
  const top = el('div', 'requirement-topline');
  top.append(el('p', '', `${state.doc.sections.requirements.length} requirements · scroll the table to see every field`));
  const add = el('button', 'button', '+ Add requirement');
  add.dataset.edit = '';
  add.addEventListener('click', () => {
    const next = Math.max(state.doc.nextRequirementNumber || 1, ...state.doc.sections.requirements.map(req => Number(req.id.slice(2)) + 1));
    if (next > 999999) { message('The requirement ID limit has been reached.', true); return; }
    state.doc.sections.requirements.push({id: `R-${String(next).padStart(3, '0')}`, priority: 'Must', proposed: true, appliesTo: '', outcome: '', behavior: '', acceptance: ''});
    state.doc.nextRequirementNumber = next + 1;
    renderEditor();
    markDirty();
    document.getElementById(`R-${String(next).padStart(3, '0')}-behavior`)?.focus();
  });
  top.append(add);
  card.append(top);
  if (!state.doc.sections.requirements.length) {
    card.append(el('p', 'requirements-empty', 'No requirements yet. Add the first behavior this product must support.'));
  } else {
    const scroll = el('div', 'requirements-scroll');
    scroll.tabIndex = 0;
    scroll.setAttribute('aria-label', 'Requirements table, scroll horizontally for all columns');
    const table = el('table', 'requirements-table');
    const caption = el('caption', 'sr-only', 'Product requirements with scope, priority, acceptance criteria, and outcomes');
    const head = el('thead');
    const row = el('tr');
    for (const title of ['Requirement & outcome', 'Scope & priority', 'Acceptance criteria', 'Remove']) {
      const th = el('th', '', title); th.scope = 'col'; row.append(th);
    }
    head.append(row);
    const body = el('tbody');
    for (const req of state.doc.sections.requirements) {
      const tr = el('tr');
      const behavior = el('td');
      behavior.append(el('span', 'requirement-id', req.id), requirementControl(req, 'behavior', 'What should happen?'), requirementControl(req, 'outcome', 'Intended outcome'));
      const scope = el('td');
      scope.append(requirementControl(req, 'appliesTo', 'Applies to use case', 'input'), requirementControl(req, 'priority', 'Priority', 'select'));
      const proposedLabel = el('label', 'proposed-label');
      const proposed = el('input');
      proposed.type = 'checkbox';
      proposed.checked = req.proposed;
      proposed.addEventListener('change', () => { req.proposed = proposed.checked; markDirty(); });
      proposedLabel.append(proposed, document.createTextNode('Priority is proposed'));
      scope.append(proposedLabel);
      const acceptance = el('td');
      acceptance.append(requirementControl(req, 'acceptance', 'How do we test it?'));
      const actions = el('td');
      const remove = el('button', 'icon-button', '×');
      remove.dataset.edit = '';
      remove.setAttribute('aria-label', `Remove requirement ${req.id}`);
      remove.addEventListener('click', () => { state.doc.sections.requirements = state.doc.sections.requirements.filter(item => item.id !== req.id); renderEditor(); markDirty(); });
      actions.append(remove);
      tr.append(behavior, scope, acceptance, actions);
      body.append(tr);
    }
    table.append(caption, head, body);
    scroll.append(table);
    card.append(scroll);
  }
  card.append(el('p', 'field-hint', '“Must” means required for this scope. “Nice to have” is optional. Clear the proposed flag only after you decide.'));
  container.append(card);
}
function reviewChecks(doc) {
  const reqs = doc.sections.requirements;
  return [
    {label: 'Problem, users, and intended outcome are documented', ok: ['problem', 'users', 'outcomes'].every(key => documented(doc.sections[key]))},
    {label: 'Use cases and scope are documented', ok: ['useCases', 'scope'].every(key => documented(doc.sections[key]))},
    {label: 'At least one requirement is defined', ok: reqs.length > 0},
    {label: 'Every requirement has behavior, scope, outcome, and acceptance criteria', ok: reqs.length > 0 && reqs.every(req => ['behavior', 'appliesTo', 'outcome', 'acceptance'].every(key => documented(req[key])))},
    {label: 'Requirement priorities have been decided', ok: reqs.length > 0 && reqs.every(req => !req.proposed)},
    {label: 'Success measures and evidence are documented', ok: ['metrics', 'evidence'].every(key => documented(doc.sections[key]))},
  ];
}
function stageIsComplete(stage, doc) {
  if (stage === 'Requirements') return doc.sections.requirements.length > 0 && doc.sections.requirements.every(req => ['behavior', 'acceptance', 'outcome', 'appliesTo'].every(key => documented(req[key])) && !req.proposed);
  if (stage === 'Review') return doc.status === 'Approved';
  return stageFields[stage].every(key => documented(doc.sections[key]));
}
function renderReview(container) {
  const card = sectionCard('04', 'Review before you approve.', 'A filled field is a starting point. Check the meaning, evidence, and tests yourself.');
  const stats = el('div', 'review-overview');
  const requirements = state.doc.sections.requirements;
  for (const [number, label] of [[requirements.length, 'Requirements'], [requirements.filter(req => req.priority === 'Must').length, 'Must'], [requirements.filter(req => req.proposed).length, 'Proposed priorities']]) {
    const stat = el('div', 'review-stat'); stat.append(el('strong', '', number), el('span', '', label)); stats.append(stat);
  }
  card.append(stats);
  const list = el('ul', 'review-checklist');
  for (const check of reviewChecks(state.doc)) {
    const li = el('li', check.ok ? '' : 'missing');
    const icon = el('span', 'check-icon', check.ok ? '✓' : '○');
    icon.setAttribute('aria-label', check.ok ? 'Present:' : 'Missing:');
    li.append(icon, document.createTextNode(check.label)); list.append(li);
  }
  card.append(list);
  const actions = el('div', 'review-actions');
  if (state.doc.status !== 'Archived') {
    const review = el('button', 'button', 'Mark in review'); review.dataset.documentAction = 'review';
    review.addEventListener('click', () => openAction('review'));
    const approve = el('button', 'button primary', 'Approve this revision'); approve.dataset.documentAction = 'approve';
    approve.addEventListener('click', () => openAction('approve'));
    actions.append(review, approve);
  }
  card.append(actions, el('p', 'review-explanation', dirty() ? 'Save your changes before changing review or approval status.' : 'Approval records an explicit decision. Editing an approved document creates a new draft when saved.'));
  container.append(card);
}
function renderPreview() {
  for (const [id, mode] of [['edit-tab', 'edit'], ['document-tab', 'document'], ['table-tab', 'table']]) {
    $(`#${id}`).classList.toggle('active', state.view === mode);
    $(`#${id}`).setAttribute('aria-pressed', String(state.view === mode));
  }
  const editing = state.view === 'edit';
  $('#editor-content').hidden = !editing;
  $('#preview-content').hidden = editing;
  $('#stage-nav').hidden = !editing;
  $('#stage-footer').hidden = !editing;
  $('#stage-subtitle').textContent = editing ? stageDescriptions[state.stage] : 'One PRD. Choose how to read it. Use Guided edit to change its wording.';
  if (!state.doc || editing) return;
  $('#preview-note').textContent = dirty() ? 'Current draft includes unsaved edits. Saved proof needs a fresh review before this draft can be marked Complete.' : `Saved PRD revision ${state.saved.revision}. Both views use the same requirements and review records.`;
  $('#review-load-state').textContent = state.verificationLoading ? 'Loading saved review details…' : state.verificationError;
  $('#review-load-state').hidden = !state.verificationLoading && !state.verificationError;
  renderPrdView($('#prd-visualization'), {doc: state.doc, mode: state.view, verification: state.verification, savedRevision: dirty() ? null : state.saved.revision, onReview: (requirementId, options) => run(() => changeReviewStatus(requirementId, options)), onComment: payload => run(() => commentRequirement(payload))});
  updateControls();
}
function renderConversation() {
  const container = $('#conversation');
  container.replaceChildren();
  if (!state.doc?.chat?.length) container.append(el('p', 'conversation-empty', 'Your conversation will appear here after a handoff. Requiro’s suggestions always need your review.'));
  for (const item of state.doc?.chat || []) {
    const bubble = el('div', `chat-item ${item.role === 'user' ? 'user' : 'assistant-reply'}`);
    bubble.append(el('p', 'chat-role', item.role === 'user' ? 'YOU' : 'Requiro · IMPORTED RESPONSE'), el('p', 'chat-content', item.content));
    container.append(bubble);
  }
  container.scrollTop = container.scrollHeight;
}
function renderDocument() {
  $('#welcome').hidden = Boolean(state.doc);
  $('#document-view').hidden = !state.doc;
  if (!state.doc) return;
  $('#document-title').value = state.doc.title;
  $('#document-status').textContent = state.doc.status;
  $('#document-status').dataset.status = state.doc.status;
  $('#document-revision').textContent = `REVISION ${state.doc.revision}`;
  $('#updated-at').textContent = state.doc.updatedAt ? `Updated ${formatDate(state.doc.updatedAt)}` : '';
  $('#starter-question').textContent = starterQuestions[state.stage];
  $('#chat-message').value = state.composeDrafts[state.doc.id] || '';
  renderStageNav();
  renderEditor();
  renderStageFooter();
  renderPreview();
  renderConversation();
  renderProposal();
  updateControls();
}
function openNew() {
  if (!requireConsent()) return;
  $('#new-title').value = '';
  inlineError('#new-error');
  $('#new-dialog').showModal();
}
function openAction(action, revision) {
  if (!state.doc || !state.consent || dirty()) { message('Save your changes before changing this document’s status.'); return; }
  if (action === 'restore' && state.doc.status === 'Archived') { message('Reopen this PRD before restoring a revision.'); return; }
  state.pendingAction = {action, revision};
  const text = {
    review: ['Mark this PRD in review?', 'The saved document will move to In review. This does not approve its content.', 'Mark in review'],
    approve: ['Approve this revision?', `Record an approval of saved revision ${state.doc.revision}. Check the requirements, evidence, and open decisions before proceeding.`, 'Approve revision'],
    archive: ['Archive this PRD?', 'The document and its history will remain available. Reopen it any time to continue as a draft.', 'Archive PRD'],
    reopen: ['Reopen as a draft?', 'A new draft revision will be created from this archived document.', 'Reopen draft'],
    restore: [`Restore revision ${revision} as a new draft?`, 'The selected content will be copied into a new draft revision. Existing history and approval records are preserved.', 'Restore as new draft'],
  }[action];
  $('#action-title').textContent = text[0]; $('#action-description').textContent = text[1]; $('#confirm-action').textContent = text[2];
  const warnings = $('#action-warnings'); warnings.replaceChildren();
  if (action === 'approve') {
    for (const check of reviewChecks(state.doc).filter(check => !check.ok)) warnings.append(el('li', '', check.label));
    if (state.doc.sections.decisions.trim() && !/^(none|no open decisions|no blocking decisions|not applicable)\.?$/i.test(state.doc.sections.decisions.trim())) warnings.append(el('li', '', 'Open decisions are recorded. Approval means you have reviewed and accept these remaining questions.'));
    warnings.append(el('li', '', 'This app checks required fields. It does not verify evidence or product readiness.'));
  }
  inlineError('#action-error');
  $('#action-dialog').showModal();
}
function downloadLocalDraft() {
  const blob = new Blob([JSON.stringify(state.doc, null, 2) + '\n'], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = el('a'); link.href = url; link.download = `requiro-unsaved-draft-${state.doc.id}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function openExport() {
  if (!state.doc) return;
  const dialog = $('#export-dialog');
  dialog.querySelectorAll('[data-export-extra]').forEach(node => node.remove());
  $('#export-note').textContent = dirty() ? 'Your edits are unsaved. Save them before exporting the current Markdown or full JSON, or download a local recovery draft below.' : `Downloads contain saved revision ${state.doc.revision}, including the complete text you entered.`;
  for (const [selector, format] of [['#export-markdown', 'markdown'], ['#export-json', 'json']]) {
    const link = $(selector);
    link.hidden = dirty();
    link.href = `/api/export/${encodeURIComponent(state.doc.id)}?format=${format}`;
  }
  if (dirty()) {
    const saveExport = el('button', 'button primary full', 'Save + export current PRD');
    saveExport.dataset.exportExtra = '';
    saveExport.style.marginTop = '12px';
    saveExport.disabled = !editable();
    saveExport.addEventListener('click', () => run(async () => { await save(); dialog.close(); openExport(); }, '#export-error'));
    const local = el('button', 'button full', 'Download unsaved draft JSON');
    local.dataset.exportExtra = ''; local.style.marginTop = '10px';
    local.addEventListener('click', downloadLocalDraft);
    const error = el('p', 'inline-error'); error.id = 'export-error'; error.dataset.exportExtra = ''; error.hidden = true; error.setAttribute('role', 'alert');
    dialog.append(saveExport, local, error);
  }
  dialog.showModal();
}
async function openHistory() {
  inlineError('#history-error');
  $('#history-list').replaceChildren(el('p', 'muted small', 'Loading saved revisions…'));
  $('#history-detail').replaceChildren(el('p', 'muted small', 'Select a revision to inspect it.'));
  $('#history-dialog').showModal();
  const history = await api(`/api/prds/${encodeURIComponent(state.doc.id)}/history`);
  const list = $('#history-list'); list.replaceChildren();
  for (const item of history) {
    const button = el('button', 'history-item');
    button.append(el('strong', '', `Revision ${item.revision} · ${item.status}`), el('span', '', formatDate(item.updatedAt)), el('span', '', item.reason || 'Saved'));
    button.addEventListener('click', () => run(async () => {
      const doc = await api(`/api/prds/${encodeURIComponent(state.doc.id)}/history/${item.revision}`);
      list.querySelectorAll('button').forEach(node => node.classList.toggle('active', node === button));
      const detail = $('#history-detail'); detail.replaceChildren(el('h3', '', doc.title), el('p', 'small muted', `Revision ${doc.revision} · ${doc.status}`));
      const restore = el('button', 'button', 'Restore as new draft');
      restore.disabled = dirty() || !state.consent || state.doc.status === 'Archived';
      restore.addEventListener('click', () => { $('#history-dialog').close(); openAction('restore', doc.revision); });
      detail.append(restore);
      if (state.doc.status === 'Archived') detail.append(el('p', 'small muted', 'Reopen this PRD before restoring a revision.'));
      else if (dirty()) detail.append(el('p', 'small muted', 'Save or discard current edits before restoring.'));
      detail.append(el('pre', '', buildMarkdown(doc)));
    }, '#history-error'));
    list.append(button);
  }
}
async function copyPacket() {
  if (!requireConsent() || !state.doc) return;
  const request = $('#chat-message').value.trim();
  if (!request) { message('Write a question or use the starter question before preparing a packet.'); $('#chat-message').focus(); return; }
  if ((state.doc.chat || []).length >= 99) throw new Error('This document has reached its conversation limit. Export the JSON before starting a new document.');
  await save();
  const result = await api(`/api/prds/${encodeURIComponent(state.doc.id)}/packet`, 'POST', {expectedRevision: state.doc.revision, message: request});
  if (typeof result.packet !== 'string') throw new Error('The local server did not return a context packet.');
  let copied = false;
  try { await navigator.clipboard.writeText(result.packet); copied = true; } catch { /* Clipboard permissions vary; the selectable packet is the fallback. */ }
  state.doc.chat ||= [];
  state.doc.chat.push({role: 'user', content: request});
  $('#chat-message').value = '';
  state.composeDrafts[state.doc.id] = '';
  renderConversation(); markDirty();
  $('#packet-text').value = result.packet;
  $('#packet-explanation').textContent = copied ? 'Copied. Paste this packet into your chat, then return here with the JSON response. The conversation entry will be saved with your next save.' : 'Clipboard access was unavailable. Select and copy the text below, then paste it into your chat.';
  $('#packet-dialog').showModal();
  if (!copied) { $('#packet-text').focus(); $('#packet-text').select(); }
}

export function validateResponse(input, doc) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('The response must be a JSON object.');
  if (Object.keys(input).some(key => !['reply', 'proposal'].includes(key))) throw new Error('The response contains an unknown top-level field. Use only reply and proposal.');
  if (typeof input.reply !== 'string' || !input.reply.trim() || input.reply.length > 20000) throw new Error('The response needs a nonempty reply of at most 20,000 characters.');
  if (input.proposal === undefined || input.proposal === null) return {reply: input.reply, proposal: null};
  const proposal = input.proposal;
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal) || Object.keys(proposal).sort().join(',') !== 'baseRevision,changes,documentId') throw new Error('A proposal needs exactly documentId, baseRevision, and changes.');
  if (typeof proposal.documentId !== 'string' || proposal.documentId !== doc.id) throw new Error('This proposal belongs to a different document or is missing documentId. Prepare a fresh packet for this PRD.');
  if (!Number.isInteger(proposal.baseRevision) || proposal.baseRevision !== doc.revision) throw new Error(`This proposal is stale or uses the wrong revision. Expected baseRevision ${doc.revision}. Prepare a fresh packet.`);
  if (!proposal.changes || typeof proposal.changes !== 'object' || Array.isArray(proposal.changes) || !Object.keys(proposal.changes).length) throw new Error('Proposal changes must be a nonempty object.');
  for (const [key, value] of Object.entries(proposal.changes)) {
    if (!Object.hasOwn(fields, key) && key !== 'requirements') throw new Error(`Unknown proposal field: ${key}. No changes were applied.`);
    if (key !== 'requirements') {
      if (typeof value !== 'string' || value.length > 20000) throw new Error(`The proposed ${key} must be text of at most 20,000 characters.`);
    } else {
      if (!Array.isArray(value) || value.length > 200) throw new Error('Proposed requirements must be a list of at most 200 items.');
      const ids = new Set();
      const currentIds = new Set(doc.sections.requirements.map(req => req.id));
      const minNext = doc.nextRequirementNumber || Math.max(1, ...doc.sections.requirements.map(req => Number(req.id.slice(2)) + 1));
      for (const req of value) {
        if (!req || typeof req !== 'object' || Array.isArray(req) || Object.keys(req).sort().join(',') !== 'acceptance,appliesTo,behavior,id,outcome,priority,proposed') throw new Error('Each proposed requirement needs exactly id, priority, proposed, appliesTo, outcome, behavior, and acceptance.');
        if (typeof req.id !== 'string' || !/^R-[0-9]{3,6}$/.test(req.id) || Number(req.id.slice(2)) === 0 || ids.has(req.id)) throw new Error('Proposed requirement IDs must be unique positive R-001-style IDs.');
        ids.add(req.id);
        if (!currentIds.has(req.id) && Number(req.id.slice(2)) < minNext) throw new Error(`Requirement ${req.id} uses a retired ID. Use the next available requirement number.`);
        if (!['Must', 'Nice to have'].includes(req.priority) || typeof req.proposed !== 'boolean') throw new Error('Proposed requirements need a valid priority and a boolean proposed flag.');
        if (['appliesTo', 'outcome', 'behavior', 'acceptance'].some(key => typeof req[key] !== 'string' || req[key].length > 20000)) throw new Error('Proposed requirement fields must be text of at most 20,000 characters.');
      }
    }
  }
  return {reply: input.reply, proposal: clone(proposal)};
}
function readResponse() {
  inlineError('#response-error');
  try {
    if (!state.doc || !editable()) throw new Error('Open an editable PRD and acknowledge the material-use statement first.');
    if ((state.doc.chat || []).length >= 100) throw new Error('The conversation limit is reached. Export this document before creating a new one.');
    let input;
    try { input = JSON.parse($('#response-json').value); } catch { throw new Error('This is not valid JSON. Paste only the complete JSON object, without Markdown code fences.'); }
    const result = validateResponse(input, state.doc);
    state.doc.chat ||= [];
    state.doc.chat.push({role: 'assistant', content: result.reply});
    state.proposal = result.proposal;
    state.proposalBaseline = clone(state.saved.sections);
    renderConversation(); renderProposal(); markDirty();
    $('#response-dialog').close();
    message(result.proposal ? 'Response imported. Review the pending changes, then apply the fields you want. Nothing has been saved yet.' : 'Response added to the conversation. No field changes were proposed. Save to keep this conversation.');
  } catch (error) { inlineError('#response-error', error.message); }
}
function renderProposal() {
  const container = $('#proposal'); container.replaceChildren();
  container.hidden = !state.proposal;
  if (!state.proposal) return;
  container.append(el('h3', '', 'Pending proposal'), el('p', '', `Based on revision ${state.proposal.baseRevision}. Selected fields replace their current draft content. Apply, review the draft, then save.`));
  for (const [key, value] of Object.entries(state.proposal.changes)) {
    const group = el('div', 'proposal-field');
    const label = el('label');
    const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.dataset.proposalKey = key;
    label.append(checkbox, document.createTextNode(key === 'requirements' ? `Requirements · replaces all ${state.doc.sections.requirements.length} current rows with ${value.length} proposed rows` : fields[key][0]));
    if (key === 'requirements') {
      const before = state.doc.sections.requirements;
      const previousIds = new Set(before.map(req => req.id));
      const proposedIds = new Set(value.map(req => req.id));
      const added = value.filter(req => !previousIds.has(req.id)).map(req => req.id);
      const removed = before.filter(req => !proposedIds.has(req.id)).map(req => req.id);
      const changed = value.filter(req => previousIds.has(req.id) && JSON.stringify(req) !== JSON.stringify(before.find(old => old.id === req.id))).map(req => req.id);
      group.append(label, el('p', 'small muted', `New: ${added.join(', ') || 'none'} · Changed: ${changed.join(', ') || 'none'} · Removed: ${removed.join(', ') || 'none'}`));
      group.append(el('pre', '', `CURRENT\n${JSON.stringify(before, null, 2)}\n\nPROPOSED\n${JSON.stringify(value, null, 2)}`));
    } else {
      group.append(label, el('pre', '', `CURRENT\n${state.doc.sections[key] || '(empty)'}\n\nPROPOSED\n${value || '(clears this field)'}`));
    }
    container.append(group);
  }
  const actions = el('div', 'proposal-actions');
  const apply = el('button', 'button primary', 'Apply selected to draft');
  apply.addEventListener('click', () => {
    if (!editable()) return;
    try {
      validateResponse({reply: 'Validation', proposal: state.proposal}, state.doc);
      const checked = [...container.querySelectorAll('input[data-proposal-key]:checked')];
      if (!checked.length) { message('Select at least one proposed field to apply.'); return; }
      const selected = checked.map(node => node.dataset.proposalKey);
      if (selected.some(key => JSON.stringify(state.doc.sections[key]) !== JSON.stringify(state.proposalBaseline[key]))) throw new Error('One of the selected fields has unsaved edits made outside this proposal. Save those edits and prepare a fresh packet before applying a replacement. Your edits and proposal are preserved.');
      for (const key of selected) state.doc.sections[key] = clone(state.proposal.changes[key]);
      if (selected.includes('requirements')) state.doc.nextRequirementNumber = Math.max(state.doc.nextRequirementNumber || 1, ...state.doc.sections.requirements.map(req => Number(req.id.slice(2)) + 1));
      state.proposal = null;
      renderEditor(); renderPreview(); renderProposal(); renderStageNav(); markDirty();
      message(`Applied ${selected.length} proposed field${selected.length === 1 ? '' : 's'} to your draft. Review and save when ready.`);
    } catch (error) { message(error.message, true); }
  });
  const dismiss = el('button', 'button', 'Dismiss');
  dismiss.addEventListener('click', () => { state.proposal = null; renderProposal(); message('Proposal dismissed. Your document fields were not changed.'); });
  actions.append(apply, dismiss); container.append(actions);
  updateControls();
}
export function buildMarkdown(doc) {
  if (!doc) return '';
  const sections = doc.sections;
  let result = `# ${doc.title}\n\nDocument ID: ${doc.id}\nStatus: ${doc.status}\nRevision: ${doc.revision}\nLast approved revision: ${doc.approvedRevision ?? 'None'}\n\n`;
  for (const key of ['problem', 'users', 'outcomes', 'useCases', 'scope', 'nonGoals', 'inputsOutputs']) result += `## ${fields[key][0]}\n\n${sections[key] || '_Not documented._'}\n\n`;
  result += '## Requirements\n\n';
  if (!sections.requirements.length) result += '_No requirements documented._\n\n';
  for (const req of sections.requirements) result += `### ${req.id} · ${req.priority}${req.proposed ? ' (proposed)' : ''}\n\n${req.behavior}\n\nApplies to: ${req.appliesTo}\n\nIntended outcome: ${req.outcome}\n\nAcceptance criteria: ${req.acceptance}\n\n`;
  for (const key of ['quality', 'metrics', 'risks', 'decisions', 'evidence']) result += `## ${fields[key][0]}\n\n${sections[key] || '_Not documented._'}\n\n`;
  return result;
}

async function refreshLibrary() {
  const [result, {projects}] = await Promise.all([api('/api/state'), api('/api/projects')]);
  state.docs = result.docs;
  const filter = $('#project-filter');
  const selected = filter.value;
  filter.replaceChildren(new Option('All projects', ''), ...projects.map(project => new Option(projectLabel(project, projects), project.id)));
  filter.value = projects.some(project => project.id === selected) ? selected : '';
  renderLibrary();
}
async function manageConnections(withDocument) {
  const result = await openConnections({doc: withDocument ? clone(state.saved) : null, docs: state.docs, api, consent: () => state.consent, hasUnsavedEdits: dirty()});
  if (result.doc) { acceptSaved(result.doc); message('Imported requirements into a new draft revision. Review their priorities and wording.'); }
  if (result.openDocumentId && discardIfNeeded()) acceptSaved(await api(`/api/prds/${encodeURIComponent(result.openDocumentId)}`));
  await refreshLibrary();
}
async function init() {
  initWorkspaceControls();
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  $('#privacy-consent').addEventListener('change', event => {
    state.consent = event.target.checked;
    $('#privacy-banner').classList.toggle('acknowledged', state.consent);
    if (state.doc) renderEditor();
    updateControls();
  });
  $('#search').addEventListener('input', renderLibrary);
  $('#status-filter').addEventListener('change', renderLibrary);
  $('#project-filter').addEventListener('change', renderLibrary);
  $('#manage-projects').addEventListener('click', async () => { await run(() => manageConnections(false)); $('#manage-projects').focus(); });
  $('#connections-prd').addEventListener('click', async () => { await run(() => manageConnections(true)); $('#connections-prd').focus(); });
  $('#new-prd').addEventListener('click', openNew);
  $('#welcome-new').addEventListener('click', openNew);
  $('#new-form').addEventListener('submit', event => {
    event.preventDefault();
    run(async () => {
      if (!requireConsent() || !discardIfNeeded()) return;
      const title = $('#new-title').value.trim();
      if (!title) throw new Error('Enter a title for this PRD.');
      const doc = await api('/api/prds', 'POST', {title, privacyConfirmed: true});
      state.view = 'edit';
      acceptSaved(doc); $('#new-dialog').close(); message('Your PRD is ready. Start with the problem and who experiences it.');
    }, '#new-error');
  });
  $('#document-title').addEventListener('input', event => { state.doc.title = event.target.value; markDirty(); });
  $('#save-prd').addEventListener('click', () => run(save));
  $('#previous-stage').addEventListener('click', () => setStage(stages[Math.max(0, stages.indexOf(state.stage) - 1)]));
  $('#next-stage').addEventListener('click', () => setStage(stages[Math.min(stages.length - 1, stages.indexOf(state.stage) + 1)]));
  for (const [id, mode] of [['edit-tab', 'edit'], ['document-tab', 'document'], ['table-tab', 'table']]) {
    $(`#${id}`).addEventListener('click', () => { if (!state.busy) { state.view = mode; renderPreview(); } });
  }
  $('#history-prd').addEventListener('click', () => run(openHistory, '#history-error'));
  $('#verify-delivery').addEventListener('click', () => run(() => reviewDelivery()));
  $('#comments-prd').addEventListener('click', () => run(() => commentRequirement()));
  $('#archive-prd').addEventListener('click', () => openAction(state.doc.status === 'Archived' ? 'reopen' : 'archive'));
  $('#export-prd').addEventListener('click', openExport);
  $('#confirm-action').addEventListener('click', () => run(async () => {
    if (!state.pendingAction || !state.doc || dirty()) throw new Error('Save current edits before changing this document’s status.');
    const doc = await api(`/api/prds/${encodeURIComponent(state.doc.id)}/action`, 'POST', {expectedRevision: state.doc.revision, ...state.pendingAction});
    acceptSaved(doc); $('#action-dialog').close(); message(`Saved revision ${doc.revision} · ${doc.status}.`);
  }, '#action-error'));
  $('#import-prd').addEventListener('click', () => {
    if (!requireConsent()) return;
    $('#import-file').value = ''; $('#import-json').value = ''; inlineError('#import-error'); $('#import-dialog').showModal();
  });
  $('#import-file').addEventListener('change', () => run(async () => {
    const file = $('#import-file').files[0]; if (!file) return;
    if (file.size > 1_048_576) throw new Error('The selected JSON file is too large. The limit is 1 MiB.');
    $('#import-json').value = await file.text();
  }, '#import-error'));
  $('#confirm-import').addEventListener('click', () => run(async () => {
    if (!requireConsent() || !discardIfNeeded()) return;
    let doc; try { doc = JSON.parse($('#import-json').value); } catch { throw new Error('Paste or choose a valid Requiro JSON document.'); }
    const imported = await api('/api/import', 'POST', {doc, privacyConfirmed: true});
    acceptSaved(imported); $('#import-dialog').close(); message('Imported as a separate draft. Existing documents were not changed.');
  }, '#import-error'));
  $('#demo-prd').addEventListener('click', () => run(async () => {
    if (!requireConsent() || !discardIfNeeded()) return;
    const example = await api('/api/example');
    const doc = await api('/api/import', 'POST', {doc: example, privacyConfirmed: true});
    acceptSaved(doc); message('Loaded a fictional example. Its assumptions, priorities, and open decisions are intentionally unresolved.');
  }));
  $('#use-starter').addEventListener('click', () => { $('#chat-message').value = starterQuestions[state.stage]; $('#chat-message').focus(); });
  $('#copy-packet').addEventListener('click', () => run(copyPacket));
  $('#paste-response').addEventListener('click', () => { inlineError('#response-error'); $('#response-json').value = ''; $('#response-dialog').showModal(); });
  $('#confirm-response').addEventListener('click', readResponse);
  $('#select-packet').addEventListener('click', () => { $('#packet-text').focus(); $('#packet-text').select(); });
  window.addEventListener('beforeprint', () => {
    // 2026-11-09: working changes must not inherit the saved revision's approval label.
    const printDoc = state.doc && dirty() ? {...state.doc, status: 'Unsaved draft (changes not approved)', revision: `Not saved (based on saved revision ${state.saved.revision})`} : state.doc;
    $('#print-document').textContent = printDoc ? buildMarkdown(printDoc) : 'No PRD is open.';
  });
  window.addEventListener('beforeunload', event => { if (dirty() || hasUnsentCompose()) { event.preventDefault(); event.returnValue = ''; } });
  updateControls();
  await run(refreshLibrary);
}
if (typeof document !== 'undefined') init();
