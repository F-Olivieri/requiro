"""Readable use-case descriptions; stored requirement references stay unchanged."""

import re


REFERENCE = r'(?:UC|U)-[0-9]+'


def use_case_choices(value):
    entries = {}
    for line in value.splitlines():
        line = re.sub(r'^\s*(?:[-*+]\s+|[0-9]+[.)]\s+|#{1,6}\s+)?', '', line).strip()
        if not line:
            continue
        match = re.fullmatch(rf'({REFERENCE})\s*(?::|[–—-])\s*(.+)', line, re.I)
        key, label = (match[1].upper(), match[2].strip()) if match else (line, line)
        if re.fullmatch(REFERENCE, label, re.I):
            continue
        if key in entries and entries[key] != label:
            entries[key] = None
        else:
            entries.setdefault(key, label)
    return [{'reference': key, 'label': label} for key, label in entries.items() if label]


def describe_use_case(value, definitions=''):
    raw = value.strip()
    inline = re.fullmatch(rf'({REFERENCE})\s*(?::|[–—-])\s*(.+)', raw, re.I)
    if inline:
        label = inline[2].strip()
    elif re.fullmatch(rf'{REFERENCE}(?:\s*(?:[,;/&]|and)\s*{REFERENCE})*', raw, re.I):
        names = {item['reference']: item['label'] for item in use_case_choices(definitions)}
        labels = [names.get(code.upper(), 'Use case description missing') for code in re.findall(REFERENCE, raw, re.I)]
        label = '; '.join(labels)
    else:
        label = raw or 'Not documented'
    return {'value': value, 'label': label, 'reference': value if raw and label != raw else ''}


def use_case_text(doc, requirement, context=None):
    info = (context or {}).get('labels', {}).get(requirement['id'])
    if not info or info['value'] != requirement['appliesTo']:
        info = describe_use_case(requirement['appliesTo'], doc['sections'].get('useCases', ''))
    return info['label'] + (f" (reference: {info['reference']})" if info['reference'] else '')
