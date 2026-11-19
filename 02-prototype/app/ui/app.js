import {openCompletion} from './completion.js';
import {renderPrdView} from './prd-views.js';
import {initWorkspaceControls} from './workspace-controls.js';
import {openRequirementStatus} from './requirement-status.js';
import {openConnections, projectLabel} from './connections.js';
import {openComments} from './comments.js';
import {useCaseControl, refreshUseCaseControls, useCaseText} from './use-cases.js';
import {fileSlug, formatDateTime as formatDate} from './format.js';

const stages = ['Discover', 'Scope', 'Requirements', 'Review'];
const fields = {
  problem: ['The problem', 'What happens today, and what does it prevent people from doing?', 'Describe the situation, its consequence, and why it matters.'],
  users: ['Who it is for', 'Who experiences this problem? What do they need to accomplish?', 'Name the user group and their task. Use fictional or general descriptions.'],
  outcomes: ['The intended outcome', 'What should become better for these users?', 'Describe the change you want, without assuming a solution or inventing a target.'],
  useCases: ['Use cases', 'Describe the situations this product will support.', 'Write one use case per line. Describe who does what; requirements can choose these descriptions.'],
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
const stageDescriptions = {Discover: 'Start with the people and the problem.', Scope: 'Draw a clear boundary around this version.', Requirements: 'Write requirements people can build and test.', Review: 'Check what blocks approval, then send the PRD for approval.'};
const starterQuestions = {Discover: 'Who runs into this problem, and what are they unable to do today?', Scope: 'Which use case must work in the first version, and what can wait?', Requirements: 'For one use case, what should happen and how would we test that it worked?', Review: 'Which requirement or assumption is least clear, and what evidence would resolve it?'};
const $ = selector => document.querySelector(selector);
const clone = value => JSON.parse(JSON.stringify(value));
const state = {docs: [], doc: null, saved: null, composeDrafts: {}, stage: 'Discover', view: 'document', useCasesContext: null, useCasesRequest: 0, verification: null, verificationRequest: 0, verificationLoading: false, verificationError: '', commentCounts: null, commentRequest: 0, pendingFocus: null, busy: false, proposal: null, proposalBaseline: null, pendingAction: null};
let workspace = null;

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
function editable() { return Boolean(state.doc && state.doc.status !== 'Archived' && !state.busy); }
function documented(value) { return !['', 'not documented', 'unknown', 'unresolved', 'tbd', 'tbc'].includes(value.trim().toLowerCase()); }
const messageTimers = {};
function message(text, options = {}) {
  const {kind = 'info', area = 'global', action} = options === true ? {kind: 'error'} : options || {};
  const node = $(area === 'chat' && (!text || !$('#chat-panel').hidden) ? '#chat-status' : '#global-message');
  if (messageTimers[node.id]) clearTimeout(messageTimers[node.id]);
  node.textContent = text;
  node.hidden = !text;
  node.classList.toggle('error', kind === 'error');
  node.classList.toggle('success', kind === 'success');
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  if (!text) return;
  if (action) {
    const button = el('button', 'button small message-action', action.label);
    button.type = 'button';
    button.addEventListener('click', action.run);
    node.append(button);
  }
  if (kind === 'success') { messageTimers[node.id] = setTimeout(() => { node.hidden = true; }, 5000); return; }
  const close = el('button', 'message-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss message');
  close.addEventListener('click', () => { node.hidden = true; node.textContent = ''; });
  node.append(close);
}
function clearStaleMessages() {
  for (const id of ['#global-message', '#chat-status']) {
    const node = $(id);
    if (node && !node.hidden && !node.classList?.contains('error')) node.hidden = true;
  }
}
function inlineError(id, text = '') { const node = $(id); node.textContent = text; node.hidden = !text; }
const focusable = node => Boolean(node?.isConnected && !node.disabled && node.getClientRects?.().length);
const focusLost = () => !document.activeElement || document.activeElement === document.body || !document.activeElement.isConnected;
function returnFocus(opener) {
  const key = opener?.getAttribute?.('data-focus-key'), menu = opener?.closest?.('[role="menu"]');
  [opener, key && document.querySelector(`[data-focus-key="${key}"]`), opener?.id && document.getElementById(opener.id), menu && document.getElementById(menu.getAttribute('aria-labelledby')), $('#document-title'), $('#new-prd')].find(focusable)?.focus();
}
function restoreFocus(dialog) {
  if (dialog.open) return;
  const opener = dialog.returnFocusTo;
  dialog.returnFocusTo = null;
  if (!focusLost() && !dialog.contains(document.activeElement)) return;
  if (state.busy && opener) state.pendingFocus = opener;
  else returnFocus(opener);
}
function trackDialogFocus() {
  const proto = globalThis.HTMLDialogElement?.prototype;
  if (!proto || proto.showModal.tracksFocus) return;
  const show = proto.showModal;
  let lastFocused = null;
  document.addEventListener('focusin', event => { lastFocused = event.target; });
  proto.showModal = function () {
    if (!this.open) {
      let opener = focusLost() ? lastFocused : document.activeElement;
      const parent = opener?.closest?.('dialog');
      if (parent && !parent.open) opener = parent.returnFocusTo;
      this.returnFocusTo = opener && opener !== document.body && !this.contains(opener) ? opener : null;
      this.addEventListener('close', () => restoreFocus(this), {once: true});
    }
    return show.call(this);
  };
  proto.showModal.tracksFocus = true;
}
function focusFirstEmpty() {
  const keys = stageFields[state.stage] || [];
  $(`#field-${keys.find(key => !state.doc?.sections[key]?.trim()) || keys[0]}`)?.focus?.();
}
const removed = [];
let draftTimer = null;
const statusLabel = status => status === 'In review' ? 'Awaiting approval' : status;
const stageLabel = stage => stage === 'Review' ? 'Approval' : stage;
const historyLabels = {Created: 'Created', Edited: 'Saved', review: 'Sent for approval', approve: 'Approved', archive: 'Archived', reopen: 'Reopened', 'Imported as a new draft': 'Imported as a new draft'};
function historyLabel(reason = '') {
  const restored = /^Restored revision (\d+)/.exec(reason);
  if (restored) return `Restored v${restored[1]}`;
  const imported = /^Imported (\d+) requirement\(s\)(?: from “(.+)” revision (\d+))?/.exec(reason);
  if (imported) return `Imported ${imported[1]} requirement${imported[1] === '1' ? '' : 's'} from ${imported[2] ? `“${imported[2]}” v${imported[3]}` : 'another PRD'}`;
  return historyLabels[reason] || reason || 'Saved';
}
function lifecycleStep(doc) {
  return (doc && {Draft: {action: 'review', label: 'Send for approval'}, 'In review': {action: 'approve', label: `Approve v${doc.revision}`}, Archived: {action: 'reopen', label: 'Reopen'}}[doc.status]) || null;
}
function plainList(items) { return items.length === 1 ? items[0] : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`; }
function approvalBlockers(doc) {
  const sections = doc.sections;
  const gaps = ['problem', 'users', 'outcomes', 'useCases', 'scope'].filter(key => !documented(sections[key])).map(key => `“${fields[key][0]}” is empty`);
  if (!sections.requirements.length) gaps.push('Add at least one requirement');
  for (const req of sections.requirements) {
    const absent = [['behavior', 'requirement'], ['appliesTo', 'use case'], ['outcome', 'intended outcome'], ['acceptance', 'acceptance criteria']].filter(([key]) => !documented(req[key])).map(([, label]) => label);
    if (absent.length) gaps.push(`${req.id} needs its ${plainList(absent)}`);
    if (req.proposed) gaps.push(`${req.id} priority is not yet agreed`);
  }
  return gaps;
}
function approvalAdvice(doc) {
  const advice = ['metrics', 'evidence'].filter(key => !documented(doc.sections[key])).map(key => `“${fields[key][0]}” is empty.`);
  const decisions = doc.sections.decisions.trim();
  if (decisions && !/^(none|no open decisions|no blocking decisions|not applicable)\.?$/i.test(decisions)) advice.push('Open decisions are recorded. Approving means you accept them as they stand.');
  advice.push('Requiro checks that required fields are filled in. It does not check evidence or product readiness.');
  return advice;
}
function storage(task) { try { const store = globalThis.localStorage; return store ? task(store) : null; } catch { return null; } }
const draftPrefix = id => `requiro-draft:${id}:`;
function clearLocalDraft(id) {
  storage(store => {
    clearTimeout(draftTimer); draftTimer = null;
    for (let index = store.length - 1; index >= 0; index--) if (store.key(index)?.startsWith(draftPrefix(id))) store.removeItem(store.key(index));
  });
}
function writeLocalDraft() {
  storage(store => {
    clearTimeout(draftTimer); draftTimer = null;
    if (!state.doc || !state.saved) return;
    const key = draftPrefix(state.doc.id) + state.saved.revision;
    if (dirty()) store.setItem(key, JSON.stringify({savedAt: new Date().toISOString(), doc: {...state.doc, stage: state.stage}}));
    else store.removeItem(key);
  });
}
function scheduleLocalDraft() { storage(() => { clearTimeout(draftTimer); draftTimer = setTimeout(writeLocalDraft, 600); }); }
function findLocalDraft(doc) {
  return storage(store => {
    for (let index = 0; index < store.length; index++) {
      const key = store.key(index);
      if (!key?.startsWith(draftPrefix(doc.id))) continue;
      const draft = JSON.parse(store.getItem(key));
      if (draft?.doc?.id === doc.id && draft.doc.sections) return {...draft, baseRevision: Number(key.slice(draftPrefix(doc.id).length))};
    }
    return null;
  });
}
function offerRecovery() {
  const draft = state.saved && findLocalDraft(state.saved);
  if (!draft) return;
  const current = draft.baseRevision === state.saved.revision;
  const dialog = $('#recover-dialog');
  $('#recover-description').textContent = current ? `This browser kept edits to v${draft.baseRevision} that were not saved${draft.savedAt ? ` (last change ${formatDate(draft.savedAt)})` : ''}. Recover them to review and save, or discard them.` : `This browser kept unsaved edits based on v${draft.baseRevision}, but the saved PRD is now v${state.saved.revision}. Download them to compare, or discard them.`;
  $('#recover-confirm').textContent = current ? 'Recover' : 'Download edits';
  const done = () => { $('#recover-confirm').onclick = $('#recover-discard').onclick = $('#recover-later').onclick = dialog.oncancel = null; dialog.close(); };
  $('#recover-later').onclick = done;
  dialog.oncancel = event => { event.preventDefault(); done(); };
  $('#recover-discard').onclick = () => { clearLocalDraft(state.saved.id); done(); message('Discarded the unsaved edits kept in this browser.'); };
  $('#recover-confirm').onclick = () => {
    done();
    if (!current) { downloadLocalDraft(draft.doc); clearLocalDraft(state.saved.id); return; }
    state.doc = {...clone(state.saved), title: draft.doc.title, sections: clone(draft.doc.sections), nextRequirementNumber: Math.max(state.saved.nextRequirementNumber || 1, draft.doc.nextRequirementNumber || 1)};
    if (stages.includes(draft.doc.stage)) state.stage = draft.doc.stage;
    renderDocument(); markDirty();
    message('Recovered your unsaved edits. Review them, then save.');
  };
  dialog.showModal();
  $('#recover-confirm').focus();
}
function renderUndo() {
  const last = removed.at(-1);
  $('#undo-toast').hidden = !last;
  if (last) $('#undo-text').textContent = `Removed ${last.req.id}${removed.length > 1 ? ` and ${removed.length - 1} more` : ''}. You can undo until you save.`;
}
function removeRequirement(id) {
  const index = state.doc.sections.requirements.findIndex(item => item.id === id);
  if (index < 0 || !editable()) return;
  removed.push({index, req: state.doc.sections.requirements.splice(index, 1)[0]});
  renderEditor(); markDirty(); renderUndo();
  $('#undo-remove').focus();
}
function undoRemove() {
  if (!removed.length || !editable()) return;
  const {index, req} = removed.pop();
  const reqs = state.doc.sections.requirements;
  if (!reqs.some(item => item.id === req.id)) reqs.splice(Math.min(index, reqs.length), 0, req);
  renderEditor(); markDirty(); renderUndo();
  message(`Restored ${req.id}.`);
  document.getElementById(`${req.id}-behavior`)?.focus();
}
function confirmLeave() {
  if (!dirty()) return Promise.resolve(true);
  const dialog = $('#leave-dialog');
  inlineError('#leave-error');
  $('#leave-save').disabled = state.doc.status === 'Archived';
  return new Promise(resolve => {
    const done = value => { $('#leave-save').onclick = $('#leave-discard').onclick = $('#leave-cancel').onclick = dialog.oncancel = null; dialog.close(); resolve(value); };
    $('#leave-cancel').onclick = () => done(false);
    dialog.oncancel = event => { event.preventDefault(); done(false); };
    $('#leave-discard').onclick = () => { clearLocalDraft(state.doc.id); done(true); };
    $('#leave-save').onclick = async () => {
      $('#leave-save').disabled = true;
      try { await save(); done(true); } catch (error) { inlineError('#leave-error', error.message); $('#leave-save').disabled = false; }
    };
    dialog.showModal();
    $($('#leave-save').disabled ? '#leave-discard' : '#leave-save').focus();
  });
}
async function api(path, method = 'GET', data) {
  const response = await fetch(path, {method, headers: data ? {'Content-Type': 'application/json'} : {}, body: data ? JSON.stringify(data) : undefined, credentials: 'same-origin'});
  let result;
  try { result = await response.json(); } catch { throw new Error('The local server returned an unreadable response. Your unsaved edits are still here.'); }
  if (!response.ok) {
    const error = new Error(result.error || 'The request could not be completed.');
    error.status = response.status;
    if (response.status === 409) error.message += ' Your edits are still here. To keep them, download them from Export before you reopen the PRD.';
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
  } finally {
    state.busy = false; updateControls();
    const opener = state.pendingFocus; state.pendingFocus = null;
    if (opener && focusLost()) returnFocus(opener);
  }
}
function updateSummary(doc) {
  const summary = {id: doc.id, title: doc.title, status: doc.status, revision: doc.revision, stage: doc.stage, updatedAt: doc.updatedAt, projectIds: state.docs.find(item => item.id === doc.id)?.projectIds || []};
  state.docs = [summary, ...state.docs.filter(item => item.id !== doc.id)];
  renderLibrary();
}
function acceptSaved(doc) {
  rememberCompose();
  if (state.saved?.id !== doc.id) { message(''); message('', {area: 'chat'}); state.commentCounts = null; workspace?.showPanel('prd'); }
  state.doc = clone(doc);
  state.saved = clone(doc);
  state.stage = stages.includes(doc.stage) ? doc.stage : 'Discover';
  state.proposal = storedProposal(doc);
  state.proposalBaseline = clone(doc.sections);
  state.verification = null;
  state.verificationError = '';
  state.useCasesContext = null;
  removed.length = 0;
  updateSummary(doc);
  renderDocument();
  renderUndo();
  refreshVerification();
  refreshUseCases();
  refreshCommentCounts();
}
async function refreshUseCases() {
  const {id, revision} = state.saved;
  const request = ++state.useCasesRequest;
  const current = () => state.useCasesRequest === request && state.saved?.id === id && state.saved.revision === revision;
  try {
    const context = await api(`/api/prds/${encodeURIComponent(id)}/use-cases?revision=${revision}`);
    if (!current()) return;
    if (context.documentId !== id || context.prdRevision !== revision || !context.labels ||
        state.saved.sections.requirements.some(req => context.labels[req.id]?.value !== req.appliesTo || typeof context.labels[req.id]?.label !== 'string' || typeof context.labels[req.id]?.imported !== 'boolean')) throw new Error('Use cases do not match this PRD revision.');
    state.useCasesContext = context;
    refreshUseCaseControls($('#editor-content'), state.doc, context);
    renderPreview();
  } catch {
    if (current()) {
      state.useCasesContext = null;
      message('Use-case descriptions could not load. Saved references are preserved; reopen the PRD to try again.', true);
    }
  }
}
function markDirty() {
  updateControls();
  if (state.view !== 'edit') renderPreview();
  scheduleLocalDraft();
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
async function refreshCommentCounts() {
  const id = state.saved?.id;
  if (!id) return;
  const request = ++state.commentRequest;
  let counts = null;
  try {
    const result = await api(`/api/prds/${encodeURIComponent(id)}/comments`);
    if (result.documentId === id && Array.isArray(result.threads)) {
      const open = result.threads.filter(thread => thread.status === 'Open');
      counts = {documentId: id, total: open.length, byRequirement: {}};
      for (const thread of open) counts.byRequirement[thread.requirementId] = (counts.byRequirement[thread.requirementId] || 0) + 1;
    }
  } catch { /* Counts are a convenience; the Comments dialog still loads every thread. */ }
  if (state.commentRequest !== request || state.saved?.id !== id) return;
  state.commentCounts = counts;
  updateControls();
  if (state.view !== 'edit') renderPreview();
}
async function reviewDelivery(requirementId) {
  await save();
  await openCompletion({doc: clone(state.saved), api, requirementId});
  await refreshVerification();
}
async function commentRequirement({requirementId, anchor, browse = false} = {}) {
  if (!state.saved) return;
  if (browse && dirty()) anchor = undefined;
  if ((anchor && dirty()) || (requirementId && !state.saved.sections.requirements.some(req => req.id === requirementId))) {
    message('Save your requirement edits before starting a comment. Your draft is preserved.');
    $('#save-prd').focus();
    return;
  }
  await openComments({doc: clone(state.saved), requirementId, anchor, browse, api});
  await refreshCommentCounts();
}
async function changeReviewStatus(requirementId, {saveDraft = false} = {}) {
  if (dirty()) {
    if (!saveDraft) {
      message('Save your draft before changing a delivery status. Your unsaved edits are still here.');
      $('#save-prd').focus();
      return;
    }
    await save();
  }
  const result = await openRequirementStatus({doc: clone(state.saved), requirementId, api});
  if (result.updated) message(`${requirementId} marked ${result.status}.`, {kind: 'success'});
  if (result.fullReview) await openCompletion({doc: clone(state.saved), requirementId, api});
  await refreshVerification();
}
async function save() {
  if (!state.doc || !dirty()) return;
  const proposal = state.proposal;
  const candidate = {...state.doc, stage: state.stage};
  const doc = await api(`/api/prds/${encodeURIComponent(state.doc.id)}`, 'PUT', {expectedRevision: state.saved.revision, doc: candidate});
  acceptSaved(doc);
  clearLocalDraft(doc.id);
  message(`Saved v${doc.revision}.`, {kind: 'success'});
  if (proposal && !state.proposal) message(`The suggested changes were for the previous version, so they were discarded. Choose Copy for assistant to get suggestions for v${doc.revision}.`, {area: 'chat'});
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
  const titleCounts = new Map();
  for (const doc of state.docs) titleCounts.set(doc.title || 'Untitled PRD', (titleCounts.get(doc.title || 'Untitled PRD') || 0) + 1);
  for (const doc of docs) {
    const button = el('button', `doc-item${state.doc?.id === doc.id ? ' active' : ''}`);
    if (state.doc?.id === doc.id) button.setAttribute('aria-current', 'page');
    const title = el('span', 'doc-item-title', doc.title || 'Untitled PRD');
    const status = el('span', 'status-pill', statusLabel(doc.status));
    status.dataset.status = doc.status;
    button.append(title, status, el('span', 'doc-item-badge', `v${doc.revision}`), el('span', 'doc-item-badge doc-item-stage', stageLabel(doc.stage)));
    if (titleCounts.get(doc.title || 'Untitled PRD') > 1) {
      const updated = doc.updatedAt ? `Updated ${formatDate(doc.updatedAt)}` : '';
      const sameTime = state.docs.some(other => other.id !== doc.id && other.title === doc.title && formatDate(other.updatedAt) === formatDate(doc.updatedAt));
      button.append(el('span', 'doc-item-updated', [updated, (sameTime || !updated) && doc.id].filter(Boolean).join(' · ')));
    }
    button.disabled = state.busy;
    button.addEventListener('click', () => {
      if (state.doc?.id === doc.id) { workspace?.showPanel('prd'); return; }
      run(async () => {
        if (!(await confirmLeave())) return;
        const opened = await api(`/api/prds/${encodeURIComponent(doc.id)}`);
        acceptSaved(opened);
        message('');
        offerRecovery();
      });
    });
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
  const openThreads = hasDoc && state.commentCounts?.documentId === state.doc.id ? state.commentCounts.total : 0;
  $('#comments-prd').textContent = openThreads ? `Comments (${openThreads})` : 'Comments';
  for (const button of document.querySelectorAll('#doc-list button')) button.disabled = state.busy;
  for (const id of ['edit-tab', 'document-tab', 'table-tab']) $(`#${id}`).disabled = state.busy;
  for (const button of document.querySelectorAll('#prd-visualization button')) button.disabled = state.busy || (button.dataset.editSection && state.doc?.status === 'Archived') || button.dataset.commentSelection === 'true' && button.dataset.selectionValid !== 'true';
  if (!hasDoc) {
    $('#copy-packet').disabled = true;
    $('#paste-response').disabled = true;
    $('#chat-message').disabled = true;
    $('#use-starter').disabled = true;
    $('#clear-chat').disabled = true;
    return;
  }
  $('#document-title').disabled = !canEdit;
  $('#save-prd').disabled = !canEdit || !changed;
  $('#save-prd').textContent = state.doc.status === 'Approved' ? 'Save as new draft' : 'Save';
  $('#save-state').textContent = changed ? 'Unsaved changes' : `Saved v${state.saved.revision}`;
  $('#save-state').classList.toggle('dirty', changed);
  $('#document-status').title = state.doc.status === 'Approved' && !changed ? `Approved v${state.saved.revision}. Edit and save to start a new draft.` : `${statusLabel(state.doc.status)} · ${changed ? `unsaved edits to v${state.saved.revision}` : `saved v${state.saved.revision}`}${state.doc.updatedAt ? ` · updated ${formatDate(state.doc.updatedAt)}` : ''}`;
  $('#export-prd').textContent = changed ? 'Export / recover ↓' : 'Export ↓';
  $('#history-prd').disabled = state.busy;
  $('#verify-delivery').disabled = state.busy;
  $('#verify-delivery').textContent = changed ? 'Save + delivery review' : 'Delivery review';
  $('#export-prd').disabled = state.busy;
  $('#archive-prd').disabled = state.busy || changed;
  $('#archive-prd').textContent = state.doc.status === 'Archived' ? 'Reopen' : 'Archive';
  $('#archive-prd').hidden = state.doc.status === 'Archived';
  const step = lifecycleStep(state.doc);
  const lifecycle = $('#lifecycle-action');
  lifecycle.hidden = !step;
  lifecycle.textContent = step?.label || '';
  lifecycle.disabled = state.busy || changed;
  lifecycle.title = changed ? 'Save your edits first.' : '';
  $('#copy-packet').textContent = changed ? 'Save + copy for assistant ↗' : 'Copy for assistant ↗';
  $('#copy-packet').disabled = !canEdit;
  $('#paste-response').disabled = !canEdit;
  $('#chat-message').disabled = !canEdit;
  $('#use-starter').disabled = !canEdit;
  $('#clear-chat').disabled = !canEdit || !state.saved.chat?.length;
  $('#handoff-state').textContent = state.doc.status === 'Archived' ? 'Reopen this PRD to continue the conversation.' : changed ? 'Copy for assistant saves your edits first, so the assistant sees them.' : `The assistant sees saved v${state.doc.revision}. Its suggestions change nothing until you apply them.`;
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
    const complete = stageIsComplete(stage, state.doc);
    const button = el('button', `stage-button${stage === state.stage ? ' active' : ''}${complete ? ' complete' : ''}`);
    button.append(el('span', 'stage-number', String(index + 1)), el('span', 'stage-label', stageLabel(stage)));
    button.title = stageLabel(stage);
    button.setAttribute('aria-label', `${stageLabel(stage)}, ${complete ? 'complete' : 'not complete'}`);
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
  $('#starter-question').textContent = $('#starter-question').title = starterQuestions[stage];
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
  top.append(el('p', '', `${state.doc.sections.requirements.length} requirements`));
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
    card.append(el('p', 'requirements-empty', 'No requirements yet. Add the first thing this product must do.'));
  } else {
    const scroll = el('div', 'requirements-scroll');
    const table = el('table', 'requirements-table');
    const caption = el('caption', 'sr-only', 'Product requirements with scope, priority, acceptance criteria, and outcomes');
    const head = el('thead');
    const row = el('tr');
    for (const title of ['Requirement and intended outcome', 'Use case and priority', 'Acceptance criteria', 'Remove']) {
      const th = el('th', '', title); th.scope = 'col'; row.append(th);
    }
    head.append(row);
    const body = el('tbody');
    for (const req of state.doc.sections.requirements) {
      const tr = el('tr');
      const behavior = el('td');
      behavior.append(el('span', 'requirement-id', req.id), requirementControl(req, 'behavior', 'Requirement'), requirementControl(req, 'outcome', 'Intended outcome'));
      const scope = el('td');
      scope.append(useCaseControl(state.doc, req, () => state.useCasesContext, markDirty), requirementControl(req, 'priority', 'Priority', 'select'));
      const proposedLabel = el('label', 'proposed-label');
      const proposed = el('input');
      proposed.type = 'checkbox';
      proposed.checked = req.proposed;
      proposed.addEventListener('change', () => { req.proposed = proposed.checked; markDirty(); });
      proposed.setAttribute('aria-describedby', 'priority-agreement-hint');
      proposedLabel.append(proposed, document.createTextNode('Priority not yet agreed'));
      scope.append(proposedLabel);
      const acceptance = el('td');
      acceptance.append(requirementControl(req, 'acceptance', 'Acceptance criteria'));
      const actions = el('td', 'requirement-remove');
      const remove = el('button', 'icon-button', '×');
      remove.dataset.edit = '';
      remove.setAttribute('aria-label', `Remove requirement ${req.id}`);
      remove.addEventListener('click', () => removeRequirement(req.id));
      actions.append(remove);
      tr.append(behavior, scope, acceptance, actions);
      body.append(tr);
    }
    table.append(caption, head, body);
    scroll.append(table);
    card.append(scroll);
  }
  const priorityHint = el('p', 'field-hint', '“Must” means required for this scope. “Nice to have” is optional. New requirements start with “Priority not yet agreed” ticked. Untick it once the team agrees the priority. Approval needs every priority agreed.');
  priorityHint.id = 'priority-agreement-hint';
  card.append(priorityHint);
  container.append(card);
}
function reviewChecks(doc) {
  const reqs = doc.sections.requirements;
  return [
    {label: 'Problem, users, and intended outcome are documented', ok: ['problem', 'users', 'outcomes'].every(key => documented(doc.sections[key]))},
    {label: 'Use cases and scope are documented', ok: ['useCases', 'scope'].every(key => documented(doc.sections[key]))},
    {label: 'At least one requirement is defined', ok: reqs.length > 0},
    {label: 'Every requirement has its wording, use case, intended outcome and acceptance criteria', ok: reqs.length > 0 && reqs.every(req => ['behavior', 'appliesTo', 'outcome', 'acceptance'].every(key => documented(req[key])))},
    {label: 'Every requirement priority is agreed', ok: reqs.length > 0 && reqs.every(req => !req.proposed)},
    {label: 'Success measures and evidence are documented (advice; does not block approval)', ok: ['metrics', 'evidence'].every(key => documented(doc.sections[key]))},
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
  for (const [number, label] of [[requirements.length, 'Requirements'], [requirements.filter(req => req.priority === 'Must').length, 'Must'], [requirements.filter(req => req.proposed).length, 'Priorities not yet agreed']]) {
    const stat = el('div', 'review-stat'); stat.append(el('strong', '', number), el('span', '', label)); stats.append(stat);
  }
  card.append(stats);
  const list = el('ul', 'review-checklist');
  for (const check of reviewChecks(state.doc)) {
    const li = el('li', check.ok ? '' : 'missing');
    const icon = el('span', 'check-icon', check.ok ? '✓' : '○');
    icon.setAttribute('aria-hidden', 'true');
    li.append(icon, el('span', 'sr-only', check.ok ? 'Done: ' : 'Missing: '), document.createTextNode(check.label)); list.append(li);
  }
  card.append(list);
  const actions = el('div', 'review-actions');
  if (state.doc.status !== 'Archived') {
    const review = el('button', 'button', 'Send for approval'); review.dataset.documentAction = 'review';
    review.addEventListener('click', () => run(() => performAction('review')));
    const approve = el('button', 'button primary', `Approve v${state.doc.revision}`); approve.dataset.documentAction = 'approve';
    approve.addEventListener('click', () => openAction('approve'));
    actions.append(review, approve);
  }
  card.append(actions, el('p', 'review-explanation', dirty() ? 'Save your edits before sending for approval or approving.' : 'Approving records an explicit decision. Saving edits to an approved PRD creates a new draft.'));
  container.append(card);
}
function editSection(key) {
  if (!state.doc || state.busy) return;
  const stage = stages.find(stage => stageFields[stage].includes(key));
  if (!stage) return;
  if (state.doc.status === 'Archived') {
    message('Reopen this PRD before editing its wording.');
    $('#lifecycle-action').focus();
    return;
  }
  message('');
  state.view = 'edit';
  setStage(stage);
  $(`#field-${key}`).focus();
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
  $('#stage-subtitle').textContent = editing ? stageDescriptions[state.stage] : state.doc?.status === 'Archived' ? 'Choose Reopen to edit this archived PRD.' : '';
  if (!state.doc || editing) return;
  $('#preview-note').textContent = dirty() ? 'This view includes unsaved edits. After you save, requirements marked Complete need a fresh delivery review.' : '';
  $('#review-load-state').textContent = state.verificationLoading ? 'Loading saved review details…' : state.verificationError;
  $('#review-load-state').hidden = !state.verificationLoading && !state.verificationError;
  const view = $('#prd-visualization'), active = document.activeElement;
  const focusKey = view.contains?.(active) ? active.getAttribute('data-focus-key') : null;
  const commentCounts = state.commentCounts?.documentId === state.doc.id ? state.commentCounts.byRequirement : null;
  renderPrdView(view, {doc: state.doc, mode: state.view, verification: state.verification, useCasesContext: state.useCasesContext, savedRevision: dirty() ? null : state.saved.revision, savedDoc: state.saved, commentCounts, onReview: (requirementId, options) => run(() => changeReviewStatus(requirementId, options)), onComment: payload => run(() => commentRequirement(payload)), onEditSection: editSection});
  updateControls();
  const again = focusKey && view.querySelector(`[data-focus-key="${focusKey}"]`);
  if (focusable(again)) again.focus();
  else if (again) state.pendingFocus = again;
}
let renderedChat = {id: null, items: []};
function chatBubble(item) {
  const bubble = el('div', `chat-item ${item.role === 'user' ? 'user' : 'assistant-reply'}`);
  bubble.append(el('p', 'chat-role', item.role === 'user' ? 'You' : 'Assistant · pasted reply'), el('p', 'chat-content', item.content));
  return bubble;
}
function renderConversation() {
  const container = $('#conversation');
  const chat = state.doc?.chat || [];
  const items = chat.map(item => `${item.role}\n${item.content}`);
  const sameDoc = renderedChat.id === (state.doc?.id || null);
  if (!sameDoc) message('', {area: 'chat'});
  if (sameDoc && renderedChat.items.every((item, index) => item === items[index])) {
    if (items.length > renderedChat.items.length) {
      if (!renderedChat.items.length) container.replaceChildren();
      container.append(...chat.slice(renderedChat.items.length).map(chatBubble));
      container.parentElement.scrollTop = container.parentElement.scrollHeight;
    }
  } else {
    container.setAttribute('aria-live', 'off');
    container.replaceChildren(...(chat.length ? chat.map(chatBubble) : [el('p', 'conversation-empty', state.doc ? 'No messages yet. Write a question below and choose Copy for assistant. Suggested changes always need your review.' : 'Create or open a PRD to begin. No model runs in this app.')]));
    container.parentElement.scrollTop = container.parentElement.scrollHeight;
    setTimeout(() => container.setAttribute('aria-live', 'polite'), 300);
  }
  const empty = !chat.length;
  if (!sameDoc || empty !== !renderedChat.items.length) { const help = $('#handoff-help'); if (help) help.open = empty; }
  $('#chat-panel')?.classList?.toggle('has-messages', !empty);
  renderedChat = {id: state.doc?.id || null, items};
}
function fitTitle() {
  const title = $('#document-title');
  title.title = title.value;
  if (!title.style || !title.getClientRects?.().length) return;
  title.style.height = '';
  title.style.height = `${title.scrollHeight}px`;
  if (document.activeElement !== title) title.scrollLeft = title.scrollTop = 0;
  title.classList.toggle('clamped', title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1);
}
function renderDocument() {
  $('#welcome').hidden = Boolean(state.doc);
  $('#document-view').hidden = !state.doc;
  if (!state.doc) return;
  $('#document-title').value = state.doc.title;
  fitTitle();
  $('#document-status').textContent = statusLabel(state.doc.status);
  $('#document-status').dataset.status = state.doc.status;
  $('#document-revision').textContent = `v${state.doc.revision}`;
  $('#updated-at').textContent = state.doc.updatedAt ? `Updated ${formatDate(state.doc.updatedAt)}` : '';
  $('#starter-question').textContent = $('#starter-question').title = starterQuestions[state.stage];
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
  $('#new-title').value = '';
  inlineError('#new-error');
  $('#new-dialog').showModal();
  $('#new-title').focus();
}
const actionMessages = {review: doc => `Sent for approval as v${doc.revision}.`, approve: doc => `Approved. Saved as v${doc.revision}.`, archive: doc => `Archived as v${doc.revision}.`, reopen: doc => `Reopened as draft v${doc.revision}.`, restore: (doc, revision) => `Restored v${revision} as draft v${doc.revision}.`};
async function performAction(action, revision) {
  if (!state.doc || dirty()) throw new Error('Save your edits before changing this PRD’s status.');
  const doc = await api(`/api/prds/${encodeURIComponent(state.doc.id)}/action`, 'POST', {expectedRevision: state.doc.revision, action, revision});
  acceptSaved(doc);
  message(actionMessages[action](doc, revision), {kind: 'success'});
}
function openAction(action, revision) {
  if (!state.doc || dirty()) { message('Save your edits before changing this PRD’s status.'); return; }
  if (action === 'restore' && state.doc.status === 'Archived') { message('Reopen this PRD before restoring a version.'); return; }
  const current = state.doc.revision, next = current + 1;
  const text = {
    approve: [`Approve v${current}?`, `Approving creates v${next} with the same content as v${current} and records v${next} as the approved version. Check the requirements, evidence and open decisions first.`, `Approve v${current}`],
    archive: ['Archive this PRD?', `Archiving saves v${next}. The PRD and its history stay available, and you can reopen it at any time.`, 'Archive'],
    reopen: ['Reopen this PRD?', `Reopening creates draft v${next} from this archived version.`, 'Reopen'],
    restore: [`Restore v${revision} as a new draft?`, `Restoring copies v${revision} into new draft v${next}. Every saved version and approval stays in history.`, 'Restore as new draft'],
  }[action];
  if (!text) return;
  state.pendingAction = {action, revision};
  $('#action-title').textContent = text[0]; $('#action-description').textContent = text[1]; $('#confirm-action').textContent = text[2];
  const blockers = action === 'approve' ? approvalBlockers(state.doc) : [];
  const advice = action === 'approve' ? approvalAdvice(state.doc) : [];
  $('#action-blocker-list').replaceChildren(...blockers.map(item => el('li', '', `${item}.`)));
  $('#action-warnings').replaceChildren(...advice.map(item => el('li', '', item)));
  $('#action-blockers').hidden = !blockers.length;
  $('#action-advice').hidden = !advice.length;
  $('#confirm-action').disabled = blockers.length > 0;
  $('#confirm-action').title = blockers.length ? 'Resolve everything under “Blocks approval” first.' : '';
  inlineError('#action-error');
  $('#action-dialog').showModal();
  $(blockers.length ? '#cancel-action' : '#confirm-action').focus();
}
function downloadLocalDraft(doc = state.doc) {
  const blob = new Blob([JSON.stringify(doc, null, 2) + '\n'], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = el('a'); link.href = url; link.download = `requiro-unsaved-draft-${fileSlug(doc.title, doc.id)}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  message(`Downloaded ${link.download}. It is not saved in Requiro.`, {kind: 'success'});
}
const exportName = (doc, extension) => `${fileSlug(doc.title, doc.id)}${extension}`;
function exported(name) { $('#export-dialog').close(); message(`Downloaded ${name}.`, {kind: 'success'}); }
function openExport() {
  if (!state.doc) return;
  const dialog = $('#export-dialog');
  dialog.querySelectorAll('[data-export-extra]').forEach(node => node.remove());
  inlineError('#export-error');
  $('#export-note').textContent = dirty() ? 'Your edits are not saved. Markdown, JSON and the delivery report use saved versions only, so save first or download your unsaved edits below. Print includes your unsaved edits and marks them.' : `Markdown, JSON and the delivery report contain saved v${state.doc.revision}.`;
  for (const [selector, format, extension] of [['#export-markdown', 'markdown', '.md'], ['#export-json', 'json', '.json']]) {
    const link = $(selector);
    link.hidden = dirty();
    link.href = `/api/export/${encodeURIComponent(state.doc.id)}?format=${format}`;
    link.download = exportName(state.saved, extension);
  }
  $('#export-report').hidden = dirty();
  let first = $('#export-markdown');
  if (dirty()) {
    const saveExport = el('button', 'button primary full', 'Save + export current PRD');
    saveExport.dataset.exportExtra = '';
    saveExport.style.marginTop = '12px';
    saveExport.disabled = !editable();
    saveExport.addEventListener('click', () => run(async () => { await save(); dialog.close(); openExport(); }, '#export-error'));
    const local = el('button', 'button full', 'Download unsaved edits (JSON)');
    local.dataset.exportExtra = ''; local.style.marginTop = '10px';
    local.addEventListener('click', () => { dialog.close(); downloadLocalDraft(); });
    $('#export-error').before(saveExport, local);
    first = saveExport.disabled ? local : saveExport;
  }
  dialog.showModal();
  first.focus();
}
async function downloadDeliveryReport() {
  if (!state.saved || dirty()) throw new Error('Save your edits first. The delivery report uses the saved version.');
  const {id, revision} = state.saved;
  const current = await api(`/api/prds/${encodeURIComponent(id)}/verification`);
  if (current.documentId !== id || current.prdRevision !== revision) throw new Error('This PRD changed elsewhere. Reopen it before downloading the delivery report.');
  const name = exportName(state.saved, '-delivery-review.zip');
  const link = el('a'); link.href = `/api/prds/${encodeURIComponent(id)}/completion-report`; link.download = name; document.body.append(link); link.click(); link.remove();
  exported(name);
}
async function openHistory() {
  inlineError('#history-error');
  $('#history-list').replaceChildren(el('p', 'muted small', 'Loading saved versions…'));
  $('#history-detail').replaceChildren(el('p', 'muted small', 'Select a version to inspect it.'));
  $('#history-dialog').showModal();
  const history = await api(`/api/prds/${encodeURIComponent(state.doc.id)}/history`);
  const list = $('#history-list'); list.replaceChildren();
  let first = null;
  for (const item of history) {
    const button = el('button', 'history-item');
    first ||= button;
    button.append(el('strong', '', `v${item.revision} · ${statusLabel(item.status)}`), el('span', '', formatDate(item.updatedAt)), el('span', '', historyLabel(item.reason)));
    button.addEventListener('click', () => run(async () => {
      const [doc, context] = await Promise.all([api(`/api/prds/${encodeURIComponent(state.doc.id)}/history/${item.revision}`), api(`/api/prds/${encodeURIComponent(state.doc.id)}/use-cases?revision=${item.revision}`)]);
      list.querySelectorAll('button').forEach(node => node.classList.toggle('active', node === button));
      const detail = $('#history-detail'); detail.replaceChildren(el('h3', '', doc.title), el('p', 'small muted', `v${doc.revision} · ${statusLabel(doc.status)}`));
      const restore = el('button', 'button', 'Restore as new draft');
      restore.disabled = dirty() || state.doc.status === 'Archived';
      restore.addEventListener('click', () => { $('#history-dialog').close(); openAction('restore', doc.revision); });
      detail.append(restore);
      if (state.doc.status === 'Archived') detail.append(el('p', 'small muted', 'Reopen this PRD before restoring a version.'));
      else if (dirty()) detail.append(el('p', 'small muted', 'Save or discard current edits before restoring.'));
      detail.append(el('pre', '', buildMarkdown(doc, context)));
    }, '#history-error'));
    list.append(button);
  }
  first?.focus();
}
async function copyPacket() {
  if (!state.doc) return;
  const request = $('#chat-message').value.trim();
  if (!request) { message('Write a question or use the starter question first.', {area: 'chat'}); $('#chat-message').focus(); return; }
  if ((state.saved.chat || []).length >= 99) throw new Error('This conversation is full. Choose Clear conversation to continue; the PRD content stays the same.');
  await save();
  const result = await api(`/api/prds/${encodeURIComponent(state.doc.id)}/packet`, 'POST', {expectedRevision: state.saved.revision, message: request});
  if (typeof result.packet !== 'string' || !Array.isArray(result.doc?.chat)) throw new Error('The local server did not return the text for your assistant.');
  acceptChat(result.doc);
  let copied = false;
  try { await navigator.clipboard.writeText(result.packet); copied = true; } catch { /* Clipboard permissions vary; the selectable text is the fallback. */ }
  $('#chat-message').value = '';
  state.composeDrafts[state.doc.id] = '';
  $('#packet-text').value = result.packet;
  $('#packet-explanation').textContent = copied ? `Copied. Paste it into your AI chat, then choose Paste assistant reply. The reply will be checked against saved v${state.saved.revision}.` : 'Your browser did not allow copying. Select all the text below, copy it, then paste it into your AI chat.';
  $('#packet-dialog').showModal();
  $('#packet-text').focus();
  if (!copied) $('#packet-text').select();
}
function acceptChat(doc) {
  state.saved.chat = clone(doc.chat);
  state.doc.chat = clone(doc.chat);
  renderConversation();
  updateControls();
}

const requirementLabels = {id: 'ID', priority: 'Priority', proposed: 'Priority not yet agreed', appliesTo: 'Use case', outcome: 'Intended outcome', behavior: 'Requirement', acceptance: 'Acceptance criteria'};
const requirementText = ['behavior', 'outcome', 'appliesTo', 'acceptance'];
const nextRequirement = doc => doc.nextRequirementNumber || Math.max(1, ...doc.sections.requirements.map(req => Number(req.id.slice(2)) + 1));
let replyProblems = [];
function replyError(text, correctable = true) {
  const error = new Error(text);
  error.correctable = correctable;
  return error;
}
function objectEnd(text, start) {
  let depth = 0, quoted = false, escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; }
    else if (char === '"') quoted = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return index;
  }
  return -1;
}
export function parseReply(text) {
  const source = String(text ?? '').trim();
  if (!source) throw replyError('Paste the assistant reply first.', false);
  let found = false;
  for (let start = source.indexOf('{'); start !== -1;) {
    const end = objectEnd(source, start);
    if (end === -1) { start = source.indexOf('{', start + 1); continue; }
    found = true;
    try {
      const value = JSON.parse(source.slice(start, end + 1));
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* Chat services often wrap the reply in prose or code fences; try the next object. */ }
    start = source.indexOf('{', end + 1);
  }
  throw replyError(found ? 'The reply looks like JSON but cannot be read, for example because of a missing comma or quotation mark.' : 'No reply in the expected format was found. Paste the assistant’s whole reply, including everything between the first { and the last }.');
}
function proposedRequirements(value, doc, issues) {
  if (!Array.isArray(value) || value.length > 200) { issues.push('Requirements were skipped because they are not a list of at most 200 requirements.'); return []; }
  const current = new Map(doc.sections.requirements.map(req => [req.id, req]));
  const next = nextRequirement(doc);
  const mentioned = new Set(), result = [];
  let unidentified = false;
  value.forEach((req, index) => {
    const object = req && typeof req === 'object' && !Array.isArray(req);
    const id = object && typeof req.id === 'string' && /^R-[0-9]{3,6}$/.test(req.id) && Number(req.id.slice(2)) > 0 ? req.id : null;
    const missing = object ? requirementText.filter(key => typeof req[key] !== 'string').map(key => requirementLabels[key]) : [];
    const problem = !object ? 'is not a requirement with named fields'
      : !id ? 'needs an ID such as R-004'
      : mentioned.has(id) ? 'appears more than once'
      : !current.has(id) && Number(id.slice(2)) < next ? `uses an ID that was used before; new requirements start at R-${String(next).padStart(3, '0')}`
      : missing.length ? `is missing ${missing.join(', ')}`
      : requirementText.some(key => req[key].length > 20000) ? 'has wording longer than 20,000 characters'
      : !['Must', 'Nice to have'].includes(req.priority) ? 'needs a priority of Must or Nice to have'
      : req.proposed !== undefined && typeof req.proposed !== 'boolean' ? 'needs “Priority not yet agreed” to be true or false'
      : '';
    if (id) mentioned.add(id); else unidentified = true;
    if (problem) { issues.push(`${id || `Suggested requirement ${index + 1}`} was skipped: it ${problem}.`); return; }
    const extra = Object.keys(req).filter(key => !Object.hasOwn(requirementLabels, key));
    if (extra.length) issues.push(`${id}: ${extra.map(key => `“${key}”`).join(', ')} ignored, because requirements have no such field.`);
    const before = current.get(id);
    const after = {id, priority: req.priority, proposed: req.proposed ?? before?.proposed ?? true, appliesTo: req.appliesTo, outcome: req.outcome, behavior: req.behavior, acceptance: req.acceptance};
    if (!before) result.push({id, kind: 'new', after});
    else if (Object.keys(requirementLabels).some(key => before[key] !== after[key])) result.push({id, kind: 'changed', before: clone(before), after});
  });
  const removed = doc.sections.requirements.filter(req => !mentioned.has(req.id));
  if (removed.length && unidentified) issues.push(`Removing ${removed.map(req => req.id).join(', ')} was not offered, because a suggested requirement had no usable ID.`);
  else result.push(...removed.map(req => ({id: req.id, kind: 'removed', before: clone(req)})));
  return result;
}
export function validateResponse(input, doc) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw replyError('The reply must be one JSON object with a reply message and, when changes are suggested, a proposal.');
  const issues = Object.keys(input).filter(key => !['reply', 'proposal'].includes(key)).map(key => `“${key}” was ignored. Only the reply message and the proposal are read.`);
  let reply = typeof input.reply === 'string' ? input.reply.trim() : '';
  if (!reply) issues.push('The reply message is missing or empty.');
  else if (reply.length > 20000) { issues.push('The reply message is longer than 20,000 characters, so it was left out of the conversation.'); reply = ''; }
  const raw = input.proposal;
  let proposal = null;
  if (raw !== undefined && raw !== null) {
    if (typeof raw !== 'object' || Array.isArray(raw)) issues.push('The proposal was skipped because it is not an object with documentId, baseRevision and changes.');
    else {
      if (raw.documentId === undefined) throw replyError('The proposal does not say which PRD it is for. It needs documentId.');
      if (raw.documentId !== doc.id) throw replyError('This proposal belongs to a different document. Choose Copy for assistant for this PRD and use the new reply.', false);
      if (!Number.isInteger(raw.baseRevision)) throw replyError('The proposal does not say which version it is for. It needs baseRevision as a whole number, such as 3.');
      if (raw.baseRevision !== doc.revision) throw replyError(`This proposal is stale: it was prepared for v${raw.baseRevision}, but this PRD is now saved as v${doc.revision}. Choose Copy for assistant again to get suggestions for v${doc.revision}.`, false);
      const changes = {};
      let requirementChanges = [];
      if (!raw.changes || typeof raw.changes !== 'object' || Array.isArray(raw.changes)) issues.push('The proposal has no list of changes, so nothing can be applied.');
      else for (const [key, value] of Object.entries(raw.changes)) {
        if (key === 'requirements') requirementChanges = proposedRequirements(value, doc, issues);
        else if (!Object.hasOwn(fields, key)) issues.push(`“${key}” is not a PRD section, so it was skipped.`);
        else if (typeof value !== 'string') issues.push(`${fields[key][0]} was skipped because the suggested wording is not text.`);
        else if (value.length > 20000) issues.push(`${fields[key][0]} was skipped because it is longer than 20,000 characters.`);
        else if (value !== doc.sections[key]) changes[key] = value;
      }
      if (Object.keys(changes).length || requirementChanges.length) proposal = {documentId: doc.id, baseRevision: doc.revision, changes, requirementChanges};
    }
  }
  if (!reply && !proposal) {
    const error = replyError('Nothing in this reply can be used.');
    error.issues = issues;
    throw error;
  }
  return {reply, proposal, issues};
}
export function correctionRequest(problems, doc) {
  const shape = {reply: 'Explain the suggested change and ask the next useful question.', proposal: {documentId: doc.id, baseRevision: doc.revision, changes: {scope: 'Full replacement text for this section.'}}};
  return [
    'The PRD workspace could not use all of your last reply. Problems found:',
    ...problems.map(problem => `- ${problem}`),
    '',
    'Please answer again with only one JSON object in this shape and no other text:',
    JSON.stringify(shape, null, 2),
    '',
    `Section keys for changes: ${Object.entries(fields).map(([key, [label]]) => `${key} (${label})`).join(', ')}, requirements.`,
    `Each section value replaces the whole section. For requirements, send the complete list. Each requirement needs ${Object.entries(requirementLabels).map(([key, label]) => `${key} (${label})`).join(', ')}. Priority is Must or Nice to have; proposed is true or false. New requirements start at R-${String(nextRequirement(doc)).padStart(3, '0')}.`,
    'Leave out proposal if you are only answering or asking a question.',
  ].join('\n');
}
async function copyCorrection(problems, button) {
  const text = correctionRequest(problems, state.saved);
  try {
    await navigator.clipboard.writeText(text);
    message('Correction request copied. Paste it into your AI chat, then paste the new reply here.', {area: 'chat', kind: 'success'});
    if (button) { button.textContent = 'Copied ✓'; setTimeout(() => { button.textContent = 'Copy correction request'; }, 3000); }
  } catch {
    $('#packet-text').value = text;
    $('#packet-explanation').textContent = 'Your browser did not allow copying. Select all the text below, copy it, then paste it into your AI chat.';
    $('#packet-dialog').showModal();
    $('#packet-text').focus();
    $('#packet-text').select();
  }
}
function showReplyProblems(summary = '', issues = [], correctable = false) {
  const box = $('#response-error');
  box.replaceChildren();
  box.hidden = !summary;
  replyProblems = summary && correctable ? [summary, ...issues] : [];
  $('#copy-correction').hidden = !replyProblems.length;
  if (!summary) return;
  box.append(el('p', '', summary));
  if (issues.length) {
    const list = el('ul');
    for (const issue of issues) list.append(el('li', '', issue));
    box.append(list);
  }
}
async function readResponse() {
  showReplyProblems();
  if (!state.doc || state.doc.status === 'Archived') { showReplyProblems('Open a PRD that is not archived first.'); return; }
  let result;
  try { result = validateResponse(parseReply($('#response-json').value), state.saved); } catch (error) {
    showReplyProblems(error.message, error.issues, error.correctable);
    $('#response-json').focus();
    return;
  }
  if (result.reply) acceptChat(await api(`/api/prds/${encodeURIComponent(state.saved.id)}/chat`, 'POST', {expectedRevision: state.saved.revision, append: [{role: 'assistant', content: result.reply}]}));
  if (result.proposal) {
    state.proposal = {...result.proposal, issues: result.issues};
    state.proposalBaseline = clone(state.saved.sections);
    storeProposal();
    renderProposal();
  }
  $('#response-dialog').close();
  const correction = {label: 'Copy correction request', run: event => copyCorrection(result.issues, event.currentTarget)};
  if (result.proposal) {
    const count = proposalItems().length;
    message(`Reply added. Check the ${count} suggested change${count === 1 ? '' : 's'} before applying ${count === 1 ? 'it' : 'them'}.`, {area: 'chat', kind: 'success'});
    openProposalReview();
  } else if (result.issues.length) message(`Reply added, but some parts could not be used. ${result.issues.join(' ')}`, {area: 'chat', kind: 'error', action: correction});
  else message('Reply added. It suggests no changes to the PRD.', {area: 'chat', kind: 'success'});
}
function renderProposal() {
  const container = $('#proposal'); container.replaceChildren();
  container.hidden = !state.proposal;
  if (!state.proposal) return;
  const count = proposalItems().length;
  const review = el('button', 'button primary', 'Check suggested changes');
  review.type = 'button';
  review.addEventListener('click', openProposalReview);
  container.append(el('h3', '', 'Suggested changes waiting'), el('p', '', `${count} change${count === 1 ? '' : 's'} from the assistant for v${state.proposal.baseRevision}. The PRD does not change until you apply them.`), review);
  updateControls();
}
const proposalPrefix = id => `requiro-proposal:${id}:`;
function storedProposal(doc) {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(proposalPrefix(doc.id)) && key !== proposalPrefix(doc.id) + doc.revision) localStorage.removeItem(key);
    const value = JSON.parse(localStorage.getItem(proposalPrefix(doc.id) + doc.revision));
    return value?.documentId === doc.id && value.baseRevision === doc.revision && Array.isArray(value.requirementChanges) ? value : null;
  } catch { return null; }
}
function storeProposal() {
  try {
    const key = proposalPrefix(state.saved.id) + state.saved.revision;
    if (state.proposal) localStorage.setItem(key, JSON.stringify(state.proposal)); else localStorage.removeItem(key);
  } catch { /* Without browser storage, suggestions stay available until the page closes. */ }
}
function proposalItems() {
  if (!state.proposal) return [];
  return [
    ...Object.entries(state.proposal.changes).map(([key, after]) => ({ref: `section:${key}`, kind: 'section', key, title: fields[key][0], before: state.proposalBaseline[key], after})),
    ...state.proposal.requirementChanges.map(item => ({...item, ref: `requirement:${item.id}`, title: item.id})),
  ];
}
const proposalKinds = {section: 'Section', new: 'New requirement', changed: 'Changed requirement', removed: 'Removed requirement'};
const priorityText = req => `${req.priority}${req.proposed ? ' (not yet agreed)' : ''}`;
function comparison(before, after, cleared = 'Clears this section') {
  const wrap = el('div', 'proposal-compare');
  for (const [title, value, kind, empty] of [['Current', before, 'before', 'Empty'], ['Suggested', after, 'after', cleared]]) {
    const column = el('div', `proposal-text ${kind}`);
    column.append(el('span', 'proposal-text-label', title), el('p', value ? '' : 'proposal-empty', value || empty));
    wrap.append(column);
  }
  return wrap;
}
function requirementDetails(req) {
  const list = el('dl', 'proposal-details');
  for (const [label, value] of [['Requirement', req.behavior], ['Intended outcome', req.outcome], ['Use case', req.appliesTo], ['Acceptance criteria', req.acceptance], ['Priority', priorityText(req)]]) list.append(el('dt', '', label), el('dd', '', value || 'Not documented'));
  return list;
}
function openProposalReview() {
  if (!state.proposal) return;
  $('#proposal-intro').textContent = `Prepared for v${state.proposal.baseRevision}. Selected changes replace the current wording in your draft. Nothing is saved until you choose Save.`;
  const issues = state.proposal.issues || [];
  const box = $('#proposal-issues');
  box.replaceChildren();
  box.hidden = !issues.length;
  if (issues.length) {
    const list = el('ul');
    for (const issue of issues) list.append(el('li', '', issue));
    const copy = el('button', 'button small', 'Copy correction request');
    copy.type = 'button';
    copy.addEventListener('click', () => copyCorrection(issues, copy));
    box.append(el('h3', '', 'Parts of the reply that could not be used'), list, copy);
  }
  const review = $('#proposal-review');
  review.replaceChildren();
  for (const item of proposalItems()) {
    const row = el('section', `proposal-item ${item.kind}`);
    const label = el('label', 'proposal-choice');
    const checkbox = el('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item.kind !== 'removed';
    checkbox.dataset.proposalItem = item.ref;
    label.append(checkbox, el('span', 'proposal-name', item.title), el('span', `proposal-kind ${item.kind}`, proposalKinds[item.kind]));
    row.append(label);
    if (item.kind === 'section') row.append(comparison(item.before, item.after));
    else if (item.kind === 'new') row.append(requirementDetails(item.after));
    else if (item.kind === 'removed') row.append(el('p', 'proposal-note', 'Select this to remove the requirement from your draft.'), requirementDetails(item.before));
    else for (const [key, name] of [['behavior', 'Requirement'], ['outcome', 'Intended outcome'], ['appliesTo', 'Use case'], ['acceptance', 'Acceptance criteria'], ['priority', 'Priority']]) {
      const [before, after] = key === 'priority' ? [priorityText(item.before), priorityText(item.after)] : [item.before[key], item.after[key]];
      if (before !== after) row.append(el('p', 'proposal-field-label', name), comparison(before, after, 'Clears this field'));
    }
    review.append(row);
  }
  inlineError('#proposal-error');
  $('#proposal-dialog').showModal();
  review.querySelector('input')?.focus();
}
function applyProposal() {
  inlineError('#proposal-error');
  if (!state.proposal || !editable()) { inlineError('#proposal-error', 'Reopen the PRD if it is archived before applying changes.'); return; }
  if (state.proposal.documentId !== state.saved.id || state.proposal.baseRevision !== state.saved.revision) { inlineError('#proposal-error', `These suggestions were for v${state.proposal.baseRevision}, but this PRD is now saved as v${state.saved.revision}. Choose Copy for assistant again for fresh suggestions.`); return; }
  const selected = new Set([...$('#proposal-review').querySelectorAll('input[data-proposal-item]:checked')].map(node => node.dataset.proposalItem));
  const all = proposalItems();
  const items = all.filter(item => selected.has(item.ref));
  if (!items.length) { inlineError('#proposal-error', 'Select at least one change to apply.'); return; }
  const draft = state.doc.sections, baseline = state.proposalBaseline;
  const saved = (list, id) => JSON.stringify(list.find(req => req.id === id) ?? null);
  const edited = items.filter(item => item.kind === 'section' ? draft[item.key] !== baseline[item.key] : saved(draft.requirements, item.id) !== saved(baseline.requirements, item.id));
  if (edited.length) { inlineError('#proposal-error', `You changed ${edited.map(item => item.title).join(', ')} in your draft after this reply arrived. Unselect ${edited.length === 1 ? 'it' : 'them'}, or save your edits and choose Copy for assistant again. Your edits and these suggestions are kept.`); return; }
  for (const item of items) {
    if (item.kind === 'section') draft[item.key] = item.after;
    else if (item.kind === 'new') draft.requirements.push(clone(item.after));
    else if (item.kind === 'changed') draft.requirements = draft.requirements.map(req => req.id === item.id ? clone(item.after) : req);
    else draft.requirements = draft.requirements.filter(req => req.id !== item.id);
  }
  if (items.some(item => item.kind === 'new')) state.doc.nextRequirementNumber = Math.max(state.doc.nextRequirementNumber || 1, ...draft.requirements.map(req => Number(req.id.slice(2)) + 1));
  state.proposal = null;
  storeProposal();
  $('#proposal-dialog').close();
  renderEditor(); renderPreview(); renderProposal(); renderStageNav(); markDirty();
  const skipped = all.length - items.length;
  message(`Applied ${items.length} change${items.length === 1 ? '' : 's'} to your draft${skipped ? `; ${skipped} unselected suggestion${skipped === 1 ? ' was' : 's were'} discarded` : ''}. Check the wording, then save.`, {area: 'chat', kind: 'success'});
}
function dismissProposal() {
  state.proposal = null;
  storeProposal();
  $('#proposal-dialog').close();
  renderProposal();
  message('Suggestions discarded. The PRD did not change.', {area: 'chat', kind: 'success'});
}
function openClearChat() {
  if (!state.doc) return;
  const count = state.saved.chat?.length || 0;
  $('#clear-chat-description').textContent = `This removes ${count} message${count === 1 ? '' : 's'} from this PRD’s conversation. The PRD content, version (v${state.saved.revision}) and status stay the same.${state.proposal ? ' Suggested changes waiting for your check are kept.' : ''} To keep the messages, export the JSON first.`;
  inlineError('#clear-chat-error');
  $('#clear-chat-dialog').showModal();
}
async function clearChat() {
  acceptChat(await api(`/api/prds/${encodeURIComponent(state.saved.id)}/chat`, 'POST', {expectedRevision: state.saved.revision, clear: true}));
  $('#clear-chat-dialog').close();
  message('Conversation cleared. The PRD content, version and status did not change.', {area: 'chat', kind: 'success'});
  $('#chat-message').focus();
}
export function buildMarkdown(doc, useCasesContext) {
  if (!doc) return '';
  const sections = doc.sections;
  let result = `# ${doc.title}\n\nDocument ID: ${doc.id}\nStatus: ${statusLabel(doc.status)}\nVersion: ${typeof doc.revision === 'number' ? `v${doc.revision}` : doc.revision}\nLast approved version: ${doc.approvedRevision ? `v${doc.approvedRevision}` : 'None'}\n\n`;
  for (const key of ['problem', 'users', 'outcomes', 'useCases', 'scope', 'nonGoals', 'inputsOutputs']) result += `## ${fields[key][0]}\n\n${sections[key] || '_Not documented._'}\n\n`;
  result += '## Requirements\n\n';
  if (!sections.requirements.length) result += '_No requirements documented._\n\n';
  for (const req of sections.requirements) result += `### ${req.id} · ${priorityText(req)}\n\n${req.behavior}\n\nUse case: ${useCaseText(doc, req, useCasesContext)}\n\nIntended outcome: ${req.outcome}\n\nAcceptance criteria: ${req.acceptance}\n\n`;
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
  const result = await openConnections({doc: withDocument ? clone(state.saved) : null, docs: state.docs, api, hasUnsavedEdits: dirty()});
  if (result.doc) { acceptSaved(result.doc); message(`Imported requirements into new draft v${result.doc.revision}. Review their priorities and wording.`); }
  if (result.openDocumentId && await confirmLeave()) { acceptSaved(await api(`/api/prds/${encodeURIComponent(result.openDocumentId)}`)); offerRecovery(); }
  await refreshLibrary();
}
async function init() {
  trackDialogFocus();
  workspace = initWorkspaceControls();
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  $('#search').addEventListener('input', renderLibrary);
  $('#status-filter').addEventListener('change', renderLibrary);
  $('#project-filter').addEventListener('change', renderLibrary);
  $('#manage-projects').addEventListener('click', async () => { await run(() => manageConnections(false)); returnFocus($('#manage-projects')); });
  $('#connections-prd').addEventListener('click', async () => { await run(() => manageConnections(true)); returnFocus($('#connections-prd')); });
  $('#new-prd').addEventListener('click', openNew);
  $('#welcome-new').addEventListener('click', openNew);
  $('#new-form').addEventListener('submit', async event => {
    event.preventDefault();
    let created = false;
    await run(async () => {
      if (!(await confirmLeave())) return;
      const title = $('#new-title').value.trim();
      if (!title) throw new Error('Enter a title for this PRD.');
      const doc = await api('/api/prds', 'POST', {title});
      state.view = 'edit';
      acceptSaved(doc); $('#new-dialog').close(); message('Your PRD is ready. Start with the problem and who experiences it.');
      created = true;
    }, '#new-error');
    if (created) focusFirstEmpty();
  });
  $('#document-title').addEventListener('keydown', event => { if (event.key === 'Enter') event.preventDefault(); });
  $('#document-title').addEventListener('input', event => {
    if (event.target.value.includes('\n')) event.target.value = event.target.value.replace(/\s*\n\s*/g, ' ');
    state.doc.title = event.target.value; markDirty(); fitTitle();
  });
  window.addEventListener('resize', fitTitle);
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => fitTitle()).observe($('#document-title'));
  for (const name of ['focus', 'blur']) $('#document-title').addEventListener(name, fitTitle);
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
    if (!state.pendingAction) throw new Error('Choose the status change again.');
    if (state.pendingAction.action === 'approve' && approvalBlockers(state.doc).length) throw new Error('Resolve everything under “Blocks approval” first.');
    await performAction(state.pendingAction.action, state.pendingAction.revision);
    $('#action-dialog').close();
  }, '#action-error'));
  $('#lifecycle-action').addEventListener('click', () => {
    const step = lifecycleStep(state.doc);
    if (step?.action === 'review') run(() => performAction('review'));
    else if (step) openAction(step.action);
  });
  $('#undo-remove').addEventListener('click', undoRemove);
  $('#export-print').addEventListener('click', () => { $('#export-dialog').close(); window.print(); });
  $('#export-report').addEventListener('click', () => run(downloadDeliveryReport, '#export-error'));
  for (const id of ['#export-markdown', '#export-json']) $(id).addEventListener('click', event => exported(event.currentTarget.download));
  window.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key?.toLowerCase() !== 's' || !state.doc) return;
    event.preventDefault();
    if (!document.querySelector('dialog[open]') && editable() && dirty()) run(save);
  });
  window.addEventListener('pagehide', writeLocalDraft);
  $('#import-prd').addEventListener('click', () => {
    $('#import-file').value = ''; $('#import-json').value = ''; inlineError('#import-error'); $('#import-dialog').showModal(); $('#import-file').focus();
  });
  $('#import-file').addEventListener('change', () => run(async () => {
    const file = $('#import-file').files[0]; if (!file) return;
    if (file.size > 1_048_576) throw new Error('The selected JSON file is too large. The limit is 1 MiB.');
    $('#import-json').value = await file.text();
  }, '#import-error'));
  $('#confirm-import').addEventListener('click', () => run(async () => {
    if (!(await confirmLeave())) return;
    let doc; try { doc = JSON.parse($('#import-json').value); } catch { throw new Error('Paste or choose a valid Requiro JSON document.'); }
    const imported = await api('/api/import', 'POST', {doc});
    acceptSaved(imported); $('#import-dialog').close(); message('Imported as a separate draft. Existing documents were not changed.');
  }, '#import-error'));
  $('#demo-prd').addEventListener('click', () => run(async () => {
    if (!(await confirmLeave())) return;
    const example = await api('/api/example');
    const existing = state.docs.find(item => item.title === example.title && item.status !== 'Archived');
    if (existing) {
      const dialog = el('dialog', 'dialog compact-dialog'); dialog.setAttribute('aria-labelledby', 'example-choice-title');
      const heading = el('div', 'dialog-heading'); const title = el('h2', '', 'Open the fictional example?'); title.id = 'example-choice-title'; heading.append(title);
      const actions = el('div', 'dialog-actions');
      for (const [label, className, value] of [['Cancel', 'button', ''], ['Create another copy', 'button', 'copy'], ['Open existing example', 'button primary', 'open']]) {
        const button = el('button', className, label); button.type = 'button'; button.addEventListener('click', () => dialog.close(value)); actions.append(button);
      }
      dialog.append(heading, el('p', 'muted', `“${existing.title}” is already in your library (updated ${formatDate(existing.updatedAt)}). Open it, or create a separate copy.`), actions);
      document.body.append(dialog);
      const choice = await new Promise(resolve => { dialog.addEventListener('close', () => { dialog.remove(); resolve(dialog.returnValue); }, {once: true}); dialog.showModal(); });
      if (choice === 'open') { acceptSaved(await api(`/api/prds/${encodeURIComponent(existing.id)}`)); message('Opened the existing fictional example. No copy was created.'); offerRecovery(); return; }
      if (choice !== 'copy') return;
    }
    const doc = await api('/api/import', 'POST', {doc: example});
    acceptSaved(doc); message('Loaded a fictional example. Its assumptions, priorities, and open decisions are intentionally unresolved.');
  }));
  $('#welcome-example').addEventListener('click', () => $('#demo-prd').click());
  $('#use-starter').addEventListener('click', () => { $('#chat-message').value = starterQuestions[state.stage]; $('#chat-message').focus(); });
  $('#copy-packet').addEventListener('click', () => run(() => copyPacket().catch(error => message(error.message, {kind: 'error', area: 'chat'}))));
  $('#paste-response').addEventListener('click', () => { showReplyProblems(); $('#response-json').value = ''; $('#response-dialog').showModal(); $('#response-json').focus(); });
  $('#confirm-response').addEventListener('click', () => run(readResponse, '#response-error'));
  $('#copy-correction').addEventListener('click', event => copyCorrection(replyProblems, event.currentTarget));
  $('#apply-proposal').addEventListener('click', applyProposal);
  $('#dismiss-proposal').addEventListener('click', dismissProposal);
  $('#clear-chat').addEventListener('click', openClearChat);
  $('#confirm-clear-chat').addEventListener('click', () => run(clearChat, '#clear-chat-error'));
  $('#workspace').addEventListener('input', clearStaleMessages);
  $('#select-packet').addEventListener('click', () => { $('#packet-text').focus(); $('#packet-text').select(); });
  window.addEventListener('beforeprint', () => {
    // 2026-11-09: working changes must not inherit the saved revision's approval label.
    const printDoc = state.doc && dirty() ? {...state.doc, status: 'Unsaved draft (changes not approved)', revision: `Not saved (based on saved v${state.saved.revision})`} : state.doc;
    const printUseCases = state.useCasesContext && printDoc ? {...state.useCasesContext, prdRevision: printDoc.revision} : null;
    $('#print-document').textContent = printDoc ? buildMarkdown(printDoc, printUseCases) : 'No PRD is open.';
  });
  window.addEventListener('beforeunload', event => { if (dirty() || hasUnsentCompose()) { event.preventDefault(); event.returnValue = ''; } });
  updateControls();
  await run(refreshLibrary);
}
if (typeof document !== 'undefined') init();
