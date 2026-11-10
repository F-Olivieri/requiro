const fieldLabels = {behavior: 'Requirement', acceptance: 'Acceptance criteria', appliesTo: 'Applies to', outcome: 'Intended outcome'};
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const dateLabel = value => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date not available' : date.toLocaleString();
};
const preview = value => { const chars = Array.from(value || ''); return chars.slice(0, 100).join('') + (chars.length > 100 ? '…' : ''); };

// DOM Range offsets and JavaScript string slices both count UTF-16 code units.
export function selectedRequirementAnchor(container, selection = container.ownerDocument?.getSelection?.()) {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  const fieldFor = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('[data-comment-requirement][data-comment-field]');
  const field = fieldFor(range.startContainer);
  if (!field || field !== fieldFor(range.endContainer) || !container.contains(field)) return null;
  const requirementId = field.getAttribute('data-comment-requirement');
  const name = field.getAttribute('data-comment-field');
  if (!requirementId || !Object.hasOwn(fieldLabels, name)) return null;
  const sourceText = field.textContent;
  const prefix = field.ownerDocument.createRange();
  prefix.selectNodeContents(field); prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  prefix.setEnd(range.endContainer, range.endOffset);
  const end = prefix.toString().length;
  const quote = sourceText.slice(start, end);
  if (start >= end || !quote.trim() || quote !== range.toString()) return null;
  return {requirementId, anchor: {field: name, start, end, quote, sourceText}};
}

