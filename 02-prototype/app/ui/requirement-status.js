const statuses = ['Complete', 'To discuss', 'Needs work'];
const label = status => status === 'Verified' ? 'Complete' : status;
const documented = value => typeof value === 'string' && !['', 'not documented', 'unknown', 'unresolved', 'tbd', 'tbc'].includes(value.trim().toLowerCase());
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function openRequirementStatus({doc, requirementId, api, consent}) {
  const requirement = doc.sections.requirements.find(item => item.id === requirementId);
  if (!requirement) throw new Error('This requirement is not in the current PRD. Reopen the saved document.');
  const base = `/api/prds/${encodeURIComponent(doc.id)}/verification`;
  const data = await api(base);
  if (data.documentId !== doc.id || data.prdRevision !== doc.revision) throw new Error('This PRD changed. Reopen it before changing a delivery status.');
  const item = Array.isArray(data.items) && data.items.find(value => value.requirementId === requirementId);
  if (!item) throw new Error('The requirement review is unavailable. Reopen the saved document.');
  const currentStatus = label(item.status);
  const dialog = el('dialog', 'dialog compact-dialog requirement-status-dialog');
  dialog.setAttribute('aria-labelledby', 'requirement-status-title');
  const heading = el('div', 'dialog-heading');
  const title = el('h2', '', 'Change delivery status'); title.id = 'requirement-status-title';
  const close = el('button', 'icon-button', '×'); close.setAttribute('aria-label', 'Close status chooser');
  heading.append(title, close);
  dialog.append(heading, el('p', 'muted', `${requirementId} · ${requirement.behavior || 'Requirement wording not documented'}`), el('p', 'small muted', `Current status: ${currentStatus} · saved PRD v${doc.revision}`));
  function field(name, id, tag, value, limit) {
    const caption = el('label', '', name); caption.htmlFor = id;
    const input = el(tag); input.id = id; input.value = value || '';
    if (limit) input.maxLength = limit;
    dialog.append(caption, input);
    return input;
  }
  const status = field('Delivery status', 'requirement-status-choice', 'select', '');
  const placeholder = el('option', '', 'Choose a status'); placeholder.value = ''; placeholder.disabled = true;
  status.append(placeholder);
  for (const value of statuses) { const option = el('option', '', value); option.value = value; status.append(option); }
  status.value = statuses.includes(currentStatus) ? currentStatus : '';
  const reviewer = field('Reviewer role', 'requirement-status-reviewer', 'input', item.reviewer, 200);
  const notes = field('Review notes or discussion question (optional)', 'requirement-status-notes', 'textarea', item.reviewNotes, 20000); notes.rows = 3;
  const hint = el('p', 'field-hint');
  const missing = el('p', 'completion-warning');
  const notice = el('p', 'inline-error'); notice.hidden = true; notice.setAttribute('role', 'alert');
  const actions = el('div', 'dialog-actions');
  const full = el('button', 'button', 'Open delivery review');
  const save = el('button', 'button primary', 'Save status');
  actions.append(full, save);
  dialog.append(hint, missing, notice, actions);
  document.body.append(dialog);
  let busy = false;
  let stale = false;
  let result = {};
  let finish;
  const closed = new Promise(resolve => { finish = resolve; });
  const initial = {status: status.value, reviewer: reviewer.value, notes: notes.value};
  const dirty = () => status.value !== initial.status || reviewer.value !== initial.reviewer || notes.value !== initial.notes;
  const allowDiscard = () => !dirty() || window.confirm('Discard unsaved status or review notes? The saved review and proof will remain.');
  const closeChooser = () => { if (!busy && allowDiscard()) dialog.close(); };
  function controls() {
    const gaps = [];
    if (!documented(requirement.behavior)) gaps.push('requirement');
    if (!documented(requirement.acceptance)) gaps.push('acceptance criteria');
    if (!Array.isArray(item.owners) || !item.owners.length || item.owners.some(owner => !documented(owner))) gaps.push('engineering owner');
    if (!documented(item.proof)) gaps.push('proof explanation');
    if (!documented(reviewer.value)) gaps.push('reviewer role');
    const canEdit = consent() && !busy && !stale;
    status.disabled = !canEdit;
    for (const input of [reviewer, notes]) { input.disabled = busy; input.readOnly = !consent() || stale; }
    close.disabled = busy;
    full.disabled = busy || stale;
    save.disabled = !canEdit || !statuses.includes(status.value) || status.value === 'Complete' && gaps.length > 0 || status.value === 'Needs work' && !documented(reviewer.value);
    missing.textContent = `To mark Complete, add: ${gaps.join(', ')}. Use Open delivery review to add owners or proof.`;
    missing.hidden = status.value !== 'Complete' || !gaps.length;
    hint.textContent = !consent() ? 'Tick the data-use confirmation before changing a status.' : 'Complete and Needs work require a reviewer role. To discuss can be saved before proof or a reviewer is recorded.';
  }
  for (const input of [status, reviewer, notes]) input.addEventListener(input === status ? 'change' : 'input', controls);
  save.addEventListener('click', async () => {
    if (busy || stale || !consent() || save.disabled) return;
    busy = true; notice.hidden = true; controls();
    try {
      const updated = await api(`${base}/${encodeURIComponent(requirementId)}/review`, 'POST', {expectedPrdRevision: doc.revision, expectedRevision: item.revision, status: status.value, reviewer: reviewer.value.trim(), notes: notes.value});
      if (updated?.requirementId !== requirementId) { stale = true; throw new Error('The server returned a review for another requirement. Copy your notes, then close and reopen the review.'); }
      result = {updated: true, status: label(updated.status || status.value)}; dialog.close();
    } catch (error) {
      stale = stale || error.status === 409;
      notice.textContent = error.status === 409 ? 'The PRD or review changed elsewhere. Your unsaved choices and notes are preserved. Copy your notes before closing, then reopen the current saved PRD.' : error.message;
      notice.hidden = false;
    } finally { busy = false; controls(); }
  });
  full.addEventListener('click', () => { if (!busy && !stale && allowDiscard()) { result = {fullReview: true}; dialog.close(); } });
  close.addEventListener('click', closeChooser);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeChooser(); });
  const beforeUnload = event => { if (dirty() || busy) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  dialog.addEventListener('close', () => { window.removeEventListener('beforeunload', beforeUnload); dialog.remove(); finish(result); }, {once: true});
  controls(); dialog.showModal(); (status.disabled ? reviewer : status).focus();
  return closed;
}
