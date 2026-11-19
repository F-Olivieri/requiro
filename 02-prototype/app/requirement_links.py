"""Explicit requirement relations and derived text references; separate from PRD wording."""

import re
import uuid

from prd_store import InputError, now, text


TEXT_FIELDS = ('behavior', 'acceptance', 'appliesTo', 'outcome')
REFERENCE = re.compile(r'\[\[(?:(PRD-[A-Za-z0-9_-]+)/)?(R-[0-9]{3,6})\]\]')
KINDS = ('Connected to', 'Depends on')


def references(value, document_id):
    for match in REFERENCE.finditer(value):
        yield {'targetDocumentId': match[1] or document_id,
               'targetRequirementId': match[2], 'text': match[0],
               'start': len(value[:match.start()].encode('utf-16-le')) // 2,
               'end': len(value[:match.end()].encode('utf-16-le')) // 2}


def remap_copied_references(value, source_id, copied_ids):
    def replace(match):
        if match[1] and match[1] != source_id:
            return match[0]
        if match[2] in copied_ids:
            return '[[' + copied_ids[match[2]] + ']]'
        return '[[' + source_id + '/' + match[2] + ']]'
    return REFERENCE.sub(replace, value)


class RequirementLinks:
    def __init__(self, store):
        self.store = store
        with store.connection() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS requirement_links (
                    id TEXT PRIMARY KEY, kind TEXT NOT NULL,
                    source_document_id TEXT NOT NULL, source_requirement_id TEXT NOT NULL,
                    target_document_id TEXT NOT NULL, target_requirement_id TEXT NOT NULL,
                    revision INTEGER NOT NULL, active INTEGER NOT NULL, created_at TEXT NOT NULL);
                CREATE UNIQUE INDEX IF NOT EXISTS requirement_links_active
                    ON requirement_links(kind, source_document_id, source_requirement_id,
                        target_document_id, target_requirement_id) WHERE active=1;
            ''')

    @staticmethod
    def _decorate(row, present):
        identity, kind, source_doc, source_req, target_doc, target_req, revision, active, created = row
        return {'id': identity, 'kind': kind, 'sourceDocumentId': source_doc,
                'sourceRequirementId': source_req, 'targetDocumentId': target_doc,
                'targetRequirementId': target_req, 'revision': revision,
                'sourcePresent': (source_doc, source_req) in present,
                'targetPresent': (target_doc, target_req) in present, 'createdAt': created}

    def snapshot(self):
        with self.store.connection() as db:
            db.execute('BEGIN')
            documents = [self.store._get(db, row[0]) for row in db.execute('SELECT id FROM documents ORDER BY id')]
            nodes = [{'id': doc['id'] + '/' + req['id'], 'documentId': doc['id'],
                      'requirementId': req['id'], 'documentTitle': doc['title'],
                      'documentRevision': doc['revision'], 'documentStatus': doc['status'],
                      'behavior': req['behavior']}
                     for doc in documents for req in doc['sections']['requirements']]
            present = {(node['documentId'], node['requirementId']) for node in nodes}
            links = [self._decorate(row, present) for row in db.execute(
                'SELECT * FROM requirement_links WHERE active=1 ORDER BY created_at,id')]
            refs = [{**ref, 'sourceDocumentId': doc['id'], 'sourceRequirementId': req['id'],
                     'field': field, 'targetPresent': (ref['targetDocumentId'], ref['targetRequirementId']) in present}
                    for doc in documents for req in doc['sections']['requirements']
                    for field in TEXT_FIELDS for ref in references(req[field], doc['id'])]
        return {'documents': [{key: doc[key] for key in ('id', 'title', 'revision', 'status')}
                              for doc in documents],
                'nodes': nodes, 'links': links, 'references': refs}

    def _endpoints(self, db, body, source_doc, source_req, target_doc, target_req):
        for identity, requirement_id, key in (
                (source_doc, source_req, 'expectedSourcePrdRevision'),
                (target_doc, target_req, 'expectedTargetPrdRevision')):
            expected = body.get(key)
            if type(expected) is not int:
                raise InputError('Current source and target PRD revisions are required.')
            doc = self.store._get(db, identity)
            if doc['revision'] != expected:
                raise InputError('A linked PRD changed. Reload the graph before changing links.', 409)
            if not any(req['id'] == requirement_id for req in doc['sections']['requirements']):
                raise InputError('A linked requirement no longer exists. Reload the graph.', 404)

    def add(self, body):
        if not isinstance(body, dict):
            raise InputError('Supply the two requirements and relationship type.')
        kind = body.get('kind')
        if kind not in KINDS:
            raise InputError('Choose Connected to or Depends on.')
        source = (text(body.get('sourceDocumentId'), 'Source PRD', 100),
                  text(body.get('sourceRequirementId'), 'Source requirement', 100))
        target = (text(body.get('targetDocumentId'), 'Target PRD', 100),
                  text(body.get('targetRequirementId'), 'Target requirement', 100))
        if source == target:
            raise InputError('Choose two different requirements.')
        if kind == 'Connected to' and target < source:
            source, target = target, source
            body = {**body, 'expectedSourcePrdRevision': body.get('expectedTargetPrdRevision'),
                    'expectedTargetPrdRevision': body.get('expectedSourcePrdRevision')}
        with self.store.connection() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                self._endpoints(db, body, *source, *target)
                if db.execute('SELECT 1 FROM requirement_links WHERE kind=? AND source_document_id=? '
                              'AND source_requirement_id=? AND target_document_id=? AND target_requirement_id=? '
                              'AND active=1', (kind, *source, *target)).fetchone():
                    raise InputError('These requirements already have this link.', 409)
                row = ('LINK-' + uuid.uuid4().hex[:12], kind, *source, *target, 1, 1, now())
                db.execute('INSERT INTO requirement_links VALUES (?,?,?,?,?,?,?,?,?)', row)
                db.commit()
                return self._decorate(row, {source, target})
            except Exception:
                db.rollback()
                raise

    def remove(self, link_id, body):
        if not isinstance(body, dict) or type(body.get('expectedRevision')) is not int:
            raise InputError('The current link revision is required.')
        link_id = text(link_id, 'Link ID', 100)
        with self.store.connection() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT * FROM requirement_links WHERE id=?', (link_id,)).fetchone()
                if not row:
                    raise InputError('Requirement link not found.', 404)
                if row[6] != body['expectedRevision'] or not row[7]:
                    raise InputError('This link changed elsewhere. Reload the graph.', 409)
                # Missing endpoints may still be unlinked, while current document revisions protect the action.
                for identity, key in ((row[2], 'expectedSourcePrdRevision'), (row[4], 'expectedTargetPrdRevision')):
                    doc = self.store._get(db, identity)
                    if type(body.get(key)) is not int or doc['revision'] != body[key]:
                        raise InputError('A linked PRD changed. Reload the graph before removing the link.', 409)
                db.execute('UPDATE requirement_links SET active=0,revision=revision+1 WHERE id=?', (link_id,))
                db.commit()
                return {'id': link_id, 'revision': row[6] + 1, 'removed': True}
            except Exception:
                db.rollback()
                raise
