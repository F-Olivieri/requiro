import {selectedRequirementAnchor} from './comments.js';
import {useCaseInfo} from './use-cases.js';

const selectionCleanups = new WeakMap();
const sections = [
  ['problem', 'The problem'], ['users', 'Who it is for'], ['outcomes', 'The intended outcome'],
  ['useCases', 'Use cases'], ['scope', 'In scope'], ['nonGoals', 'Out of scope'],
  ['inputsOutputs', 'Inputs and outputs'], ['requirements', 'Requirements'],
  ['quality', 'Quality and constraints'], ['metrics', 'Success measures'],
  ['risks', 'Risks and dependencies'], ['decisions', 'Open decisions'], ['evidence', 'Evidence and assumptions'],
];
const text = (value, empty = 'Not documented') => value?.trim() ? value : empty;
function el(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = value;
  return node;
}
function pair(list, label, value) {
  const node = el('dd', 'prd-view-text', value);
  list.append(el('dt', '', label), node);
  return node;
}
function badge(status, onClick, label) {
  const tone = status === 'Complete' ? 'complete' : ['To discuss', 'Needs work', 'Needs recheck'].includes(status) ? 'pending' : '';
  const node = el(onClick ? 'button' : 'span', `prd-view-status ${tone}`, status);
  if (onClick) { node.type = 'button'; node.setAttribute('aria-label', label); node.title = label; node.addEventListener('click', onClick); }
  return node;
}

