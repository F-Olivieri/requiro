import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {validateResponse, buildMarkdown} from './ui/app.js';

// Run with: node test_ui.mjs
const keys = ['problem', 'users', 'outcomes', 'useCases', 'scope', 'nonGoals', 'inputsOutputs', 'quality', 'metrics', 'risks', 'decisions', 'evidence'];
const doc = {
  id: 'fictional-doc',
  title: 'Fictional <script>title</script>',
  revision: 2,
  status: 'Draft',
  approvedRevision: null,
  nextRequirementNumber: 4,
  sections: Object.fromEntries(keys.map(key => [key, key === 'problem' ? 'Raw <b>text</b> with\nnewlines' : ''])),
};
doc.sections.requirements = [{
  id: 'R-001', priority: 'Must', proposed: false, appliesTo: 'UC-01',
  outcome: 'Find a suggestion', behavior: 'Browse the list', acceptance: 'All titles appear',
}];
const response = {
  reply: 'Suggested revision',
  proposal: {documentId: doc.id, baseRevision: 2, changes: {problem: 'Proposed text'}},
};

assert.equal(validateResponse(response, doc).proposal.changes.problem, 'Proposed text');
assert.equal(doc.sections.problem, 'Raw <b>text</b> with\nnewlines', 'Validating a proposal must not mutate the document.');
assert.throws(() => validateResponse({...response, proposal: {...response.proposal, documentId: 'wrong-doc'}}, doc), /different document/);
assert.throws(() => validateResponse({...response, proposal: {...response.proposal, baseRevision: 1}}, doc), /stale/);
assert.throws(() => validateResponse({...response, proposal: {...response.proposal, changes: {approvedRevision: 1}}}, doc), /Unknown/);
assert.throws(() => validateResponse({...response, proposal: {...response.proposal, changes: {
  requirements: [{...doc.sections.requirements[0], id: 'R-002'}],
}}}, doc), /retired/);
assert.throws(() => validateResponse({...response, proposal: {...response.proposal, changes: {
  requirements: [{...doc.sections.requirements[0], id: 'R-004', proposed: 'true'}],
}}}, doc), /boolean/);
assert.equal(validateResponse({...response, proposal: {...response.proposal, changes: {
  requirements: [...doc.sections.requirements, {...doc.sections.requirements[0], id: 'R-004'}],
}}}, doc).proposal.changes.requirements.length, 2);
assert.ok(buildMarkdown(doc).includes('Raw <b>text</b> with\nnewlines'), 'Preview must preserve entered text and newlines.');
assert.ok(buildMarkdown(doc).includes('Document ID: fictional-doc'), 'Preview must identify its document.');
assert.ok(buildMarkdown(doc).includes('R-001'), 'Preview must preserve stable requirement IDs.');

// Exercise the real control updater without adding a browser or exporting app internals.
// Loading the script without a document skips its normal bootstrap; inject only
// the controls used when a saved library exists but no PRD has been opened yet.
const source = readFileSync(new URL('./ui/app.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function '), context);
const controls = new Map();
const libraryButtons = [{disabled: false}, {disabled: false}];
context.document = {
  querySelector(selector) {
    if (!controls.has(selector)) controls.set(selector, {disabled: false});
    return controls.get(selector);
  },
  querySelectorAll(selector) {
    if (selector === '#doc-list button') return libraryButtons;
    assert.ok(['#prd-visualization button', '#editor-content input, #editor-content textarea, #editor-content select, #editor-content button[data-edit]', '[data-document-action]', '#proposal button'].includes(selector), selector);
    return [];
  },
};
vm.runInContext('state.busy = true; updateControls();', context);
assert.ok(libraryButtons.every(button => button.disabled), 'Library controls must disable during initial loading.');
vm.runInContext('state.busy = false; updateControls();', context);
assert.ok(libraryButtons.every(button => !button.disabled), 'Reload must reenable saved PRDs even when no PRD is active.');

