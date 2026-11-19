const referencePattern = () => /\[\[(?:(PRD-[A-Za-z0-9_-]+)\/)?(R-[0-9]{3,6})\]\]/g;
const identity = item => `${item.documentId}/${item.requirementId}`;
const sourceKey = edge => `${edge.sourceDocumentId}/${edge.sourceRequirementId}`;
const targetKey = edge => `${edge.targetDocumentId}/${edge.targetRequirementId}`;
let graphNumber = 0;

export function requirementReferences(value, documentId) {
  return [...String(value).matchAll(referencePattern())].map(match => ({
    text: match[0], start: match.index, end: match.index + match[0].length,
    documentId: match[1] || documentId, requirementId: match[2],
  }));
}

export function appendRequirementText(node, value, {doc, snapshot = null, onOpenRequirement} = {}) {
  const text = String(value ?? '');
  const owner = node.ownerDocument || document;
  const refs = requirementReferences(text, doc.id);
  if (!refs.length) { node.textContent = text; return node; }
  let end = 0;
  for (const ref of refs) {
    node.append(owner.createTextNode(text.slice(end, ref.start)));
    const present = snapshot ? snapshot.nodes.some(item => identity(item) === identity(ref))
      : ref.documentId === doc.id ? doc.sections.requirements.some(req => req.id === ref.requirementId) : null;
    const link = owner.createElement(present === false ? 'span' : 'a');
    link.textContent = ref.text;
    link.className = present === false ? 'requirement-text-link missing' : 'requirement-text-link';
    link.setAttribute('data-requirement-link', identity(ref));
    if (present === false) {
      link.setAttribute('data-requirement-link-missing', 'true');
      link.title = `Missing requirement: ${identity(ref)}`;
      link.setAttribute('aria-label', `${ref.text}, missing requirement`);
      link.style.textDecoration = 'underline wavy';
    } else {
      link.href = `#${encodeURIComponent(identity(ref))}`;
      link.title = `Open ${identity(ref)}`;
      link.addEventListener('click', event => {
        event.preventDefault();
        if (owner.getSelection?.()?.isCollapsed === false) return;
        onOpenRequirement?.({documentId: ref.documentId, requirementId: ref.requirementId});
      });
    }
    node.append(link);
    end = ref.end;
  }
  node.append(owner.createTextNode(text.slice(end)));
  return node;
}

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const endpoint = '/api/requirement-links';

