import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {useCaseChoices, useCaseInfo, useCaseText, useCaseControl, refreshUseCaseControls} from './ui/use-cases.js';

const cases = [
  'UC-01: A member borrows a tool.\nUC-02: A member returns a tool.',
  '- U-001 — A member keeps 😀 work.\n* A member shares a draft.',
  'UC-01: First meaning\nUC-01: Conflicting meaning\nUC-02: Clear meaning',
  'UC-01: Same meaning\nUC-01: Same meaning\nUC-99',
  '',
];
const python = JSON.parse(execFileSync('python3', ['-c', 'import json,sys; from use_cases import use_case_choices; print(json.dumps([use_case_choices(v) for v in json.load(sys.stdin)]))'], {input: JSON.stringify(cases), encoding: 'utf8', cwd: new URL('.', import.meta.url)}));
assert.deepEqual(cases.map(useCaseChoices), python, 'Browser and backend parse the same named choices.');
const definitions = cases[0];
const req = {id: 'R-001', appliesTo: 'UC-01'};
const doc = {id: 'fictional-doc', revision: 3, status: 'Approved', sections: {useCases: definitions, requirements: [req]}};
const context = {documentId: doc.id, prdRevision: 3, useCases: definitions, labels: {'R-001': {value: 'UC-01', label: 'A member borrows a tool.', reference: 'UC-01', imported: false}}};
assert.equal(useCaseInfo(doc, req, context).label, 'A member borrows a tool.');
assert.equal(useCaseInfo(doc, req, null).label, 'Use case description missing', 'Unavailable context must not guess an imported code’s meaning.');
assert.equal(useCaseInfo(doc, {...req, appliesTo: 'UC-01, UC-02'}, context).label, 'A member borrows a tool.; A member returns a tool.');
assert.equal(useCaseInfo(doc, {...req, appliesTo: 'UC-99'}, context).label, 'Use case description missing');
assert.equal(useCaseInfo(doc, {...req, appliesTo: 'A member chooses several situations.'}, context).label, 'A member chooses several situations.');
assert.equal(useCaseInfo({...doc, sections: {...doc.sections, useCases: cases[2]}}, req, context).label, 'Use case description missing');
const imported = {...context, labels: {'R-001': {...context.labels['R-001'], label: 'A participant signs up.', imported: true}}};
assert.equal(useCaseInfo(doc, req, imported).label, 'A participant signs up.', 'Imported source context wins over a destination code collision.');
assert.equal(useCaseText(doc, req, context), 'A member borrows a tool. (reference: UC-01)');

class Node {
  constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.value = ''; this.hidden = false; }
  append(...nodes) { this.children.push(...nodes); }
  setAttribute(key, value) { this.attributes[key] = value; }
  getAttribute(key) { return this.attributes[key]; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  focus() { document.activeElement = this; }
  querySelectorAll(selector) { return this.children.flatMap(node => [...((selector.startsWith('[') ? node.attributes[selector.slice(1, -1)] : node.tag === selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
}
globalThis.document = {createElement: tag => new Node(tag)};
globalThis.Option = function(text, value) { const node = new Node('option'); node.textContent = text; node.value = value; return node; };
let edits = 0;
const before = JSON.stringify(doc);
const control = useCaseControl(doc, req, () => context, () => edits++);
assert.equal(JSON.stringify(doc), before, 'Rendering never rewrites legacy references, approval or requirements.');
assert.equal(edits, 0);
const select = control.querySelectorAll('select')[0];
const custom = control.querySelectorAll('textarea')[0];
assert.equal(select.value, 'saved');
const description = control.querySelectorAll('[data-use-case-description]')[0];
assert.equal(description.textContent, '', 'A chosen use case is not repeated below the picker.');
assert.equal(description.hidden, true);
assert.equal(select.title, 'A member borrows a tool.', 'The full description stays available on the picker.');
assert.ok(select.children.some(option => option.textContent === 'A member borrows a tool.'));
assert.ok(select.children.every(option => !/^UC-/.test(option.textContent)), 'Choices use descriptions, including the saved legacy reference.');
refreshUseCaseControls(control, doc, imported);
assert.equal(select.children.find(option => option.value === 'saved').textContent, 'Current: A participant signs up.');
assert.equal(description.hidden, true, 'Refreshing labels keeps the chosen use case out of the hint.');
for (const [appliesTo, expected] of [['', 'Choose a use case, or write a description.'], ['UC-99', 'Use case description missing. Choose a use case from the list, or write a description.']]) {
  const other = {id: 'R-002', appliesTo};
  const hint = useCaseControl({...doc, sections: {...doc.sections, requirements: [req, other]}}, other, () => null, () => {}).querySelectorAll('[data-use-case-description]')[0];
  assert.equal(hint.textContent, expected, 'Prompts and missing-description warnings stay visible.');
  assert.equal(hint.hidden, false);
}
assert.equal(req.appliesTo, 'UC-01');
select.value = 'case-1'; select.listeners.change();
assert.equal(req.appliesTo, 'A member returns a tool.');
assert.equal(edits, 1);
select.value = 'saved'; select.listeners.change();
assert.equal(req.appliesTo, 'UC-01', 'The existing value can be restored before saving.');
select.value = 'custom'; select.listeners.change();
assert.equal(custom.hidden, false);
assert.equal(document.activeElement, custom);
custom.value = 'A member borrows a tool.\nA member returns it.'; custom.listeners.input();
assert.equal(req.appliesTo, custom.value);
assert.equal(doc.status, 'Approved', 'Only the normal Save flow creates a new draft revision.');
for (const original of ['', 'UC-99', 'UC-01; UC-02', 'All fictional situations']) {
  const working = {...req, appliesTo: original};
  useCaseControl(doc, working, () => null, () => { throw new Error('Unexpected edit'); });
  assert.equal(working.appliesTo, original);
}
for (const original of ['UC-01', 'UC-01, UC-99']) {
  const working = {...req, appliesTo: original};
  let loaded = null, changed = 0;
  const field = useCaseControl(doc, working, () => loaded, () => changed++);
  loaded = context;
  refreshUseCaseControls(field, doc, loaded);
  const selector = field.querySelectorAll('select')[0], input = field.querySelectorAll('textarea')[0];
  selector.value = 'custom'; selector.listeners.change();
  assert.equal(working.appliesTo, original, 'Showing a custom field must not clear or rewrite the saved scope.');
  assert.equal(changed, 0);
  assert.equal(input.value, original === 'UC-01' ? 'A member borrows a tool.' : original);
  input.value = 'A member borrows and returns a tool.'; input.listeners.input();
  selector.value = 'case-1'; selector.listeners.change();
  selector.value = 'custom'; selector.listeners.change();
  assert.equal(working.appliesTo, input.value, 'Returning to a written custom scope preserves that draft.');
}
console.log('Use cases passed: shared parsing, readable choices, source context, ambiguity, custom scope and unchanged saved references.');