export function renderPrdView(container, {doc, mode, verification = null, useCasesContext = null, savedRevision = doc.revision, onReview, onComment, onEditSection}) {
  if (!['document', 'table'].includes(mode)) throw new Error('Choose Document or Table view.');
  selectionCleanups.get(container)?.();
  const selectionButtons = [];
  let selectedAnchor = null;
  function markField(node, req, field) {
    if (req[field]?.trim()) {
      node.setAttribute('data-comment-requirement', req.id);
      node.setAttribute('data-comment-field', field);
    }
    return node;
  }
  function commentControls(req) {
    const actions = el('div', 'prd-comment-actions');
    const comments = el('button', 'text-button', 'Comments'); comments.type = 'button'; comments.setAttribute('aria-label', `Comments for ${req.id}`);
    comments.addEventListener('click', () => onComment({requirementId: req.id}));
    const selected = el('button', 'button prd-comment-selection', 'Comment on selected text'); selected.type = 'button';
    selected.setAttribute('aria-label', `Comment on selected text in ${req.id}`);
    selected.setAttribute('data-comment-selection', 'true'); selected.setAttribute('data-selection-valid', 'false');
    selected.hidden = true; selected.disabled = true;
    let pressedAnchor = null;
    selected.addEventListener('mousedown', event => { pressedAnchor = selectedAnchor; if (pressedAnchor) event.preventDefault(); });
    selected.addEventListener('click', () => {
      const chosen = pressedAnchor || selectedAnchor; pressedAnchor = null;
      if (!chosen || chosen.requirementId !== req.id) return;
      const valid = [...container.querySelectorAll('[data-comment-requirement][data-comment-field]')].some(node => node.getAttribute('data-comment-requirement') === req.id && node.getAttribute('data-comment-field') === chosen.anchor.field && node.textContent === chosen.anchor.sourceText);
      if (valid) onComment(chosen);
    });
    selectionButtons.push({button: selected, requirementId: req.id});
    actions.append(comments, selected); return actions;
  }
  const reviews = verification?.documentId === doc.id ? new Map(verification.items.map(item => [item.requirementId, item])) : null;
  const reviewFor = req => reviews?.get(req.id);
  const statusFor = req => {
    if (!reviews) return 'Review not loaded';
    const item = reviewFor(req);
    if (!item) return 'Not reviewed';
    if (['Verified', 'Complete'].includes(item.status)) {
      return savedRevision !== doc.revision || verification.prdRevision !== doc.revision ? 'Needs recheck' : 'Complete';
    }
    return item.status;
  };
  const statusControl = req => badge(statusFor(req), onReview ? () => onReview(req.id) : null, `Change review status for ${req.id}: ${statusFor(req)}`);
  const reviewButton = (req, compact = false) => {
    const action = savedRevision === null ? 'Save + change' : 'Change status';
    const label = `${action} ${req.id}`;
    let buttonText = label;
    if (compact) buttonText = savedRevision === null ? action : 'Change';
    const button = el('button', 'button prd-view-review', buttonText);
    button.setAttribute('aria-label', label);
    button.type = 'button';
    button.addEventListener('click', () => onReview(req.id, {saveDraft: savedRevision === null}));
    return button;
  };
  function requirementDetails(req) {
    const details = el('dl', 'prd-view-metadata');
    const useCase = useCaseInfo(doc, req, useCasesContext);
    const applies = pair(details, 'Use case', useCase.label);
    if (useCase.reference) {
      const reference = el('div', 'field-hint', 'Reference: ');
      reference.append(markField(el('span', '', req.appliesTo), req, 'appliesTo'));
      applies.append(reference);
    } else markField(applies, req, 'appliesTo');
    markField(pair(details, 'Intended outcome', text(req.outcome)), req, 'outcome');
    markField(pair(details, 'Acceptance criteria', text(req.acceptance)), req, 'acceptance');
    const item = reviewFor(req);
    pair(details, 'Engineering owners', item?.owners.length ? item.owners.join(', ') : reviews ? 'Not assigned' : 'Review not loaded');
    const status = el('dd'); status.append(statusControl(req));
    details.append(el('dt', '', 'Review status'), status);
    if (item) {
      pair(details, 'Proof explanation', text(item.proof));
      pair(details, 'Reviewer role', text(item.reviewer, 'Not recorded'));
      pair(details, 'Review date', item.reviewedAt || 'Not recorded');
      pair(details, 'Review notes or discussion question', text(item.reviewNotes, 'None recorded'));
      pair(details, 'Proof recorded for PRD revision', item.baselinePrdRevision == null ? 'Not recorded' : String(item.baselinePrdRevision));
      const attachments = el('dd', 'prd-view-attachments');
      for (const file of item.attachments) {
        const link = el('a', '', file.name);
        link.href = `/api/prds/${encodeURIComponent(doc.id)}/verification/${encodeURIComponent(req.id)}/attachments/${encodeURIComponent(file.id)}`;
        link.download = file.name;
        attachments.append(link);
      }
      if (!item.attachments.length) attachments.append(el('span', '', 'None attached'));
      details.append(el('dt', '', 'Proof attachments'), attachments);
    }
    return details;
  }
  function narrativeSection(key, label) {
    const section = el('section', 'prd-view-section');
    const heading = el('h3', 'prd-view-section-heading', label);
    if (onEditSection) {
      const edit = el('button', 'text-button prd-view-edit', 'Edit');
      edit.type = 'button';
      edit.setAttribute('aria-label', `Edit ${label.toLowerCase()}`);
      edit.setAttribute('data-edit-section', key);
      edit.addEventListener('click', () => onEditSection(key));
      heading.append(edit);
    }
    section.append(heading, el('p', 'prd-view-text', text(doc.sections[key])));
    return section;
  }
  const view = el('article', `prd-view prd-view-${mode}`);
  view.setAttribute('aria-label', `${mode === 'document' ? 'Document' : 'Table'} view of ${doc.title || 'Untitled PRD'}`);
  view.append(el('h2', 'prd-view-title', doc.title || 'Untitled PRD'));
  view.append(el('p', 'prd-view-identity', `${doc.id} · ${doc.status} · revision ${doc.revision}${savedRevision === null ? ' · unsaved draft' : ''}`));
  view.append(el('p', 'prd-view-identity', `Last approved revision: ${doc.approvedRevision ?? 'None'}`));
  if (mode === 'document') {
    for (const [key, label] of sections) {
      if (key !== 'requirements') { view.append(narrativeSection(key, label)); continue; }
      const requirements = el('section', 'prd-view-section');
      requirements.append(el('h3', '', label));
      if (!doc.sections.requirements.length) requirements.append(el('p', 'prd-view-text', 'No requirements documented.'));
      for (const req of doc.sections.requirements) {
        const card = el('section', 'prd-view-requirement');
        const heading = el('div', 'prd-view-requirement-heading');
        heading.append(el('h4', '', `${req.id} · ${req.priority}${req.proposed ? ' (proposed)' : ''}`), statusControl(req));
        card.append(heading, markField(el('p', 'prd-view-text prd-view-behavior', text(req.behavior)), req, 'behavior'), requirementDetails(req));
        if (onReview) card.append(reviewButton(req));
        if (onComment) card.append(commentControls(req));
        requirements.append(card);
      }
      view.append(requirements);
    }
  } else {
    const scroll = el('div', 'prd-view-table-wrap');
    const table = el('table', 'prd-view-table');
    table.append(el('caption', '', 'Requirements'));
    const head = el('thead'); const header = el('tr');
    for (const label of ['ID', 'Requirement', 'Priority', 'Engineering owners', 'Review status', ...(onReview || onComment ? ['Action'] : [])]) {
      const cell = el('th', '', label); cell.scope = 'col'; header.append(cell);
    }
    head.append(header); table.append(head);
    const body = el('tbody');
    for (const req of doc.sections.requirements) {
      const row = el('tr');
      const id = el('th', '', req.id); id.scope = 'row'; row.append(id);
      const requirement = el('td');
      requirement.append(markField(el('p', 'prd-view-text prd-view-table-behavior', text(req.behavior)), req, 'behavior'));
      const detail = el('details', 'prd-view-row-details');
      detail.append(el('summary', '', `Details and proof for ${req.id}`), markField(el('p', 'prd-view-text prd-view-behavior', text(req.behavior)), req, 'behavior'), requirementDetails(req));
      requirement.append(detail); row.append(requirement);
      const owners = reviewFor(req)?.owners;
      row.append(el('td', '', `${req.priority}${req.proposed ? ' (proposed)' : ''}`), el('td', 'prd-view-text', owners?.length ? owners.join(', ') : reviews ? 'Not assigned' : 'Review not loaded'));
      const status = el('td'); status.append(statusControl(req)); row.append(status);
      if (onReview || onComment) {
        const action = el('td');
        if (onReview) action.append(reviewButton(req, true));
        if (onComment) action.append(commentControls(req));
        row.append(action);
      }
      body.append(row);
    }
    table.append(body); scroll.append(table); view.append(scroll);
    if (!doc.sections.requirements.length) view.append(el('p', 'prd-view-text', 'No requirements documented.'));
    const context = el('details', 'prd-view-context'); context.append(el('summary', '', 'Other PRD sections'));
    for (const [key, label] of sections) if (key !== 'requirements') context.append(narrativeSection(key, label));
    view.append(context);
  }
  container.replaceChildren(view);
  if (onComment) {
    const owner = container.ownerDocument || document;
    const updateSelection = () => {
      const found = selectedRequirementAnchor(container, owner.getSelection?.());
      if (!found && selectedAnchor && selectionButtons.some(({button}) => owner.activeElement === button)) return;
      selectedAnchor = found;
      for (const {button, requirementId} of selectionButtons) {
        const valid = found?.requirementId === requirementId;
        button.hidden = !valid; button.disabled = !valid; button.setAttribute('data-selection-valid', String(valid));
      }
    };
    owner.addEventListener?.('selectionchange', updateSelection);
    selectionCleanups.set(container, () => owner.removeEventListener?.('selectionchange', updateSelection));
    updateSelection();
  }
}
