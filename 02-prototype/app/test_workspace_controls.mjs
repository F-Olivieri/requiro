import assert from 'node:assert/strict';
import {initWorkspaceControls} from './ui/workspace-controls.js';

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
function boot() {
  const nodes = new Map(['library-panel', 'chat-panel', 'toggle-library', 'toggle-chat', 'toggle-theme', 'open-settings', 'settings-dialog', 'settings-theme', 'settings-library', 'settings-chat'].map(id => [id, new Node()]));
  const shell = new Node();
  const html = {dataset: {}};
  globalThis.document = {documentElement: html, getElementById: id => nodes.get(id), querySelector: selector => { assert.equal(selector, '.app-shell'); return shell; }};
  initWorkspaceControls();
  return {nodes, shell, html};
}
let page = boot();
assert.equal(page.html.dataset.theme, 'dark');
assert.equal(page.nodes.get('toggle-theme').attributes['aria-label'], 'Switch to light theme');
page.nodes.get('toggle-library').click();
assert.equal(page.nodes.get('library-panel').hidden, true);
assert.equal(page.nodes.get('toggle-library').attributes['aria-label'], 'Show library');
assert.equal(page.nodes.get('toggle-library').attributes['aria-expanded'], 'false');
assert.ok(page.shell.classes.has('library-hidden'));
assert.equal(page.nodes.get('chat-panel').hidden, false, 'Panels hide independently.');
page.nodes.get('toggle-chat').click();
assert.equal(page.nodes.get('chat-panel').hidden, true);
assert.ok(page.shell.classes.has('chat-hidden'));
assert.equal(page.nodes.get('library-panel').value, 'Unsaved draft', 'Hiding preserves panel contents.');
page.nodes.get('toggle-theme').click();
assert.equal(page.html.dataset.theme, 'light');
assert.equal(page.nodes.get('toggle-theme').attributes['aria-label'], 'Switch to dark theme');
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
page.nodes.get('toggle-theme').click();
assert.equal(page.nodes.get('chat-panel').hidden, true);
assert.equal(page.html.dataset.theme, 'light', 'Controls work even when browser storage is blocked.');
console.log('Workspace controls passed: accessible icon labels, independent panels, settings, retained content, reload preferences and blocked-storage fallback.');
