import assert from 'node:assert/strict';
import {openComments, selectedRequirementAnchor} from './ui/comments.js';
import {renderPrdView} from './ui/prd-views.js';

class TextNode {
  constructor(text, owner) { this.nodeType = 3; this.textContent = text; this.ownerDocument = owner; }
}
class Element {
  constructor(tag, owner) { this.nodeType = 1; this.tag = tag; this.ownerDocument = owner; this.childNodes = []; this.attributes = {}; this.listeners = {}; this.value = ''; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  set textContent(text) { this.replaceChildren(new TextNode(String(text), this.ownerDocument)); }
  get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.childNodes.push(node); } }
  replaceChildren(...nodes) { if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body; for (const node of this.childNodes) node.parentElement = null; this.childNodes = []; this.append(...nodes); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  matches(selector) { return selector.startsWith('[') ? [...selector.matchAll(/\[([^\]]+)\]/g)].every(match => this.attributes[match[1]] !== undefined) : this.tag === selector; }
  querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector); }
  contains(node) { return node === this || this.children.some(child => child.contains(node)) || this.childNodes.includes(node); }
  addEventListener(name, handler) { (this.listeners[name] ||= []).push(handler); }
  async fire(name) { for (const handler of this.listeners[name] || []) await handler({preventDefault() {}}); }
  async click() { if (!this.disabled) await this.fire('click'); }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  remove() { if (this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter(node => node !== this); }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; }
  select() { this.selected = true; }
}
const documentEvents = new Map();
const browserEvents = new Map();
const polls = new Map();
let timer = 0;
let discard = false;
let copied = '';
const dom = {
  selection: null,
  createElement: tag => new Element(tag, dom),
  getSelection: () => dom.selection,
  addEventListener(name, handler) { if (!documentEvents.has(name)) documentEvents.set(name, new Set()); documentEvents.get(name).add(handler); },
  removeEventListener(name, handler) { documentEvents.get(name)?.delete(handler); },
  createRange() { return {selectNodeContents(field) { this.field = field; }, setEnd(node, offset) { this.node = node; this.offset = offset; }, toString() { return this.node.nodeType === 3 ? this.node.textContent.slice(0, this.offset) : this.field.textContent; }}; },
};
dom.body = dom.createElement('body');
globalThis.document = dom;
globalThis.window = {confirm: () => discard, addEventListener: (name, handler) => browserEvents.set(name, handler), removeEventListener: name => browserEvents.delete(name)};
globalThis.setInterval = callback => { polls.set(++timer, callback); return timer; };
globalThis.clearInterval = id => polls.delete(id);
Object.defineProperty(globalThis, 'navigator', {configurable: true, value: {clipboard: {writeText: async text => { copied = text; }}}});
const container = dom.createElement('div'); dom.body.append(container);
const fields = ['problem', 'users', 'outcomes', 'useCases', 'scope', 'nonGoals', 'inputsOutputs', 'quality', 'metrics', 'risks', 'decisions', 'evidence'];
const doc = {id: 'fictional-comments', title: 'Fictional shared list', revision: 4, status: 'Draft', approvedRevision: null, sections: Object.fromEntries(fields.map(field => [field, 'Fictional context']))};
doc.sections.requirements = [1, 2].map(number => ({id: `R-00${number}`, priority: 'Must', proposed: false, behavior: `Ship 🚀 safely ${number}`, acceptance: `A fictional result appears ${number}.`, appliesTo: 'UC-01', outcome: 'A fictional outcome'}));
const baseline = JSON.stringify(doc);
function selection(start, from, to, end = start, quote = start.textContent.slice(from, to)) {
  const range = {startContainer: start.childNodes[0], startOffset: from, endContainer: end.childNodes[0], endOffset: to, toString: () => quote};
  return {isCollapsed: from === to && start === end, rangeCount: 1, getRangeAt: () => range};
}
const marked = (field, requirement = 'R-001') => container.querySelectorAll('[data-comment-requirement][data-comment-field]').find(node => node.getAttribute('data-comment-requirement') === requirement && node.getAttribute('data-comment-field') === field);
let commentTarget;
for (const mode of ['document', 'table']) {
  renderPrdView(container, {doc, mode, onComment: target => { commentTarget = target; }});
  const behavior = marked('behavior');
  dom.selection = selection(behavior, 5, 7);
  assert.deepEqual(selectedRequirementAnchor(container), {requirementId: 'R-001', anchor: {field: 'behavior', start: 5, end: 7, quote: '🚀', sourceText: doc.sections.requirements[0].behavior}}, 'Anchors use DOM Range UTF-16 offsets.');
  for (const handler of documentEvents.get('selectionchange')) handler();
  const selected = container.querySelectorAll('button').find(node => node.getAttribute('aria-label') === 'Comment on selected text in R-001');
  assert.equal(selected.hidden, false); assert.equal(selected.getAttribute('data-selection-valid'), 'true');
  await selected.fire('mousedown'); dom.selection = null; selected.focus();
  for (const handler of documentEvents.get('selectionchange')) handler();
  await selected.click();
  assert.equal(commentTarget.anchor.quote, '🚀', 'A button taking focus must not erase its selected anchor.');
  const acceptance = marked('acceptance');
  assert.equal(selectedRequirementAnchor(container, selection(behavior, 0, 3, acceptance, 'cross field')), null);
  assert.equal(selectedRequirementAnchor(container, selection(behavior, 0, 3, marked('behavior', 'R-002'), 'cross requirement')), null);
  assert.equal(selectedRequirementAnchor(container, selection(behavior, 0, 4, behavior, 'wrong quote')), null);
  assert.equal(selectedRequirementAnchor(container, {...selection(behavior, 0, 4), rangeCount: 2}), null);
  assert.equal(selectedRequirementAnchor(container, selection(behavior, 4, 4)), null);
  const outside = dom.createElement('p'); outside.textContent = 'Outside text'; dom.body.append(outside);
  assert.equal(selectedRequirementAnchor(container, selection(outside, 0, 7)), null);
  for (const field of ['acceptance', 'appliesTo', 'outcome']) {
    const node = marked(field); const result = selectedRequirementAnchor(container, selection(node, 0, node.textContent.length));
    assert.equal(result.anchor.field, field); assert.equal(result.anchor.quote, doc.sections.requirements[0][field]);
  }
  await container.querySelectorAll('button').find(node => node.getAttribute('aria-label') === 'Comment on R-002 wording').click();
  assert.equal(commentTarget.requirementId, 'R-002');
  assert.equal(commentTarget.anchor.quote, doc.sections.requirements[1][commentTarget.anchor.field], 'The single Comment control anchors to the whole saved wording.');
}
assert.equal(documentEvents.get('selectionchange').size, 1, 'Rerendering removes the earlier selection listener.');