// Both visualizations read the same working record; switching never calls a save.
const rendered = [];
context.renderPrdView = (container, options) => rendered.push(options);
for (const node of controls.values()) {
  node.classList = {toggle() {}};
  node.setAttribute = () => {};
}
context.document.querySelector = selector => {
  if (!controls.has(selector)) controls.set(selector, {classList: {toggle() {}}, setAttribute() {}});
  return controls.get(selector);
};
context.fixture = structuredClone(doc);
vm.runInContext('state.doc = fixture; state.saved = clone(fixture); state.view = "document"; renderPreview(); state.view = "table"; renderPreview();', context);
assert.deepEqual(rendered.map(item => item.mode), ['document', 'table']);
assert.equal(rendered[0].doc, rendered[1].doc, 'Views must use the same working PRD object.');
assert.equal(JSON.stringify(context.fixture), JSON.stringify(doc), 'Switching must preserve every field and ID.');
vm.runInContext('state.doc.sections.requirements[0].behavior = "Unsaved draft behavior"; state.view = "document"; renderPreview(); state.view = "table"; renderPreview();', context);
assert.equal(rendered.at(-1).doc.sections.requirements[0].behavior, 'Unsaved draft behavior');
assert.equal(rendered.at(-1).savedRevision, null, 'Unsaved drafts must not inherit a completion verdict.');
assert.equal(vm.runInContext('state.saved.sections.requirements[0].behavior', context), 'Browse the list', 'Switching must not save the draft.');
assert.equal(controls.get('#preview-note').textContent.includes('unsaved edits'), true);

// An earlier review fetch must not overwrite a newer review for the same PRD revision.
context.renderPreview = () => {};
const pendingReviews = [];
context.api = () => new Promise(resolve => pendingReviews.push(resolve));
const olderLoad = vm.runInContext('refreshVerification()', context);
const newerLoad = vm.runInContext('refreshVerification()', context);
pendingReviews[1]({documentId: doc.id, prdRevision: doc.revision, items: [{status: 'To discuss'}]});
await newerLoad;
pendingReviews[0]({documentId: doc.id, prdRevision: doc.revision, items: [{status: 'Not reviewed'}]});
await olderLoad;
assert.equal(vm.runInContext('state.verification.items[0].status', context), 'To discuss');

// The shared review action must preserve a dirty draft when acknowledgement is removed.
let saves = 0;
let reviewTarget;
let acknowledgement = '';
context.save = async () => { saves++; };
context.openCompletion = async options => { reviewTarget = options.requirementId; };
context.refreshVerification = async () => {};
context.message = value => { acknowledgement = value; };
context.document.querySelector('#privacy-consent').focus = () => {};
vm.runInContext('state.consent = false;', context);
await vm.runInContext('reviewDelivery("R-001")', context);
assert.equal(saves, 0);
assert.equal(reviewTarget, undefined);
assert.ok(acknowledgement.includes('Acknowledge'));
assert.equal(vm.runInContext('state.doc.sections.requirements[0].behavior', context), 'Unsaved draft behavior');
vm.runInContext('state.consent = true;', context);
await vm.runInContext('reviewDelivery("R-001")', context);
assert.equal(saves, 1);
assert.equal(reviewTarget, 'R-001');

let statusChoosers = 0;
context.openRequirementStatus = async options => { statusChoosers++; assert.equal(options.requirementId, 'R-001'); return {}; };
context.document.querySelector('#save-prd').focus = () => {};
await vm.runInContext('changeReviewStatus("R-001")', context);
assert.equal(statusChoosers, 0, 'A status click must not silently save a dirty PRD.');
assert.equal(saves, 1);
assert.ok(acknowledgement.includes('Save your draft'));
await vm.runInContext('changeReviewStatus("R-001", {saveDraft:true})', context);
assert.equal(statusChoosers, 1, 'The explicit Save + change action opens the status chooser.');
assert.equal(saves, 2);
vm.runInContext('state.consent = false;', context);
await vm.runInContext('changeReviewStatus("R-001", {saveDraft:true})', context);
assert.equal(saves, 2, 'The new action keeps the existing material-use guard.');
assert.equal(statusChoosers, 1);

