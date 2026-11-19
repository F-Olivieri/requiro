import {useCaseText} from './use-cases.js';
import {formatDateTime} from './format.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const prdPath = id => `/api/prds/${encodeURIComponent(id)}`;

export function projectLabel(project, projects) {
  const name = project.name.trim().toLocaleLowerCase();
  return projects.filter(item => item.name.trim().toLocaleLowerCase() === name).length > 1 ? `${project.name} (${project.id})` : project.name;
}

export async function openConnections({doc, docs, api, hasUnsavedEdits}) {
  const [{projects}, memberships, relationships] = await Promise.all([
    api('/api/projects'),
    doc ? api(`${prdPath(doc.id)}/projects`) : {projectIds: []},
    doc ? api(`${prdPath(doc.id)}/relationships`) : {imports: [], usedBy: []},
  ]);
  let projectIds = memberships.projectIds;
  let sourceDoc = null;
  let loadingSource = 0;
  let busy = false;
  let result = {};
  const dialog = el('dialog', 'dialog connections-dialog');
  dialog.setAttribute('aria-labelledby', 'connections-title');
  const heading = el('div', 'dialog-heading');
  const title = el('h2', '', doc ? 'Projects & reused requirements' : 'Projects'); title.id = 'connections-title';
  const close = el('button', 'icon-button', '×'); close.setAttribute('aria-label', 'Close projects and reuse');
  heading.append(title, close);
  const notice = el('p', 'inline-error'); notice.hidden = true; notice.setAttribute('role', 'alert');
  dialog.append(heading);
  if (doc) dialog.append(el('p', 'muted', `${doc.title} · v${doc.revision}`));
  const hint = el('p', 'field-hint', 'Changes stay in this local workspace.');
  dialog.append(hint, notice);
  function section(name) {
    const section = el('section', 'connections-section'); section.append(el('h3', '', name)); dialog.append(section); return section;
  }
  const projectSection = section(doc ? 'Linked projects' : 'Your projects');
  const projectList = el('div', 'project-choices');
  const projectSave = el('button', 'button', 'Save project links');
  projectSave.hidden = !doc;
  const createForm = el('form', 'project-create');
  const nameLabel = el('label', '', 'New project name'); nameLabel.htmlFor = 'project-name';
  const name = el('input'); name.id = 'project-name'; name.maxLength = 200; name.required = true;
  const create = el('button', 'button', 'Create project'); create.type = 'submit';
  createForm.append(nameLabel, name, create);
  projectSection.append(projectList, projectSave, createForm);
  function renderProjects() {
    projectList.replaceChildren();
    if (!projects.length) projectList.append(el('p', 'muted', 'No projects yet. Create one below.'));
    for (const project of projects) {
      if (!doc) { projectList.append(el('p', 'project-name', projectLabel(project, projects))); continue; }
      const label = el('label', 'connection-choice');
      const check = el('input'); check.type = 'checkbox'; check.value = project.id; check.checked = projectIds.includes(project.id);
      label.append(check, el('span', '', projectLabel(project, projects))); projectList.append(label);
    }
  }
  renderProjects();
  const source = el('select'); source.id = 'reuse-source';
  const choices = el('div', 'import-choices');
  const importButton = el('button', 'button primary', 'Import selected requirements');
  if (doc) {
    const importsSection = section('Requirements imported into this PRD');
    const usedSection = section('PRDs reusing requirements from this PRD');
    function renderRelationships(container, rows, incoming) {
      if (!rows.length) container.append(el('p', 'muted', incoming ? 'No imported requirements.' : 'No other PRD has imported requirements from this one.'));
      for (const row of rows) {
        const card = el('div', 'connection-card');
        card.append(el('p', '', `${row.sourceTitle} / ${row.sourceRequirementId} (v${row.sourceRevision}) → ${row.targetTitle} / ${row.targetRequirementId}`));
        if (row.sourceRequirementPresent === false || row.targetRequirementPresent === false) card.append(el('p', 'field-hint', 'A requirement was removed from the current PRD. The original source revision remains available below.'));
        const open = el('button', 'text-button', incoming ? 'Open source PRD' : 'Open destination PRD');
        open.addEventListener('click', () => { if (!busy && allowDiscard()) { result.openDocumentId = incoming ? row.sourceDocumentId : row.targetDocumentId; dialog.close(); } });
        const inspect = el('button', 'text-button', 'View original requirement');
        const original = el('div', 'source-preview'); original.hidden = true;
        inspect.addEventListener('click', () => perform(async () => {
          const [historical, context] = await Promise.all([api(`${prdPath(row.sourceDocumentId)}/history/${row.sourceRevision}`), api(`${prdPath(row.sourceDocumentId)}/use-cases?revision=${row.sourceRevision}`)]);
          const req = historical.sections.requirements.find(item => item.id === row.sourceRequirementId);
          if (!req) throw new Error('The original requirement is unavailable.');
          original.replaceChildren(el('strong', '', `${historical.title} · v${historical.revision} · ${req.id}`));
          requirementText(original, req, historical, context); original.hidden = false;
        }));
        card.append(open, inspect, original); container.append(card);
      }
    }
    renderRelationships(importsSection, relationships.imports, true);
    renderRelationships(usedSection, relationships.usedBy, false);
    const importSection = section('Import requirements');
    importSection.append(el('p', 'field-hint', hasUnsavedEdits ? 'Save your unsaved PRD edits, then reopen this panel to import requirements.' : doc.status === 'Archived' ? 'Reopen this archived PRD before importing.' : 'Choose a source PRD and select the requirements to copy. Each copy links to its source. Copied priorities are marked “Priority not yet agreed”. Delivery reviews and proof are not copied.'));
    const sourceLabel = el('label', '', 'Source PRD'); sourceLabel.htmlFor = source.id;
    source.append(new Option('Choose a PRD…', ''));
    for (const item of docs.filter(item => item.id !== doc.id)) source.append(new Option(`${item.title} · v${item.revision}${item.updatedAt ? ` · updated ${formatDateTime(item.updatedAt)}` : ''}`, item.id));
    importSection.append(sourceLabel, source, choices, importButton);
    source.addEventListener('change', async () => {
      const request = ++loadingSource;
      sourceDoc = null; choices.replaceChildren(); controls();
      if (!source.value) return;
      choices.append(el('p', 'muted', 'Loading saved requirements…'));
      try {
        const loaded = await api(prdPath(source.value));
        const context = await api(`${prdPath(loaded.id)}/use-cases?revision=${loaded.revision}`);
        if (request !== loadingSource || !dialog.open) return;
        sourceDoc = loaded;
        choices.replaceChildren(el('p', 'small muted', `${loaded.title} · saved v${loaded.revision}`));
        if (!loaded.sections.requirements.length) choices.append(el('p', 'muted', 'This PRD has no requirements.'));
        for (const req of loaded.sections.requirements) {
          const card = el('div', 'connection-card');
          const label = el('label', 'connection-choice');
          const checkbox = el('input'); checkbox.type = 'checkbox'; checkbox.value = req.id;
          const imported = relationships.imports.some(row => row.sourceDocumentId === loaded.id && row.sourceRevision === loaded.revision && row.sourceRequirementId === req.id);
          checkbox.dataset.imported = String(imported);
          label.append(checkbox, el('strong', '', `${req.id} · ${req.priority}${imported ? ' · Already imported' : ''}`));
          card.append(label); requirementText(card, req, loaded, context); choices.append(card);
        }
      } catch (error) { if (request === loadingSource) showError(error); }
      finally { controls(); }
    });
    importButton.addEventListener('click', () => perform(async () => {
      const requirementIds = [...choices.querySelectorAll('input:checked')].map(input => input.value);
      if (!canImport() || !sourceDoc || !requirementIds.length) return;
      if (!allowDiscard()) return;
      const imported = await api(`${prdPath(doc.id)}/import-requirements`, 'POST', {expectedRevision: doc.revision, sourceDocumentId: sourceDoc.id, sourceRevision: sourceDoc.revision, requirementIds});
      result.doc = imported.doc; dialog.close();
    }));
  }
  const selectedProjects = () => [...projectList.querySelectorAll('input:checked')].map(input => input.value).sort();
  const projectDirty = () => Boolean(doc && JSON.stringify(selectedProjects()) !== JSON.stringify([...projectIds].sort()));
  const allowDiscard = () => !projectDirty() || window.confirm('Discard unsaved project selections? Saved links will remain.');
  function showError(error) { notice.textContent = error.message; notice.hidden = false; }
  function canImport() { return Boolean(doc && doc.status !== 'Archived' && !hasUnsavedEdits); }
  function controls() {
    for (const button of dialog.querySelectorAll('button')) button.disabled = busy;
    for (const input of [...projectList.querySelectorAll('input'), name]) input.disabled = busy;
    create.disabled = projectSave.disabled = busy;
    source.disabled = busy || !canImport();
    for (const input of choices.querySelectorAll('input')) input.disabled = busy || !canImport() || input.dataset.imported === 'true';
    importButton.disabled = busy || !canImport() || !sourceDoc || !choices.querySelector('input:checked');
  }
  async function perform(task) {
    if (busy) return;
    busy = true; notice.hidden = true; controls();
    try { await task(); } catch (error) { showError(error); }
    finally { busy = false; controls(); }
  }
  projectSave.addEventListener('click', () => perform(async () => {
    const saved = await api(`${prdPath(doc.id)}/projects`, 'PUT', {expectedProjectIds: projectIds, projectIds: selectedProjects()});
    projectIds = saved.projectIds; renderProjects(); hint.textContent = 'Project links saved.';
  }));
  createForm.addEventListener('submit', event => {
    event.preventDefault();
    perform(async () => {
      if (!name.value.trim()) return;
      const project = await api('/api/projects', 'POST', {name: name.value.trim()});
      const selected = selectedProjects();
      projects.push(project); renderProjects();
      for (const input of projectList.querySelectorAll('input')) input.checked = selected.includes(input.value) || input.value === project.id;
      name.value = ''; hint.textContent = doc ? 'Project created and selected. Save project links to attach it to this PRD.' : 'Project created.';
    });
  });
  projectList.addEventListener('change', controls);
  choices.addEventListener('change', controls);
  const closePanel = () => { if (!busy && allowDiscard()) dialog.close(); };
  close.addEventListener('click', closePanel);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closePanel(); });
  const beforeUnload = event => { if (busy || projectDirty()) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  const closed = new Promise(resolve => dialog.addEventListener('close', () => {
    ++loadingSource; window.removeEventListener('beforeunload', beforeUnload); dialog.remove(); resolve(result);
  }, {once: true}));
  document.body.append(dialog); controls(); dialog.showModal();
  (projectList.querySelector('input') || name).focus();
  return closed;
}

function requirementText(container, req, doc, context) {
  for (const [label, value] of [['Requirement', req.behavior], ['Acceptance criteria', req.acceptance], ['Use case', useCaseText(doc, req, context)], ['Intended outcome', req.outcome]]) {
    container.append(el('p', 'requirement-source-text', `${label}: ${value || 'Not documented'}`));
  }
}
