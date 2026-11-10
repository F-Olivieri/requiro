const storageKey = 'requiro-display';

export function initWorkspaceControls() {
  let stored;
  try { stored = JSON.parse(localStorage.getItem(storageKey)); } catch { /* Display controls also work when browser storage is unavailable. */ }
  const preferences = {theme: stored?.theme === 'light' ? 'light' : 'dark', libraryHidden: stored?.libraryHidden === true, chatHidden: stored?.chatHidden === true};
  const shell = document.querySelector('.app-shell');
  const library = document.getElementById('library-panel');
  const chat = document.getElementById('chat-panel');
  const libraryButton = document.getElementById('toggle-library');
  const chatButton = document.getElementById('toggle-chat');
  const themeButton = document.getElementById('toggle-theme');
  const settings = document.getElementById('settings-dialog');
  const themeSetting = document.getElementById('settings-theme');
  const librarySetting = document.getElementById('settings-library');
  const chatSetting = document.getElementById('settings-chat');
  function render() {
    document.documentElement.dataset.theme = preferences.theme;
    library.hidden = preferences.libraryHidden;
    chat.hidden = preferences.chatHidden;
    shell.classList.toggle('library-hidden', preferences.libraryHidden);
    shell.classList.toggle('chat-hidden', preferences.chatHidden);
    libraryButton.setAttribute('aria-expanded', String(!preferences.libraryHidden));
    chatButton.setAttribute('aria-expanded', String(!preferences.chatHidden));
    for (const [button, label] of [[libraryButton, preferences.libraryHidden ? 'Show library' : 'Hide library'], [chatButton, preferences.chatHidden ? 'Show chat' : 'Hide chat'], [themeButton, preferences.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme']]) {
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    }
    themeSetting.value = preferences.theme;
    librarySetting.checked = !preferences.libraryHidden;
    chatSetting.checked = !preferences.chatHidden;
  }
  function changed() {
    render();
    try { localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* Keep the current display choice even when it cannot be remembered. */ }
  }
  libraryButton.addEventListener('click', () => { preferences.libraryHidden = !preferences.libraryHidden; changed(); });
  chatButton.addEventListener('click', () => { preferences.chatHidden = !preferences.chatHidden; changed(); });
  themeButton.addEventListener('click', () => { preferences.theme = preferences.theme === 'dark' ? 'light' : 'dark'; changed(); });
  document.getElementById('open-settings').addEventListener('click', () => settings.showModal());
  themeSetting.addEventListener('change', () => { preferences.theme = themeSetting.value; changed(); });
  librarySetting.addEventListener('change', () => { preferences.libraryHidden = !librarySetting.checked; changed(); });
  chatSetting.addEventListener('change', () => { preferences.chatHidden = !chatSetting.checked; changed(); });
  render();
}
