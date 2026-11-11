import assert from 'node:assert/strict';
import {openRequirementStatus} from './ui/requirement-status.js';

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.value = ''; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  async fire(name) { for (const handler of this.listeners[name] || []) await handler({preventDefault() {}}); }
  click() { return this.fire('click'); }
  focus() { document.activeElement = this; }
}
const body = new Node('body');
globalThis.document = {createElement: tag => new Node(tag), body};
let confirmDiscard = true;
const windowListeners = new Map();
globalThis.window = {addEventListener: (name, handler) => windowListeners.set(name, handler), removeEventListener: name => windowListeners.delete(name), confirm: () => confirmDiscard};
const doc = {id: 'fictional-doc', revision: 8, sections: {requirements: [
  {id: 'R-001', behavior: 'Create a draft task.', acceptance: 'A draft task is saved.'},
  {id: 'R-002', behavior: 'Reopen a task.', acceptance: 'The earlier completion note stays readable.'},
]}};
const baseRow = {requirementId: 'R-002', revision: 3, owners: [], proof: '', status: 'Not reviewed', reviewer: '', reviewNotes: ''};
let row;
let consent = true;
let conflict = false;
let wrongResponse = false;
let posts = [];
let responseIdentity = {documentId: doc.id, prdRevision: doc.revision};
const baseline = JSON.stringify(doc);
async function api(path, method = 'GET', input) {
  if (method === 'GET') return {...responseIdentity, items: [structuredClone(row)]};
  assert.equal(path, '/api/prds/fictional-doc/verification/R-002/review');
  posts.push(structuredClone(input));
  assert.equal(input.expectedPrdRevision, 8);
  assert.equal(input.expectedRevision, row.revision);
  if (conflict) { const error = new Error('Changed elsewhere.'); error.status = 409; throw error; }
  return {requirementId: wrongResponse ? 'R-001' : row.requirementId, status: input.status, revision: row.revision + 1};
}
async function open(changes = {}, candidate = doc) {
  row = {...structuredClone(baseRow), ...changes};
  const done = openRequirementStatus({doc: candidate, requirementId: 'R-002', api, consent: () => consent});
  await new Promise(resolve => setImmediate(resolve));
  return {done, dialog: body.children[0]};
}
const field = (dialog, id) => [...dialog.querySelectorAll('input'), ...dialog.querySelectorAll('textarea'), ...dialog.querySelectorAll('select')].find(node => node.id === id);
const button = (dialog, name) => dialog.querySelectorAll('button').find(node => node.textContent === name);
async function set(dialog, id, value) { const node = field(dialog, id); node.value = value; await node.fire(node.tag === 'select' ? 'change' : 'input'); }
async function cancel(test) { confirmDiscard = true; await button(test.dialog, '×').click(); assert.deepEqual(await test.done, {}); }

let test = await open();
assert.equal(document.activeElement, field(test.dialog, 'requirement-status-choice'), 'Opening the dialog focuses its first field.');
assert.deepEqual(field(test.dialog, 'requirement-status-choice').children.map(option => option.value), ['', 'Complete', 'To discuss', 'Needs work']);
assert.ok(test.dialog.querySelectorAll('p').some(node => node.textContent.includes('R-002 · Reopen a task.')));
await set(test.dialog, 'requirement-status-choice', 'Complete');
assert.equal(button(test.dialog, 'Save status').disabled, true, 'Complete requires owner, proof and reviewer.');
assert.ok(test.dialog.querySelectorAll('p').some(node => node.textContent.includes('engineering owner, proof explanation, reviewer role')));
await set(test.dialog, 'requirement-status-choice', 'Needs work');
assert.equal(button(test.dialog, 'Save status').disabled, true, 'Needs work requires a reviewer.');
await set(test.dialog, 'requirement-status-choice', 'To discuss');
await set(test.dialog, 'requirement-status-notes', 'Should reopening also notify the task owner?');
assert.equal(button(test.dialog, 'Save status').disabled, false, 'Discussion does not need proof or a reviewer.');
await button(test.dialog, 'Save status').click();
assert.deepEqual(await test.done, {updated: true, status: 'To discuss'}, 'The caller can confirm what was saved.');
assert.equal(posts.at(-1).status, 'To discuss');
assert.equal(posts.at(-1).notes, 'Should reopening also notify the task owner?');
assert.equal(posts.at(-1).reviewer, '');
assert.equal(body.children.length, 0);
assert.equal(windowListeners.has('beforeunload'), false, 'Closing removes the unload guard.');

