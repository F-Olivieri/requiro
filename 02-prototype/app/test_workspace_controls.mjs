import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {initWorkspaceControls, initMenu} from './ui/workspace-controls.js';

class Node {
  constructor() { this.hidden = false; this.attributes = {}; this.listeners = {}; this.value = 'Unsaved draft'; this.classes = new Set(); this.classList = {toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name)}; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, handler) { this.listeners[name] = handler; }
  click() { this.listeners.click(); }
  change() { this.listeners.change(); }
  showModal() { this.open = true; }
}
const stored = new Map();
globalThis.localStorage = {getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value)};
globalThis.fetch = () => { throw new Error('Display changes must not call the data API.'); };
function boot(extra = {}) {
  const nodes = new Map(['library-panel', 'chat-panel', 'toggle-library', 'toggle-chat', 'open-settings', 'settings-dialog', 'settings-theme', 'settings-library', 'settings-chat'].map(id => [id, new Node()]));
  for (const [id, node] of Object.entries(extra)) nodes.set(id, node);
  const shell = new Node();
  const html = new Node();
  html.dataset = {};
  globalThis.document = {documentElement: html, getElementById: id => nodes.get(id), querySelector: selector => { assert.equal(selector, '.app-shell'); return shell; }};
  const controls = initWorkspaceControls();
  return {nodes, shell, html, controls};
}
let page = boot();
assert.equal(page.html.dataset.theme, 'dark');
assert.ok(!page.html.classes.has('library-hidden'));
page.nodes.get('toggle-library').click();
assert.equal(page.nodes.get('library-panel').hidden, true);
assert.equal(page.nodes.get('toggle-library').attributes['aria-label'], 'Show library');
assert.equal(page.nodes.get('toggle-library').attributes['aria-expanded'], 'false');
assert.ok(page.shell.classes.has('library-hidden'));
assert.ok(page.html.classes.has('library-hidden'), 'The page root mirrors the panel state that the boot script set before first paint.');
assert.equal(page.nodes.get('chat-panel').hidden, false, 'Panels hide independently.');
page.nodes.get('toggle-chat').click();
assert.equal(page.nodes.get('chat-panel').hidden, true);
assert.ok(page.shell.classes.has('chat-hidden'));
assert.equal(page.nodes.get('library-panel').value, 'Unsaved draft', 'Hiding preserves panel contents.');
page.nodes.get('settings-theme').value = 'light';
page.nodes.get('settings-theme').change();
assert.equal(page.html.dataset.theme, 'light');
page = boot();
assert.equal(page.html.dataset.theme, 'light');
assert.equal(page.nodes.get('library-panel').hidden, true);
assert.equal(page.nodes.get('chat-panel').hidden, true);
page.nodes.get('toggle-library').click();
page.nodes.get('toggle-chat').click();
assert.equal(page.nodes.get('library-panel').hidden, false);
assert.equal(page.nodes.get('chat-panel').hidden, false);
assert.equal(page.nodes.get('toggle-library').attributes['aria-expanded'], 'true');
page.nodes.get('open-settings').click();
assert.equal(page.nodes.get('settings-dialog').open, true);
assert.equal(page.nodes.get('settings-theme').value, 'light');
assert.equal(page.nodes.get('settings-library').checked, true);
page.nodes.get('settings-theme').value = 'dark';
page.nodes.get('settings-theme').change();
page.nodes.get('settings-library').checked = false;
page.nodes.get('settings-library').change();
page.nodes.get('settings-chat').checked = false;
page.nodes.get('settings-chat').change();
assert.equal(page.html.dataset.theme, 'dark');
assert.equal(page.nodes.get('library-panel').hidden, true);
assert.equal(page.nodes.get('chat-panel').hidden, true);
assert.equal(page.nodes.get('library-panel').value, 'Unsaved draft', 'Settings must preserve panel contents.');
assert.equal(page.nodes.get('toggle-chat').attributes['aria-label'], 'Show chat');
page = boot();
assert.equal(page.nodes.get('settings-theme').value, 'dark');
assert.equal(page.nodes.get('settings-library').checked, false);
assert.equal(page.nodes.get('settings-chat').checked, false);
stored.set('requiro-display', '{broken json');
page = boot();
assert.equal(page.html.dataset.theme, 'dark', 'Malformed preferences do not break the workspace.');
stored.set('requiro-display', JSON.stringify({theme: 'unsupported', libraryHidden: 'true', chatHidden: 1}));
page = boot();
assert.equal(page.html.dataset.theme, 'dark');
assert.equal(page.nodes.get('library-panel').hidden, false, 'Stored preferences must have the expected types.');
globalThis.localStorage = {getItem() { throw new Error('Storage blocked'); }, setItem() { throw new Error('Storage blocked'); }};
page = boot();
page.nodes.get('toggle-chat').click();
page.nodes.get('settings-theme').value = 'light';
page.nodes.get('settings-theme').change();
assert.equal(page.nodes.get('chat-panel').hidden, true);
assert.equal(page.html.dataset.theme, 'light', 'Controls work even when browser storage is blocked.');

