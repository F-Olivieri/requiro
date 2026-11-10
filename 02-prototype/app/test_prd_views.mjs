import assert from 'node:assert/strict';
import {renderPrdView} from './ui/prd-views.js';

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.value = ''; }
  set textContent(value) { this.value = value; this.children = []; }
  get textContent() { return this.value + this.children.map(child => child.textContent).join('\n'); }
  set innerHTML(_) { throw new Error('PRD values must use textContent.'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.value = ''; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  query(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.query(tag)]); }
}
globalThis.document = {createElement: tag => new Node(tag)};
const sectionKeys = ['problem', 'users', 'outcomes', 'useCases', 'scope', 'nonGoals', 'inputsOutputs', 'quality', 'metrics', 'risks', 'decisions', 'evidence'];
const doc = {id: 'fictional-doc', title: 'Fictional reading list', revision: 4, status: 'Draft', approvedRevision: null,
  sections: Object.fromEntries(sectionKeys.map(key => [key, `Fictional ${key} text\nwith a second line.`]))};
doc.sections.requirements = [1, 2].map(number => ({id: `R-00${number}`, priority: number === 1 ? 'Must' : 'Nice to have', proposed: number === 2,
  behavior: `Fictional behavior ${number} <img src=x onerror=alert(1)>`, appliesTo: `Fictional use case ${number}`,
  outcome: `Fictional outcome ${number}`, acceptance: `Fictional acceptance ${number}`}));
const verification = {documentId: doc.id, prdRevision: 4, items: doc.sections.requirements.map((req, index) => ({requirementId: req.id,
  owners: ['Test engineer'], proof: `Fictional proof ${index}`, attachments: [{id: `proof-${index}`, name: 'proof <b>one</b>.txt'}],
  status: index ? 'To discuss' : 'Verified', reviewer: 'Test lead', reviewedAt: '2026-11-09T12:00:00Z',
  baselinePrdRevision: 4, reviewNotes: `Fictional review note ${index}`}))};
const baseline = JSON.stringify({doc, verification});
function freeze(value) { Object.freeze(value); for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); }
freeze(doc); freeze(verification);
const container = new Node('div');
let selected;
for (const mode of ['document', 'table', 'document']) {
  renderPrdView(container, {doc, mode, verification, onReview: id => { selected = id; }});
  const content = container.textContent;
  for (const key of sectionKeys) assert.ok(content.includes(doc.sections[key]), `${mode} preserves ${key}.`);
  for (const req of doc.sections.requirements) {
    for (const key of ['id', 'behavior', 'appliesTo', 'outcome', 'acceptance']) assert.ok(content.includes(req[key]), `${mode} preserves ${req.id} ${key}.`);
  }
  for (const item of verification.items) {
    for (const key of ['proof', 'reviewer', 'reviewedAt', 'reviewNotes']) assert.ok(content.includes(item[key]), `${mode} preserves review ${key}.`);
    assert.ok(content.includes(item.attachments[0].name));
  }
  assert.ok(content.includes('Complete') && content.includes('To discuss') && !content.includes('Verified'));
  assert.ok(content.includes('Nice to have (proposed)'));
  assert.ok(content.includes(doc.id) && content.includes('revision 4'));
  assert.equal(container.query('img').length, 0, 'Markup in values stays literal text.');
  const links = container.query('a');
  assert.equal(links[0].href, '/api/prds/fictional-doc/verification/R-001/attachments/proof-0');
  assert.equal(links[0].download, 'proof <b>one</b>.txt');
  const buttons = container.query('button'); buttons.find(node => node.attributes['aria-label'] === 'Change status R-002').listeners.click();
  assert.equal(selected, 'R-002', 'Both views open the same requirement review.');
  selected = null;
  buttons.find(node => node.attributes['aria-label'] === 'Change review status for R-002: To discuss').listeners.click();
  assert.equal(selected, 'R-002', 'Clicking the status selects the same requirement as its Action control.');
  if (mode === 'table') {
    assert.equal(container.query('thead')[0].query('th').length, 6);
    assert.equal(container.query('tbody')[0].query('tr').length, 2);
    assert.ok(container.query('details').length >= 3, 'Full details and context remain expandable.');
  }
  assert.equal(JSON.stringify({doc, verification}), baseline, 'Switching views never mutates PRD or review data.');
}
for (const mode of ['document', 'table']) {
  const edited = [];
  renderPrdView(container, {doc, mode, verification, onEditSection: key => edited.push(key)});
  const buttons = container.query('button').filter(node => node.attributes['data-edit-section']);
  assert.equal(buttons.length, sectionKeys.length, `${mode} offers editing for every text section.`);
  for (const button of buttons) {
    assert.ok(button.attributes['aria-label'].startsWith('Edit '));
    assert.equal(button.type, 'button');
    button.listeners.click();
  }
  assert.deepEqual(edited, sectionKeys, 'Each Edit button routes to its own field.');
  assert.equal(JSON.stringify({doc, verification}), baseline, 'Edit navigation preserves PRD and review data.');
}
renderPrdView(container, {doc, mode: 'table', verification, savedRevision: null});
assert.ok(container.textContent.includes('Needs recheck') && !container.textContent.includes('Complete'), 'Unsaved draft cannot display an old completion as current.');
assert.ok(container.textContent.includes('To discuss'), 'Open discussion stays pending on a draft.');
renderPrdView(container, {doc, mode: 'table', verification, savedRevision: null, onReview: () => {}});
const draftAction = container.query('button').find(node => node.attributes['aria-label'] === 'Save + change R-001');
assert.equal(draftAction.textContent, 'Save + change', 'The table uses a compact action label.');
assert.equal(draftAction.attributes['aria-label'], 'Save + change R-001', 'Saving before review and its requirement remain explicit.');
renderPrdView(container, {doc, mode: 'document', verification: {...verification, documentId: 'another-doc'}});
assert.ok(container.textContent.includes('Review not loaded') && !container.textContent.includes('Fictional proof'), 'Another document’s review is never displayed.');
renderPrdView(container, {doc, mode: 'document', verification: {...verification, prdRevision: 3}});
assert.ok(container.textContent.includes('Needs recheck'), 'Earlier revision proof cannot mark the current PRD Complete.');
renderPrdView(container, {doc: {...doc, sections: {...doc.sections, requirements: []}}, mode: 'table'});
assert.ok(container.textContent.includes('No requirements documented.'));
assert.equal(container.query('button').length, 0, 'No review action is added without a shared callback.');
assert.throws(() => renderPrdView(container, {doc, mode: 'spreadsheet'}), /Document or Table/);
console.log('PRD views passed: shared data, full text and metadata, safe text, review links, draft/revision gates and empty state.');
