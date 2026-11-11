import assert from 'node:assert/strict';
import {renderPrdView} from './ui/prd-views.js';
import {formatDateTime} from './ui/format.js';

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
    for (const key of ['proof', 'reviewer', 'reviewNotes']) assert.ok(content.includes(item[key]), `${mode} preserves review ${key}.`);
    assert.ok(content.includes(formatDateTime(item.reviewedAt)) && !content.includes(item.reviewedAt), `${mode} shows the review date in local time.`);
    assert.ok(content.includes(item.attachments[0].name));
  }
  assert.ok(content.includes('Complete') && content.includes('To discuss') && !content.includes('Verified'));
  assert.ok(content.includes('Nice to have (not yet agreed)') && !content.includes('(proposed)'));
  assert.ok(content.includes(doc.id) && content.includes('v4') && !content.includes('revision 4'));
  assert.equal(container.query('img').length, 0, 'Markup in values stays literal text.');
  const links = container.query('a');
  assert.equal(links[0].href, '/api/prds/fictional-doc/verification/R-001/attachments/proof-0');
  assert.equal(links[0].download, 'proof <b>one</b>.txt');
  const buttons = container.query('button'); buttons.find(node => node.attributes['aria-label'] === 'Change status R-002').listeners.click();
  assert.equal(selected, 'R-002', 'Both views open the same requirement review.');
  selected = null;
  buttons.find(node => node.attributes['aria-label'] === 'Change delivery status for R-002: To discuss').listeners.click();
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
const coded = {...doc, sections: {...doc.sections, useCases: 'UC-01: A member borrows a tool.', requirements: doc.sections.requirements.map(req => ({...req, appliesTo: 'UC-01'}))}};
const context = {documentId: doc.id, prdRevision: 4, useCases: coded.sections.useCases,
  labels: {'R-001': {value: 'UC-01', label: 'A member borrows a tool.', reference: 'UC-01', imported: false},
    'R-002': {value: 'UC-01', label: 'A participant signs up.', reference: 'UC-01', imported: true}}};
