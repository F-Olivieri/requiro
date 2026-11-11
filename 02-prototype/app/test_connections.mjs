import assert from 'node:assert/strict';
import {openConnections} from './ui/connections.js';

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.dataset = {}; this.attributes = {}; this.value = ''; this.checked = false; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, handler) { (this.listeners[event] ||= []).push(handler); }
  querySelectorAll(selector) {
    return this.children.flatMap(node => [...((selector === 'input:checked' ? node.tag === 'input' && node.checked : node.tag === selector) ? [node] : []), ...node.querySelectorAll(selector)]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  remove() { this.parent.children = this.parent.children.filter(node => node !== this); }
  async fire(event) { for (const handler of this.listeners[event] || []) await handler({preventDefault() {}}); }
  click() { return this.disabled ? Promise.resolve() : this.fire('click'); }
}
const body = new Node('body');
globalThis.document = {createElement: tag => new Node(tag), body};
globalThis.Option = function(text, value) { const node = new Node('option'); node.textContent = text; node.value = value; return node; };
let confirmDiscard = true;
const listeners = new Map();
globalThis.window = {confirm: () => confirmDiscard, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name)};
const target = {id: 'target', title: 'Fictional destination', revision: 3, status: 'Draft'};
const req = {id: 'R-005', priority: 'Must', behavior: '<b>Keep raw text</b>', acceptance: 'A sample reopens.', appliesTo: 'UC-01', outcome: 'Keep work'};
const source = {id: 'source', title: 'Fictional source', revision: 7, sections: {useCases: 'UC-01: A member keeps a draft.', requirements: [req]}};
const projects = [{id: 'project-a', name: 'Fictional garden'}, {id: 'project-b', name: 'Fictional workshop'}];
const calls = [];
let conflict = false;
let imports = [];
async function api(path, method = 'GET', data) {
  calls.push({path, method, data: structuredClone(data)});
  if (method !== 'GET' && conflict) { const error = new Error('Changed elsewhere. Reopen the saved PRD.'); error.status = 409; throw error; }
  if (path === '/api/projects') return method === 'GET' ? {projects: structuredClone(projects)} : {id: 'project-c', name: data.name};
  if (path.endsWith('/projects')) return {projectIds: method === 'PUT' ? data.projectIds : ['project-a']};
  if (path.endsWith('/relationships')) return {imports: structuredClone(imports), usedBy: []};
  if (path.endsWith('/import-requirements')) return {doc: {...target, revision: 4}, imports: []};
  if (path === '/api/prds/source/use-cases?revision=7') return {documentId: 'source', prdRevision: 7, useCases: source.sections.useCases,
    labels: {'R-005': {value: 'UC-01', label: 'A member keeps a draft.', reference: 'UC-01', imported: false}}};
  if (path === '/api/prds/source' || path === '/api/prds/source/history/7') return structuredClone(source);
  throw new Error(`Unexpected path ${path}`);
}
const button = (dialog, label) => dialog.querySelectorAll('button').find(node => node.textContent === label);
const field = (dialog, id) => [...dialog.querySelectorAll('select'), ...dialog.querySelectorAll('input')].find(node => node.id === id);
const flush = () => new Promise(resolve => setImmediate(resolve));
async function open(options = {}) {
  const done = openConnections({doc: target, docs: [target, source], api, consent: () => true, hasUnsavedEdits: false, ...options});
  await flush(); return {done, dialog: body.children[0]};
}
async function close(test) { confirmDiscard = true; await button(test.dialog, '×').click(); await test.done; }
let test = await open();
let sourceChoice = field(test.dialog, 'reuse-source');
assert.deepEqual(sourceChoice.children.map(node => node.value), ['', 'source'], 'Destination cannot import from itself.');
sourceChoice.value = 'source'; await sourceChoice.fire('change');
assert.ok(test.dialog.querySelectorAll('p').some(node => node.textContent === 'Behavior: <b>Keep raw text</b>'), 'Preview preserves wording as text.');
assert.ok(test.dialog.querySelectorAll('p').some(node => node.textContent === 'Use case: A member keeps a draft. (reference: UC-01)'), 'Source preview names the use case.');
const selection = test.dialog.querySelectorAll('input').find(node => node.value === 'R-005');
selection.checked = true;
await selection.parent.parent.parent.fire('change');
assert.equal(button(test.dialog, 'Import selected requirements').disabled, false);
conflict = true;
await button(test.dialog, 'Import selected requirements').click();
assert.equal(test.dialog.open, true, 'Conflict keeps the selected requirements available.');
assert.equal(selection.checked, true);
assert.ok(test.dialog.querySelectorAll('p').some(node => node.textContent.includes('Changed elsewhere')));
conflict = false;
await button(test.dialog, 'Import selected requirements').click();
assert.equal((await test.done).doc.revision, 4);
const request = calls.findLast(call => call.path.endsWith('/import-requirements'));
assert.deepEqual(request.data, {expectedRevision: 3, sourceDocumentId: 'source', sourceRevision: 7, requirementIds: ['R-005'], privacyConfirmed: true});
assert.equal(target.revision, 3, 'Dialog never mutates its input PRD.');
assert.equal(listeners.has('beforeunload'), false);