// Narrow screens start with fewer panels without overwriting the saved choice.
stored.clear();
globalThis.localStorage = {getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value)};
stored.set('requiro-display', JSON.stringify({theme: 'dark', libraryHidden: false, chatHidden: false}));
globalThis.matchMedia = query => ({matches: query === '(max-width:1279px)'});
page = boot();
assert.equal(page.nodes.get('chat-panel').hidden, true, 'Below 1280 px the chat starts collapsed so the header keeps two rows.');
assert.equal(page.nodes.get('library-panel').hidden, false);
assert.equal(JSON.parse(stored.get('requiro-display')).chatHidden, false, 'The automatic collapse is not saved.');
assert.equal(page.nodes.get('settings-chat').checked, false, 'Settings show the chat as hidden.');
page.nodes.get('toggle-library').click();
assert.equal(JSON.parse(stored.get('requiro-display')).chatHidden, false, 'Saving another panel choice does not save the automatic collapse.');
assert.equal(page.nodes.get('chat-panel').hidden, true);
page.nodes.get('toggle-chat').click();
assert.equal(page.nodes.get('chat-panel').hidden, false, 'Choosing Show chat overrides the automatic collapse.');
stored.set('requiro-display', JSON.stringify({theme: 'dark', libraryHidden: true, chatHidden: false}));
page = boot();
assert.equal(page.nodes.get('chat-panel').hidden, false, 'With the library hidden there is room for the chat.');
stored.set('requiro-display', JSON.stringify({theme: 'dark', libraryHidden: false, chatHidden: false}));
globalThis.matchMedia = () => ({matches: true});
page = boot();
assert.equal(page.nodes.get('library-panel').hidden, true, 'On a phone the PRD shows first.');
assert.equal(page.nodes.get('chat-panel').hidden, true);
assert.equal(page.shell.attributes['data-panel'], 'prd');
const tabButtons = ['library', 'prd', 'chat'].map(name => ({dataset: {panel: name}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, closest() { return this; }}));
const tabs = new Node();
tabs.querySelectorAll = () => tabButtons;
const savedDisplay = stored.get('requiro-display');
page = boot({'mobile-tabs': tabs});
assert.deepEqual(tabButtons.map(tab => tab.attributes['aria-current']), ['false', 'true', 'false'], 'The PRD tab starts selected.');
tabs.listeners.click({target: tabButtons[0]});
assert.equal(page.nodes.get('library-panel').hidden, false, 'The Library tab shows the library.');
assert.equal(page.nodes.get('chat-panel').hidden, true);
assert.equal(page.shell.attributes['data-panel'], 'library', 'The PRD is set aside while the library shows.');
assert.deepEqual(tabButtons.map(tab => tab.attributes['aria-current']), ['true', 'false', 'false']);
tabs.listeners.click({target: tabButtons[2]});
assert.equal(page.nodes.get('chat-panel').hidden, false, 'The Chat tab shows the chat.');
assert.equal(page.nodes.get('library-panel').hidden, true);
tabs.listeners.click({target: tabButtons[0]});
page.controls.showPanel('prd');
assert.equal(page.shell.attributes['data-panel'], 'prd', 'Opening a PRD switches to the PRD tab.');
assert.equal(page.nodes.get('library-panel').hidden, true);
assert.equal(stored.get('requiro-display'), savedDisplay, 'Switching tabs is not saved as a panel preference.');
delete globalThis.matchMedia;
page = boot();
let focusedToggle = false;
page.nodes.get('toggle-library').focus = () => { focusedToggle = true; };
globalThis.getComputedStyle = () => ({position: 'fixed'});
page.nodes.get('library-panel').listeners.keydown({key: 'Escape'});
assert.equal(page.nodes.get('library-panel').hidden, true, 'Escape closes a slide-over panel.');
assert.ok(focusedToggle, 'Focus returns to the panel toggle.');
page.nodes.get('toggle-library').click();
page.nodes.get('library-panel').listeners.click({target: {closest: selector => selector === '.doc-item' ? {} : null}});
assert.equal(page.nodes.get('library-panel').hidden, true, 'Opening a PRD from the slide-over library shows the PRD.');
globalThis.getComputedStyle = () => ({position: 'sticky'});
page.nodes.get('toggle-library').click();
page.nodes.get('library-panel').listeners.click({target: {closest: () => ({})}});
assert.equal(page.nodes.get('library-panel').hidden, false, 'A docked library stays open after choosing a PRD.');
delete globalThis.getComputedStyle;