// Library badges and filters read saved metadata, including nondefault values.
class LibraryNode {
  constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute() {}
  addEventListener() {}
}
context.document.createElement = tag => new LibraryNode(tag);
controls.set('#doc-list', new LibraryNode('nav'));
controls.set('#search', {value: ''});
controls.set('#status-filter', {value: ''});
controls.set('#project-filter', {value: ''});
context.libraryFixture = [{id: 'one', title: 'A <b>literal</b> title', status: 'Approved', revision: 7, stage: 'Review', projectIds: ['p1']}, {id: 'two', title: 'Other PRD', status: 'Draft', revision: 2, stage: 'Scope', projectIds: ['p2']}];
vm.runInContext('state.doc = null; state.docs = libraryFixture; renderLibrary();', context);
let library = controls.get('#doc-list');
assert.deepEqual(library.children[0].children.map(node => node.textContent), ['A <b>literal</b> title', 'Approved', 'v7', 'Review']);
assert.equal(library.children[0].children[1].dataset.status, 'Approved');
controls.get('#project-filter').value = 'p2';
vm.runInContext('renderLibrary()', context);
assert.equal(library.children.length, 1);
assert.equal(library.children[0].children[0].textContent, 'Other PRD');
controls.get('#status-filter').value = 'Approved';
vm.runInContext('renderLibrary()', context);
assert.equal(library.children[0].textContent, 'No PRDs match this search.');

// 2026-11-09: unsent chat questions must survive saves and failed packet preparation.
const composeContext = vm.createContext({});
vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function '), composeContext);
const composeControls = new Map();
const browserEvents = new Map();
composeContext.document = {
  querySelector(selector) {
    if (!composeControls.has(selector)) composeControls.set(selector, {
      value: '', dataset: {}, classList: {toggle() {}}, setAttribute() {},
      addEventListener() {}, focus() {}, select() {}, showModal() {},
    });
    return composeControls.get(selector);
  },
  querySelectorAll() { return []; },
};
composeContext.window = {addEventListener: (name, handler) => browserEvents.set(name, handler)};
composeContext.navigator = {clipboard: {writeText: async () => { throw new Error('Clipboard unavailable in this check.'); }}};
composeContext.initWorkspaceControls = () => {};
vm.runInContext('updateSummary=()=>{}; renderStageNav=()=>{}; renderEditor=()=>{}; renderStageFooter=()=>{}; renderPreview=()=>{}; renderConversation=()=>{}; renderProposal=()=>{}; updateControls=()=>{}; refreshVerification=()=>{}; refreshLibrary=async()=>{}; message=()=>{};', composeContext);
const composeFixture = {...structuredClone(doc), stage: 'Discover', chat: []};
composeContext.fixture = composeFixture;
vm.runInContext('state.doc=clone(fixture); state.saved=clone(fixture); state.consent=true;', composeContext);
const compose = composeContext.document.querySelector('#chat-message');
const puts = [];
let packetFails = false;
composeContext.api = async (path, method, data) => {
  if (method === 'PUT') { puts.push(structuredClone(data)); return {...structuredClone(data.doc), revision: data.expectedRevision + 1}; }
  assert.ok(path.endsWith('/packet'));
  if (packetFails) throw new Error('The local packet service is unavailable.');
  return {packet: 'Fictional context packet.'};
};
for (let attempt = 1; attempt <= 2; attempt++) {
  compose.value = `Unsent fictional question ${attempt}`;
  vm.runInContext(`state.doc.title="Fictional saved change ${attempt}";`, composeContext);
  await vm.runInContext('save()', composeContext);
  assert.equal(compose.value, `Unsent fictional question ${attempt}`, 'Saving the PRD must preserve the unsent question.');
}
assert.ok(puts.every(body => !JSON.stringify(body).includes('Unsent fictional question')), 'Saving must not send unsent questions to the backend.');
composeContext.firstSaved = vm.runInContext('clone(state.saved)', composeContext);
composeContext.other = {...structuredClone(composeFixture), id: 'other-fictional-doc'};
vm.runInContext('acceptSaved(other)', composeContext);
assert.equal(compose.value, '', 'A question must not carry into another PRD.');
compose.value = 'A question for the other PRD';
vm.runInContext('acceptSaved(firstSaved)', composeContext);
assert.equal(compose.value, 'Unsent fictional question 2', 'Returning to a PRD restores its own unsent question.');
vm.runInContext('acceptSaved({...state.saved,status:"In review",revision:state.saved.revision+1})', composeContext);
assert.equal(compose.value, 'Unsent fictional question 2', 'A same-document status action must preserve the question.');
packetFails = true;
compose.value = '  Keep this question if preparation fails.  ';
vm.runInContext('state.doc.title="Another fictional saved change";', composeContext);
await assert.rejects(vm.runInContext('copyPacket()', composeContext), /packet service is unavailable/);
assert.equal(compose.value, '  Keep this question if preparation fails.  ');
assert.equal(vm.runInContext('state.doc.chat.length', composeContext), 0, 'A failed packet must not add a conversation entry.');
packetFails = false;
await vm.runInContext('copyPacket()', composeContext);
assert.equal(compose.value, '', 'Successful packet preparation consumes the compose draft.');
assert.equal(vm.runInContext('state.doc.chat.at(-1).content', composeContext), 'Keep this question if preparation fails.');
await vm.runInContext('init()', composeContext);
vm.runInContext('state.saved=clone(state.doc);', composeContext);
compose.value = 'Protect this unsent question before reload.';
let prevented = false;
browserEvents.get('beforeunload')({preventDefault() { prevented = true; }});
assert.equal(prevented, true, 'Reload must warn about an unsent compose draft even when the PRD is clean.');
vm.runInContext('acceptSaved(other);', composeContext);
compose.value = '';
prevented = false;
browserEvents.get('beforeunload')({preventDefault() { prevented = true; }});
assert.equal(prevented, true, 'An unsent question in another PRD also needs reload protection.');
vm.runInContext('state.composeDrafts={};', composeContext); compose.value = '';
prevented = false;
browserEvents.get('beforeunload')({preventDefault() { prevented = true; }});
assert.equal(prevented, false, 'No warning is needed after all compose drafts are cleared.');

