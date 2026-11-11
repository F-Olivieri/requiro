"""Local completion evidence and explicit team verdicts, separate from PRD authoring."""

import hashlib
import io
import json
import re
import uuid
import zipfile
from urllib.parse import quote

from prd_store import InputError, markdown, missing, now, text
from use_cases import use_case_text


MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
STATUSES = ('Not reviewed', 'To discuss', 'Needs work', 'Verified', 'Needs recheck')


def status_label(status):
    return 'Complete' if status == 'Verified' else status


def required_gaps(requirement, item):
    fields = {'behavior': requirement.get('behavior'), 'acceptance criteria': requirement.get('acceptance'),
              'proof explanation': item.get('proof'), 'reviewer role': item.get('reviewer'),
              'review date': item.get('reviewedAt')}
    gaps = [label for label, value in fields.items() if not isinstance(value, str) or missing(value)]
    owners = item.get('owners')
    if not isinstance(owners, list) or not owners or any(not isinstance(owner, str) or missing(owner) for owner in owners):
        gaps.append('engineering owner')
    return gaps


def fingerprint(doc, requirement):
    context = {key: doc['sections'][key] for key in
               ('scope', 'useCases', 'inputsOutputs', 'nonGoals', 'quality')}
    return hashlib.sha256(json.dumps([requirement, context], sort_keys=True,
                                    ensure_ascii=False).encode()).hexdigest()


def filename(value):
    value = text(value, 'Attachment filename', 200).strip()
    if not value or value in ('.', '..') or any(c in value for c in '/\\') or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise InputError('Use a filename without folders or control characters.')
    return value


