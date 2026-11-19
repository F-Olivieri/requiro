import {selectedRequirementAnchor} from './comments.js';
import {useCaseInfo} from './use-cases.js';
import {formatDateTime} from './format.js';
import {appendRequirementText} from './requirement-links.js';

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

const priorityText = req => `${req.priority}${req.proposed ? ' (not yet agreed)' : ''}`;
export function renderPrdView(container, {doc, mode, verification = null, useCasesContext = null, savedRevision = doc.revision, savedDoc = null, commentCounts = null, commentThreads = [], linksSnapshot = null, onOpenRequirement, onConnections, onProof, onReview, onComment, onEditSection}) {
  if (!['document', 'table'].includes(mode)) throw new Error('Choose Document or Table view.');
  selectionCleanups.get(container)?.();
  const selectionButtons = [];
  let selectedAnchor = null;
  function markField(node, req, field) {
    if (req[field]?.trim()) {
      const content = el('span');
      content.setAttribute('data-comment-requirement', req.id);
      content.setAttribute('data-comment-field', field);
      appendRequirementText(content, req[field], {doc, field, snapshot: linksSnapshot, onOpenRequirement});
      const threads = commentThreads.filter(thread => thread.requirementId === req.id && thread.status === 'Open' && thread.anchorCurrent !== false && thread.anchor.field === field && thread.anchor.sourceText === req[field]);
      highlightCommentRanges(content, threads.map(thread => thread.anchor));
      node.replaceChildren(content);
      if (onComment) for (const thread of threads) {
        const icon = el('button', 'text-button prd-comment-marker', '💬'); icon.type = 'button';
        icon.setAttribute('aria-label', `Open comment on ${req.id}: ${thread.anchor.quote}`);
        icon.setAttribute('data-focus-key', `thread:${thread.id}`);
        icon.title = thread.anchor.quote;
        icon.addEventListener('click', () => onComment({requirementId: req.id, browse: true, threadId: thread.id}));
        node.append(icon);
      }
    }
    return node;
  }
  function extraActions(req) {
    const actions = el('div', 'prd-requirement-tools');
    for (const [label, callback, key] of [['Edit proof', onProof, 'proof'], ['Links & graph', onConnections, 'links']]) if (callback) {
      const button = el('button', 'text-button', label); button.type = 'button';
      button.setAttribute('aria-label', `${label} for ${req.id}`); button.setAttribute('data-focus-key', `${key}:${req.id}`);
      button.addEventListener('click', () => callback(req.id)); actions.append(button);
    }
    return actions;
  }
  function commentControls(req) {
    const actions = el('div', 'prd-comment-actions');
    const open = commentCounts?.[req.id] || 0;
    const wording = ['behavior', 'acceptance', 'outcome', 'appliesTo'].find(field => req[field]?.trim());
    const start = el('button', 'button prd-comment-start', open ? `Comments (${open})` : 'Comment'); start.type = 'button';
    start.setAttribute('aria-label', open ? `Comments for ${req.id}, ${open} open` : `Comment on ${req.id} wording`); start.setAttribute('data-focus-key', `comment:${req.id}`); start.hidden = !wording && !open;
    start.addEventListener('click', () => {
      if (!wording && !open) return;
      onComment({requirementId: req.id, ...(wording && {anchor: {field: wording, start: 0, end: req[wording].length, quote: req[wording], sourceText: req[wording]}}), ...(open && {browse: true})});
    });
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
    actions.append(start, selected); return actions;
  }
  const reviews = verification?.documentId === doc.id ? new Map(verification.items.map(item => [item.requirementId, item])) : null;
  const reviewFor = req => reviews?.get(req.id);
  const statusFor = req => {
    if (!reviews) return 'Delivery review not loaded';
    const item = reviewFor(req);
    if (!item) return 'Not reviewed';
    if (['Verified', 'Complete'].includes(item.status)) {
      if (verification.prdRevision !== doc.revision) return 'Needs recheck';
      const saved = savedDoc?.id === doc.id && savedDoc.revision === doc.revision && savedDoc.sections.useCases === doc.sections.useCases && savedDoc.sections.requirements.find(value => value.id === req.id);
      return savedRevision === doc.revision || saved && ['behavior', 'acceptance', 'appliesTo', 'outcome'].every(key => saved[key] === req[key]) ? 'Complete' : 'Needs recheck';
    }
    return item.status;
  };
  const statusControl = (req, place = 'status') => {
    const node = badge(statusFor(req), onReview ? () => onReview(req.id) : null, `Change delivery status for ${req.id}: ${statusFor(req)}`);
    if (onReview) node.setAttribute('data-focus-key', `${place}:${req.id}`);
    return node;
  };
  const reviewButton = (req, compact = false) => {
    const action = savedRevision === null ? 'Save + change' : 'Change status';
    const label = `${action} ${req.id}`;
    let buttonText = label;
    if (compact) buttonText = savedRevision === null ? action : 'Change';
    const button = el('button', 'button prd-view-review', buttonText);
    button.setAttribute('aria-label', label); button.setAttribute('data-focus-key', `review:${req.id}`);
    button.type = 'button';
    button.addEventListener('click', () => onReview(req.id, {saveDraft: savedRevision === null}));
    return button;
  };
  function requirementDetails(req, {owners = true} = {}) {
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
    const missing = [];
    if (owners && reviews) {
      if (item?.owners.length) pair(details, 'Engineering owners', item.owners.join(', '));
      else missing.push('engineering owners');
    }
    if (item) {
      for (const [label, value, name] of [['Proof explanation', item.proof?.trim() && item.proof, 'proof'], ['Reviewer role', item.reviewer?.trim() && item.reviewer, 'reviewer role'], ['Review date', formatDateTime(item.reviewedAt), 'review date'],
        ['Review notes or discussion question', item.reviewNotes?.trim() && item.reviewNotes, 'review notes'], ['Proof recorded for PRD version', item.baselinePrdRevision == null ? '' : `v${item.baselinePrdRevision}`, 'proof version']]) {
        if (value) pair(details, label, value);
        else missing.push(name);
      }
      if (item.attachments.length) {
        const attachments = el('dd', 'prd-view-attachments');
        for (const file of item.attachments) {
          const link = el('a', '', file.name);
          link.href = `/api/prds/${encodeURIComponent(doc.id)}/verification/${encodeURIComponent(req.id)}/attachments/${encodeURIComponent(file.id)}`;
          link.download = file.name;
          attachments.append(link);
        }
        details.append(el('dt', '', 'Proof attachments'), attachments);
      } else missing.push('attachments');
    }
    if (missing.length) details.append(el('dt', '', 'Not recorded'), el('dd', 'prd-view-missing', missing.join(', ')));
    return details;
  }
  function narrativeSection(key, label) {
    const section = el('section', 'prd-view-section');
    const heading = el('h3', 'prd-view-section-heading', label);
    if (onEditSection) {
      const edit = el('button', 'text-button prd-view-edit', 'Edit');
      edit.type = 'button';
      edit.setAttribute('aria-label', `Edit ${label.toLowerCase()}`);
      edit.setAttribute('data-edit-section', key); edit.setAttribute('data-focus-key', `edit:${key}`);
      if (doc.status === 'Archived') { edit.setAttribute('aria-disabled', 'true'); edit.title = 'Reopen this PRD to edit it'; }
      edit.addEventListener('click', () => onEditSection(key));
      heading.append(edit);
    }
    section.append(heading, el('p', 'prd-view-text', text(doc.sections[key])));
    return section;
  }
  const view = el('article', `prd-view prd-view-${mode}`);
  view.setAttribute('aria-label', `${mode === 'document' ? 'Document' : 'Table'} view of ${doc.title || 'Untitled PRD'}`);
  view.append(el('h2', 'prd-view-title', doc.title || 'Untitled PRD'));
  view.append(el('p', 'prd-view-identity', `${doc.id} · ${doc.status === 'In review' ? 'Awaiting approval' : doc.status} · v${doc.revision}${savedRevision === null ? ' · unsaved draft' : ''}`));
  view.append(el('p', 'prd-view-identity', `Last approved version: ${doc.approvedRevision ? `v${doc.approvedRevision}` : 'None'}`));
  if (mode === 'document') {
    for (const [key, label] of sections) {
      if (key !== 'requirements') { view.append(narrativeSection(key, label)); continue; }
      const requirements = el('section', 'prd-view-section');
      requirements.append(el('h3', '', label));
      if (!doc.sections.requirements.length) requirements.append(el('p', 'prd-view-text', 'No requirements documented.'));
      for (const req of doc.sections.requirements) {
        const card = el('section', 'prd-view-requirement');
        card.setAttribute('data-requirement-id', req.id); card.setAttribute('data-focus-key', `requirement:${req.id}`); card.tabIndex = -1;
        const heading = el('div', 'prd-view-requirement-heading');
        heading.append(el('h4', '', `${req.id} · ${priorityText(req)}`), statusControl(req));
        card.append(heading, markField(el('p', 'prd-view-text prd-view-behavior', text(req.behavior)), req, 'behavior'), requirementDetails(req));
        if (onReview) card.append(reviewButton(req));
        if (onComment) card.append(commentControls(req));
        if (onProof || onConnections) card.append(extraActions(req));
        requirements.append(card);
      }
      view.append(requirements);
    }
  } else {
    const scroll = el('div', 'prd-view-table-wrap');
    const table = el('table', 'prd-view-table');
    table.append(el('caption', '', 'Requirements'));
    const head = el('thead'); const header = el('tr');
    for (const label of ['ID', 'Requirement', 'Priority', 'Engineering owners', 'Delivery status', ...(onReview || onComment ? ['Action'] : [])]) {
      const cell = el('th', '', label); cell.scope = 'col'; header.append(cell);
    }
    head.append(header); table.append(head);
    const body = el('tbody');
    for (const req of doc.sections.requirements) {
      const row = el('tr');
      row.setAttribute('data-requirement-id', req.id); row.setAttribute('data-focus-key', `requirement:${req.id}`); row.tabIndex = -1;
      const id = el('th', '', req.id); id.scope = 'row'; row.append(id);
      const requirement = el('td');
      requirement.append(markField(el('p', 'prd-view-text prd-view-table-behavior', text(req.behavior)), req, 'behavior'));
      const detail = el('details', 'prd-view-row-details');
      detail.append(el('summary', '', `Details and proof for ${req.id}`), requirementDetails(req, {owners: false}));
      requirement.append(detail); row.append(requirement);
      const owners = reviewFor(req)?.owners;
      const priority = el('td', '', priorityText(req)); priority.setAttribute('data-label', 'Priority');
      const ownerCell = el('td', 'prd-view-text', owners?.length ? owners.join(', ') : reviews ? 'Not assigned' : 'Delivery review not loaded'); ownerCell.setAttribute('data-label', 'Engineering owners');
      row.append(priority, ownerCell);
      const status = el('td'); status.setAttribute('data-label', 'Delivery status'); status.append(statusControl(req)); row.append(status);
      if (onReview || onComment) {
        const action = el('td', 'prd-view-actions');
        if (onReview) action.append(reviewButton(req, true));
        if (onComment) action.append(commentControls(req));
        if (onProof || onConnections) action.append(extraActions(req));
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
        if (valid) {
          const rect = owner.getSelection?.()?.getRangeAt(0)?.getBoundingClientRect?.();
          if (rect && button.style) {
            button.setAttribute('data-selection-popup', 'true');
            button.style.left = `${Math.max(8, Math.min(rect.left, (owner.documentElement?.clientWidth || 1000) - 230))}px`;
            button.style.top = `${Math.max(8, Math.min(rect.bottom + 8, (owner.documentElement?.clientHeight || 800) - 52))}px`;
          }
        }
      }
    };
    owner.addEventListener?.('selectionchange', updateSelection);
    owner.addEventListener?.('scroll', updateSelection, true);
    selectionCleanups.set(container, () => {
      owner.removeEventListener?.('selectionchange', updateSelection);
      owner.removeEventListener?.('scroll', updateSelection, true);
    });
    updateSelection();
  }
}

export function highlightCommentRanges(container, ranges) {
  if (!ranges.length) return;
  let offset = 0;
  const visit = parent => {
    for (const child of [...(parent.childNodes || [])]) {
      if (child.nodeType !== 3) { visit(child); continue; }
      const value = child.textContent, start = offset; offset += value.length;
      const cuts = [...new Set([0, value.length, ...ranges.flatMap(range => [range.start - start, range.end - start]).filter(n => n > 0 && n < value.length)])].sort((a, b) => a - b);
      const wrapper = el('span');
      for (let i = 1; i < cuts.length; i++) {
        const from = cuts[i - 1], to = cuts[i];
        const active = ranges.some(range => range.start <= start + from && range.end >= start + to);
        wrapper.append(el(active ? 'mark' : 'span', active ? 'prd-comment-highlight' : '', value.slice(from, to)));
      }
      parent.replaceChild(wrapper, child);
    }
  };
  visit(container);
}
