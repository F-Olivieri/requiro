"""PRD document model, validation, storage and export; independent of the UI."""

import contextlib
import datetime
import json
from pathlib import Path
import re
import sqlite3
import uuid


SECTION_KEYS = (
    'problem', 'users', 'outcomes', 'useCases', 'scope', 'nonGoals',
    'inputsOutputs', 'requirements', 'quality', 'metrics', 'risks',
    'decisions', 'evidence',
)
SECTION_LABELS = (
    'Problem', 'Users', 'Outcomes', 'Use cases', 'Scope', 'Non-goals',
    'Inputs and outputs', 'Requirements', 'Quality and operation',
    'Success metrics', 'Risks and dependencies', 'Open decisions', 'Evidence',
)
STAGES = ('Discover', 'Scope', 'Requirements', 'Review')
MAX_BYTES = 1_048_576


class InputError(ValueError):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def text(value, label, limit=20_000):
    if not isinstance(value, str) or len(value) > limit:
        raise InputError(f'{label} must be text of at most {limit} characters.')
    try:
        value.encode('utf-8')
    except UnicodeEncodeError as exc:
        raise InputError(f'{label} contains invalid Unicode text.') from exc
    return value


def validated_sections(sections):
    if not isinstance(sections, dict) or set(sections) != set(SECTION_KEYS):
        raise InputError('Document sections are missing or contain unknown fields.')
    result = {}
    for key in SECTION_KEYS:
        if key != 'requirements':
            result[key] = text(sections[key], key)
            continue
        requirements = sections[key]
        if not isinstance(requirements, list) or len(requirements) > 200:
            raise InputError('Requirements must be a list with at most 200 items.')
        ids = set()
        result[key] = []
        for req in requirements:
            fields = {'id', 'priority', 'proposed', 'appliesTo', 'outcome', 'behavior', 'acceptance'}
            if not isinstance(req, dict) or set(req) != fields:
                raise InputError('A requirement is missing fields or contains unknown fields.')
            if not isinstance(req['id'], str) or not re.fullmatch(r'R-[0-9]{3,6}', req['id']):
                raise InputError('Requirement IDs must use R-001 style.')
            if req['id'] in ids or int(req['id'][2:]) == 0:
                raise InputError('Requirement IDs must be unique positive numbers.')
            ids.add(req['id'])
            if req['priority'] not in ('Must', 'Nice to have') or type(req['proposed']) is not bool:
                raise InputError('Each requirement needs a priority and a proposed-priority flag.')
            cleaned = {k: text(v, k) for k, v in req.items() if k not in ('priority', 'proposed')}
            cleaned.update(priority=req['priority'], proposed=req['proposed'])
            result[key].append(cleaned)
    return result


def validated_chat(chat):
    if not isinstance(chat, list) or len(chat) > 100:
        raise InputError('Chat must contain at most 100 messages; export older messages before removing them.')
    result = []
    for message in chat:
        if not isinstance(message, dict) or set(message) != {'role', 'content'}:
            raise InputError('Invalid chat message.')
        if message['role'] not in ('user', 'assistant'):
            raise InputError('Chat roles must be user or assistant.')
        result.append({'role': message['role'], 'content': text(message['content'], 'Chat message')})
    return result


def missing(value):
    return value.strip().casefold() in ('', 'not documented', 'unknown', 'unresolved', 'tbd', 'tbc')


def approval_gaps(doc):
    sections = doc['sections']
    gaps = [key for key in ('problem', 'users', 'outcomes', 'useCases', 'scope') if missing(sections[key])]
    if not sections['requirements']:
        gaps.append('at least one requirement')
    for req in sections['requirements']:
        for key in ('behavior', 'acceptance', 'outcome', 'appliesTo'):
            if missing(req[key]):
                gaps.append(f"{req['id']} {key}")
        if req['proposed']:
            gaps.append(f"{req['id']} priority agreement")
    return gaps


