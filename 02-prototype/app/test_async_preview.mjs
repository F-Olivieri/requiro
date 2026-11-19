import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Exercise real async refresh handlers without running a browser or touching storage.
const source = readFileSync(new URL('./ui/app.js', import.meta.url), 'utf8');
const context = vm.createContext({console, JSON, setTimeout, clearTimeout});
vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function '), context);
let selected = false, paints = 0;
const listeners = new Map(), pending = [];
context.document = {
  getSelection: () => ({isCollapsed: !selected}),
  querySelector: () => ({}),
  addEventListener: (type, handler) => listeners.set(type, handler),
};
context.paint = () => { paints++; };
context.api = path => new Promise(resolve => pending.push({path, resolve}));
context.refreshUseCaseControls = () => {};
context.stopSetup = new Error('Stop after registering the real selection handler.');
vm.runInContext('renderPreview=paint; updateControls=()=>{}; trackDialogFocus=()=>{}; initWorkspaceControls=()=>{throw stopSetup}', context);
await assert.rejects(vm.runInContext('init()', context), error => error === context.stopSetup);
assert.equal(typeof listeners.get('selectionchange'), 'function');
const run = code => vm.runInContext(code, context);
const fixture = id => ({id, revision: 1, sections: {requirements: [{id: 'R-001', appliesTo: 'UC-01'}]}});
function reset() {
  context.fixture = fixture('PRD-fictional');
  run('state.saved=clone(fixture); state.doc=clone(fixture); state.view="document"; state.commentCounts=null; state.linksSnapshot=null; state.useCasesContext=null; state.verification=null; previewDeferred=false');
  selected = false; paints = 0; pending.length = 0;
}
const lanes = [
  {name: 'comments', call: 'refreshCommentCounts()', field: 'commentCounts', reply: marker => ({documentId: 'PRD-fictional', prdRevision: 1, threads: [{id: marker, requirementId: 'R-001', status: 'Open', messages: []}]})},
  {name: 'links', call: 'refreshRequirementLinks()', field: 'linksSnapshot', reply: marker => ({marker, nodes: [], links: [], references: []})},
  {name: 'use cases', call: 'refreshUseCases()', field: 'useCasesContext', reply: marker => ({documentId: 'PRD-fictional', prdRevision: 1, marker, labels: {'R-001': {value: 'UC-01', label: marker, imported: false}}})},
  {name: 'verification', call: 'refreshVerification()', field: 'verification', reply: marker => ({documentId: 'PRD-fictional', prdRevision: 1, marker, items: []})},
];
for (const lane of lanes) {
  reset();
  const refresh = run(lane.call), beforeResponse = paints;
  assert.equal(pending.length, 1);
  selected = true;
  pending[0].resolve(lane.reply('new-data'));
  await refresh;
  assert.equal(paints, beforeResponse, `${lane.name}: a selection begun during the request must survive its response`);
  assert.equal(run('previewDeferred'), true);
  assert.notEqual(run(`state.${lane.field}`), null, `${lane.name}: store the new snapshot while deferring paint`);
  selected = false;
  listeners.get('selectionchange')();
  assert.equal(paints, beforeResponse + 1, `${lane.name}: collapse flushes the stored snapshot once`);
  assert.equal(run('previewDeferred'), false);

  reset();
  const stale = run(lane.call), beforeStaleResponse = paints;
  context.other = fixture('PRD-other');
  run('state.saved=clone(other); state.doc=clone(other)');
  pending[0].resolve(lane.reply('wrong-document'));
  await stale;
  assert.equal(run(`state.${lane.field}`), null, `${lane.name}: discard a response for the previous document`);
  assert.equal(paints, beforeStaleResponse);

  reset();
  const first = run(lane.call), second = run(lane.call);
  pending[1].resolve(lane.reply('latest'));
  await second;
  const newest = run(`JSON.stringify(state.${lane.field})`), afterNewest = paints;
  pending[0].resolve(lane.reply('outdated'));
  await first;
  assert.equal(run(`JSON.stringify(state.${lane.field})`), newest, `${lane.name}: an older response cannot replace a newer one`);
  assert.equal(paints, afterNewest);
}
console.log('Async preview checks passed: four real refresh handlers preserve in-flight selections, flush after collapse, and discard stale-document and superseded responses.');