export async function openComments({doc, requirementId, anchor, api, consent}) {
  const base = `/api/prds/${encodeURIComponent(doc.id)}/comments`;
  let data = await api(base);
  if (data.documentId !== doc.id || !Array.isArray(data.threads)) throw new Error('The comments do not match this PRD. Reopen it and try again.');
  let threads = data.threads;
  const visibleThreads = () => threads.filter(thread => !requirementId || thread.requirementId === requirementId);
  let selectedId = anchor ? null : visibleThreads()[0]?.id;
  let busy = false;
  let refreshing = false;
  let closed = false;
  let generation = 0;
  let noticeSource = '';
  const dialog = el('dialog', 'dialog comments-dialog');
  dialog.setAttribute('aria-labelledby', 'comments-title');
  const heading = el('div', 'dialog-heading');
  const title = el('h2', '', requirementId ? `Comments on ${requirementId}` : 'PRD comments'); title.id = 'comments-title';
  const close = el('button', 'icon-button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close comments');
  heading.append(title, close);
  dialog.append(heading, el('p', 'muted', `${doc.title} · saved revision ${doc.revision}`));
  const authorLabel = el('label', '', 'Author label'); authorLabel.htmlFor = 'comments-author';
  const author = el('input'); author.id = 'comments-author'; author.maxLength = 200; author.placeholder = 'For example, Test engineer';
  dialog.append(authorLabel, author, el('p', 'field-hint', 'Use a role label. This label does not verify anyone’s identity. Comments are shared with people using this workspace.'));
  const notice = el('p', 'inline-error'); notice.hidden = true; notice.setAttribute('role', 'alert');
  const layout = el('div', 'comments-layout');
  const list = el('nav', 'comments-list'); list.setAttribute('aria-label', 'Comment threads');
  const main = el('section', 'comments-main'); main.setAttribute('aria-label', 'Discussion');
  const body = el('div', 'comments-thread');
  const compose = el('div', 'comments-compose');
  const textLabel = el('label', '', 'Comment or reply'); textLabel.htmlFor = 'comments-text';
  const text = el('textarea'); text.id = 'comments-text'; text.rows = 3; text.maxLength = 20000;
  const suggestionLabel = el('label', '', 'Suggested wording (optional)'); suggestionLabel.htmlFor = 'comments-suggestion';
  const suggestion = el('textarea'); suggestion.id = 'comments-suggestion'; suggestion.rows = 2; suggestion.maxLength = 20000;
  const hint = el('p', 'field-hint');
  const post = el('button', 'button primary', 'Post comment'); post.type = 'button';
  compose.append(textLabel, text, suggestionLabel, suggestion, hint, post);
  main.append(body, compose); layout.append(list, main); dialog.append(notice, layout);
  const current = () => threads.find(thread => thread.id === selectedId);
  const dirty = () => Boolean(text.value || suggestion.value);
  const message = (value, source = 'action') => { notice.textContent = value; notice.hidden = !value; noticeSource = value ? source : ''; };
  const allowDiscard = () => !dirty() || window.confirm('Discard your unfinished comment or suggested wording? Posted comments will remain.');
  function switchThread(id) {
    if (busy || id === selectedId || !allowDiscard()) return;
    selectedId = id; text.value = ''; suggestion.value = ''; message(''); render();
  }
  function canStart() {
    return Boolean(anchor && requirementId && data.prdRevision === doc.revision && doc.sections.requirements.some(req => req.id === requirementId));
  }
  function rememberFocus() {
    const owner = dialog.ownerDocument || document;
    const active = owner.activeElement;
    if (!active || !dialog.contains(active) || owner.hasFocus && !owner.hasFocus()) return null;
    const key = active.getAttribute('data-comment-focus');
    return key ? {key, start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection} : null;
  }
  function restoreFocus(focus) {
    if (!focus) return;
    const target = [...dialog.querySelectorAll('[data-comment-focus]')].find(node => node.getAttribute('data-comment-focus') === focus.key);
    if (!target || target.disabled || target.hidden) return;
    target.focus({preventScroll: true});
    if (typeof focus.start === 'number' && typeof focus.end === 'number') target.setSelectionRange(focus.start, focus.end, focus.direction);
  }
  function controls() {
    const writable = consent() && !busy;
    close.disabled = busy;
    author.disabled = text.disabled = suggestion.disabled = busy;
    author.readOnly = text.readOnly = suggestion.readOnly = !consent();
    compose.hidden = !current() && !canStart() && !dirty();
    post.textContent = current() ? 'Post reply' : 'Post comment';
    post.disabled = !writable || !author.value.trim() || !(text.value.trim() || suggestion.value.trim()) || (!current() && !canStart());
    for (const button of list.querySelectorAll('button')) button.disabled = busy;
    for (const button of body.querySelectorAll('[data-comment-status]')) button.disabled = !writable || !author.value.trim();
    hint.textContent = !consent() ? 'Acknowledge the material-use statement before posting or changing a discussion.' : !current() && !canStart() && dirty() ? 'The saved PRD changed. Copy your unfinished text, then reopen the saved PRD before starting this comment.' : 'A comment or suggested wording is enough. Posting does not change the PRD or its delivery review.';
  }
  function threadButton(label, id) {
    const button = el('button', `comments-item${id === selectedId ? ' active' : ''}`, label); button.type = 'button';
    button.setAttribute('data-comment-focus', `thread:${id ?? 'new'}`);
    if (id === selectedId) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => switchThread(id)); list.append(button);
  }
  function showQuote(container, selectedAnchor, revision) {
    container.append(el('p', 'small muted', `${fieldLabels[selectedAnchor.field] || selectedAnchor.field} · saved PRD revision ${revision}`), el('blockquote', 'comments-quote', selectedAnchor.quote));
  }
  function render() {
    const focus = rememberFocus();
    list.replaceChildren();
    if (canStart()) threadButton('New comment on selected text', null);
    for (const thread of visibleThreads()) {
      const first = thread.messages[0];
      const summary = first ? `${first.author} · ${dateLabel(first.createdAt)}\n${preview(first.text || first.suggestion)}` : 'No messages yet.';
      threadButton(`${thread.requirementId} · ${thread.status}\n${preview(thread.anchor.quote)}\n${summary}`, thread.id);
    }
    if (!visibleThreads().length) list.append(el('p', 'muted small', 'No comments yet. Select requirement text in the PRD to start a thread.'));
    body.replaceChildren();
    const thread = current();
    if (thread) {
      body.append(el('h3', '', `${thread.requirementId} · ${thread.status}`));
      if (thread.requirementPresent === false) body.append(el('p', 'completion-warning', 'This requirement was removed. Its discussion history is kept.'));
      else if (thread.anchorCurrent === false) body.append(el('p', 'completion-warning', 'The requirement wording has changed. This discussion keeps the original selected words and saved PRD revision.'));
      showQuote(body, thread.anchor, thread.createdPrdRevision);
      for (const item of thread.messages) {
        const entry = el('article', 'comments-message');
        entry.append(el('p', 'comments-message-meta', `${item.author} · ${dateLabel(item.createdAt)}`));
        if (item.text) entry.append(el('p', 'comments-message-text', item.text));
        if (item.suggestion) {
          const wording = el('textarea', 'comments-suggested'); wording.readOnly = true; wording.value = item.suggestion; wording.rows = 3;
          wording.setAttribute('aria-label', `Suggested wording from ${item.author}`);
          wording.setAttribute('data-comment-focus', `wording:${thread.id}:${item.id}`);
          const copy = el('button', 'text-button', 'Copy suggested wording'); copy.type = 'button';
          copy.setAttribute('data-comment-focus', `copy:${thread.id}:${item.id}`);
          copy.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(item.suggestion); message('Suggested wording copied. Paste it into Guided edit when you choose to make the change.'); }
            catch { wording.focus(); wording.select(); message('Select and copy the suggested wording below. Paste it into Guided edit when you choose to make the change.'); }
          });
          entry.append(el('h4', '', 'Suggested wording'), wording, copy);
        }
        body.append(entry);
      }
      const status = el('button', 'button', thread.status === 'Resolved' ? 'Reopen discussion' : 'Resolve discussion'); status.type = 'button'; status.setAttribute('data-comment-status', 'true');
      status.setAttribute('data-comment-focus', `status:${thread.id}`);
      status.addEventListener('click', () => perform(async () => {
        const updated = await api(`${base}/${encodeURIComponent(thread.requirementId)}/${encodeURIComponent(thread.id)}`, 'PUT', {expectedRevision: thread.revision, status: thread.status === 'Resolved' ? 'Open' : 'Resolved', author: author.value.trim(), privacyConfirmed: true});
        replaceThread(updated); render();
      }));
      body.append(status);
    } else if (canStart()) {
      body.append(el('h3', '', `New comment on ${requirementId}`)); showQuote(body, anchor, doc.revision);
    } else body.append(el('p', 'muted', data.prdRevision !== doc.revision ? 'The saved PRD changed. Reopen it before starting a comment on new selected text.' : 'Choose a discussion, or select words in a requirement to start one.'));
    controls();
    restoreFocus(focus);
  }
  function replaceThread(thread) {
    if (!thread?.id || !thread.requirementId || !Array.isArray(thread.messages)) throw new Error('The server returned an unreadable discussion. Your unfinished text is still here.');
    generation++;
    threads = [...threads.filter(item => item.id !== thread.id), thread];
  }
  async function refresh() {
    if (closed || busy || refreshing) return;
    refreshing = true;
    const started = generation;
    try {
      const updated = await api(base);
      if (closed || generation !== started) return;
      if (updated.documentId !== doc.id || !Array.isArray(updated.threads)) throw new Error('The refreshed comments do not match this PRD.');
      if (noticeSource === 'refresh') message('');
      const unchanged = data.prdRevision === updated.prdRevision && JSON.stringify(threads) === JSON.stringify(updated.threads);
      data = updated; threads = updated.threads;
      if (!unchanged) render();
    } finally { refreshing = false; }
  }
  async function perform(task) {
    if (busy || !consent() || !author.value.trim()) return;
    busy = true; message(''); controls();
    try { await task(); }
    catch (error) {
      message(error.status === 409 ? 'This discussion or PRD changed elsewhere. Your unfinished text is preserved. Check the latest discussion before trying again.' : error.message);
    } finally { busy = false; controls(); }
  }
  post.addEventListener('click', () => {
    if (post.disabled) return;
    return perform(async () => {
      const thread = current();
      const payload = {author: author.value.trim(), text: text.value, suggestion: suggestion.value, privacyConfirmed: true};
      const updated = thread
        ? await api(`${base}/${encodeURIComponent(thread.requirementId)}/${encodeURIComponent(thread.id)}/replies`, 'POST', payload)
        : await api(`${base}/${encodeURIComponent(requirementId)}`, 'POST', {...payload, expectedPrdRevision: doc.revision, anchor});
      replaceThread(updated); selectedId = updated.id; text.value = ''; suggestion.value = ''; render();
    });
  });
  for (const input of [author, text, suggestion]) input.addEventListener('input', controls);
  const closeComments = () => { if (!busy && allowDiscard()) dialog.close(); };
  close.addEventListener('click', closeComments);
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeComments(); });
  const beforeUnload = event => { if (busy || dirty()) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  const finished = new Promise(resolve => dialog.addEventListener('close', () => {
    closed = true; clearInterval(poll); window.removeEventListener('beforeunload', beforeUnload); dialog.remove(); resolve();
  }, {once: true}));
  document.body.append(dialog); render(); dialog.showModal();
  const poll = setInterval(() => refresh().catch(error => { if (!closed) message(`Comments could not refresh. Your unfinished text is still here. ${error.message}`, 'refresh'); }), 3000);
  return finished;
}