test = await open({hasUnsavedEdits: true});
assert.equal(field(test.dialog, 'reuse-source').disabled, true, 'Import cannot overwrite unsaved PRD edits.');
assert.equal(button(test.dialog, 'Import selected requirements').disabled, true);
const projectCheck = test.dialog.querySelectorAll('input').find(node => node.value === 'project-b');
projectCheck.checked = true;
confirmDiscard = false;
await button(test.dialog, '×').click();
assert.equal(test.dialog.open, true, 'Closing preserves pending project selections.');
await button(test.dialog, 'Save project links').click(); await flush();
assert.deepEqual(calls.findLast(call => call.method === 'PUT').data, {expectedProjectIds: ['project-a'], projectIds: ['project-a', 'project-b'], privacyConfirmed: true});
await close(test);

imports = [{sourceDocumentId: 'source', sourceTitle: 'Fictional source', sourceRevision: 7, sourceRequirementId: 'R-005', targetDocumentId: 'target', targetTitle: target.title, targetRequirementId: 'R-009'}];
test = await open();
await button(test.dialog, 'View original requirement').click(); await flush();
assert.ok(calls.some(call => call.path === '/api/prds/source/history/7'));
sourceChoice = field(test.dialog, 'reuse-source'); sourceChoice.value = 'source'; await sourceChoice.fire('change');
assert.equal(test.dialog.querySelectorAll('input').find(node => node.value === 'R-005').disabled, true, 'The same source requirement and revision cannot be imported twice.');
await button(test.dialog, 'Open source PRD').click();
assert.equal((await test.done).openDocumentId, 'source');

for (const options of [{consent: () => false}, {doc: {...target, status: 'Archived'}}]) {
  test = await open(options);
  assert.equal(button(test.dialog, 'Import selected requirements').disabled, true);
  await close(test);
}
test = await open({doc: null});
field(test.dialog, 'project-name').value = 'Fictional shared launch';
await test.dialog.querySelector('form').fire('submit'); await flush();
assert.ok(test.dialog.querySelectorAll('p').some(node => node.textContent === 'Fictional shared launch'));
await close(test);
// 2026-11-09: legacy projects with equal labels must remain distinguishable.
projects.push({id:'project-legacy',name:'Fictional garden'});
test = await open();
const legacyLabels = test.dialog.querySelectorAll('label').filter(node => node.children[0]?.tag === 'input' && node.children[0].value.startsWith('project-')).map(node => node.children[1].textContent);
assert.ok(legacyLabels.includes('Fictional garden (project-a)'));
assert.ok(legacyLabels.includes('Fictional garden (project-legacy)'));
assert.ok(legacyLabels.includes('Fictional workshop'), 'Distinct names stay concise.');
await close(test);
console.log('Project and requirement reuse UI passed: selection, provenance preview, conflicts, duplicate prevention, distinct legacy labels and unsaved-edit guards.');