let threads = [];
let conflict = false;
let pendingGet;
let deferGet = false;
let serverRevision = doc.revision;
let getFailure = false;
const calls = [];
const now = '2026-11-09T18:00:00Z';
const anchor = {field: 'behavior', start: 5, end: 7, quote: '🚀', sourceText: doc.sections.requirements[0].behavior};
function makeThread(id, requirementId = 'R-001') { return {id, requirementId, anchor: structuredClone(anchor), createdPrdRevision: 4, revision: 1, status: 'Open', messages: [{id: `${id}-message`, author: 'Test engineer', text: 'Fictional discussion', suggestion: '', createdAt: now}], createdAt: now, updatedAt: now, requirementPresent: true, anchorCurrent: true}; }
threads = [makeThread('first'), makeThread('second', 'R-002')];
async function api(path, method = 'GET', input) {
  calls.push({path, method, input: structuredClone(input)});
  if (method === 'GET') {
    if (getFailure) throw new Error('Fictional refresh unavailable.');
    const result = {documentId: doc.id, prdRevision: serverRevision, threads: structuredClone(threads)};
    if (deferGet) return new Promise(resolve => { pendingGet = () => resolve(result); });
    return result;
  }
  if (conflict) { const error = new Error('Changed elsewhere.'); error.status = 409; throw error; }
  assert.equal(input.privacyConfirmed, true);
  let thread = threads.find(item => path.includes(`/${item.id}`));
  if (!thread) {
    assert.equal(input.expectedPrdRevision, 4);
    assert.deepEqual(input.anchor, anchor);
    thread = {...makeThread('new-thread'), messages: []}; threads.push(thread);
  }
  if (method === 'PUT') { assert.equal(input.expectedRevision, thread.revision); thread.status = input.status; }
  thread.revision++;
  thread.messages.push({id: `${thread.id}-${thread.revision}`, author: input.author, text: input.text || `Discussion ${input.status}`, suggestion: input.suggestion || '', createdAt: now});
  return structuredClone(thread);
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const find = (dialog, id) => [...dialog.querySelectorAll('input'), ...dialog.querySelectorAll('textarea')].find(node => node.id === id);
const button = (dialog, label) => dialog.querySelectorAll('button').find(node => node.textContent === label);
async function open(options = {}) {
  const done = openComments({doc, api, consent: () => true, ...options}); await flush();
  return {done, dialog: dom.body.children.find(node => node.tag === 'dialog')};
}
async function set(input, value) { input.value = value; await input.fire('input'); }
async function close(test) { discard = true; await button(test.dialog, '×').click(); await test.done; }
let test = await open({requirementId: 'R-001', anchor});
const author = find(test.dialog, 'comments-author'); const comment = find(test.dialog, 'comments-text'); const suggestion = find(test.dialog, 'comments-suggestion');
assert.equal(dom.activeElement, author, 'Opening comments focuses the first field.');
await set(author, 'Application engineer'); await set(suggestion, 'Fictional suggested wording only.');
assert.equal(button(test.dialog, 'Post comment').disabled, false, 'Suggested wording alone is a valid message.');
await button(test.dialog, 'Post comment').click();
assert.ok(test.dialog.textContent.includes('Fictional suggested wording only.') || test.dialog.querySelectorAll('textarea').some(node => node.value === 'Fictional suggested wording only.'));
await button(test.dialog, 'Copy suggested wording').click(); assert.equal(copied, 'Fictional suggested wording only.');
await set(comment, 'Keep this unfinished reply.'); await set(suggestion, 'Keep this unfinished wording.');
threads.find(thread => thread.id === 'new-thread').messages.push({id: 'incoming', author: 'Another engineer', text: 'A concurrent fictional reply.', suggestion: '', createdAt: now});
await [...polls.values()][0]();
assert.equal(comment.value, 'Keep this unfinished reply.'); assert.equal(suggestion.value, 'Keep this unfinished wording.');
assert.equal(find(test.dialog, 'comments-text'), comment, 'Polling keeps the composer element and its focus/selection.');
assert.ok(test.dialog.textContent.includes('A concurrent fictional reply.'));
conflict = true; await button(test.dialog, 'Resolve discussion').click(); conflict = false;
assert.equal(comment.value, 'Keep this unfinished reply.'); assert.ok(test.dialog.textContent.includes('changed elsewhere'));
await button(test.dialog, 'Resolve discussion').click();
assert.equal(comment.value, 'Keep this unfinished reply.', 'Resolving cannot consume an unfinished reply.');
assert.ok(button(test.dialog, 'Reopen discussion'));
await button(test.dialog, 'Reopen discussion').click();
deferGet = true; const oldPoll = [...polls.values()][0]();
await button(test.dialog, 'Post reply').click();
assert.equal(comment.value, ''); assert.equal(suggestion.value, '');
pendingGet(); await oldPoll; deferGet = false;
assert.ok(test.dialog.textContent.includes('Keep this unfinished reply.'), 'An earlier poll cannot overwrite a successful newer reply.');
await set(comment, 'Protect this draft on switch.');
discard = false;
await test.dialog.querySelectorAll('nav')[0].querySelectorAll('button').find(node => node.textContent.startsWith('R-001 · Open\n🚀')).click();
assert.equal(comment.value, 'Protect this draft on switch.');
let prevented = false; browserEvents.get('beforeunload')({preventDefault() { prevented = true; }}); assert.equal(prevented, true);
await button(test.dialog, '×').click(); assert.equal(test.dialog.open, true);
await test.dialog.fire('cancel'); assert.equal(test.dialog.open, true);
discard = true;
await test.dialog.querySelectorAll('nav')[0].querySelectorAll('button').find(node => node.textContent.startsWith('R-001 · Open\n🚀')).click();
assert.equal(comment.value, '', 'Accepting discard switches threads and clears only the unfinished reply.');
assert.equal(author.value, 'Application engineer');
await set(comment, 'Protect this draft on close.'); discard = false;
await button(test.dialog, '×').click(); assert.equal(test.dialog.open, true);
await close(test); assert.equal(polls.size, 0); assert.equal(browserEvents.has('beforeunload'), false);

test = await open({requirementId: 'R-001', anchor});
const staleNewDraft = find(test.dialog, 'comments-text');
await set(find(test.dialog, 'comments-author'), 'Test engineer'); await set(staleNewDraft, 'Keep this new comment visible after a PRD edit.');
serverRevision = 5; await [...polls.values()][0]();
assert.equal(staleNewDraft.value, 'Keep this new comment visible after a PRD edit.');
assert.equal(staleNewDraft.parentElement.hidden, false, 'A stale new-comment draft must stay visible and copyable.');
assert.equal(button(test.dialog, 'Post comment').disabled, true);
assert.ok(test.dialog.textContent.includes('Copy your unfinished text'));
await close(test); serverRevision = doc.revision;

threads[0].anchorCurrent = false;
threads[1].requirementPresent = false;
test = await open();
assert.ok(test.dialog.textContent.includes('wording has changed'));
await test.dialog.querySelectorAll('nav')[0].querySelectorAll('button').find(node => node.textContent.startsWith('R-002')).click();
assert.ok(test.dialog.textContent.includes('requirement was removed'));
assert.ok(test.dialog.textContent.includes('saved PRD v4'));
await close(test);
const whole = doc.sections.requirements[0].behavior;
test = await open({requirementId: 'R-001', anchor: {field: 'behavior', start: 0, end: whole.length, quote: whole, sourceText: whole}});
assert.ok(test.dialog.querySelectorAll('button').some(node => node.textContent === 'New comment on R-001'), 'A whole-field comment is named after its requirement, not a selection.');
await close(test);
test = await open({requirementId: 'R-001', anchor: {field: 'behavior', start: 0, end: whole.length, quote: whole, sourceText: whole}, browse: true});
assert.ok(test.dialog.querySelectorAll('button').some(node => node.textContent === 'New comment on R-001'), 'Comments (N) still offers a new comment inside the list.');
assert.ok(button(test.dialog, 'Post reply'), 'Comments (N) opens on the first existing discussion.');
await close(test);
test = await open({consent: () => false});
assert.equal(find(test.dialog, 'comments-text').readOnly, true);
assert.equal(button(test.dialog, 'Post reply').disabled, true);
await close(test);

// 2026-11-09: polling must preserve keyboard focus and copyable text selections.
threads[0].messages[0].suggestion = 'Focusable fictional wording.';
test = await open();
await set(find(test.dialog, 'comments-author'), 'Test engineer');
const initialStatus = button(test.dialog, 'Resolve discussion'); initialStatus.focus();
await [...polls.values()][0]();
assert.equal(button(test.dialog, 'Resolve discussion') === initialStatus, true, 'An unchanged poll must keep existing controls.');
assert.equal(dom.activeElement, initialStatus);
threads[0].messages.push({id: 'focus-incoming', author: 'Another engineer', text: 'A reply while keyboard focus stays on the status button.', suggestion: '', createdAt: now});
threads[0].status = 'Resolved'; threads[0].revision++;
await [...polls.values()][0]();
const refreshedStatus = button(test.dialog, 'Reopen discussion');
assert.notEqual(refreshedStatus, initialStatus);
assert.equal(dom.activeElement, refreshedStatus, 'An incoming update must restore focus to the same thread status control.');
assert.deepEqual(refreshedStatus.focusOptions, {preventScroll: true});
let wording = test.dialog.querySelectorAll('textarea').find(node => node.className === 'comments-suggested');
wording.focus(); wording.setSelectionRange(2, 10, 'backward');
threads[0].messages.push({id: 'selection-incoming', author: 'Another engineer', text: 'A reply while suggested words are selected.', suggestion: '', createdAt: now});
threads[0].status = 'Open'; threads[0].revision++;
await [...polls.values()][0]();
wording = test.dialog.querySelectorAll('textarea').find(node => node.className === 'comments-suggested');
assert.equal(dom.activeElement, wording);
assert.deepEqual([wording.selectionStart, wording.selectionEnd, wording.selectionDirection], [2, 10, 'backward']);
button(test.dialog, 'Copy suggested wording').focus();
threads[0].messages.push({id: 'copy-incoming', author: 'Another engineer', text: 'A reply while the copy control has focus.', suggestion: '', createdAt: now});
await [...polls.values()][0]();
assert.equal(dom.activeElement, button(test.dialog, 'Copy suggested wording'));
const focusedThread = test.dialog.querySelectorAll('nav')[0].querySelectorAll('button')[0]; focusedThread.focus();
threads[0].messages.push({id: 'thread-incoming', author: 'Another engineer', text: 'A reply while a thread choice has focus.', suggestion: '', createdAt: now});
await [...polls.values()][0]();
assert.equal(dom.activeElement, test.dialog.querySelectorAll('nav')[0].querySelectorAll('button')[0]);
const focusedComposer = find(test.dialog, 'comments-text'); focusedComposer.focus();
await set(focusedComposer, 'A reply must retain its focus and text.');
threads[0].messages.push({id: 'compose-incoming', author: 'Another engineer', text: 'A reply while the composer has focus.', suggestion: '', createdAt: now});
await [...polls.values()][0]();
assert.equal(dom.activeElement, focusedComposer); assert.equal(focusedComposer.value, 'A reply must retain its focus and text.');
getFailure = true; await [...polls.values()][0](); getFailure = false;
assert.ok(test.dialog.textContent.includes('Comments could not refresh'));
await [...polls.values()][0]();
assert.ok(!test.dialog.textContent.includes('Comments could not refresh'), 'A successful retry clears its own refresh error.');
await button(test.dialog, 'Copy suggested wording').click();
await [...polls.values()][0]();
assert.ok(test.dialog.textContent.includes('Suggested wording copied'), 'Refreshing must not erase a copy notice.');
conflict = true; await button(test.dialog, 'Resolve discussion').click(); conflict = false;
await [...polls.values()][0]();
assert.ok(test.dialog.textContent.includes('changed elsewhere'), 'Refreshing must not erase a post/status conflict notice.');
await close(test);
assert.equal(JSON.stringify(doc), baseline, 'Commenting, replies and discussion status must never mutate the PRD.');
assert.ok(calls.filter(call => call.method !== 'GET').every(call => call.path.includes('/comments/')));
console.log('Shared comments passed: UTF-16 selection and field boundaries, both views, suggestion-only posts/copy, concurrent refresh, draft guards, stale changes, resolved/reopened threads and removed requirement history.');