// 2026-11-09: printing working changes must not claim the saved revision's approval.
const approvedPrintFixture = {...structuredClone(composeFixture), title: 'Saved fictional print title', status: 'Approved', revision: 20, approvedRevision: 20};
composeContext.approvedPrintFixture = approvedPrintFixture;
vm.runInContext('state.doc=clone(approvedPrintFixture); state.saved=clone(approvedPrintFixture);', composeContext);
const savedPrintBaseline = vm.runInContext('JSON.stringify(state.saved)', composeContext);
const beforePrint = browserEvents.get('beforeprint');
const printDocument = composeContext.document.querySelector('#print-document');
for (let attempt = 1; attempt <= 2; attempt++) {
  vm.runInContext(`state.doc.title="Unsaved fictional print title ${attempt}"; state.doc.sections.requirements[0].behavior="Unsaved fictional behavior ${attempt}";`, composeContext);
  const workingBeforePrint = vm.runInContext('JSON.stringify(state.doc)', composeContext);
  beforePrint();
  assert.ok(printDocument.textContent.includes(`Unsaved fictional print title ${attempt}`));
  assert.ok(printDocument.textContent.includes(`Unsaved fictional behavior ${attempt}`));
  assert.match(printDocument.textContent, /^Status: Unsaved draft/m, 'Print must label working changes as an unsaved draft.');
  assert.match(printDocument.textContent, /based on saved revision 20/);
  assert.match(printDocument.textContent, /^Last approved revision: 20$/m, 'The historical approval remains recorded.');
  assert.doesNotMatch(printDocument.textContent, /^Status: Approved$/m);
  assert.doesNotMatch(printDocument.textContent, /^Revision: 20$/m, 'Working changes must not claim to be the saved revision.');
  assert.equal(vm.runInContext('JSON.stringify(state.doc)', composeContext), workingBeforePrint, 'Printing must not mutate the working document.');
  assert.equal(vm.runInContext('JSON.stringify(state.saved)', composeContext), savedPrintBaseline, 'Printing must not mutate the saved baseline.');
}
vm.runInContext('state.doc=clone(state.saved);', composeContext);
compose.value = 'This unsent question does not change the printed PRD.';
beforePrint();
assert.equal(printDocument.textContent, buildMarkdown(approvedPrintFixture), 'A clean saved document keeps its existing Markdown and approval semantics.');
vm.runInContext('state.doc=null;', composeContext);
beforePrint();
assert.equal(printDocument.textContent, 'No PRD is open.');