// The More menu keeps the real action buttons and follows the menu-button keyboard pattern.
function menuPage() {
  const docListeners = {};
  const doc = {activeElement: null, addEventListener: (name, handler) => { (docListeners[name] ||= []).push(handler); }};
  const sources = new Map([['comments-prd', {textContent: 'Comments', disabled: false, hidden: false, clicks: 0, click() { this.clicks++; }}], ['verify-delivery', {textContent: 'Save + delivery review', disabled: true, hidden: false, click() {}}]]);
  doc.getElementById = id => sources.get(id);
  const button = new Node();
  button.contains = target => target === button;
  button.focus = () => { doc.activeElement = button; };
  const menu = new Node();
  menu.hidden = true;
  const item = (label, extra = {}) => ({textContent: label, hidden: false, disabled: false, shown: true, dataset: {}, ...extra,
    focus() { doc.activeElement = this; }, closest(selector) { return selector === '[role="menuitem"]' ? this : null; },
    getClientRects() { return !menu.hidden && !this.hidden && this.shown ? [{}] : []; }});
  const proxy = item('Comments', {dataset: {proxy: 'comments-prd'}, shown: false});
  const proxyReview = item('Delivery review', {dataset: {proxy: 'verify-delivery'}, shown: false});
  const items = [proxy, proxyReview, item('Projects & reuse'), item('History'), item('Export ↓'), item('Archive')];
  menu.querySelectorAll = selector => selector === '[data-proxy]' ? items.filter(node => node.dataset.proxy) : items;
  menu.contains = target => items.includes(target) || target === menu;
  const captured = {};
  menu.addEventListener = (name, handler, capture) => { captured[name] = {handler, capture}; };
  globalThis.document = doc;
  initMenu(button, menu);
  const key = (target, name) => { let prevented = false; target(({key: name, preventDefault: () => { prevented = true; }})); return prevented; };
  return {doc, docListeners, sources, button, menu, items, proxy, proxyReview, captured, key};
}
let menuTest = menuPage();
menuTest.button.click();
assert.equal(menuTest.menu.hidden, false);
assert.equal(menuTest.button.attributes['aria-expanded'], 'true');
assert.equal(menuTest.doc.activeElement, menuTest.items[2], 'Opening moves focus to the first available item.');
assert.equal(menuTest.proxyReview.textContent, 'Save + delivery review', 'Narrow-screen copies mirror the live label.');
assert.equal(menuTest.proxyReview.disabled, true, 'Narrow-screen copies mirror the disabled state.');
assert.equal(menuTest.key(menuTest.captured.keydown.handler, 'ArrowDown'), true);
assert.equal(menuTest.doc.activeElement, menuTest.items[3]);
menuTest.key(menuTest.captured.keydown.handler, 'End');
assert.equal(menuTest.doc.activeElement, menuTest.items[5]);
menuTest.key(menuTest.captured.keydown.handler, 'ArrowDown');
assert.equal(menuTest.doc.activeElement, menuTest.items[2], 'Arrow keys wrap around.');
menuTest.items[3].disabled = true;
menuTest.key(menuTest.captured.keydown.handler, 'ArrowDown');
assert.equal(menuTest.doc.activeElement, menuTest.items[4], 'Disabled items are skipped.');
menuTest.key(menuTest.captured.keydown.handler, 'Home');
assert.equal(menuTest.doc.activeElement, menuTest.items[2]);
assert.equal(menuTest.key(menuTest.captured.keydown.handler, 'Escape'), true);
assert.equal(menuTest.menu.hidden, true, 'Escape closes the menu.');
assert.equal(menuTest.button.attributes['aria-expanded'], 'false');
assert.equal(menuTest.doc.activeElement, menuTest.button, 'Escape returns focus to the More button.');
menuTest.key(menuTest.button.listeners.keydown, 'ArrowUp');
assert.equal(menuTest.menu.hidden, false);
assert.equal(menuTest.doc.activeElement, menuTest.items[5], 'ArrowUp on the button opens at the last item.');
menuTest.doc.activeElement = null;
menuTest.docListeners.click.forEach(handler => handler({target: {}}));
assert.equal(menuTest.menu.hidden, true, 'Clicking outside closes the menu.');
assert.equal(menuTest.doc.activeElement, null, 'Clicking outside does not steal focus.');
menuTest.button.click();
menuTest.button.click();
assert.equal(menuTest.menu.hidden, true, 'The More button toggles the menu.');
menuTest.button.click();
menuTest.key(menuTest.captured.keydown.handler, 'Tab');
assert.equal(menuTest.menu.hidden, true, 'Tab leaves and closes the menu.');
menuTest.button.click();
assert.equal(menuTest.captured.click.capture, true, 'Items close the menu before their own handlers open a dialog.');
menuTest.captured.click.handler({target: menuTest.items[4]});
assert.equal(menuTest.menu.hidden, true);
assert.equal(menuTest.doc.activeElement, menuTest.button, 'A dialog opened from the menu can return focus to the More button.');
menuTest = menuPage();
menuTest.proxy.shown = true;
menuTest.button.click();
assert.equal(menuTest.doc.activeElement, menuTest.proxy, 'At narrow widths Comments appears in the menu.');
menuTest.captured.click.handler({target: menuTest.proxy});
assert.equal(menuTest.sources.get('comments-prd').clicks, 1, 'The menu copy activates the real Comments button.');
menuTest.button.click();
menuTest.docListeners.keydown.forEach(handler => handler({key: 'Escape'}));
assert.equal(menuTest.menu.hidden, true, 'Escape anywhere closes an open menu.');
const markup = readFileSync(new URL('./ui/index.html', import.meta.url), 'utf8');
const menuMarkup = markup.slice(markup.indexOf('id="more-menu"'), markup.indexOf('</div>', markup.indexOf('id="more-menu"')));
for (const id of ['connections-prd', 'history-prd', 'export-prd', 'archive-prd']) assert.match(menuMarkup, new RegExp(`id="${id}"[^>]*role="menuitem"`), `${id} stays a real, clickable menu item.`);
for (const id of ['save-prd', 'comments-prd', 'verify-delivery', 'lifecycle-action']) assert.ok(markup.includes(`id="${id}"`), `${id} keeps its id.`);
assert.match(markup, /id="more-actions"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"[^>]*aria-controls="more-menu"/);
for (const marker of ['privacy-consent', 'privacy-banner', 'privacy-indicator', 'Data-use', 'data-use confirmation']) assert.ok(!markup.includes(marker), `R-054: index.html has no ${marker}.`);
assert.ok(!markup.includes('PRODUCT WORKSPACE'), 'The header no longer spends a row on an eyebrow.');
assert.ok(markup.includes('id="welcome-example"'), 'The welcome screen offers the fictional example.');

// R-054: no data-use confirmation is asked for, stored or required.
const appSource = readFileSync(new URL('./ui/app.js', import.meta.url), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export function /gm, 'function ');
for (const name of ['boot.js', 'app.js', 'comments.js', 'completion.js', 'connections.js', 'requirement-status.js', 'style.css', 'theme.css']) {
  const source = readFileSync(new URL(`./ui/${name}`, import.meta.url), 'utf8');
  for (const marker of [/consent/i, /privacy-(banner|indicator)/, /data-use confirmation/i, /privacyConfirmed/]) assert.doesNotMatch(source, marker, `${name} has no ${marker}.`);
}
function bootApp() {
  const context = vm.createContext({setInterval() { return 0; }});
  vm.runInContext(appSource, context);
  const controls = new Map();
  const handlers = new Map();
  context.document = {
    querySelector(selector) {
      if (!controls.has(selector)) controls.set(selector, {value: '', dataset: {}, classList: {toggle() {}}, setAttribute() {}, showModal() { this.opened = true; }, focus() { context.focused = selector; }, addEventListener(name, handler) { handlers.set(`${selector} ${name}`, handler); }});
      return controls.get(selector);
    },
    querySelectorAll: () => [],
  };
  context.window = {addEventListener() {}};
  context.initWorkspaceControls = () => {};
  vm.runInContext('updateControls=()=>{}; renderEditor=()=>{}; refreshLibrary=async()=>{};', context);
  return {context, controls, handlers};
}
const app = bootApp();
await vm.runInContext('init()', app.context);
assert.equal(vm.runInContext('"consent" in state', app.context), false);
assert.ok(![...app.controls.keys()].some(selector => selector.includes('privacy')), 'Startup touches no confirmation control.');
vm.runInContext('state.doc={id:"fictional-doc",title:"Fictional list",status:"Draft",revision:1,sections:{},chat:[]}; state.saved=clone(state.doc);', app.context);
assert.equal(vm.runInContext('editable()', app.context), true, 'An open draft is editable without any confirmation.');
app.handlers.get('#new-prd click')();
assert.equal(app.controls.get('#new-dialog').opened, true, 'New PRD opens directly.');

console.log('Workspace controls passed: accessible icon labels, independent panels, settings, retained content, reload preferences, blocked-storage fallback, narrow-screen panels, the More menu and no data-use confirmation.');
