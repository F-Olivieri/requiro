import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {useCaseText} from './ui/use-cases.js';
import {fileSlug, formatDateTime} from './ui/format.js';

// Run with: node test_lifecycle.mjs
class Node {
  constructor(tag = 'control') { Object.assign(this, {tag, children: [], listeners: {}, dataset: {}, attributes: {}, style: {}, value: '', textContent: '', hidden: false, disabled: false, title: ''}); this.classList = {toggle() {}, add() {}, remove() {}}; }
  append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  before(...nodes) { this.inserted = nodes; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  querySelectorAll(tag) { return this.children.flatMap(node => [...(node.tag === tag ? [node] : []), ...node.querySelectorAll(tag)]); }
  closest() { return null; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { ctx.focused = this; }
  select() {}
  async click(event = {preventDefault() {}}) { if (this.disabled) return; await this.onclick?.(event); for (const handler of this.listeners.click || []) await handler(event); }
}
const store = new Map();
const localStorage = {get length() { return store.size; }, key: index => [...store.keys()][index] ?? null, getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key)};
const timers = [];
const windowEvents = {};
let printed = 0;
const ctx = vm.createContext({
  useCaseText, fileSlug, formatDate: formatDateTime, localStorage, console, JSON, Blob, URL: {createObjectURL: () => 'blob:fictional', revokeObjectURL() {}},
  setTimeout: callback => timers.push(callback), clearTimeout() {}, setInterval() { return 0; },
  window: {addEventListener: (name, handler) => { windowEvents[name] = handler; }, print: () => { printed++; }},
});
const source = readFileSync(new URL('./ui/app.js', import.meta.url), 'utf8');
vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function '), ctx);
const controls = new Map();
let openDialog = null;
const $ = selector => { if (!controls.has(selector)) controls.set(selector, new Node()); return controls.get(selector); };
ctx.document = {
  body: new Node('body'),
  createElement: tag => new Node(tag),
  getElementById: () => null,
  querySelector: selector => selector === 'dialog[open]' ? openDialog : $(selector),
  querySelectorAll: () => [],
};
const calls = [];
let saveFails = false;
let verificationRevision = null;
let threads = [];
ctx.api = async (path, method = 'GET', data) => {
  calls.push({path, method, data: structuredClone(data)});
  if (method === 'PUT') {
    if (saveFails) { const error = new Error('Fictional save failure.'); error.status = 409; throw error; }
    return {...structuredClone(data.doc), revision: data.expectedRevision + 1};
  }
  if (path.endsWith('/action')) {
    const status = {review: 'In review', approve: 'Approved', archive: 'Archived', reopen: 'Draft'}[data.action];
    return {...vm.runInContext('clone(state.saved)', ctx), status, revision: data.expectedRevision + 1};
  }
  if (path.endsWith('/verification')) return {documentId: 'fictional-doc', prdRevision: verificationRevision};
  if (path === '/api/prds' && method === 'POST') return {...structuredClone(complete), id: 'fictional-new', title: data.title, revision: 1, stage: 'Discover', sections: {...Object.fromEntries(fields.map(key => [key, ''])), requirements: []}};
  if (path.endsWith('/comments')) return {documentId: path.split('/')[3], threads};
  throw new Error(`Unexpected request ${path}`);
};
ctx.initWorkspaceControls = () => {};
vm.runInContext('renderLibrary=()=>{}; renderDocument=()=>{}; renderEditor=()=>{}; renderPreview=()=>{}; refreshVerification=()=>{}; refreshUseCases=()=>{}; refreshRequirementLinks=()=>{}; refreshLibrary=async()=>{}; storedProposal=()=>null; realCommentCounts=refreshCommentCounts; refreshCommentCounts=async()=>{};', ctx);
const run = code => vm.runInContext(code, ctx);
const flush = () => new Promise(resolve => setImmediate(resolve));
const fields = ['problem', 'users', 'outcomes', 'useCases', 'scope', 'nonGoals', 'inputsOutputs', 'quality', 'metrics', 'risks', 'decisions', 'evidence'];
const complete = {id: 'fictional-doc', title: 'Fictional lending shelf', revision: 3, status: 'Draft', stage: 'Review', approvedRevision: null, nextRequirementNumber: 3, chat: [{role: 'user', content: 'Saved fictional question'}],
  sections: {...Object.fromEntries(fields.map(key => [key, `Fictional ${key}.`])), decisions: 'None.',
    requirements: ['R-001', 'R-002'].map(id => ({id, priority: 'Must', proposed: false, behavior: `Show ${id}.`, appliesTo: 'UC-01', outcome: 'Members borrow a tool.', acceptance: `${id} appears.`}))}};
function load(changes = {}, sections = {}) {
  ctx.fixture = {...structuredClone(complete), ...changes, sections: {...structuredClone(complete.sections), ...sections}};
  run('state.doc=clone(fixture); state.saved=clone(fixture); state.busy=false; state.pendingAction=null; removed.length=0;');
}
await run('init()');

// R-042: one lifecycle button per status, gated by unsaved edits.
for (const [status, label] of [['Draft', 'Send for approval'], ['In review', 'Approve v3'], ['Archived', 'Reopen']]) {
  load({status}); run('updateControls()');
  assert.equal($('#lifecycle-action').hidden, false, `${status} offers its next step.`);
  assert.equal($('#lifecycle-action').textContent, label);
  assert.equal($('#lifecycle-action').disabled, false);
}
assert.equal($('#archive-prd').hidden, true, 'An archived PRD shows one Reopen button, not two.');
load({status: 'Approved', approvedRevision: 3}); run('updateControls()');
assert.equal($('#lifecycle-action').hidden, true, 'Approved has no next approval step.');
assert.equal($('#document-status').title, 'Approved v3. Edit and save to start a new draft.', 'The status pill explains what an approved PRD offers next.');
assert.equal($('#archive-prd').hidden, false);
load(); run('state.doc.title="Unsaved fictional title"; updateControls();');
assert.equal($('#lifecycle-action').disabled, true); assert.equal($('#lifecycle-action').title, 'Save your edits first.');
load(); run('updateControls();');
assert.equal($('#lifecycle-action').disabled, false); assert.equal($('#lifecycle-action').title, '', 'R-054: no confirmation is needed before a status change.');
assert.equal($('#archive-prd').disabled, false);

// R-042: Send for approval runs directly; Approve opens a checked confirmation.
load(); run('updateControls()'); calls.length = 0;
await $('#lifecycle-action').click(); await flush();
assert.deepEqual(calls.map(call => [call.path, call.data?.action]), [['/api/prds/fictional-doc/action', 'review']]);
assert.equal($('#action-dialog').open, undefined, 'Send for approval needs no confirmation dialog.');
assert.equal(run('state.doc.status'), 'In review');
assert.equal($('#global-message').textContent, 'Sent for approval as v4.');
load({status: 'In review'}); run('updateControls()');
await $('#lifecycle-action').click();
assert.equal($('#action-dialog').open, true);
assert.equal($('#action-title').textContent, 'Approve v3?');
assert.match($('#action-description').textContent, /^Approving creates v4 with the same content as v3/);
assert.equal($('#confirm-action').disabled, false);
assert.equal($('#action-blockers').hidden, true);
assert.equal(ctx.focused, $('#confirm-action'));
const advice = $('#action-warnings').children.map(node => node.textContent);
assert.ok(advice.at(-1).startsWith('Requiro checks that required fields are filled in.'), 'Advice says what the check does not cover.');

// R-042: blockers and advice are separate, and Approve stays disabled while blockers remain.
load({status: 'In review'}, {problem: '', metrics: 'TBD', decisions: 'Who owns returns?', requirements: [{...complete.sections.requirements[0], appliesTo: '', acceptance: '', proposed: true}]});
run('openAction("approve")');
assert.deepEqual($('#action-blocker-list').children.map(node => node.textContent), ['“The problem” is empty.', 'R-001 needs its use case and acceptance criteria.', 'R-001 priority is not yet agreed.']);
assert.equal($('#action-blockers').hidden, false);
assert.deepEqual($('#action-warnings').children.map(node => node.textContent).slice(0, 2), ['“Success measures” is empty.', 'Open decisions are recorded. Approving means you accept them as they stand.']);
assert.equal($('#confirm-action').disabled, true);
assert.equal(ctx.focused, $('#cancel-action'), 'A blocked approval focuses Cancel, not a disabled button.');
calls.length = 0; $('#confirm-action').disabled = false;
await $('#confirm-action').click();
assert.equal(calls.length, 0, 'The confirm handler rechecks blockers before calling the server.');
assert.match($('#action-error').textContent, /Blocks approval/);
for (const action of ['archive', 'reopen']) {
  load({status: action === 'reopen' ? 'Archived' : 'Draft'}); run(`openAction("${action}")`);
  assert.equal($('#action-blockers').hidden, true); assert.equal($('#action-advice').hidden, true); assert.equal($('#confirm-action').disabled, false);
}

// R-043: version history uses plain reasons and v-labels.
const labels = run('[historyLabel("Created"), historyLabel("Edited"), historyLabel("review"), historyLabel("approve"), historyLabel("Restored revision 4 as a new draft"), historyLabel("archive"), historyLabel("reopen"), historyLabel("Imported 1 requirement(s) from “Fictional source” revision 2"), historyLabel("")]');
assert.deepEqual([...labels], ['Created', 'Saved', 'Sent for approval', 'Approved', 'Restored v4', 'Archived', 'Reopened', 'Imported 1 requirement from “Fictional source” v2', 'Saved']);
assert.equal(run('statusLabel("In review")'), 'Awaiting approval');
assert.equal(run('stageLabel("Review")'), 'Approval');
const index = readFileSync(new URL('./ui/index.html', import.meta.url), 'utf8');
assert.ok(index.includes('<option value="In review">Awaiting approval</option>'), 'The status filter shows the display label and keeps the stored value.');

// R-044: leaving with unsaved edits offers Save and continue, Discard, or Cancel.
load(); assert.equal(await run('confirmLeave()'), true, 'A clean PRD leaves without asking.');
load(); run('state.doc.sections.problem="Unsaved fictional problem";');
let leaving = run('confirmLeave()');
assert.equal($('#leave-dialog').open, true); assert.equal(ctx.focused, $('#leave-save'));
await $('#leave-cancel').click();
assert.equal(await leaving, false); assert.equal(run('state.doc.sections.problem'), 'Unsaved fictional problem', 'Cancel keeps the edits.');
store.set('requiro-draft:fictional-doc:3', '{}');
leaving = run('confirmLeave()'); await $('#leave-discard').click();
assert.equal(await leaving, true); assert.equal(store.size, 0, 'Discard also drops the browser copy.');
saveFails = true; calls.length = 0;
leaving = run('confirmLeave()'); await $('#leave-save').click();
assert.equal($('#leave-dialog').open, true, 'A failed save keeps the dialog open.');
assert.match($('#leave-error').textContent, /Fictional save failure/); assert.equal($('#leave-error').hidden, false);
saveFails = false; await $('#leave-save').click();
assert.equal(await leaving, true); assert.equal($('#leave-dialog').open, false);
assert.equal(calls.filter(call => call.method === 'PUT').length, 2);
assert.equal(run('dirty()'), false); assert.equal(run('state.saved.sections.problem'), 'Unsaved fictional problem');
load({status: 'Archived'}); run('state.doc.title="Unsaved archived title";');
leaving = run('confirmLeave()');
assert.equal($('#leave-save').disabled, true); assert.equal(ctx.focused, $('#leave-discard'));
await $('#leave-cancel').click(); await leaving;

// R-044: removing a requirement can be undone until the next save.
load(); run('removeRequirement("R-001")');
assert.deepEqual([...run('state.doc.sections.requirements.map(req => req.id)')], ['R-002']);
assert.equal($('#undo-toast').hidden, false);
assert.equal($('#undo-text').textContent, 'Removed R-001. You can undo until you save.');
assert.equal(ctx.focused, $('#undo-remove'));
run('removeRequirement("R-002")');
assert.equal($('#undo-text').textContent, 'Removed R-002 and 1 more. You can undo until you save.');
await $('#undo-remove').click(); await $('#undo-remove').click();
assert.deepEqual([...run('state.doc.sections.requirements.map(req => req.id)')], ['R-001', 'R-002'], 'Undo restores each requirement in its place.');
assert.equal($('#undo-toast').hidden, true);
assert.equal(run('dirty()'), false);
run('removeRequirement("R-002")'); await run('save()');
assert.equal($('#undo-toast').hidden, true, 'Saving ends the undo window.');
run('undoRemove()');
assert.equal(run('state.doc.sections.requirements.length'), 1);

// R-044: unsaved edits are kept in this browser only, and offered back when the PRD reopens.
load(); store.clear(); timers.length = 0; calls.length = 0;
run('state.doc.sections.problem="Fictional edit kept locally"; state.stage="Scope"; markDirty();');
assert.equal(store.size, 0, 'Autosave waits for a pause in typing.');
timers.at(-1)();
assert.deepEqual([...store.keys()], ['requiro-draft:fictional-doc:3']);
assert.equal(JSON.parse(store.get('requiro-draft:fictional-doc:3')).doc.sections.problem, 'Fictional edit kept locally');
assert.equal(calls.length, 0, 'Autosave never writes to the server.');
load(); run('offerRecovery()');
assert.equal($('#recover-dialog').open, true);
assert.equal($('#recover-confirm').textContent, 'Recover');
assert.match($('#recover-description').textContent, /edits to v3 that were not saved/);
await $('#recover-confirm').click();
assert.equal($('#recover-dialog').open, false);
assert.equal(run('state.doc.sections.problem'), 'Fictional edit kept locally');
assert.equal(run('state.stage'), 'Scope');
assert.equal(run('state.doc.chat[0].content'), 'Saved fictional question', 'Recovery keeps the saved conversation.');
assert.equal(run('dirty()'), true); assert.equal(calls.length, 0, 'Recovered edits wait for an explicit save.');
await run('save()');
assert.equal(store.size, 0, 'Saving clears the browser copy.');
load(); store.set('requiro-draft:fictional-doc:2', JSON.stringify({savedAt: '2026-11-09T12:00:00Z', doc: {...structuredClone(complete), sections: {...complete.sections, problem: 'Older fictional edit'}}}));
run('offerRecovery()');
assert.equal($('#recover-confirm').textContent, 'Download edits', 'Edits based on an older version are downloaded, never merged.');
assert.match($('#recover-description').textContent, /based on v2, but the saved PRD is now v3/);
await $('#recover-discard').click();
assert.equal(store.size, 0); assert.equal(run('state.doc.sections.problem'), complete.sections.problem);
load(); run('offerRecovery()');
assert.equal($('#recover-dialog').open, false, 'No prompt without a browser copy.');
load(); run('state.doc.title="Pagehide fictional title";');
windowEvents.pagehide();
assert.equal(JSON.parse(store.get('requiro-draft:fictional-doc:3')).doc.title, 'Pagehide fictional title');
store.clear();

// R-046: Ctrl or Cmd+S saves when nothing else is open.
const press = (keys) => { let prevented = false; windowEvents.keydown({key: 's', ...keys, preventDefault() { prevented = true; }}); return prevented; };
for (const keys of [{ctrlKey: true}, {metaKey: true}]) {
  load(); run('state.doc.title="Shortcut fictional title";'); calls.length = 0;
  assert.equal(press(keys), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(call => call.method), ['PUT']); assert.equal(run('dirty()'), false);
}
load(); calls.length = 0;
assert.equal(press({ctrlKey: true}), true, 'The browser save dialog is suppressed while a PRD is open.');
run('state.doc.title="Dialog fictional title";'); openDialog = new Node('dialog');
press({ctrlKey: true}); openDialog = null;
run('state.doc.status="Archived";'); press({metaKey: true});
assert.equal(press({ctrlKey: true, altKey: true}), false);
await new Promise(resolve => setImmediate(resolve));
assert.equal(calls.length, 0, 'No save when clean, when a dialog is open, or when the PRD is archived.');
run('state.doc=null;'); assert.equal(press({ctrlKey: true}), false, 'Without a PRD the browser keeps its own shortcut.');

// R-048: export says what each format includes and leaves out.
const exportDialog = index.slice(index.indexOf('<dialog id="export-dialog"'), index.indexOf('</dialog>', index.indexOf('<dialog id="export-dialog"')));
for (const id of ['export-markdown', 'export-json', 'export-print', 'export-report']) {
  const start = exportDialog.indexOf(`id="${id}"`); assert.ok(start > 0, id);
  const item = exportDialog.slice(start, exportDialog.indexOf(id.includes('print') || id.includes('report') ? '</button>' : '</a>', start));
  assert.ok(id === 'export-report' || item.includes('Leaves out'), `${id} names what it leaves out.`);
}
assert.ok(exportDialog.includes('Print or save as PDF') && exportDialog.includes('Delivery report with proofs'));
assert.ok(exportDialog.includes('Importing it creates a new draft'));
assert.ok(exportDialog.includes('id="export-error" class="inline-error" role="alert"'));
load(); run('openExport()');
assert.equal($('#export-report').hidden, false); assert.equal($('#export-markdown').hidden, false);
assert.equal($('#export-note').textContent, 'Markdown, JSON and the delivery report contain saved v3.');
assert.equal(ctx.focused, $('#export-markdown'));
assert.equal($('#export-markdown').href, '/api/export/fictional-doc?format=markdown');
run('state.doc.title="Unsaved export title"; openExport();');
assert.equal($('#export-report').hidden, true); assert.equal($('#export-json').hidden, true);
assert.match($('#export-note').textContent, /Print includes your unsaved edits and marks them/);
assert.deepEqual($('#export-error').inserted.map(node => node.textContent), ['Save + export current PRD', 'Download unsaved edits (JSON)']);
assert.equal(ctx.focused, $('#export-error').inserted[0]);
$('#export-dialog').open = true; await $('#export-print').click();
assert.equal(printed, 1); assert.equal($('#export-dialog').open, false, 'Print closes the dialog first.');
load(); verificationRevision = 2; calls.length = 0;
await $('#export-report').click();
assert.match($('#export-error').textContent, /changed elsewhere/);
verificationRevision = 3; inlineReset();
const bodyBefore = ctx.document.body.children.length;
await $('#export-report').click();
assert.equal($('#export-error').hidden, true);
assert.equal(ctx.document.body.children.length, bodyBefore, 'The download link is removed after use.');
assert.equal($('#export-dialog').open, false, 'A finished download closes Export.');
assert.equal($('#global-message').textContent, 'Downloaded fictional-lending-shelf-delivery-review.zip.');
function inlineReset() { run('inlineError("#export-error")'); }

// R-049: downloads and delivery statuses confirm where the action happened.
for (const [id, name] of [['#export-markdown', 'fictional-lending-shelf.md'], ['#export-json', 'fictional-lending-shelf.json']]) {
  load(); run('message(""); openExport();');
  assert.equal($(id).download, name, 'The browser saves the file under the name the confirmation uses.');
  await $(id).click({currentTarget: $(id)});
  assert.equal($('#export-dialog').open, false);
  assert.equal($('#global-message').textContent, `Downloaded ${name}.`);
}
load({title: 'Fictional title / with symbols'}); run('openExport()');
assert.equal($('#export-markdown').download, 'fictional-title-with-symbols.md', 'Names match the server’s export filenames.');
load(); ctx.openRequirementStatus = async () => ({updated: true, status: 'To discuss'});
await run('changeReviewStatus("R-001")');
assert.equal($('#global-message').textContent, 'R-001 marked To discuss.');
ctx.openRequirementStatus = async () => ({});
run('message("")'); await run('changeReviewStatus("R-001")');
assert.equal($('#global-message').textContent, '', 'Cancelling the chooser confirms nothing.');

// R-049: opening another PRD clears messages about the previous one.
load(); run('message("Fictional note about this PRD."); acceptSaved(clone(state.saved));');
assert.equal($('#global-message').textContent, 'Fictional note about this PRD.', 'Saving the same PRD keeps its messages.');
run('message("Fictional error about this PRD.", true); message("Fictional chat note.", {area: "chat"});');
ctx.other = {...structuredClone(complete), id: 'fictional-other'};
run('acceptSaved(other)');
assert.equal($('#global-message').hidden, true); assert.equal($('#global-message').textContent, '');
assert.equal($('#chat-status').textContent, '', 'Chat messages about the previous PRD clear too.');

// R-052: a new PRD focuses its first empty field.
load(); ctx.focused = null; $('#new-title').value = 'Fictional new PRD';
for (const handler of $('#new-form').listeners.submit) await handler({preventDefault() {}});
assert.equal(run('state.doc.id'), 'fictional-new');
assert.equal(ctx.focused, $('#field-problem'), 'Focus lands in the first empty Discover field, not on the page body.');
run('state.doc.sections.problem="Fictional problem"; focusFirstEmpty();');
assert.equal(ctx.focused, $('#field-users'));

// R-053: comment buttons show how many discussions are open.
load(); threads = [{requirementId: 'R-001', status: 'Open'}, {requirementId: 'R-001', status: 'Open'}, {requirementId: 'R-002', status: 'Resolved'}];
await run('realCommentCounts()');
assert.equal($('#comments-prd').textContent, 'Comments (2)');
assert.deepEqual({...run('state.commentCounts.byRequirement')}, {'R-001': 2});
threads = []; await run('realCommentCounts()');
assert.equal($('#comments-prd').textContent, 'Comments');
threads = [{requirementId: 'R-001', status: 'Open'}]; await run('realCommentCounts()');
ctx.other = {...structuredClone(complete), id: 'fictional-other'}; run('acceptSaved(other); updateControls();');
assert.equal($('#comments-prd').textContent, 'Comments', 'Counts never carry into another PRD.');

// R-052: closing any dialog returns focus to the control that opened it.
const focusCtx = vm.createContext({console});
vm.runInContext(source.replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function '), focusCtx);
const pending = [];
class El {
  constructor(name) { Object.assign(this, {name, parent: null, connected: true, visible: true, disabled: false, attributes: {}, listeners: {}}); }
  get isConnected() { return this.connected; }
  getClientRects() { return this.visible ? [{}] : []; }
  contains(node) { for (let item = node; item; item = item.parent) if (item === this) return true; return false; }
  closest(selector) { for (let item = this; item; item = item.parent) if (selector === 'dialog' ? item instanceof Dialog : item.attributes.role === 'menu') return item; return null; }
  getAttribute(key) { return this.attributes[key] ?? null; }
  focus() { if (this.connected && !this.disabled) { fdoc.activeElement = this; fdoc.focusin?.({target: this}); } }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  child(name) { const node = new El(name); node.parent = this; return node; }
}
class Dialog extends El {
  showModal() { this.open = true; }
  close() { this.open = false; const handlers = this.listeners.close || []; this.listeners.close = []; pending.push(() => handlers.forEach(handler => handler())); }
}
const flushClose = () => { while (pending.length) pending.shift()(); };
const registry = {};
const fdoc = {body: new El('body'), addEventListener(name, handler) { this[name] = handler; }, querySelector: selector => registry[selector] ?? null, getElementById: id => registry[`#${id}`] ?? null};
fdoc.activeElement = fdoc.body;
Object.assign(focusCtx, {HTMLDialogElement: Dialog, document: fdoc});
vm.runInContext('trackDialogFocus(); updateControls=()=>{};', focusCtx);
const title = registry['#document-title'] = new El('title');
const opener = new El('opener');
let dialog = new Dialog('dialog'); let inside = dialog.child('inside');
opener.focus(); dialog.showModal(); inside.focus(); dialog.close(); flushClose();
assert.equal(fdoc.activeElement, opener, 'Static dialogs return focus to their opener.');
dialog = new Dialog('built'); inside = dialog.child('inside');
opener.focus(); dialog.showModal(); inside.focus(); dialog.close(); dialog.connected = inside.connected = false; fdoc.activeElement = fdoc.body; flushClose();
assert.equal(fdoc.activeElement, opener, 'Dialogs removed on close also return focus.');
const statusButton = new El('status'); statusButton.attributes['data-focus-key'] = 'status:R-001';
const rerendered = registry['[data-focus-key="status:R-001"]'] = new El('status again');
statusButton.focus(); dialog = new Dialog('chooser'); dialog.showModal(); dialog.child('select').focus(); dialog.close(); statusButton.connected = false; fdoc.activeElement = fdoc.body; flushClose();
assert.equal(fdoc.activeElement, rerendered, 'A re-rendered opener is found by its focus key.');
const clicked = new El('clicked'); clicked.attributes['data-focus-key'] = 'status:R-002';
const replacement = registry['[data-focus-key="status:R-002"]'] = new El('clicked again');
clicked.focus(); clicked.connected = false; fdoc.activeElement = fdoc.body;
dialog = new Dialog('after re-render'); dialog.showModal(); dialog.child('select').focus(); dialog.close(); flushClose();
assert.equal(fdoc.activeElement, replacement, 'A control that lost focus before its dialog opened still gets focus back.');
const gone = new El('gone'); gone.focus(); dialog = new Dialog('lost'); dialog.showModal(); dialog.close(); gone.connected = false; fdoc.activeElement = fdoc.body; flushClose();
assert.equal(fdoc.activeElement, title, 'Without its opener, focus goes to the PRD title.');
const menu = new El('menu'); Object.assign(menu.attributes, {role: 'menu', 'aria-labelledby': 'more-actions'});
const moreButton = registry['#more-actions'] = new El('more'); const menuItem = menu.child('export');
menuItem.focus(); dialog = new Dialog('export'); dialog.showModal(); dialog.child('link').focus(); menuItem.visible = false; dialog.close(); flushClose();
assert.equal(fdoc.activeElement, moreButton, 'Items in a closed menu return focus to the menu button.');
const field = new El('field');
opener.focus(); dialog = new Dialog('moved'); dialog.showModal(); dialog.close(); field.focus(); flushClose();
assert.equal(fdoc.activeElement, field, 'Focus the app moved deliberately is left alone.');
const first = new Dialog('first'); const next = new Dialog('next'); const step = first.child('step');
opener.focus(); first.showModal(); step.focus(); first.close(); next.showModal(); next.child('confirm').focus(); flushClose();
assert.notEqual(fdoc.activeElement, opener, 'Opening a follow-up dialog keeps focus inside it.');
next.close(); flushClose();
assert.equal(fdoc.activeElement, opener, 'A follow-up dialog returns focus to the original opener.');
dialog = new Dialog('reopened'); const again = dialog.child('again');
opener.focus(); dialog.showModal(); again.focus(); dialog.close(); dialog.showModal(); again.focus(); flushClose();
assert.equal(fdoc.activeElement, again, 'Reopening the same dialog keeps focus inside it.');
dialog.close(); flushClose();
assert.equal(fdoc.activeElement, opener);
const busyButton = new El('busy');
busyButton.focus(); dialog = new Dialog('busy'); dialog.showModal(); vm.runInContext('state.busy=true', focusCtx); busyButton.disabled = true;
dialog.close(); fdoc.activeElement = fdoc.body; flushClose();
assert.equal(fdoc.activeElement, fdoc.body, 'A disabled opener waits for the action to finish.');
vm.runInContext('state.busy=false', focusCtx); busyButton.disabled = false;
await vm.runInContext('run(async () => {})', focusCtx);
assert.equal(fdoc.activeElement, busyButton, 'Focus returns once the opener is enabled again.');

console.log('Lifecycle passed: status buttons, blockers vs advice, history labels, 3-way leave, undo removal, local draft recovery, Ctrl/Cmd+S, export copy and confirmations, status confirmation, message clearing, new-PRD focus, comment counts and dialog focus return.');
