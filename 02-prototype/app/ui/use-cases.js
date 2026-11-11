const reference = '(?:UC|U)-[0-9]+';
const inline = new RegExp(`^(${reference})\\s*(?::|[–—-])\\s*(.+)$`, 'i');
const references = new RegExp(`^${reference}(?:\\s*(?:[,;/&]|and)\\s*${reference})*$`, 'i');

export function useCaseChoices(value = '') {
  const entries = new Map();
  for (let line of value.split(/\r?\n/)) {
    line = line.replace(/^\s*(?:[-*+]\s+|[0-9]+[.)]\s+|#{1,6}\s+)?/, '').trim();
    if (!line) continue;
    const match = line.match(inline);
    const [key, label] = match ? [match[1].toUpperCase(), match[2].trim()] : [line, line];
    if (new RegExp(`^${reference}$`, 'i').test(label)) continue;
    if (entries.has(key) && entries.get(key) !== label) entries.set(key, null);
    else if (!entries.has(key)) entries.set(key, label);
  }
  return [...entries].filter(([, label]) => label).map(([reference, label]) => ({reference, label}));
}

function describe(value, definitions) {
  const raw = value.trim();
  const match = raw.match(inline);
  let label = raw || 'Not documented';
  if (match) label = match[2].trim();
  else if (references.test(raw)) {
    const names = new Map(useCaseChoices(definitions).map(item => [item.reference, item.label]));
    label = raw.match(new RegExp(reference, 'ig')).map(code => names.get(code.toUpperCase()) || 'Use case description missing').join('; ');
  }
  return {value, label, reference: raw && label !== raw ? value : ''};
}

export function useCaseInfo(doc, req, context) {
  const valid = context?.documentId === doc.id && context.prdRevision === doc.revision;
  const saved = valid ? context.labels?.[req.id] : null;
  if (saved?.value === req.appliesTo && (saved.imported || context.useCases === doc.sections.useCases)) return saved;
  return describe(req.appliesTo, valid ? doc.sections.useCases : '');
}

export function useCaseText(doc, req, context) {
  const info = useCaseInfo(doc, req, context);
  return info.label + (info.reference ? ` (reference: ${info.reference})` : '');
}

function describeChoice(hint, select, doc, req, context) {
  const label = req.appliesTo ? useCaseInfo(doc, req, context).label : '';
  if (select) select.title = label;
  hint.textContent = !req.appliesTo ? 'Choose a use case, or write a description.' : label.includes('Use case description missing') ? `${label}. Choose a use case from the list, or write a description.` : '';
  hint.hidden = !hint.textContent;
}
export function useCaseControl(doc, req, getContext, onChange) {
  const wrapper = document.createElement('div');
  const label = document.createElement('label'); label.textContent = 'Use case'; label.htmlFor = `${req.id}-appliesTo`;
  const select = document.createElement('select'); select.id = label.htmlFor;
  const original = req.appliesTo;
  const choices = [...new Set(useCaseChoices(doc.sections.useCases).map(item => item.label))];
  select.append(new Option('Choose a use case…', ''));
  choices.forEach((name, index) => select.append(new Option(name, `case-${index}`)));
  if (original && !choices.includes(original)) {
    const saved = new Option(`Current: ${useCaseInfo(doc, req, getContext()).label}`, 'saved');
    saved.setAttribute('data-use-case-current', req.id);
    saved.setAttribute('data-use-case-value', original);
    select.append(saved);
  }
  select.append(new Option('Write a description / several use cases…', 'custom'));
  select.value = choices.includes(original) ? `case-${choices.indexOf(original)}` : original ? 'saved' : '';
  const customLabel = document.createElement('label'); customLabel.textContent = 'Describe the use cases'; customLabel.htmlFor = `${select.id}-custom`; customLabel.hidden = true;
  const custom = document.createElement('textarea'); custom.id = customLabel.htmlFor; custom.rows = 3; custom.maxLength = 20000; custom.hidden = true;
  let customEdited = false;
  custom.value = original;
  const hint = document.createElement('p'); hint.className = 'field-hint'; hint.id = `${select.id}-description`;
  hint.setAttribute('data-use-case-description', req.id);
  select.setAttribute('aria-describedby', hint.id);
  const showDescription = () => describeChoice(hint, select, doc, req, getContext());
  showDescription();
  select.addEventListener('change', () => {
    custom.hidden = customLabel.hidden = select.value !== 'custom';
    if (!custom.hidden) {
      if (customEdited) { req.appliesTo = custom.value; onChange(); }
      else {
        const info = useCaseInfo(doc, req, getContext());
        custom.value = info.reference && !info.label.includes('Use case description missing') ? info.label : req.appliesTo;
      }
      custom.focus();
    } else {
      req.appliesTo = select.value === 'saved' ? original : select.value ? choices[Number(select.value.slice(5))] : '';
      onChange();
    }
    showDescription();
  });
  custom.addEventListener('input', () => { customEdited = true; req.appliesTo = custom.value; showDescription(); onChange(); });
  wrapper.append(label, select, customLabel, custom, hint);
  return wrapper;
}

export function refreshUseCaseControls(container, doc, context) {
  for (const option of container.querySelectorAll('[data-use-case-current]')) {
    const req = doc.sections.requirements.find(req => req.id === option.getAttribute('data-use-case-current'));
    if (req) option.textContent = `Current: ${useCaseInfo(doc, {...req, appliesTo: option.getAttribute('data-use-case-value')}, context).label}`;
  }
  for (const hint of container.querySelectorAll('[data-use-case-description]')) {
    const req = doc.sections.requirements.find(req => req.id === hint.getAttribute('data-use-case-description'));
    if (req) describeChoice(hint, container.querySelector?.(`#${hint.id.replace(/-description$/, '')}`), doc, req, context);
  }
}
