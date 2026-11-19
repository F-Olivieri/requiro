import assert from 'node:assert/strict';
import {openCompletion} from './ui/completion.js';
const navigations = [];
class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; this.attributes = {}; this.open = false; }
  append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]); }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  remove() { this.parent.children = this.parent.children.filter(child => child !== this); }
  async fire(name) { for (const handler of this.listeners[name] || []) await handler({preventDefault() {}}); }
  click() { if (this.tag === 'a' && !(this.listeners.click || []).length) navigations.push(this.href); return this.fire('click'); }
  focus() { document.activeElement = this; }
}
const body = new Node('body');
globalThis.document = {createElement: tag => new Node(tag), body};
let confirmDiscard = true;
globalThis.window = {addEventListener() {}, removeEventListener() {}, confirm: () => confirmDiscard};
const reqs = ['R-001', 'R-002'].map(id => ({id, priority: 'Must', behavior: `Behavior ${id}`, acceptance: 'Acceptance'}));
const doc = {id: 'fictional-doc', title: 'Fictional PRD', revision: 1, sections: {requirements: reqs}};
const before = JSON.stringify(doc);
const rows = new Map(reqs.map(req => [req.id, {requirementId: req.id, owners: [], proof: '', attachments: [], revision: 0, baselinePrdRevision: null, status: 'Not reviewed', reviewer: '', reviewNotes: '', reviewedAt: null}]));
let conflict = false;
let apiCalls = 0;
const clone = value => structuredClone(value);
async function api(path, method = 'GET', data) {
  apiCalls++;
  if (method === 'GET') {
    if (path.endsWith('/history')) return [clone(rows.get('R-001'))];
    return {documentId: doc.id, prdRevision: doc.revision, items: [...rows.values()].map(clone)};
  }
  if (conflict) { const error = new Error('changed elsewhere'); error.status = 409; throw error; }
  const id = path.includes('/R-002') ? 'R-002' : 'R-001';
  const row = rows.get(id);
  assert.equal(data.expectedPrdRevision, 1);
  assert.equal(data.expectedRevision, row.revision);
  if (path.endsWith('/review')) Object.assign(row, {status: data.status === 'Complete' ? 'Verified' : data.status, reviewer: data.reviewer, reviewNotes: data.notes, reviewedAt: '2026-11-09T01:00:00Z'});
  else Object.assign(row, {owners: data.owners, proof: data.proof, status: ['Not reviewed', 'To discuss'].includes(row.status) ? row.status : 'Needs recheck'});
  row.revision++; row.baselinePrdRevision = 1;
  return clone(row);
}
const opened = openCompletion({doc, api});
await new Promise(resolve => setImmediate(resolve));
const dialog = body.children[0];
const all = () => [dialog, ...dialog.querySelectorAll('button'), ...dialog.querySelectorAll('input'), ...dialog.querySelectorAll('textarea')];
const field = id => all().find(node => node.id === id);
const button = text => dialog.querySelectorAll('button').find(node => node.textContent === text);
const type = async (id, value) => { field(id).value = value; await field(id).fire('input'); };
assert.equal(dialog.open, true);
assert.ok(dialog.querySelectorAll('a').some(node => node.textContent === 'View delivery report'));
assert.ok(dialog.querySelectorAll('a').some(node => node.textContent === 'Download with proofs'));
assert.equal(dialog.querySelectorAll('a').find(node => node.textContent === 'Completed report').hidden, true, 'Pending requirements cannot offer a completed report.');
assert.equal(document.activeElement, field('completion-owners'), 'Opening the delivery review focuses its first field.');
assert.equal(button('Mark complete').disabled, true);
assert.equal(button('To discuss').disabled, false, 'Discussion does not require owners, proof or reviewer.');
await type('completion-notes', 'Which draft state should we keep?');
const saved = dialog.querySelectorAll('p').find(node => node.className === 'completion-saved');
assert.equal(saved.hidden, true);
await button('To discuss').click();
assert.equal(rows.get('R-001').status, 'To discuss');
assert.equal(rows.get('R-001').reviewNotes, 'Which draft state should we keep?');
assert.equal(saved.hidden, false); assert.equal(saved.textContent, 'R-001 marked To discuss.');
assert.equal(saved.attributes.role, 'status', 'Screen readers hear the confirmation.');
assert.ok(dialog.querySelectorAll('span').some(node => node.textContent === '1 to discuss'));
assert.ok(dialog.querySelectorAll('p').some(node => node.textContent === '0 of 2 complete · 2 pending'));
await type('completion-owners', 'Frontend engineer, Test engineer, Frontend engineer');
await type('completion-proof', 'Acceptance passed in the local example.');
assert.equal(field('completion-file').disabled, true, 'Unsaved evidence prevents upload.');
await button('Save owners and proof').click();
assert.equal(saved.textContent, 'Saved owners and proof for R-001.');
assert.deepEqual(rows.get('R-001').owners, ['Frontend engineer', 'Test engineer']);
assert.equal(rows.get('R-001').status, 'To discuss', 'Evidence keeps an open discussion pending.');
await type('completion-reviewer', 'Test engineer');
await type('completion-notes', 'Team reviewed the proof.');
assert.equal(button('Mark complete').disabled, false);
await button('Mark complete').click();
assert.equal(rows.get('R-001').status, 'Verified');
assert.equal(saved.textContent, 'R-001 marked Complete.', 'The confirmation uses the display label.');
assert.ok(dialog.querySelectorAll('span').some(node => node.textContent === 'Complete'), 'Stored Verified displays as Complete.');
const history = dialog.querySelectorAll('details')[0]; history.open = true; await history.fire('toggle');
assert.ok(dialog.querySelectorAll('p').some(node => node.textContent.startsWith('Complete · review record')), 'History uses the same label.');
await type('completion-proof', 'A revised proof.');
assert.equal(button('Mark complete').disabled, true);
assert.equal(button('To discuss').disabled, true, 'Save unsaved evidence before changing status.');
await button('Save owners and proof').click();
assert.equal(rows.get('R-001').status, 'Needs recheck');
await type('completion-proof', 'Unsaved proof must survive.');
confirmDiscard = false;
await button('×').click();
assert.equal(dialog.open, true, 'Close protects unsaved proof.');
const secondReq = dialog.querySelectorAll('button').find(node => node.children[0]?.textContent === 'R-002');
await secondReq.click();
assert.equal(field('completion-proof').value, 'Unsaved proof must survive.', 'Switch protects unsaved proof.');
conflict = true;
await button('Save owners and proof').click();
assert.equal(field('completion-proof').value, 'Unsaved proof must survive.', 'Conflict preserves unsaved proof.');
assert.equal(field('completion-proof').readOnly, true, 'Conflict freezes edits while keeping text selectable.');
assert.equal(field('completion-proof').disabled, false);
assert.equal(button('Mark complete').disabled, true);
assert.equal(button('To discuss').disabled, true, 'Conflicts also freeze discussion changes.');
assert.equal(JSON.stringify(doc), before, 'Completion never mutates PRD authoring data.');
confirmDiscard = true;
await button('×').click(); await opened;
assert.equal(body.children.length, 0);
const targeted = openCompletion({doc, api, requirementId: 'R-002'});
await new Promise(resolve => setImmediate(resolve));
assert.ok(body.children[0].querySelectorAll('h3').some(node => node.textContent.startsWith('R-002')), 'Review from either view opens the chosen requirement.');
await body.children[0].querySelectorAll('button').find(node => node.textContent === '×').click(); await targeted;
for (const key of ['behavior', 'acceptance']) {
  for (const value of ['', ' Not documented ', 'Unknown', 'Unresolved', 'TBD', 'TBC']) {
    const incomplete = clone(doc); incomplete.sections.requirements[0][key] = value;
    const review = openCompletion({doc: incomplete, api});
    await new Promise(resolve => setImmediate(resolve));
    const active = body.children[0];
    assert.equal(active.querySelectorAll('button').find(node => node.textContent === 'Mark complete').disabled, true, `${key}=${JSON.stringify(value)} must prevent completion.`);
    assert.ok(active.querySelectorAll('p').some(node => node.textContent.includes(`To mark complete, add: ${key === 'behavior' ? 'requirement' : 'acceptance criteria'}`)), 'Missing requirement content must be visible.');
    await active.querySelectorAll('button').find(node => node.textContent === '×').click(); await review;
  }
}
for (const key of ['proof', 'reviewer']) {
  const saved = rows.get('R-001')[key]; rows.get('R-001')[key] = ' Unknown ';
  const review = openCompletion({doc, api});
  await new Promise(resolve => setImmediate(resolve));
  const active = body.children[0];
  assert.equal(active.querySelectorAll('button').find(node => node.textContent === 'Mark complete').disabled, true, `Placeholder ${key} must prevent completion.`);
  assert.ok(active.querySelectorAll('p').some(node => node.textContent.includes(`To mark complete, add: ${key === 'proof' ? 'proof explanation' : 'reviewer role'}`)), `Missing ${key} must be visible.`);
  if (key === 'reviewer') assert.equal(active.querySelectorAll('button').find(node => node.textContent === 'Needs work').disabled, true, 'A placeholder reviewer must prevent a completion verdict.');
  await active.querySelectorAll('button').find(node => node.textContent === '×').click(); await review;
  rows.get('R-001')[key] = saved;
}
const savedRows = [...rows].map(([id, item]) => [id, clone(item)]);
for (const item of rows.values()) Object.assign(item, {status: 'Verified', owners: ['Example engineer'], proof: 'Fictional saved proof.', reviewer: 'Example reviewer', reviewedAt: '2026-11-19T12:00:00Z'});
const reports = openCompletion({doc, api});
await new Promise(resolve => setImmediate(resolve));
const reportDialog = body.children[0];
const reportLink = text => reportDialog.querySelectorAll('a').find(node => node.textContent === text);
assert.equal(reportLink('Completed report').hidden, false, 'All current completed rows offer the guarded report.');
await reportLink('Completed report').click();
assert.ok(navigations.at(-1).endsWith('/completed-report'));
await reportLink('View delivery report').click();
assert.ok(navigations.at(-1).endsWith('/delivery-report'));
await reportLink('Download with proofs').click();
assert.ok(navigations.at(-1).endsWith('/completion-report'));
const countBeforeStale = navigations.length;
rows.get('R-002').status = 'Needs recheck';
await reportLink('Completed report').click();
assert.equal(navigations.length, countBeforeStale, 'A fresh verification fetch blocks a report after another reviewer changed evidence.');
assert.equal(reportLink('Completed report').hidden, true);
assert.ok(reportDialog.querySelectorAll('p').some(node => node.textContent.includes('Some requirements now need review.')));
const notes = reportDialog.querySelectorAll('textarea').find(node => node.id === 'completion-notes');
notes.value = 'Keep this unsaved review question.'; await notes.fire('input');
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => ({ok: false, status: 422, json: async () => ({error: 'Fictional attachment error.'})});
const upload = reportDialog.querySelectorAll('input').find(node => node.id === 'completion-file');
upload.files = [{name: 'fictional-proof.txt', size: 10}];
await upload.fire('change');
await new Promise(resolve => setImmediate(resolve));
assert.equal(notes.value, 'Keep this unsaved review question.', 'Upload errors preserve entered reviewer notes.');
assert.equal(rows.get('R-001').proof, 'Fictional saved proof.');
assert.ok(reportDialog.querySelectorAll('p').some(node => node.textContent === 'Fictional attachment error.'));
globalThis.fetch = previousFetch;
await reportDialog.querySelectorAll('button').find(node => node.textContent === '×').click(); await reports;
for (const [id, item] of savedRows) rows.set(id, item);
const emptyDoc = {...doc, sections: {requirements: []}};
const emptyReport = openCompletion({doc: emptyDoc, api: async () => ({documentId: doc.id, prdRevision: doc.revision, items: []})});
await new Promise(resolve => setImmediate(resolve));
assert.equal(body.children[0].querySelectorAll('a').find(node => node.textContent === 'Completed report').hidden, true, 'An empty PRD cannot offer a completed report.');
await body.children[0].querySelectorAll('button').find(node => node.textContent === '×').click(); await emptyReport;
console.log(`Completion UI self-check passed: owner/proof saves, explicit verdict, invalidation, unsaved close/switch guards, CAS conflict preservation, PRD separation, missing-content verdict gates (${apiCalls} API calls).`);