export async function openRequirementLinks({doc, requirementId = null, api, onOpenRequirement}) {
  let snapshot = await api(endpoint);
  let busy = false;
  const dialog = el('dialog', 'dialog requirement-links-dialog');
  dialog.setAttribute('aria-labelledby', 'requirement-links-title');
  const heading = el('div', 'dialog-heading');
  const title = el('h2', '', 'Requirement connections and dependencies'); title.id = 'requirement-links-title';
  const reload = el('button', 'button', 'Reload graph'); reload.type = 'button';
  const close = el('button', 'icon-button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close requirement connections');
  heading.append(title, reload, close);
  const notice = el('p', 'inline-error'); notice.hidden = true; notice.setAttribute('role', 'alert');
  const intro = el('p', 'field-hint', 'All saved requirements are shown, including requirements without links. Connections and dependencies preserve requirement wording and approval. Text references and backlinks update after saving.');
  const graph = el('div', 'requirement-links-graph');
  const legend = el('p', 'field-hint', 'Legend: blue line = Connected to (both ways); orange arrow = Depends on (points to the prerequisite); dashed green arrow = Text reference (not a dependency).');
  const form = el('form', 'requirement-links-form');
  const source = el('select'); source.id = 'requirement-link-source';
  const target = el('select'); target.id = 'requirement-link-target';
  const kind = el('select'); kind.id = 'requirement-link-kind';
  for (const value of ['Connected to', 'Depends on']) kind.append(new Option(value, value));
  const add = el('button', 'button primary', 'Add link'); add.type = 'submit';
  for (const [label, input] of [['From requirement', source], ['Relationship', kind], ['To requirement', target]]) {
    const field = el('label', '', label); field.htmlFor = input.id; field.append(input); form.append(field);
  }
  form.append(add);
  const selected = el('section', 'requirement-links-context');
  const listHeading = el('h3', '', 'All relationships and text references');
  const list = el('ul', 'requirement-links-list');
  const empty = el('p', 'muted');
  dialog.append(heading, intro, notice, graph, legend, form, selected, listHeading, list, empty);
  const names = () => new Map(snapshot.nodes.map(node => [node.id, node]));
  const nodeLabel = (documentId, reqId) => {
    const item = names().get(`${documentId}/${reqId}`);
    return item ? `${item.documentTitle} · ${reqId} (${documentId})` : `${documentId}/${reqId} — missing requirement`;
  };
  function navigation(documentId, reqId, label) {
    const button = el('button', 'text-button', label || nodeLabel(documentId, reqId)); button.type = 'button';
    button.disabled = !names().has(`${documentId}/${reqId}`);
    button.setAttribute('data-missing', String(button.disabled));
    button.addEventListener('click', () => open(documentId, reqId));
    return button;
  }
  function open(documentId, reqId) {
    if (busy) return;
    dialog.close();
    onOpenRequirement?.({documentId, requirementId: reqId});
  }
  const revisions = () => new Map((snapshot.documents || snapshot.nodes.map(node => ({id: node.documentId, revision: node.documentRevision}))).map(item => [item.id, item.revision]));
  function expected(edge) {
    const versions = revisions();
    return {expectedSourcePrdRevision: versions.get(edge.sourceDocumentId), expectedTargetPrdRevision: versions.get(edge.targetDocumentId)};
  }
  async function perform(action) {
    if (busy) return;
    busy = true; notice.hidden = true; controls();
    try { await action(); snapshot = await api(endpoint); render(); }
    catch (error) { notice.textContent = error.message; notice.hidden = false; }
    finally { busy = false; controls(); }
  }
  function edgeRow(edge, removable = false) {
    const row = el('li', 'requirement-link-row');
    row.append(navigation(edge.sourceDocumentId, edge.sourceRequirementId),
      el('span', '', removable ? ` ${edge.kind} ` : ` references${edge.field ? ` in ${edge.field}` : ''} `),
      navigation(edge.targetDocumentId, edge.targetRequirementId));
    if (!names().has(sourceKey(edge)) || !names().has(targetKey(edge))) row.append(el('span', 'field-hint', ' Missing requirement.'));
    if (removable) {
      const remove = el('button', 'text-button', 'Remove link'); remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${edge.kind} link from ${nodeLabel(edge.sourceDocumentId, edge.sourceRequirementId)} to ${nodeLabel(edge.targetDocumentId, edge.targetRequirementId)}`);
      remove.addEventListener('click', () => perform(() => api(`${endpoint}/${encodeURIComponent(edge.id)}/remove`, 'POST', {expectedRevision: edge.revision, ...expected(edge)})));
      row.append(remove);
    }
    return row;
  }
  function renderContext() {
    selected.replaceChildren(el('h3', '', 'Selected requirement: connections and backlinks'));
    const current = names().get(source.value);
    if (!current) { selected.append(el('p', 'muted', 'Choose a saved requirement.')); return; }
    selected.append(el('p', '', nodeLabel(current.documentId, current.requirementId)));
    const related = snapshot.links.filter(edge => sourceKey(edge) === current.id || targetKey(edge) === current.id);
    const outgoing = snapshot.references.filter(edge => sourceKey(edge) === current.id);
    const incoming = snapshot.references.filter(edge => targetKey(edge) === current.id);
    for (const [label, edges, isLink] of [['Connections and dependencies', related, true], ['Text links from this requirement', outgoing, false], ['Backlinks: requirements whose text links here', incoming, false]]) {
      selected.append(el('h4', '', label));
      const items = el('ul');
      for (const edge of edges) items.append(edgeRow(edge, isLink));
      if (!edges.length) items.append(el('li', 'muted', 'None.'));
      selected.append(items);
    }
  }
  function renderGraph() {
    graph.replaceChildren();
    if (!snapshot.nodes.length) { graph.append(el('p', 'muted', 'No saved requirements yet.')); return; }
    const svgNS = 'http://www.w3.org/2000/svg';
    const svgEl = (tag, attributes = {}, value) => {
      const node = document.createElementNS(svgNS, tag);
      for (const [key, val] of Object.entries(attributes)) node.setAttribute(key, String(val));
      if (value !== undefined) node.textContent = value;
      return node;
    };
    const width = 960, columns = 3, height = Math.ceil(snapshot.nodes.length / columns) * 100 + 40;
    const svg = svgEl('svg', {viewBox: `0 0 ${width} ${height}`, role: 'group', 'aria-label': 'All saved requirements. The list below provides the same relationships.'});
    svg.style.width = '100%'; svg.style.minWidth = '580px';
    const coords = new Map(snapshot.nodes.map((node, index) => [node.id, {x: 160 + index % columns * 320, y: 40 + Math.floor(index / columns) * 100}]));
    const unique = ++graphNumber;
    const defs = svgEl('defs');
    for (const [name, color] of [['dependency', '#f59e0b'], ['reference', '#22c55e']]) {
      const marker = svgEl('marker', {id: `requirement-${unique}-${name}`, viewBox: '0 0 10 10', refX: 10, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse'});
      marker.append(svgEl('path', {d: 'M 0 0 L 10 5 L 0 10 z', fill: color})); defs.append(marker);
    }
    svg.append(defs);
    const edges = [...snapshot.links, ...snapshot.references.map(edge => ({...edge, kind: 'Text reference'}))];
    for (const edge of edges) {
      const from = coords.get(sourceKey(edge)), to = coords.get(targetKey(edge));
      if (!from || !to) continue;
      const dependence = edge.kind === 'Depends on', reference = edge.kind === 'Text reference';
      const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      const inset = 17;
      const offset = dependence ? 7 : reference ? -7 : 0;
      const dx = (to.x - from.x) / length, dy = (to.y - from.y) / length;
      const line = from === to
        ? svgEl('path', {d: `M ${from.x + 12} ${from.y - 8} C ${from.x + 60} ${from.y - 60} ${from.x - 60} ${from.y - 60} ${from.x - 12} ${from.y - 8}`, fill: 'none'})
        : svgEl('line', {x1: from.x + dx * inset - dy * offset, y1: from.y + dy * inset + dx * offset,
          x2: to.x - dx * inset - dy * offset, y2: to.y - dy * inset + dx * offset});
      line.setAttribute('stroke', dependence ? '#f59e0b' : reference ? '#22c55e' : '#60a5fa');
      line.setAttribute('stroke-width', '2');
      if (reference) line.setAttribute('stroke-dasharray', '6 5');
      if (dependence || reference) line.setAttribute('marker-end', `url(#requirement-${unique}-${dependence ? 'dependency' : 'reference'})`);
      svg.append(line);
    }
    for (const node of snapshot.nodes) {
      const at = coords.get(node.id);
      const group = svgEl('g', {role: 'button', tabindex: 0, 'aria-label': `Open ${nodeLabel(node.documentId, node.requirementId)}`});
      group.style.cursor = 'pointer';
      group.append(svgEl('title', {}, nodeLabel(node.documentId, node.requirementId)),
        svgEl('circle', {cx: at.x, cy: at.y, r: 15, fill: '#1d4ed8', stroke: '#93c5fd', 'stroke-width': 2}),
        svgEl('text', {x: at.x, y: at.y + 34, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 14}, `${node.documentTitle.slice(0, 30)} · ${node.requirementId}`),
        svgEl('text', {x: at.x, y: at.y + 51, 'text-anchor': 'middle', fill: 'currentColor', 'font-size': 11}, node.documentId));
      group.addEventListener('click', () => open(node.documentId, node.requirementId));
      group.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); open(node.documentId, node.requirementId); } });
      svg.append(group);
    }
    graph.append(svg);
  }
  function controls() {
    for (const control of dialog.querySelectorAll('button, select')) control.disabled = busy || control.getAttribute('data-missing') === 'true';
    add.disabled = busy || !source.value || !target.value || source.value === target.value;
  }
  function render() {
    const chosenSource = source.value || (doc && requirementId ? `${doc.id}/${requirementId}` : '');
    const chosenTarget = target.value;
    source.replaceChildren(new Option('Choose a requirement…', ''));
    target.replaceChildren(new Option('Choose a requirement…', ''));
    for (const node of snapshot.nodes) {
      source.append(new Option(nodeLabel(node.documentId, node.requirementId), node.id));
      target.append(new Option(nodeLabel(node.documentId, node.requirementId), node.id));
    }
    source.value = names().has(chosenSource) ? chosenSource : snapshot.nodes.find(node => node.documentId === doc?.id)?.id || '';
    target.value = names().has(chosenTarget) ? chosenTarget : '';
    list.replaceChildren();
    for (const edge of snapshot.links) list.append(edgeRow(edge, true));
    for (const edge of snapshot.references) list.append(edgeRow(edge));
    const isolates = snapshot.nodes.filter(node => ![...snapshot.links, ...snapshot.references].some(edge => sourceKey(edge) === node.id || targetKey(edge) === node.id));
    for (const node of isolates) { const row = el('li'); row.append(navigation(node.documentId, node.requirementId), el('span', '', ' — no links.')); list.append(row); }
    empty.textContent = snapshot.nodes.length ? '' : 'No saved requirements.';
    renderContext(); renderGraph(); controls();
  }
  source.addEventListener('change', () => { renderContext(); controls(); }); target.addEventListener('change', controls);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const from = names().get(source.value), to = names().get(target.value);
    if (!from || !to || from.id === to.id) return;
    const edge = {kind: kind.value, sourceDocumentId: from.documentId, sourceRequirementId: from.requirementId, targetDocumentId: to.documentId, targetRequirementId: to.requirementId};
    perform(() => api(endpoint, 'POST', {...edge, ...expected(edge)}));
  });
  close.addEventListener('click', () => { if (!busy) dialog.close(); });
  reload.addEventListener('click', () => perform(async () => {}));
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  const done = new Promise(resolve => dialog.addEventListener('close', () => { dialog.remove(); resolve(snapshot); }, {once: true}));
  document.body.append(dialog); render(); dialog.showModal(); source.focus();
  return done;
}
