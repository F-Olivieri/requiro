const storageKey = 'requiro-display';
const matches = query => globalThis.matchMedia?.(query).matches === true;
const overlaid = panel => globalThis.getComputedStyle?.(panel).position === 'fixed';

export function initMenu(button, menu) {
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')].filter(item => !item.disabled && item.getClientRects().length > 0);
  function sync() {
    for (const proxy of menu.querySelectorAll('[data-proxy]')) {
      const source = document.getElementById(proxy.dataset.proxy);
      proxy.textContent = source.textContent;
      proxy.disabled = source.disabled;
      proxy.hidden = source.hidden;
    }
  }
  function open(last = false) {
    sync();
    menu.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    const list = items();
    list[last ? list.length - 1 : 0]?.focus();
  }
  function close(returnFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    if (returnFocus) button.focus();
  }
  button.addEventListener('click', () => menu.hidden ? open() : close());
  button.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    open(event.key === 'ArrowUp');
  });
  menu.addEventListener('keydown', event => {
    const list = items();
    const index = list.indexOf(document.activeElement);
    const target = {ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1}[event.key];
    if (event.key === 'Escape') { event.preventDefault(); close(true); }
    else if (event.key === 'Tab') close();
    else if (target !== undefined && list.length) { event.preventDefault(); list[(target + list.length) % list.length].focus(); }
  });
  menu.addEventListener('click', event => {
    const item = event.target.closest('[role="menuitem"]');
    if (!item || item.disabled) return;
    close(true);
    if (item.dataset.proxy) document.getElementById(item.dataset.proxy).click();
  }, true);
  document.addEventListener('click', event => { if (!menu.hidden && !button.contains(event.target) && !menu.contains(event.target)) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !menu.hidden) close(true); });
  return {open, close};
}

export function initWorkspaceControls() {
  let stored;
  try { stored = JSON.parse(localStorage.getItem(storageKey)); } catch { /* Display controls also work when browser storage is unavailable. */ }
  const preferences = {theme: stored?.theme === 'light' ? 'light' : 'dark', libraryHidden: stored?.libraryHidden === true, chatHidden: stored?.chatHidden === true};
  const phone = () => matches('(max-width:620px)');
  const automatic = {libraryHidden: phone(), chatHidden: matches('(max-width:980px)') || (matches('(max-width:1279px)') && !preferences.libraryHidden)};
  const hidden = key => preferences[key] || automatic[key];
  let panel = 'prd';
  const shell = document.querySelector('.app-shell');
  const tabs = document.getElementById('mobile-tabs');
  const library = document.getElementById('library-panel');
  const chat = document.getElementById('chat-panel');
  const libraryButton = document.getElementById('toggle-library');
  const chatButton = document.getElementById('toggle-chat');
  const settings = document.getElementById('settings-dialog');
  const themeSetting = document.getElementById('settings-theme');
  const librarySetting = document.getElementById('settings-library');
  const chatSetting = document.getElementById('settings-chat');
  const moves = [['view-switcher', 'phone-view-slot'], ['stage-nav', 'editor-toolbar']].map(([id, phoneId]) => {
    const node = document.getElementById(id);
    return {node, home: node?.parentElement, phoneHome: document.getElementById(phoneId)};
  });
  function render() {
    const root = document.documentElement;
    root.dataset.theme = preferences.theme;
    const small = phone();
    const libraryHidden = small ? panel !== 'library' : hidden('libraryHidden');
    const chatHidden = small ? panel !== 'chat' : hidden('chatHidden');
    library.hidden = libraryHidden;
    chat.hidden = chatHidden;
    for (const node of [shell, root]) {
      node.classList.toggle('library-hidden', libraryHidden);
      node.classList.toggle('chat-hidden', chatHidden);
    }
    shell.setAttribute('data-panel', panel);
    for (const {node, home, phoneHome} of moves) {
      const target = small ? phoneHome : home;
      if (node && target && node.parentElement !== target) target.append(node);
    }
    libraryButton.setAttribute('aria-expanded', String(!libraryHidden));
    chatButton.setAttribute('aria-expanded', String(!chatHidden));
    for (const [button, label] of [[libraryButton, libraryHidden ? 'Show library' : 'Hide library'], [chatButton, chatHidden ? 'Show chat' : 'Hide chat']]) {
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    }
    for (const tab of tabs?.querySelectorAll('[data-panel]') || []) tab.setAttribute('aria-current', String(tab.dataset.panel === panel));
    themeSetting.value = preferences.theme;
    librarySetting.checked = !hidden('libraryHidden');
    chatSetting.checked = !hidden('chatHidden');
  }
  function changed() {
    render();
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* Keep the current display choice even when it cannot be remembered. */ }
  }
  function choose(key, value) {
    preferences[key] = value;
    automatic[key] = false;
    changed();
  }
  function showPanel(name) {
    panel = name;
    render();
  }
  libraryButton.addEventListener('click', () => choose('libraryHidden', !hidden('libraryHidden')));
  chatButton.addEventListener('click', () => choose('chatHidden', !hidden('chatHidden')));
  document.getElementById('open-settings').addEventListener('click', () => settings.showModal());
  themeSetting.addEventListener('change', () => { preferences.theme = themeSetting.value; changed(); });
  librarySetting.addEventListener('change', () => choose('libraryHidden', !librarySetting.checked));
  chatSetting.addEventListener('change', () => choose('chatHidden', !chatSetting.checked));
  for (const [element, button, key] of [[library, libraryButton, 'libraryHidden'], [chat, chatButton, 'chatHidden']]) {
    element.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !overlaid(element)) return;
      automatic[key] = true;
      render();
      button.focus();
    });
  }
  library.addEventListener('click', event => {
    if (overlaid(library) && event.target.closest('.doc-item')) { automatic.libraryHidden = true; render(); }
  });
  tabs?.addEventListener('click', event => {
    const tab = event.target.closest('[data-panel]');
    if (tab) showPanel(tab.dataset.panel);
  });
  globalThis.matchMedia?.('(max-width:620px)').addEventListener?.('change', render);
  const moreButton = document.getElementById('more-actions');
  const moreMenu = document.getElementById('more-menu');
  if (moreButton && moreMenu) initMenu(moreButton, moreMenu);
  render();
  return {showPanel};
}