class Store:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / 'juno.sqlite3'
        with self.connection() as db:
            db.executescript('''
                CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS revisions (
                    document_id TEXT NOT NULL, revision INTEGER NOT NULL,
                    data TEXT NOT NULL, reason TEXT NOT NULL,
                    PRIMARY KEY (document_id, revision));
                CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS project_documents (
                    project_id TEXT NOT NULL, document_id TEXT NOT NULL,
                    PRIMARY KEY (project_id, document_id));
                CREATE TABLE IF NOT EXISTS requirement_imports (
                    source_document_id TEXT NOT NULL, source_revision INTEGER NOT NULL,
                    source_requirement_id TEXT NOT NULL, target_document_id TEXT NOT NULL,
                    target_requirement_id TEXT NOT NULL, target_revision INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (target_document_id, source_document_id, source_revision, source_requirement_id));
                CREATE INDEX IF NOT EXISTS requirement_imports_source
                    ON requirement_imports (source_document_id);
            ''')

    @contextlib.contextmanager
    def connection(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        try:
            yield db
        finally:
            db.close()

    def _get(self, db, document_id):
        row = db.execute('SELECT data FROM documents WHERE id = ?', (document_id,)).fetchone()
        if not row:
            raise InputError('PRD not found.', 404)
        return json.loads(row[0])

    def _record(self, db, doc, reason):
        payload = json.dumps(doc, ensure_ascii=False)
        if len(payload.encode()) > MAX_BYTES:
            raise InputError('Document is too large to save; export and split its scope.')
        db.execute('INSERT OR REPLACE INTO documents VALUES (?, ?)', (doc['id'], payload))
        db.execute('INSERT INTO revisions VALUES (?, ?, ?, ?)', (doc['id'], doc['revision'], payload, reason))

    def get(self, document_id, revision=None):
        with self.connection() as db:
            if revision is None:
                return self._get(db, document_id)
            if type(revision) is not int or not 0 < revision < 2 ** 63:
                raise InputError('Choose a positive revision within the supported numeric range.')
            row = db.execute('SELECT data FROM revisions WHERE document_id = ? AND revision = ?',
                             (document_id, revision)).fetchone()
            if not row:
                raise InputError('Revision not found.', 404)
            return json.loads(row[0])

    def summaries(self):
        with self.connection() as db:
            docs = [json.loads(row[0]) for row in db.execute('SELECT data FROM documents')]
            memberships = {}
            for project_id, document_id in db.execute('SELECT project_id, document_id FROM project_documents ORDER BY project_id'):
                memberships.setdefault(document_id, []).append(project_id)
        keys = ('id', 'title', 'status', 'revision', 'stage', 'updatedAt')
        return [{**{key: doc[key] for key in keys}, 'projectIds': memberships.get(doc['id'], [])}
                for doc in sorted(docs, key=lambda d: d['updatedAt'], reverse=True)]

    def projects(self):
        with self.connection() as db:
            return {'projects': [{'id': row[0], 'name': row[1]} for row in
                                 db.execute('SELECT id, name FROM projects ORDER BY name COLLATE NOCASE, id')]}

    def create_project(self, name, confirmed=False):
        if confirmed is not True:
            raise InputError('Confirm that project material is synthetic or approved nonconfidential course material.')
        name = text(name, 'Project name', 200).strip()
        if not name:
            raise InputError('Give the project a name.')
        project = {'id': 'PROJECT-' + uuid.uuid4().hex[:12], 'name': name}
        with self.connection() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                if any(row[0].strip().casefold() == name.casefold() for row in db.execute('SELECT name FROM projects')):
                    raise InputError('A project with this name already exists. Choose a different name.')
                db.execute('INSERT INTO projects VALUES (?, ?)', (project['id'], project['name']))
                db.commit()
            except Exception:
                db.rollback()
                raise
        return project

    @staticmethod
    def _project_ids(value):
        if not isinstance(value, list) or len(value) > 200 or any(not isinstance(v, str) for v in value):
            raise InputError('Project IDs must be a list of at most 200 IDs.')
        if len(set(value)) != len(value):
            raise InputError('Select each project only once.')
        return sorted(value)

    def _document_projects(self, db, document_id):
        self._get(db, document_id)
        projects = [{'id': row[0], 'name': row[1]} for row in db.execute(
            'SELECT p.id, p.name FROM projects p JOIN project_documents d ON d.project_id=p.id '
            'WHERE d.document_id=? ORDER BY p.id', (document_id,))]
        return {'documentId': document_id, 'projectIds': [p['id'] for p in projects], 'projects': projects}

    def document_projects(self, document_id):
        with self.connection() as db:
            return self._document_projects(db, document_id)

    def link_projects(self, document_id, expected_project_ids, project_ids):
        expected = self._project_ids(expected_project_ids)
        selected = self._project_ids(project_ids)
        with self.connection() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                current = self._document_projects(db, document_id)
                if current['projectIds'] != expected:
                    raise InputError('Project links changed elsewhere. Reload the selections before saving.', 409)
                existing = {row[0] for row in db.execute('SELECT id FROM projects')}
                if not set(selected).issubset(existing):
                    raise InputError('A selected project no longer exists.', 404)
                db.execute('DELETE FROM project_documents WHERE document_id=?', (document_id,))
                db.executemany('INSERT INTO project_documents VALUES (?, ?)', [(p, document_id) for p in selected])
                result = self._document_projects(db, document_id)
                db.commit()
                return result
            except Exception:
                db.rollback()
                raise

    def _relationships(self, db, document_id):
        self._get(db, document_id)
        result = {'documentId': document_id, 'imports': [], 'usedBy': []}
        for row in db.execute('SELECT source_document_id, source_revision, source_requirement_id, '
                              'target_document_id, target_requirement_id, target_revision, created_at '
                              'FROM requirement_imports WHERE source_document_id=? OR target_document_id=? '
                              'ORDER BY created_at, target_document_id, target_requirement_id',
                              (document_id, document_id)):
            source_id, source_revision, source_req, target_id, target_req, target_revision, created_at = row
            source = self._get(db, source_id)
            target = self._get(db, target_id)
            source_snapshot = db.execute('SELECT data FROM revisions WHERE document_id=? AND revision=?',
                                         (source_id, source_revision)).fetchone()
            relation = {'sourceDocumentId': source_id, 'sourceRevision': source_revision,
                        'sourceRequirementId': source_req, 'sourceTitle': json.loads(source_snapshot[0])['title'],
                        'targetDocumentId': target_id, 'targetRequirementId': target_req,
                        'targetTitle': target['title'], 'targetRevision': target_revision, 'createdAt': created_at,
                        'sourceRequirementPresent': any(r['id'] == source_req for r in source['sections']['requirements']),
                        'targetRequirementPresent': any(r['id'] == target_req for r in target['sections']['requirements'])}
            result['imports' if target_id == document_id else 'usedBy'].append(relation)
        return result

    def relationships(self, document_id):
        with self.connection() as db:
            return self._relationships(db, document_id)

    def import_requirements(self, document_id, expected, source_id, source_revision, requirement_ids, confirmed=False):
        if confirmed is not True:
            raise InputError('Confirm that imported material is synthetic or approved nonconfidential course material.')
        if type(expected) is not int or type(source_revision) is not int:
            raise InputError('Numeric expectedRevision and sourceRevision are required.')
        if not isinstance(source_id, str) or source_id == document_id:
            raise InputError('Choose a different source PRD.')
        if (not isinstance(requirement_ids, list) or not 1 <= len(requirement_ids) <= 200
                or any(not isinstance(v, str) for v in requirement_ids)
                or len(set(requirement_ids)) != len(requirement_ids)):
            raise InputError('Select one or more distinct source requirement IDs.')
        with self.connection() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                current = self._get(db, document_id)
                source = self._get(db, source_id)
                if current['revision'] != expected or source['revision'] != source_revision:
                    raise InputError('A PRD changed. Reload the destination and source selection before importing.', 409)
                if current['status'] == 'Archived':
                    raise InputError('Reopen the archived destination PRD before importing requirements.')
                available = {r['id']: r for r in source['sections']['requirements']}
                if not set(requirement_ids).issubset(available):
                    raise InputError('A selected source requirement does not exist.', 404)
                duplicates = {row[0] for row in db.execute(
                    'SELECT source_requirement_id FROM requirement_imports WHERE target_document_id=? '
                    'AND source_document_id=? AND source_revision=?', (document_id, source_id, source_revision))}
                if duplicates.intersection(requirement_ids):
                    raise InputError('A selected requirement from this source revision was already imported.', 409)
                doc = json.loads(json.dumps(current))
                added = []
                for source_req in requirement_ids:
                    req = dict(available[source_req])
                    req['id'] = f"R-{doc['nextRequirementNumber']:03d}"
                    req['proposed'] = True
                    doc['nextRequirementNumber'] += 1
                    doc['sections']['requirements'].append(req)
                    added.append((source_id, source_revision, source_req, document_id, req['id'], expected + 1, now()))
                doc['sections'] = validated_sections(doc['sections'])
                doc.update(status='Draft', revision=expected + 1, updatedAt=now())
                self._record(db, doc, f'Imported {len(added)} requirement(s) from {source_id} revision {source_revision}')
                db.executemany('INSERT INTO requirement_imports VALUES (?, ?, ?, ?, ?, ?, ?)', added)
                relations = self._relationships(db, document_id)['imports']
                imported_ids = {row[4] for row in added}
                db.commit()
                return {'doc': doc, 'imports': [r for r in relations if r['targetRequirementId'] in imported_ids]}
            except Exception:
                db.rollback()
                raise

    def create(self, title, confirmed=False, imported=None):
        if confirmed is not True:
            raise InputError('Confirm that the material is synthetic or approved nonconfidential course material, free of real employer, customer, personal, and account information.')
        title = text(title, 'Title', 200).strip()
        if not title:
            raise InputError('Give the PRD a title.')
        doc = {
            'id': 'PRD-' + uuid.uuid4().hex[:12], 'title': title,
            'status': 'Draft', 'revision': 1, 'stage': 'Discover', 'updatedAt': now(),
            'approvedRevision': None, 'privacy': 'synthetic-or-approved-nonconfidential',
            'sections': {key: [] if key == 'requirements' else '' for key in SECTION_KEYS},
            'chat': [], 'nextRequirementNumber': 1,
        }
        if imported is not None:
            if not isinstance(imported, dict):
                raise InputError('Import must contain one exported PRD object.')
            doc['sections'] = validated_sections(imported.get('sections'))
            doc['chat'] = validated_chat(imported.get('chat', []))
            if imported.get('stage') not in STAGES:
                raise InputError('Invalid imported stage.')
            doc['stage'] = imported['stage']
            doc['nextRequirementNumber'] = max([int(r['id'][2:]) for r in doc['sections']['requirements']] + [0]) + 1
        with self.connection() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                self._record(db, doc, 'Imported as a new draft' if imported else 'Created')
                db.commit()
            except Exception:
                db.rollback()
                raise
        return doc

    def mutate(self, document_id, expected, *, candidate=None, action=None, revision=None):
        if type(expected) is not int:
            raise InputError('A numeric expectedRevision is required.')
        with self.connection() as db:
            try:
                db.execute('BEGIN IMMEDIATE')
                current = self._get(db, document_id)
                if current['revision'] != expected:
                    raise InputError('This PRD changed elsewhere. Reload and reconcile your edits before saving.', 409)
                doc = json.loads(json.dumps(current))
                reason = action or 'Edited'
                if candidate is not None:
                    if current['status'] == 'Archived':
                        raise InputError('Reopen the archived PRD before editing.')
                    if not isinstance(candidate, dict) or candidate.get('id') != document_id:
                        raise InputError('The submitted document ID does not match.')
                    doc['title'] = text(candidate.get('title'), 'Title', 200).strip()
                    if not doc['title'] or candidate.get('stage') not in STAGES:
                        raise InputError('A title and a valid stage are required.')
                    doc['stage'] = candidate['stage']
                    doc['sections'] = validated_sections(candidate.get('sections'))
                    doc['chat'] = validated_chat(candidate.get('chat', []))
                    old_ids = {r['id'] for r in current['sections']['requirements']}
                    for req in doc['sections']['requirements']:
                        if req['id'] not in old_ids and int(req['id'][2:]) < current['nextRequirementNumber']:
                            raise InputError(f"{req['id']} is retired. Add a new requirement ID or restore a historical revision.")
                    doc['nextRequirementNumber'] = max(current['nextRequirementNumber'],
                        max([int(r['id'][2:]) for r in doc['sections']['requirements']] + [0]) + 1)
                    if all(doc[k] == current[k] for k in ('title', 'stage', 'sections', 'chat')):
                        return current
                    doc['status'] = 'Draft'
                elif action == 'review':
                    if current['status'] != 'Draft':
                        raise InputError('Only a draft can enter review.')
                    doc['status'] = 'In review'
                    doc['stage'] = 'Review'
                elif action == 'approve':
                    if current['status'] != 'In review':
                        raise InputError('Move this exact draft into review before approval.')
                    gaps = approval_gaps(current)
                    if gaps:
                        raise InputError('Resolve these approval gaps: ' + ', '.join(gaps))
                    doc['status'] = 'Approved'
                    doc['approvedRevision'] = expected + 1
                elif action == 'archive':
                    if current['status'] == 'Archived':
                        raise InputError('This PRD is already archived.')
                    doc['status'] = 'Archived'
                elif action == 'reopen':
                    if current['status'] != 'Archived':
                        raise InputError('Only an archived PRD can be reopened.')
                    doc['status'] = 'Draft'
                elif action == 'restore':
                    if current['status'] == 'Archived':
                        raise InputError('Reopen the PRD before restoring a revision.')
                    if type(revision) is not int or not 0 < revision < 2 ** 63:
                        raise InputError('Choose a positive revision within the supported numeric range.')
                    row = db.execute('SELECT data FROM revisions WHERE document_id=? AND revision=?',
                                     (document_id, revision)).fetchone()
                    if not row:
                        raise InputError('Revision not found.', 404)
                    historical = json.loads(row[0])
                    for key in ('title', 'stage', 'sections', 'chat'):
                        doc[key] = historical[key]
                    doc['status'] = 'Draft'
                    reason = f'Restored revision {revision} as a new draft'
                else:
                    raise InputError('Unknown lifecycle action.')
                doc['revision'] = expected + 1
                doc['updatedAt'] = now()
                self._record(db, doc, reason)
                db.commit()
                return doc
            except Exception:
                db.rollback()
                raise

    def history(self, document_id):
        with self.connection() as db:
            self._get(db, document_id)
            result = []
            for data, reason in db.execute('SELECT data, reason FROM revisions WHERE document_id=? ORDER BY revision DESC', (document_id,)):
                doc = json.loads(data)
                result.append({**{key: doc[key] for key in ('revision', 'status', 'title', 'updatedAt')}, 'reason': reason})
            return result


def markdown(doc):
    lines = [f"# {doc['title']}", '',
             f"{doc['id']} · Revision {doc['revision']} · {doc['status']} · {doc['stage']}",
             f"Updated: {doc['updatedAt']}",
             f"Last approved revision: {doc['approvedRevision'] or 'None'}", '']
    for key, label in zip(SECTION_KEYS, SECTION_LABELS):
        lines.extend([f'## {label}', ''])
        if key != 'requirements':
            lines.extend([doc['sections'][key] or 'Not documented', ''])
        else:
            for req in doc['sections'][key]:
                lines.extend([f"### {req['id']} · {req['priority']}" + (' (proposed)' if req['proposed'] else ''), '',
                    f"Applies to: {req['appliesTo'] or 'Unresolved'}",
                    f"Outcome: {req['outcome'] or 'Not documented'}", '',
                    req['behavior'] or 'Behavior: Not documented', '',
                    'Acceptance: ' + (req['acceptance'] or 'Not documented'), ''])
            if not doc['sections'][key]:
                lines.extend(['Not documented', ''])
    return '\n'.join(lines)