class Verification:
    def __init__(self, store):
        self.store = store
        with store.connection() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS verification (
                    document_id TEXT NOT NULL, requirement_id TEXT NOT NULL,
                    data TEXT NOT NULL, PRIMARY KEY (document_id, requirement_id));
                CREATE TABLE IF NOT EXISTS verification_history (
                    document_id TEXT NOT NULL, requirement_id TEXT NOT NULL,
                    revision INTEGER NOT NULL, data TEXT NOT NULL,
                    PRIMARY KEY (document_id, requirement_id, revision));
            ''')

    def _item(self, db, doc, requirement):
        row = db.execute('SELECT data FROM verification WHERE document_id=? AND requirement_id=?',
                         (doc['id'], requirement['id'])).fetchone()
        current = fingerprint(doc, requirement)
        item = {'requirementId': requirement['id'], 'requirementFingerprint': current,
                'baselinePrdRevision': None, 'revision': 0, 'owners': [], 'proof': '',
                'attachments': [], 'status': 'Not reviewed', 'reviewer': '',
                'reviewedAt': None, 'reviewNotes': '', 'savedAt': None}
        if not row:
            return item
        item.update(json.loads(row[0]))
        if item['status'] != 'To discuss' and (
                item['requirementFingerprint'] != current or item['baselinePrdRevision'] != doc['revision']
                or item['status'] == 'Verified' and required_gaps(requirement, item)):
            item['status'] = 'Needs recheck'
        item['requirementFingerprint'] = current
        return item

    def _snapshot(self, db, document_id):
        doc = self.store._get(db, document_id)
        items = [self._item(db, doc, req) for req in doc['sections']['requirements']]
        return doc, items

    def get(self, document_id):
        with self.store.connection() as db:
            db.execute('BEGIN')
            doc, items = self._snapshot(db, document_id)
        return {'documentId': document_id, 'prdRevision': doc['revision'], 'items': items}

    def _current(self, db, document_id, requirement_id, expected_prd, expected):
        if type(expected_prd) is not int or type(expected) is not int:
            raise InputError('Numeric expectedPrdRevision and expectedRevision are required.')
        doc = self.store._get(db, document_id)
        if doc['revision'] != expected_prd:
            raise InputError('The PRD changed. Reload before recording completion evidence or a team review.', 409)
        requirement = next((r for r in doc['sections']['requirements'] if r['id'] == requirement_id), None)
        if requirement is None:
            raise InputError('Requirement not found in the current PRD.', 404)
        item = self._item(db, doc, requirement)
        if item['revision'] != expected:
            raise InputError('Completion evidence changed elsewhere. Reload before saving or reviewing.', 409)
        return doc, item

    def _save(self, db, doc, item):
        item['revision'] += 1
        item['baselinePrdRevision'] = doc['revision']
        item['savedAt'] = now()
        payload = json.dumps(item, ensure_ascii=False)
        db.execute('INSERT OR REPLACE INTO verification VALUES (?, ?, ?)',
                   (doc['id'], item['requirementId'], payload))
        db.execute('INSERT INTO verification_history VALUES (?, ?, ?, ?)',
                   (doc['id'], item['requirementId'], item['revision'], payload))
        return item

    def update(self, document_id, requirement_id, body, *, review=False):
        with self.store.connection() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                doc, item = self._current(db, document_id, requirement_id,
                                          body.get('expectedPrdRevision'), body.get('expectedRevision'))
                if review:
                    status = 'Verified' if body.get('status') == 'Complete' else body.get('status')
                    if status not in ('Verified', 'To discuss', 'Needs work'):
                        raise InputError('Choose Complete, To discuss or Needs work.')
                    reviewer = text(body.get('reviewer', ''), 'Reviewer role', 200).strip()
                    if status != 'To discuss' and missing(reviewer):
                        raise InputError('Record the role of the person who reviewed the evidence.')
                    item.update(status=status, reviewer=reviewer, reviewedAt=now(),
                                reviewNotes=text(body.get('notes', ''), 'Review notes'))
                    if item['status'] == 'Verified':
                        requirement = next(req for req in doc['sections']['requirements'] if req['id'] == requirement_id)
                        gaps = required_gaps(requirement, item)
                        if gaps:
                            raise InputError('Complete requires: ' + ', '.join(gaps) + '.')
                else:
                    owners = body.get('owners')
                    if not isinstance(owners, list) or len(owners) > 20:
                        raise InputError('Engineering owners must be a list of at most 20 role labels.')
                    owners = [text(owner, 'Engineering owner role', 200).strip() for owner in owners]
                    if any(missing(owner) for owner in owners) or len(set(owners)) != len(owners):
                        raise InputError('Engineering owner role labels must be meaningful and unique.')
                    proof = text(body.get('proof'), 'Proof explanation')
                    if item['owners'] == owners and item['proof'] == proof:
                        return item
                    item.update(owners=owners, proof=proof,
                                status=item['status'] if item['status'] in ('Not reviewed', 'To discuss') else 'Needs recheck')
                self._save(db, doc, item)
                db.commit()
                return item
            except Exception:
                db.rollback()
                raise

    def attach(self, document_id, requirement_id, expected_prd, expected, name, content):
        name = filename(name)
        if not 0 < len(content) <= MAX_ATTACHMENT_BYTES:
            raise InputError('Attachments must contain between 1 byte and 25 MiB.', 413)
        created_path = None
        with self.store.connection() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                doc, item = self._current(db, document_id, requirement_id, expected_prd, expected)
                attachment_id = uuid.uuid4().hex
                directory = self.store.directory / 'attachments'
                directory.mkdir(exist_ok=True)
                path = directory / attachment_id
                with path.open('xb') as target:
                    created_path = path
                    target.write(content)
                item['attachments'].append({'id': attachment_id, 'name': name, 'size': len(content),
                                            'sha256': hashlib.sha256(content).hexdigest()})
                if item['status'] not in ('Not reviewed', 'To discuss'):
                    item['status'] = 'Needs recheck'
                self._save(db, doc, item)
                db.commit()
                return item
            except Exception:
                db.rollback()
                if created_path is not None:
                    created_path.unlink(missing_ok=True)
                raise

    def _attachment(self, item, attachment_id):
        if not re.fullmatch(r'[0-9a-f]{32}', attachment_id):
            raise InputError('Attachment not found.', 404)
        attachment = next((a for a in item['attachments'] if a['id'] == attachment_id), None)
        if attachment is None:
            raise InputError('Attachment not found.', 404)
        content = (self.store.directory / 'attachments' / attachment_id).read_bytes()
        if len(content) != attachment['size'] or hashlib.sha256(content).hexdigest() != attachment['sha256']:
            raise InputError('The stored attachment changed or is incomplete; restore it before exporting.', 500)
        return attachment, content

    def history(self, document_id, requirement_id):
        with self.store.connection() as db:
            db.execute('BEGIN')
            doc = self.store._get(db, document_id)
            if not any(req['id'] == requirement_id for req in doc['sections']['requirements']):
                raise InputError('Requirement not found in the current PRD.', 404)
            return [json.loads(row[0]) for row in db.execute(
                'SELECT data FROM verification_history WHERE document_id=? AND requirement_id=? ORDER BY revision DESC',
                (document_id, requirement_id))]

    def attachment(self, document_id, requirement_id, attachment_id):
        result = self.get(document_id)
        item = next((i for i in result['items'] if i['requirementId'] == requirement_id), None)
        if item is None:
            raise InputError('Requirement not found in the current PRD.', 404)
        return self._attachment(item, attachment_id)

    def report(self, document_id):
        with self.store.connection() as db:
            db.execute('BEGIN')
            doc, items = self._snapshot(db, document_id)
        use_cases = self.store.use_case_context(doc)
        counts = {status: sum(item['status'] == status for item in items) for status in STATUSES}
        lines = [f"# Completion review: {doc['title']}", '',
                 f"{document_id} · Current PRD revision {doc['revision']}", '',
                 'Complete means an explicit recorded team verdict. This workspace does not execute or independently validate proof.', '',
                 'To discuss means a question or decision remains open. These requirements count as pending.', '',
                 f"Requirements: {len(items)}. " + '; '.join(f'{status_label(status)}: {counts[status]}' for status in STATUSES) + '.', '',
                 'All current requirements have a recorded Complete team verdict.' if items and counts['Verified'] == len(items)
                 else 'Completion has gaps: review the not-reviewed, to-discuss, needs-work and needs-recheck requirements below.', '',
                 '[Full current PRD](prd.md)', '']
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as bundle:
            bundle.writestr('prd.md', markdown(doc, use_cases))
            for requirement, item in zip(doc['sections']['requirements'], items):
                gaps = required_gaps(requirement, item)
                lines.extend([f"## {requirement['id']} · {status_label(item['status'])}", '',
                    'Required information gaps: ' + (', '.join(gaps) if gaps else 'None.'), '',
                    f"Priority: {requirement['priority']}" + (' (proposed)' if requirement['proposed'] else ''),
                    f"Use case: {use_case_text(doc, requirement, use_cases)}",
                    f"Outcome: {requirement['outcome'] or 'Not documented'}", '',
                    'Behavior:', requirement['behavior'] or 'Not documented', '',
                    'Acceptance:', requirement['acceptance'] or 'Not documented', '',
                    'Engineering owners: ' + (', '.join(item['owners']) or 'Not assigned'), '',
                    'Proof explanation:', item['proof'] or 'Not documented', '',
                    f"Last reviewer role: {item['reviewer'] or 'Not recorded'}",
                    f"Last reviewed at: {item['reviewedAt'] or 'Not recorded'}",
                    f"Evidence baseline PRD revision: {item['baselinePrdRevision'] or 'Not recorded'}",
                    'Review notes: ' + (item['reviewNotes'] or 'Not recorded'), '', 'Proof attachments:', ''])
                for metadata in item['attachments']:
                    attachment, content = self._attachment(item, metadata['id'])
                    archive_path = f"attachments/{attachment['id']}/{attachment['name']}"
                    bundle.writestr(archive_path, content)
                    label = attachment['name'].replace('\\', '\\\\').replace('[', '\\[').replace(']', '\\]')
                    lines.append(f"- [{label}]({quote(archive_path)}) ({attachment['size']} bytes)")
                if not item['attachments']:
                    lines.append('None attached.')
                lines.append('')
            bundle.writestr('completion-report.md', '\n'.join(lines))
        return output.getvalue()