// 2026-11-09: history must not offer a restore that archived PRDs cannot perform.
class HistoryNode {
  constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.classList = {toggle() {}}; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  querySelectorAll(tag) { return this.children.flatMap(node => [...(node.tag === tag ? [node] : []), ...node.querySelectorAll(tag)]); }
  showModal() { this.open = true; }
  close() { this.open = false; }
  async click() { if (!this.disabled) for (const handler of this.listeners.click || []) await handler(); }
}
const historyContext = vm.createContext({});
vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function '), historyContext);
const historyControls = new Map();
historyContext.document = {
  createElement: tag => new HistoryNode(tag),
  querySelector(selector) { if (!historyControls.has(selector)) historyControls.set(selector, new HistoryNode('control')); return historyControls.get(selector); },
};
historyContext.historical = structuredClone(approvedPrintFixture);
historyContext.api = async path => path.endsWith('/history') ? [{revision: 20, status: 'Approved'}] : structuredClone(approvedPrintFixture);
vm.runInContext('updateControls=()=>{}; state.doc={...clone(historical),status:"Archived",revision:21}; state.saved=clone(state.doc); state.consent=true;', historyContext);
async function inspectHistory() {
  await vm.runInContext('openHistory()', historyContext);
  await historyControls.get('#history-list').querySelectorAll('button')[0].click();
  return historyControls.get('#history-detail').querySelectorAll('button')[0];
}
let restore = await inspectHistory();
assert.equal(restore.disabled, true, 'An archived PRD must be reopened before history can offer Restore.');
assert.ok(historyControls.get('#history-detail').querySelectorAll('p').some(node => node.textContent.includes('Reopen this PRD before restoring')));
vm.runInContext('openAction("restore",20)', historyContext);
assert.equal(historyControls.get('#action-dialog')?.open, undefined, 'The action guard must also reject archived restore.');
assert.equal(vm.runInContext('state.pendingAction', historyContext), null);
assert.ok(historyControls.get('#global-message').textContent.includes('Reopen this PRD before restoring'));
vm.runInContext('state.doc.status="Draft"; state.saved=clone(state.doc);', historyContext);
restore = await inspectHistory();
assert.equal(restore.disabled, false, 'A clean Draft must still offer restore.');
await restore.click();
assert.equal(historyControls.get('#history-dialog').open, false);
assert.equal(historyControls.get('#action-dialog').open, true);
assert.equal(vm.runInContext('state.pendingAction.action', historyContext), 'restore');
assert.equal(vm.runInContext('state.pendingAction.revision', historyContext), 20);
vm.runInContext('state.doc.title="Unsaved history change";', historyContext);
assert.equal((await inspectHistory()).disabled, true, 'The existing unsaved-edit restore guard must remain.');
vm.runInContext('state.doc=clone(state.saved); state.consent=false;', historyContext);
assert.equal((await inspectHistory()).disabled, true, 'The existing acknowledgement guard must remain.');

// Comments use saved wording while leaving unrelated PRD edits untouched.
const commentCalls = [];
historyContext.openComments = async options => commentCalls.push(options);
historyContext.document.querySelector('#save-prd').focus = () => {};
historyContext.commentAnchor = {field: 'behavior', start: 0, end: 6, quote: 'Browse', sourceText: approvedPrintFixture.sections.requirements[0].behavior};
vm.runInContext('state.doc=clone(historical); state.saved=clone(historical); state.doc.title="Unsaved comment context"; state.consent=true;', historyContext);
const commentDraftBefore = vm.runInContext('JSON.stringify(state.doc)', historyContext);
await vm.runInContext('commentRequirement({requirementId:"R-001",anchor:commentAnchor})', historyContext);
assert.equal(commentCalls.length, 0, 'A new anchored comment must wait until requirement edits are saved.');
assert.equal(vm.runInContext('JSON.stringify(state.doc)', historyContext), commentDraftBefore);
await vm.runInContext('commentRequirement({requirementId:"R-001"})', historyContext);
assert.equal(commentCalls.length, 1, 'Existing comments remain readable while a draft is unsaved.');
assert.equal(commentCalls[0].doc.title, approvedPrintFixture.title, 'The discussion must identify saved wording.');
assert.equal(vm.runInContext('JSON.stringify(state.doc)', historyContext), commentDraftBefore);
await vm.runInContext('commentRequirement({requirementId:"R-999"})', historyContext);
assert.equal(commentCalls.length, 1, 'A newly added unsaved requirement needs a save before comments.');
vm.runInContext('state.doc=clone(state.saved);', historyContext);
await vm.runInContext('commentRequirement({requirementId:"R-001",anchor:commentAnchor})', historyContext);
assert.equal(commentCalls.length, 2);
assert.equal(commentCalls[1].anchor.quote, 'Browse');
assert.equal(commentCalls[1].doc.revision, approvedPrintFixture.revision);

console.log('Frontend validation, saved metadata badges, combined filters, shared-record views, scoped unsent-chat protection, truthful print labels, archived restore guards and comment integration passed.');