const codedBefore = JSON.stringify(coded);
for (const mode of ['document', 'table']) {
  renderPrdView(container, {doc: coded, mode, useCasesContext: context});
  assert.ok(container.textContent.includes('A participant signs up.'), 'Imported use case keeps its original meaning.');
  const marked = container.query('span').filter(node => node.attributes['data-comment-field'] === 'appliesTo');
  assert.equal(marked.length, 2);
  assert.ok(marked.every(node => node.textContent === 'UC-01'), 'Existing comment anchors retain the exact saved text.');
  assert.equal(JSON.stringify(coded), codedBefore, 'Readable presentation never rewrites stored references.');
}
renderPrdView(container, {doc, mode: 'table', verification, savedRevision: null});
assert.ok(container.textContent.includes('Needs recheck') && !container.textContent.includes('Complete'), 'Unsaved draft cannot display an old completion as current.');
assert.ok(container.textContent.includes('To discuss'), 'Open discussion stays pending on a draft.');
const otherEdit = {...doc, sections: {...doc.sections, problem: 'Edited fictional problem.', requirements: doc.sections.requirements.map(req => req.id === 'R-002' ? {...req, behavior: 'Edited fictional behavior.'} : req)}};
renderPrdView(container, {doc: otherEdit, mode: 'table', verification, savedRevision: null, savedDoc: doc});
assert.ok(container.textContent.includes('Complete') && !container.textContent.includes('Needs recheck'), 'Unsaved edits to other sections and requirements keep an unchanged Complete.');
const ownEdit = {...doc, sections: {...doc.sections, requirements: doc.sections.requirements.map(req => req.id === 'R-001' ? {...req, acceptance: 'Edited fictional acceptance.'} : req)}};
renderPrdView(container, {doc: ownEdit, mode: 'table', verification, savedRevision: null, savedDoc: doc});
assert.ok(container.textContent.includes('Needs recheck') && !container.textContent.includes('Complete'), 'Unsaved acceptance changes need a recheck.');
renderPrdView(container, {doc, mode: 'table', verification, savedRevision: null, onReview: () => {}});
const draftAction = container.query('button').find(node => node.attributes['aria-label'] === 'Save + change R-001');
assert.equal(draftAction.textContent, 'Save + change', 'The table uses a compact action label.');
assert.equal(draftAction.attributes['aria-label'], 'Save + change R-001', 'Saving before review and its requirement remain explicit.');
renderPrdView(container, {doc, mode: 'document', verification: {...verification, documentId: 'another-doc'}});
assert.ok(container.textContent.includes('Delivery review not loaded') && !container.textContent.includes('Fictional proof'), 'Another document’s review is never displayed.');
renderPrdView(container, {doc, mode: 'document', verification: {...verification, prdRevision: 3}});
assert.ok(container.textContent.includes('Needs recheck'), 'Earlier revision proof cannot mark the current PRD Complete.');
renderPrdView(container, {doc: {...doc, sections: {...doc.sections, requirements: []}}, mode: 'table'});
assert.ok(container.textContent.includes('No requirements documented.'));
assert.equal(container.query('button').length, 0, 'No review action is added without a shared callback.');
for (const mode of ['document', 'table']) {
  const comments = [];
  const blank = {...doc, sections: {...doc.sections, requirements: [...doc.sections.requirements, {id: 'R-003', priority: 'Must', behavior: '', appliesTo: '', outcome: '', acceptance: ''}]}};
  renderPrdView(container, {doc: blank, mode, onComment: payload => comments.push(payload)});
  const starts = container.query('button').filter(node => node.textContent === 'Comment');
  assert.equal(starts.length, 3, `${mode} offers Comment on every requirement.`);
  assert.equal(starts[0].attributes['aria-label'], 'Comment on R-001 wording');
  assert.equal(starts[2].hidden, true, 'A requirement with no wording has nothing to anchor a comment to.');
  starts[0].listeners.click();
  const text = doc.sections.requirements[0].behavior;
  assert.deepEqual(comments, [{requirementId: 'R-001', anchor: {field: 'behavior', start: 0, end: text.length, quote: text, sourceText: text}}], 'Comment needs no text selection and anchors to the whole saved field.');
}
for (const mode of ['document', 'table']) {
  const comments = [];
  renderPrdView(container, {doc, mode, verification, commentCounts: {'R-002': 2}, onComment: payload => comments.push(payload), onReview: () => {}});
  const buttons = container.query('button');
  const counted = buttons.find(node => node.attributes['aria-label'] === 'Comments for R-002, 2 open');
  assert.equal(counted?.textContent, 'Comments (2)', `${mode} shows open discussions on the one comment control.`);
  assert.equal(buttons.find(node => node.attributes['aria-label'] === 'Comment on R-001 wording').textContent, 'Comment');
  assert.equal(buttons.filter(node => /^Comments?\b/.test(node.textContent) && node.attributes['data-focus-key']?.endsWith(':R-002')).length, 1, `${mode} shows a single comment control per requirement.`);
  counted.listeners.click();
  const text = doc.sections.requirements[1].behavior;
  assert.deepEqual(comments, [{requirementId: 'R-002', anchor: {field: 'behavior', start: 0, end: text.length, quote: text, sourceText: text}, browse: true}], 'Comments (N) opens the list and still offers a new comment.');
  const keys = buttons.map(node => node.attributes['data-focus-key']).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length, `${mode} gives each control a distinct focus key so focus survives re-rendering.`);
  assert.ok(['comment:R-002', 'review:R-002', 'status:R-002'].every(key => keys.includes(key)));
  assert.ok(!keys.includes('comments:R-002'), 'The separate Comments link is gone.');
  renderPrdView(container, {doc: {...doc, sections: {...doc.sections, requirements: [{id: 'R-009', priority: 'Must', behavior: '', appliesTo: '', outcome: '', acceptance: ''}]}}, mode, commentCounts: {'R-009': 1}, onComment: () => {}});
  assert.equal(container.query('button').find(node => node.textContent === 'Comments (1)')?.hidden, false, 'Open discussions stay reachable when the wording was cleared.');
}
const sparse = {...verification, items: verification.items.map(item => ({...item, owners: [], proof: '', reviewer: '', reviewedAt: null, reviewNotes: '', baselinePrdRevision: null, attachments: []}))};
const byClass = (root, name) => [...(root.className?.split(' ').includes(name) ? [root] : []), ...root.children.flatMap(child => byClass(child, name))];
renderPrdView(container, {doc, mode: 'document', verification: sparse, onReview: () => {}});
assert.equal(byClass(container, 'prd-view-requirement').length, 2);
for (const card of byClass(container, 'prd-view-requirement')) {
  assert.equal(byClass(card, 'prd-view-status').length, 1, 'Each Document requirement shows its status badge once.');
  assert.equal(card.query('dd').filter(node => /^(Not recorded|None recorded|None attached|Not assigned)$/.test(node.textContent)).length, 0, 'Empty details are not listed one by one.');
  assert.equal(byClass(card, 'prd-view-missing')[0].textContent, 'engineering owners, proof, reviewer role, review date, review notes, proof version, attachments');
}
renderPrdView(container, {doc, mode: 'table', verification, onReview: () => {}});
for (const row of container.query('tbody')[0].query('tr')) {
  const details = byClass(row, 'prd-view-row-details')[0];
  const behavior = byClass(row, 'prd-view-table-behavior')[0].textContent;
  assert.ok(!details.textContent.includes(behavior), 'Table details do not repeat the requirement text.');
  assert.equal(byClass(row, 'prd-view-status').length, 1, 'Each table row shows its status badge once.');
  assert.ok(row.query('td').some(cell => cell.attributes['data-label'] === 'Delivery status'), 'Phone cards can label each value.');
}
renderPrdView(container, {doc: {...doc, status: 'Archived'}, mode: 'document', onEditSection: () => {}});
assert.ok(container.query('button').filter(node => node.attributes['data-edit-section']).every(node => node.attributes['aria-disabled'] === 'true'), 'Archived Edit links are marked disabled and still explain why when chosen.');
renderPrdView(container, {doc, mode: 'document', onEditSection: () => {}});
assert.ok(container.query('button').filter(node => node.attributes['data-edit-section']).every(node => !node.attributes['aria-disabled']));
assert.throws(() => renderPrdView(container, {doc, mode: 'spreadsheet'}), /Document or Table/);
console.log('PRD views passed: shared data, full text and metadata, safe text, review links, draft/revision gates and empty state.');
