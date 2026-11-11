(() => {
  const root = document.documentElement;
  const matches = query => window.matchMedia?.(query).matches === true;
  let display = null;
  try { display = JSON.parse(localStorage.getItem('requiro-display')); } catch { /* The defaults apply when browser storage is unavailable. */ }
  try { if (sessionStorage.getItem('requiro-consent') === 'confirmed') root.classList.add('consent-confirmed'); } catch { /* The confirmation line shows until the app has loaded. */ }
  const phone = matches('(max-width:620px)');
  const libraryHidden = phone || display?.libraryHidden === true;
  const chatHidden = phone || display?.chatHidden === true || matches('(max-width:980px)') || (matches('(max-width:1279px)') && display?.libraryHidden !== true);
  root.dataset.theme = display?.theme === 'light' ? 'light' : 'dark';
  root.classList.toggle('library-hidden', libraryHidden);
  root.classList.toggle('chat-hidden', chatHidden);
})();
