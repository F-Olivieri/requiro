import assert from 'node:assert/strict';
import {appendRequirementText, openRequirementLinks, requirementReferences} from './ui/requirement-links.js';

class Node {
  constructor(tag, owner, value = '') { this.tag = tag; this.ownerDocument = owner; this.children = []; this.attributes = {}; this.listeners = {}; this.style = {}; this.value = value; this.disabled = false; }
  get textContent() { return this.tag === '#text' ? this.text : this.children.map(node => node.textContent).join(''); }
  set textContent(value) { if (this.tag === '#text') this.text = String(value); else this.replaceChildren(this.ownerDocument.createTextNode(String(value))); }
  append(...items) { for (const node of items) { node.parent = this; this.children.push(node); } }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  matches(selector) { return selector.startsWith('[') ? this.attributes[selector.slice(1, -1)] !== undefined : this.tag === selector; }
  querySelectorAll(selector) { const selectors = selector.split(',').map(value => value.trim()); return this.children.flatMap(node => [...(selectors.some(s => node.matches(s)) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  async fire(type, extras = {}) { const event = {prevented: false, preventDefault() { this.prevented = true; }, ...extras}; for (const fn of this.listeners[type] || []) await fn(event); return event; }
  click() { return this.disabled ? Promise.resolve() : this.fire('click'); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
}
const document = {selection: {isCollapsed: true}, createElement(tag) { return new Node(tag, this); }, createElementNS(_namespace, tag) { return new Node(tag, this); }, createTextNode(value) { const node = new Node('#text', this); node.text = String(value); return node; }, getSelection() { return this.selection; }};
document.body = document.createElement('body');
globalThis.document = document;
globalThis.Option = function(label, value) { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; };
const doc = {id: 'PRD-one', revision: 2, sections: {requirements: [{id: 'R-001'}, {id: 'R-002'}]}};
const nodes = [
  {id: 'PRD-one/R-001', documentId: 'PRD-one', requirementId: 'R-001', documentTitle: '<script>Fictional source</script>', documentRevision: 2},
  {id: 'PRD-one/R-002', documentId: 'PRD-one', requirementId: 'R-002', documentTitle: '<script>Fictional source</script>', documentRevision: 2},
  {id: 'PRD-two/R-001', documentId: 'PRD-two', requirementId: 'R-001', documentTitle: 'Fictional target', documentRevision: 3},
  {id: 'PRD-three/R-001', documentId: 'PRD-three', requirementId: 'R-001', documentTitle: 'Fictional isolated requirement', documentRevision: 1},
];
const link = {id: 'LINK-one', kind: 'Connected to', sourceDocumentId: 'PRD-one', sourceRequirementId: 'R-001', targetDocumentId: 'PRD-two', targetRequirementId: 'R-001', revision: 1};
const snapshot = {nodes, documents: [{id: 'PRD-one', revision: 2}, {id: 'PRD-two', revision: 3}, {id: 'PRD-three', revision: 1}], links: [link, {...link, id: 'LINK-two', kind: 'Depends on', sourceDocumentId: 'PRD-two', targetDocumentId: 'PRD-one'}], references: [
  {...link, field: 'behavior', sourceDocumentId: 'PRD-one', sourceRequirementId: 'R-002'},
  {...link, field: 'acceptance', targetRequirementId: 'R-999', targetPresent: false},
]};
let opened = [];
const span = document.createElement('span');
const raw = '🚀 See [[R-002]], [[PRD-two/R-001]], and [[R-999]]. <script>plain text</script>';
appendRequirementText(span, raw, {doc, snapshot, onOpenRequirement: item => opened.push(item)});
assert.equal(span.textContent, raw, 'Rendering must preserve every UTF-16 code unit for comment anchors.');
assert.equal(span.querySelectorAll('a').length, 2);
assert.equal(span.querySelectorAll('[data-requirement-link-missing]').length, 1);
assert.equal(span.querySelectorAll('script').length, 0, 'Untrusted content is not HTML.');
assert.deepEqual(requirementReferences(raw, doc.id).map(item => [item.documentId, item.requirementId]), [['PRD-one', 'R-002'], ['PRD-two', 'R-001'], ['PRD-one', 'R-999']]);
assert.equal(requirementReferences(raw, doc.id)[0].start, raw.indexOf('[[R-002]]'));
document.selection = {isCollapsed: false};
await span.querySelector('a').click(); assert.deepEqual(opened, [], 'Selecting text within a link must not navigate.');
document.selection = {isCollapsed: true};
await span.querySelector('a').click(); assert.deepEqual(opened, [{documentId: 'PRD-one', requirementId: 'R-002'}]);
const plain = {textContent: '', ownerDocument: {}};
appendRequirementText(plain, 'No links here.', {doc}); assert.equal(plain.textContent, 'No links here.', 'Plain text needs no DOM text-node APIs.');
assert.deepEqual(requirementReferences('[[javascript:alert(1)]] [[R-1]]', doc.id), []);

const calls = [];
let conflict = false;
let current = structuredClone(snapshot);
async function api(path, method = 'GET', body) {
  calls.push({path, method, body: structuredClone(body)});
  if (method === 'GET') return structuredClone(current);
  if (conflict) { const error = new Error('A linked PRD changed. Reload the graph.'); error.status = 409; throw error; }
  if (path.endsWith('/remove')) { current.links = current.links.filter(item => item.id !== path.split('/').at(-2)); return {removed: true}; }
  current.links.push({id: 'LINK-added', ...body, revision: 1}); return current.links.at(-1);
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const byId = (dialog, id) => dialog.querySelectorAll('select').find(node => node.id === id);
const byText = (dialog, text) => dialog.querySelectorAll('button').find(node => node.textContent === text);
opened = [];
let done = openRequirementLinks({doc, requirementId: 'R-002', api, onOpenRequirement: item => opened.push(item)});
await flush();
let dialog = document.body.querySelector('dialog');
assert.equal(document.activeElement, byId(dialog, 'requirement-link-source'));
assert.equal(byId(dialog, 'requirement-link-source').value, 'PRD-one/R-002');
assert.equal(dialog.querySelectorAll('g').length, 4, 'Graph includes every saved requirement, including isolates.');
assert.ok(dialog.textContent.includes('no links.'));
assert.ok(dialog.textContent.includes('Backlinks: requirements whose text links here'));
assert.ok(dialog.textContent.includes('Missing requirement.'));
assert.ok(dialog.textContent.includes('orange arrow = Depends on (points to the prerequisite)'));
assert.equal(dialog.querySelectorAll('line').filter(node => node.getAttribute('marker-end') !== null).length, 2, 'Dependencies and text references have distinct arrowed edges.');
const source = byId(dialog, 'requirement-link-source'), target = byId(dialog, 'requirement-link-target'), kind = byId(dialog, 'requirement-link-kind');
source.value = 'PRD-one/R-002'; target.value = 'PRD-three/R-001'; kind.value = 'Depends on';
conflict = true;
await dialog.querySelector('form').fire('submit'); await flush();
assert.equal(dialog.open, true); assert.equal(source.value, 'PRD-one/R-002'); assert.equal(target.value, 'PRD-three/R-001');
assert.ok(dialog.textContent.includes('A linked PRD changed.'));
conflict = false;
await dialog.querySelector('form').fire('submit'); await flush();
const added = calls.findLast(call => call.path === '/api/requirement-links' && call.method === 'POST');
assert.deepEqual(added.body, {kind: 'Depends on', sourceDocumentId: 'PRD-one', sourceRequirementId: 'R-002', targetDocumentId: 'PRD-three', targetRequirementId: 'R-001', expectedSourcePrdRevision: 2, expectedTargetPrdRevision: 1});
const remove = dialog.querySelectorAll('button').find(node => node.getAttribute('aria-label')?.startsWith('Remove Connected to'));
await remove.click(); await flush();
const removed = calls.findLast(call => call.path.endsWith('/remove'));
assert.equal(removed.body.expectedRevision, 1); assert.equal(removed.body.expectedSourcePrdRevision, 2); assert.equal(removed.body.expectedTargetPrdRevision, 3);
const group = dialog.querySelector('g'); await group.fire('keydown', {key: 'Enter'});
await done; assert.equal(opened.length, 1, 'Keyboard activation opens the graph node.');
assert.equal(document.body.querySelector('dialog'), null);
assert.equal(JSON.stringify(snapshot.links[0]), JSON.stringify(link), 'UI never mutates supplied snapshots.');
console.log('Requirement links passed: raw text/UTF-16 anchors, selection guard, missing targets, graph isolates/arrows, keyboard navigation, add/remove CAS, backlinks, and conflict preservation.');
