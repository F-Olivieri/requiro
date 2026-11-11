import {formatDateTime} from './format.js';

const statuses = ['Not reviewed', 'To discuss', 'Needs work', 'Needs recheck', 'Verified'];
const statusLabel = status => status === 'Verified' ? 'Complete' : status;
const statusClass = status => ({Verified: 'verified', 'To discuss': 'to-discuss', 'Needs work': 'needs-work', 'Needs recheck': 'needs-recheck'}[status] || 'not-reviewed');
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const ownersFrom = text => [...new Set(text.split(',').map(value => value.trim()).filter(Boolean))];
const documentedText = text => !['', 'not documented', 'unknown', 'unresolved', 'tbd', 'tbc'].includes(text.trim().toLowerCase());

export async function openCompletion({doc, api, consent, requirementId}) {
  const base = `/api/prds/${encodeURIComponent(doc.id)}`;
  const data = await api(`${base}/verification`);
  if (data.documentId !== doc.id || data.prdRevision !== doc.revision) throw new Error('This PRD changed. Reopen it before opening Delivery review.');
  const rows = new Map(data.items.map(row => [row.requirementId, row]));
  if (doc.sections.requirements.some(req => !rows.has(req.id))) throw new Error('Delivery review records are incomplete. Open Delivery review again to retry.');
  const dialog = el('dialog', 'dialog completion-dialog');
  dialog.setAttribute('aria-labelledby', 'completion-title');
  const heading = el('div', 'dialog-heading');
  const title = el('h2', '', 'Delivery review'); title.id = 'completion-title';
  const close = el('button', 'icon-button', '×'); close.setAttribute('aria-label', 'Close delivery review');
  heading.append(title, close);
  const identity = el('p', 'completion-identity', `${doc.title || 'Untitled PRD'} · saved v${doc.revision}`);
  const explanation = el('p', 'muted', 'Complete means the team confirms the acceptance criteria are met. To discuss flags an open question or decision and counts as pending. Requiro does not run your tests.');
  const summary = el('div', 'completion-summary');
  summary.setAttribute('aria-live', 'polite');
  const layout = el('div', 'completion-layout');
  const list = el('nav', 'completion-list'); list.setAttribute('aria-label', 'Requirements to verify');
  const detail = el('section', 'completion-detail'); detail.setAttribute('aria-label', 'Requirement evidence and team verdict');
  layout.append(list, detail);
  const notice = el('p', 'inline-error'); notice.hidden = true; notice.setAttribute('role', 'alert');
  const done = el('p', 'completion-saved'); done.hidden = true; done.setAttribute('role', 'status');
  const footer = el('div', 'completion-footer');
  const report = el('a', 'button', 'Download delivery report with proofs');
  report.href = `${base}/completion-report`; report.download = '';
  footer.append(el('p', 'muted small', 'ZIP: saved Markdown report and original proof attachments.'), report);
  dialog.append(heading, identity, explanation, summary, layout, notice, done, footer);
  document.body.append(dialog);
  let selected = doc.sections.requirements.find(req => req.id === requirementId)?.id ?? doc.sections.requirements[0]?.id;
  let inputs = null;
  let busy = false;
  let stale = false;
  let finish;
  const closed = new Promise(resolve => { finish = resolve; });
  const row = () => rows.get(selected);
  const evidenceDirty = () => Boolean(inputs && (JSON.stringify(ownersFrom(inputs.owners.value)) !== JSON.stringify(row().owners) || inputs.proof.value !== row().proof));
  const verdictDirty = () => Boolean(inputs && (inputs.reviewer.value !== row().reviewer || inputs.notes.value !== row().reviewNotes));
  const dirty = () => evidenceDirty() || verdictDirty();
  let doneTimer = null;
  const message = text => { notice.textContent = text; notice.hidden = !text; done.hidden = true; clearTimeout(doneTimer); };
  const confirmSaved = text => { done.textContent = text; done.hidden = false; clearTimeout(doneTimer); doneTimer = setTimeout(() => { done.hidden = true; }, 5000); };
  const allowDiscard = () => !dirty() || window.confirm('Discard unsaved owners, proof, or reviewer notes for this requirement? Saved reviews and attachments will remain.');
  const closeReview = () => { if (!busy && allowDiscard()) dialog.close(); };
  const endpoint = () => `${base}/verification/${encodeURIComponent(selected)}`;
  const expected = () => ({expectedPrdRevision: doc.revision, expectedRevision: row().revision});

  function controls() {
    close.disabled = busy;
    for (const button of list.querySelectorAll('button')) button.disabled = busy;
    report.setAttribute('aria-disabled', String(busy || stale));
    if (!inputs) return;
    const canEdit = consent() && !busy && !stale;
    const req = doc.sections.requirements.find(item => item.id === selected);
    for (const input of [inputs.owners, inputs.proof, inputs.reviewer, inputs.notes]) {
      input.disabled = busy;
      input.readOnly = !consent() || stale;
    }
    inputs.save.disabled = !canEdit || !evidenceDirty();
    inputs.file.disabled = !canEdit || evidenceDirty();
    inputs.verified.disabled = !canEdit || evidenceDirty() || !row().owners.length || !documentedText(row().proof) || !documentedText(inputs.reviewer.value) || !documentedText(req.behavior) || !documentedText(req.acceptance);
    inputs.needsWork.disabled = !canEdit || evidenceDirty() || !documentedText(inputs.reviewer.value);
    inputs.toDiscuss.disabled = !canEdit || evidenceDirty();
    const missing = [];
    if (!documentedText(req.behavior)) missing.push('requirement');
    if (!documentedText(req.acceptance)) missing.push('acceptance criteria');
    if (!ownersFrom(inputs.owners.value).length) missing.push('engineering owner');
    if (!documentedText(inputs.proof.value)) missing.push('proof explanation');
    if (!documentedText(inputs.reviewer.value)) missing.push('reviewer role');
    inputs.missing.textContent = `To mark complete, add: ${missing.join(', ')}.`;
    inputs.missing.hidden = !missing.length;
    inputs.saveHint.textContent = !consent() ? 'Close Delivery review and tick the data-use confirmation to edit or upload.' : stale ? 'A newer saved record exists. Your unsaved text is still here. Close and reopen Delivery review to load it.' : evidenceDirty() ? 'Save owners and proof before uploading or changing the delivery status.' : 'Changing owners, proof or attachments turns Complete or Needs work into Needs recheck. To discuss stays until you change it.';
  }
  function renderOverview() {
    const counts = Object.fromEntries(statuses.map(status => [status, 0]));
    for (const value of rows.values()) counts[value.status]++;
    const total = doc.sections.requirements.length;
    summary.replaceChildren();
    const progressText = el('p', 'completion-progress-text', `${counts.Verified} of ${total} complete · ${total - counts.Verified} pending`);
    const progress = el('progress'); progress.max = total || 1; progress.value = counts.Verified; progress.setAttribute('aria-label', `${counts.Verified} of ${total} requirements complete`);
    const countsNode = el('div', 'completion-counts');
    for (const status of statuses) countsNode.append(el('span', `completion-badge ${statusClass(status)}`, `${counts[status]} ${statusLabel(status).toLowerCase()}`));
    summary.append(progressText, progress, countsNode);
    list.replaceChildren();
    for (const req of doc.sections.requirements) {
      const value = rows.get(req.id);
      const button = el('button', `completion-item${req.id === selected ? ' active' : ''}`);
      if (req.id === selected) button.setAttribute('aria-current', 'true');
      button.append(el('strong', '', req.id), el('span', 'completion-item-behavior', req.behavior || 'Requirement text not documented'), el('span', `completion-badge ${statusClass(value.status)}`, statusLabel(value.status)));
      button.addEventListener('click', () => {
        if (req.id === selected || !allowDiscard()) return;
        selected = req.id; message(''); renderOverview(); renderDetail();
      });
      list.append(button);
    }
  }
  function field(labelText, id, tag, value, placeholder = '') {
    const group = el('div', 'completion-field');
    const label = el('label', '', labelText); label.htmlFor = id;
    const input = el(tag); input.id = id; input.value = value || ''; input.placeholder = placeholder;
    input.maxLength = tag === 'textarea' ? 20000 : 1000;
    if (tag === 'textarea') input.rows = 3;
    input.addEventListener('input', controls);
    group.append(label, input);
    return {group, input};
  }
  function renderDetail(preserveVerdict = false) {
    const draft = preserveVerdict && inputs ? {reviewer: inputs.reviewer.value, notes: inputs.notes.value} : null;
    detail.replaceChildren(); inputs = null;
    if (!selected) { detail.append(el('p', 'muted', 'Add requirements to the PRD before reviewing delivery.')); controls(); return; }
    const req = doc.sections.requirements.find(item => item.id === selected);
    const value = row();
    const top = el('div', 'completion-detail-heading');
    top.append(el('h3', '', `${req.id} · ${req.priority}`), el('span', `completion-badge ${statusClass(value.status)}`, statusLabel(value.status)));
    detail.append(top, el('h4', '', 'Requirement'), el('p', 'completion-text', req.behavior || 'Not documented'), el('h4', '', 'Acceptance criteria'), el('p', 'completion-text', req.acceptance || 'Not documented'));
    if (value.status === 'Needs recheck') detail.append(el('p', 'completion-warning', value.requirementChanged ? `This requirement changed after its evidence was recorded (PRD v${value.baselinePrdRevision} → v${doc.revision}). Recheck it against the current requirement.` : 'This requirement or its evidence changed after the last review. Review it again.'));
    const missing = el('p', 'completion-warning'); detail.append(missing);
    const owners = field('Engineering owners (role labels, separated by commas)', 'completion-owners', 'input', value.owners.join(', '), 'Frontend engineer, Test engineer');
    const proof = field('Proof explanation', 'completion-proof', 'textarea', value.proof, 'Explain how the acceptance criteria were checked and what the proof shows.');
    const save = el('button', 'button', 'Save owners and proof');
    const saveHint = el('p', 'field-hint');
    const attachments = el('div', 'completion-attachments');
    attachments.append(el('h4', '', `Proof attachments (${value.attachments.length})`));
    if (!value.attachments.length) attachments.append(el('p', 'muted small', 'No attachments yet.'));
    const files = el('ul');
    for (const attachment of value.attachments) {
      const item = el('li');
      const link = el('a', '', attachment.name);
      link.href = `${endpoint()}/attachments/${encodeURIComponent(attachment.id)}`;
      link.download = attachment.name;
      item.append(link, el('span', 'muted small', ` · ${Math.ceil(attachment.size / 1024)} KB`)); files.append(item);
    }
    attachments.append(files);
    const uploadLabel = el('label', '', 'Attach proof (up to 25 MiB per file)'); uploadLabel.htmlFor = 'completion-file';
    const file = el('input'); file.id = 'completion-file'; file.type = 'file';
    attachments.append(uploadLabel, file);
    const reviewHeading = el('h4', 'completion-review-heading', 'Delivery status');
    const reviewer = field('Reviewer role', 'completion-reviewer', 'input', draft?.reviewer ?? value.reviewer, 'Test engineer');
    const notes = field('Review notes or discussion question (optional)', 'completion-notes', 'textarea', draft?.notes ?? value.reviewNotes, 'Record what needs discussion, the team’s decision or remaining work.');
    const actions = el('div', 'review-actions');
    const verified = el('button', 'button primary', 'Mark complete');
    const toDiscuss = el('button', 'button', 'To discuss');
    const needsWork = el('button', 'button', 'Needs work');
    actions.append(verified, toDiscuss, needsWork);
    const reviewed = formatDateTime(value.reviewedAt);
    detail.append(owners.group, proof.group, save, saveHint, attachments, reviewHeading, el('p', 'field-hint', 'Mark complete after reviewing the proof. To discuss can be selected before proof or a reviewer is recorded.'), reviewer.group, notes.group, actions);
    if (reviewed) detail.append(el('p', 'field-hint', `Last recorded review: ${value.reviewer || 'role not documented'} · ${reviewed}. Previous evidence is retained when a recheck is required.`));
    const history = el('details', 'completion-history');
    history.append(el('summary', '', 'Previous reviews'));
    const historyContent = el('div'); history.append(historyContent); detail.append(history);
    const historyEndpoint = `${endpoint()}/history`;
    let historyLoaded = false;
    history.addEventListener('toggle', async () => {
      if (!history.open || historyLoaded) return;
      historyLoaded = true; historyContent.replaceChildren(el('p', 'muted small', 'Loading saved reviews…'));
      try {
        const result = await api(historyEndpoint);
        const items = Array.isArray(result) ? result : result.items;
        historyContent.replaceChildren();
        if (!items.length) historyContent.append(el('p', 'muted small', 'No previous reviews yet.'));
        for (const previous of items) {
          const entry = el('div', 'completion-history-entry');
          entry.append(el('p', '', `${statusLabel(previous.status)} · review record ${previous.revision} · PRD v${previous.baselinePrdRevision}`));
          entry.append(el('p', 'muted small', `${previous.reviewer || 'No reviewer'}${previous.reviewedAt ? ` · ${formatDateTime(previous.reviewedAt)}` : ''}`));
          entry.append(el('p', 'small', `Owners: ${previous.owners.join(', ') || 'Not documented'}`), el('p', 'completion-text', previous.proof || 'Proof not documented'));
          if (previous.reviewNotes) entry.append(el('p', 'completion-text', previous.reviewNotes));
          historyContent.append(entry);
        }
      } catch (error) { historyLoaded = false; historyContent.replaceChildren(el('p', 'completion-warning', error.message)); }
    });
    inputs = {owners: owners.input, proof: proof.input, reviewer: reviewer.input, notes: notes.input, save, saveHint, file, verified, toDiscuss, needsWork, missing};
    save.addEventListener('click', () => mutate(async () => api(endpoint(), 'PUT', {...expected(), owners: ownersFrom(inputs.owners.value), proof: inputs.proof.value}), true, saved => `Saved owners and proof for ${saved.requirementId}.`));
    const review = status => mutate(async () => api(`${endpoint()}/review`, 'POST', {...expected(), status, reviewer: inputs.reviewer.value.trim(), notes: inputs.notes.value}), false, saved => `${saved.requirementId} marked ${statusLabel(saved.status)}.`);
    verified.addEventListener('click', () => review('Complete'));
    toDiscuss.addEventListener('click', () => review('To discuss'));
    needsWork.addEventListener('click', () => review('Needs work'));
    file.addEventListener('change', () => {
      const attachment = file.files[0]; if (!attachment) return;
      if (attachment.size > 25 * 1024 * 1024) { message('This attachment exceeds 25 MiB. Choose a smaller file.'); file.value = ''; return; }
      mutate(async () => {
        const response = await fetch(`${endpoint()}/attachments`, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(attachment.name), 'X-Expected-Prd-Revision': String(doc.revision), 'X-Expected-Revision': String(row().revision)}, body: attachment});
        const result = await response.json();
        if (!response.ok) { const error = new Error(result.error || 'The attachment could not be saved.'); error.status = response.status; throw error; }
        return result;
      }, true, saved => `Attached ${attachment.name} to ${saved.requirementId}.`);
    });
    controls();
  }
  async function mutate(task, preserveVerdict = false, success = null) {
    if (busy || stale || !consent()) return;
    busy = true; message(''); controls();
    try {
      const result = await task();
      if (result.requirementId !== selected) throw new Error('The server returned a review for another requirement. Reopen the review.');
      rows.set(selected, result); renderOverview(); renderDetail(preserveVerdict);
      if (success) confirmSaved(success(result));
    } catch (error) {
      stale = error.status === 409;
      if (inputs) inputs.file.value = '';
      message(stale ? 'The PRD or review changed elsewhere. Your unsaved text is preserved. Copy it before closing, then reopen the current saved PRD to review again.' : error.message);
    } finally { busy = false; controls(); }
  }
  report.addEventListener('click', async event => {
    event.preventDefault();
    if (busy || stale) return;
    if (dirty()) { message('Save owners and proof and record or discard reviewer notes before downloading. The report uses saved reviews only.'); return; }
    busy = true; message(''); controls();
    try {
      const current = await api(`${base}/verification`);
      if (current.documentId !== doc.id || current.prdRevision !== doc.revision) {
        stale = true;
        throw new Error('This PRD changed. Close Delivery review and reopen the PRD before downloading the report.');
      }
      const download = el('a'); download.href = report.href; download.download = ''; document.body.append(download); download.click(); download.remove();
    } catch (error) { message(error.message); }
    finally { busy = false; controls(); }
  });
  close.addEventListener('click', closeReview);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeReview(); });
  const beforeUnload = event => { if (dirty() || busy) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  dialog.addEventListener('close', () => { clearTimeout(doneTimer); window.removeEventListener('beforeunload', beforeUnload); dialog.remove(); finish(); }, {once: true});
  renderOverview(); renderDetail(); dialog.showModal();
  (inputs?.owners || close).focus();
  await closed;
}
