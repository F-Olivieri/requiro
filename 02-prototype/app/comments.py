"""Shared requirement discussions, independent of authoring and delivery evidence."""

import json
import uuid

from prd_store import InputError, MAX_BYTES, now, text


ANCHOR_FIELDS = ('behavior', 'acceptance', 'appliesTo', 'outcome')


def author_label(body):
    if body.get('privacyConfirmed') is not True:
        raise InputError('Confirm that the discussion contains only synthetic or approved nonconfidential material.')
    author = text(body.get('author'), 'Author label', 200).strip()
    if not author:
        raise InputError('Add an author label. Labels do not verify identity.')
    return author


def message(body):
    author = author_label(body)
    content = text(body.get('text', ''), 'Comment')
    suggestion = text(body.get('suggestion', ''), 'Suggested wording')
    if not content.strip() and not suggestion.strip():
        raise InputError('Write a comment or suggest replacement wording.')
    return {'id': 'MESSAGE-' + uuid.uuid4().hex[:12], 'author': author,
            'text': content, 'suggestion': suggestion, 'createdAt': now()}


def validated_anchor(value, requirement):
    fields = {'field', 'start', 'end', 'quote', 'sourceText'}
    if not isinstance(value, dict) or set(value) != fields or value.get('field') not in ANCHOR_FIELDS:
        raise InputError('Select text within one requirement field.')
    source = text(value['sourceText'], 'Selected source text')
    quote = text(value['quote'], 'Selected words')
    if source != requirement[value['field']]:
        raise InputError('The selected field changed. Reload the saved requirement and select its text again.', 409)
    start, end = value['start'], value['end']
    encoded = source.encode('utf-16-le')
    if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(encoded) // 2:
        raise InputError('Select a nonempty range within one saved requirement field.')
    try:
        selected = encoded[start * 2:end * 2].decode('utf-16-le')
    except UnicodeDecodeError as exc:
        raise InputError('The selection must contain complete characters.') from exc
    if not quote.strip() or selected != quote:
        raise InputError('The selected words do not match the saved requirement range.')
    return {'field': value['field'], 'start': start, 'end': end, 'quote': quote, 'sourceText': source}


class Comments:
    def __init__(self, store):
        self.store = store
        with store.connection() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS comment_threads (
                    id TEXT PRIMARY KEY, document_id TEXT NOT NULL,
                    requirement_id TEXT NOT NULL, data TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS comment_threads_document ON comment_threads(document_id);
            ''')

    @staticmethod
    def _decorate(thread, doc):
        requirement = next((req for req in doc['sections']['requirements'] if req['id'] == thread['requirementId']), None)
        return {**thread, 'requirementPresent': requirement is not None,
                'anchorCurrent': requirement is not None and requirement[thread['anchor']['field']] == thread['anchor']['sourceText']}

    @staticmethod
    def _thread(db, document_id, requirement_id, thread_id):
        thread_id = text(thread_id, 'Discussion ID', 100)
        row = db.execute('SELECT data FROM comment_threads WHERE id=? AND document_id=? AND requirement_id=?',
                         (thread_id, document_id, requirement_id)).fetchone()
        if not row:
            raise InputError('Discussion not found.', 404)
        return json.loads(row[0])

    @staticmethod
    def _save(db, document_id, thread, *, create=False):
        payload = json.dumps(thread, ensure_ascii=False)
        if len(payload.encode('utf-8')) > MAX_BYTES:
            raise InputError('This discussion is too large. Start a new comment for the next topic.')
        if create:
            db.execute('INSERT INTO comment_threads VALUES (?, ?, ?, ?)',
                       (thread['id'], document_id, thread['requirementId'], payload))
        else:
            db.execute('UPDATE comment_threads SET data=? WHERE id=? AND document_id=? AND requirement_id=?',
                       (payload, thread['id'], document_id, thread['requirementId']))

    def get(self, document_id):
        with self.store.connection() as db:
            db.execute('BEGIN')
            doc = self.store._get(db, document_id)
            threads = [self._decorate(json.loads(row[0]), doc) for row in db.execute(
                'SELECT data FROM comment_threads WHERE document_id=? ORDER BY rowid', (document_id,))]
        return {'documentId': document_id, 'prdRevision': doc['revision'], 'threads': threads}

    def create(self, document_id, requirement_id, body):
        first = message(body)
        expected = body.get('expectedPrdRevision')
        if type(expected) is not int:
            raise InputError('A numeric expectedPrdRevision is required.')
        with self.store.connection() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                doc = self.store._get(db, document_id)
                if doc['revision'] != expected:
                    raise InputError('The PRD changed. Reload the saved requirement before starting a discussion.', 409)
                requirement = next((req for req in doc['sections']['requirements'] if req['id'] == requirement_id), None)
                if requirement is None:
                    raise InputError('Requirement not found in the current PRD.', 404)
                anchor = validated_anchor(body.get('anchor'), requirement)
                thread = {'id': 'COMMENT-' + uuid.uuid4().hex[:12], 'requirementId': requirement_id,
                          'anchor': anchor, 'createdPrdRevision': doc['revision'], 'revision': 1,
                          'status': 'Open', 'messages': [first],
                          'createdAt': first['createdAt'], 'updatedAt': first['createdAt']}
                self._save(db, document_id, thread, create=True)
                db.commit()
                return self._decorate(thread, doc)
            except Exception:
                db.rollback()
                raise

    def reply(self, document_id, requirement_id, thread_id, body):
        reply = message(body)
        with self.store.connection() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                doc = self.store._get(db, document_id)
                thread = self._thread(db, document_id, requirement_id, thread_id)
                thread['messages'].append(reply)
                thread.update(revision=thread['revision'] + 1, updatedAt=reply['createdAt'])
                self._save(db, document_id, thread)
                db.commit()
                return self._decorate(thread, doc)
            except Exception:
                db.rollback()
                raise

    def set_status(self, document_id, requirement_id, thread_id, body):
        author = author_label(body)
        expected, status = body.get('expectedRevision'), body.get('status')
        if type(expected) is not int or status not in ('Open', 'Resolved'):
            raise InputError('Choose Open or Resolved and provide the current discussion revision.')
        with self.store.connection() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                doc = self.store._get(db, document_id)
                thread = self._thread(db, document_id, requirement_id, thread_id)
                if thread['revision'] != expected:
                    raise InputError('This discussion changed elsewhere. Reload its messages before changing its status.', 409)
                if thread['status'] == status:
                    return self._decorate(thread, doc)
                event = {'id': 'MESSAGE-' + uuid.uuid4().hex[:12], 'author': author,
                         'text': 'Marked this discussion resolved.' if status == 'Resolved' else 'Reopened this discussion.',
                         'suggestion': '', 'createdAt': now()}
                thread['messages'].append(event)
                thread.update(status=status, revision=thread['revision'] + 1, updatedAt=event['createdAt'])
                self._save(db, document_id, thread)
                db.commit()
                return self._decorate(thread, doc)
            except Exception:
                db.rollback()
                raise