test = await open({owners: ['Application engineer'], proof: 'Simulated example proof.', reviewer: 'Test engineer', status: 'Verified'});
assert.equal(field(test.dialog, 'requirement-status-choice').value, 'Complete', 'Stored Verified uses the visible Complete label.');
assert.equal(button(test.dialog, 'Save status').disabled, false);
await button(test.dialog, 'Save status').click();
assert.deepEqual(await test.done, {updated: true, status: 'Complete'});
assert.equal(posts.at(-1).status, 'Complete');

test = await open();
await set(test.dialog, 'requirement-status-choice', 'Needs work');
await set(test.dialog, 'requirement-status-reviewer', 'Test engineer');
assert.equal(button(test.dialog, 'Save status').disabled, false);
await button(test.dialog, 'Save status').click();
assert.deepEqual(await test.done, {updated: true, status: 'Needs work'});
assert.equal(posts.at(-1).status, 'Needs work');

test = await open();
await set(test.dialog, 'requirement-status-choice', 'To discuss');
await set(test.dialog, 'requirement-status-notes', 'Unsaved question.');
confirmDiscard = false;
await button(test.dialog, '×').click();
assert.equal(test.dialog.open, true, 'Close preserves an unsaved status and notes.');
await test.dialog.fire('cancel');
assert.equal(test.dialog.open, true, 'Escape uses the same unsaved-change guard.');
conflict = true;
await button(test.dialog, 'Save status').click();
assert.equal(field(test.dialog, 'requirement-status-choice').value, 'To discuss');
assert.equal(field(test.dialog, 'requirement-status-notes').value, 'Unsaved question.');
assert.equal(field(test.dialog, 'requirement-status-notes').readOnly, true);
assert.equal(field(test.dialog, 'requirement-status-notes').disabled, false, 'Conflicting notes remain selectable.');
assert.equal(button(test.dialog, 'Save status').disabled, true);
assert.equal(button(test.dialog, 'Open delivery review').disabled, true);
assert.ok(test.dialog.querySelectorAll('p').some(node => node.textContent.includes('changed elsewhere')));
await cancel(test); conflict = false;

test = await open();
await button(test.dialog, 'Open delivery review').click();
assert.deepEqual(await test.done, {fullReview: true});

consent = false;
test = await open({status: 'To discuss'});
assert.equal(button(test.dialog, 'Save status').disabled, true);
const beforePosts = posts.length;
await button(test.dialog, 'Save status').click();
assert.equal(posts.length, beforePosts, 'Missing acknowledgement cannot send a status change.');
await cancel(test); consent = true;

for (const missing of ['behavior', 'acceptance']) {
  const incomplete = structuredClone(doc); incomplete.sections.requirements[1][missing] = 'TBC';
  test = await open({owners: ['Application engineer'], proof: 'Simulated proof.', reviewer: 'Test engineer'}, incomplete);
  await set(test.dialog, 'requirement-status-choice', 'Complete');
  assert.equal(button(test.dialog, 'Save status').disabled, true, `Complete requires ${missing}.`);
  await cancel(test);
}
wrongResponse = true;
test = await open();
await set(test.dialog, 'requirement-status-choice', 'To discuss');
await button(test.dialog, 'Save status').click();
assert.equal(test.dialog.open, true, 'A response for another requirement cannot report success.');
assert.equal(button(test.dialog, 'Save status').disabled, true, 'An inconsistent response freezes further writes.');
assert.ok(test.dialog.querySelectorAll('p').some(node => node.textContent.includes('another requirement')));
await cancel(test); wrongResponse = false;

for (const mismatch of [{documentId: 'other-doc', prdRevision: 8}, {documentId: doc.id, prdRevision: 9}]) {
  responseIdentity = mismatch;
  await assert.rejects(openRequirementStatus({doc, requirementId: 'R-002', api, consent: () => true}), /PRD changed/);
  assert.equal(body.children.length, 0);
}
assert.equal(JSON.stringify(doc), baseline, 'Changing review status never mutates the PRD document.');
console.log('Requirement status chooser passed: options, proof/reviewer gates, CAS, discussion, full review, consent, conflicts and draft protection.');
