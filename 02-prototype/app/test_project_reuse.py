"""Synthetic project membership and selected-requirement reuse tests."""

import copy
import json
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
import unittest
from unittest.mock import patch

from prd_store import InputError, Store
from verification import Verification
import test_server as fixtures


class ProjectReuseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = Store(self.directory.name)
        second = fixtures.requirement(2)
        second.update(behavior='A member can remove an item from a draft list.',
                      acceptance='The removed item no longer appears in the draft list.')
        self.source = self.create('Fictional source', [fixtures.requirement(1), second])
        self.target = self.create('Fictional destination', [fixtures.requirement(1)])

    def create(self, title, requirements):
        doc = self.store.create(title, True)
        doc['sections']['requirements'] = requirements
        return self.store.mutate(doc['id'], doc['revision'], candidate=doc)

    def rejected(self, status, operation):
        with self.assertRaises(InputError) as caught:
            operation()
        self.assertEqual(caught.exception.status, status)

    def import_selected(self, **changes):
        args = dict(document_id=self.target['id'], expected=self.target['revision'],
                    source_id=self.source['id'], source_revision=self.source['revision'],
                    requirement_ids=['R-002'], confirmed=True)
        args.update(changes)
        return self.store.import_requirements(**args)

    def test_many_to_many_memberships_do_not_revise_documents_and_survive_reopen(self):
        first = self.store.create_project('Fictional release', True)
        second = self.store.create_project('Fictional exploration', True)
        before = self.store.get(self.target['id'])
        history = self.store.history(self.target['id'])
        ids = [first['id'], second['id']]
        self.assertEqual(self.store.link_projects(self.target['id'], [], ids)['projectIds'], sorted(ids))
        self.store.link_projects(self.source['id'], [], [first['id']])
        self.assertEqual(self.store.get(self.target['id']), before)
        self.assertEqual(self.store.history(self.target['id']), history)
        reopened = Store(self.directory.name)
        self.assertEqual(reopened.document_projects(self.target['id'])['projectIds'], sorted(ids))
        summaries = {d['id']: d for d in reopened.summaries()}
        self.assertEqual(summaries[self.source['id']]['projectIds'], [first['id']])
        self.store.link_projects(self.target['id'], ids, [])
        self.assertEqual(len(self.store.projects()['projects']), 2)
        self.assertEqual(self.store.get(self.target['id']), before)

    # 2026-11-09: repeated project labels must not create indistinguishable choices.
    def test_duplicate_project_names_are_rejected_without_changing_legacy_records(self):
        project = self.store.create_project('Fictional garden', True)
        self.store.link_projects(self.target['id'], [], [project['id']])
        before = self.store.get(self.target['id'])
        for duplicate in ('Fictional garden', '  fictional GARDEN  '):
            self.rejected(422, lambda: self.store.create_project(duplicate, True))
        self.store.create_project('Fictional workshop', True)
        self.store.create_project('Fictional Straße', True)
        self.rejected(422, lambda: self.store.create_project('Fictional STRASSE', True))
        with self.store.connection() as db:
            db.execute('INSERT INTO projects VALUES (?,?)', ('legacy-duplicate', 'Fictional garden'))
        legacy = self.store.projects()
        self.rejected(422, lambda: self.store.create_project('Fictional garden', True))
        self.assertEqual(self.store.projects(), legacy, 'Existing duplicates must not be merged or deleted.')
        self.assertEqual(self.store.document_projects(self.target['id'])['projectIds'], [project['id']])
        self.assertEqual(self.store.get(self.target['id']), before)

    def test_duplicate_project_check_is_atomic_for_concurrent_creates(self):
        ready = threading.Barrier(2)
        def create():
            ready.wait(timeout=5)
            try:
                return self.store.create_project('Fictional concurrent project', True)
            except InputError as error:
                return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: create(), range(2)))
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        self.assertEqual(results.count(422), 1)
        self.assertEqual(len(self.store.projects()['projects']), 1)

    def test_memberships_reject_concurrent_changes_unknown_ids_and_invalid_payloads(self):
        project = self.store.create_project('Fictional release', True)
        self.store.link_projects(self.target['id'], [], [project['id']])
        self.rejected(409, lambda: self.store.link_projects(self.target['id'], [], []))
        self.rejected(404, lambda: self.store.link_projects(self.target['id'], [project['id']], ['missing']))
        for value in (None, 'all', [1], [project['id'], project['id']]):
            self.rejected(422, lambda: self.store.link_projects(self.target['id'], [project['id']], value))
        self.assertEqual(self.store.document_projects(self.target['id'])['projectIds'], [project['id']])
        for name, confirmed in [('', True), ('Fictional', False), ('Fictional', 1)]:
            self.rejected(422, lambda: self.store.create_project(name, confirmed))
        self.assertEqual(len(self.store.projects()['projects']), 1)

    def test_import_copies_selection_with_new_ids_and_pinned_two_way_provenance(self):
        source_before = self.store.get(self.source['id'])
        source_history = self.store.history(self.source['id'])
        target_before = copy.deepcopy(self.target)
        result = self.import_selected()
        saved = result['doc']
        self.assertEqual(saved['revision'], target_before['revision'] + 1)
        self.assertEqual(saved['status'], 'Draft')
        self.assertEqual(saved['sections']['requirements'][0], target_before['sections']['requirements'][0])
        copied = saved['sections']['requirements'][1]
        self.assertEqual(copied, {**self.source['sections']['requirements'][1], 'id': 'R-002', 'proposed': True})
        self.assertEqual(saved['nextRequirementNumber'], 3)
        self.assertEqual(self.store.get(self.source['id']), source_before)
        self.assertEqual(self.store.history(self.source['id']), source_history)
        self.assertEqual(self.store.get(self.target['id'], target_before['revision']), target_before)
        incoming = self.store.relationships(self.target['id'])['imports']
        outgoing = self.store.relationships(self.source['id'])['usedBy']
        self.assertEqual(incoming, outgoing)
        self.assertEqual(incoming, result['imports'])
        relation = incoming[0]
        for key, value in dict(sourceDocumentId=self.source['id'], sourceTitle=self.source['title'],
                               sourceRevision=self.source['revision'], sourceRequirementId='R-002',
                               targetDocumentId=self.target['id'], targetTitle=self.target['title'],
                               targetRequirementId='R-002', targetRevision=saved['revision']).items():
            self.assertEqual(relation[key], value)
        self.assertEqual(Store(self.directory.name).relationships(self.source['id'])['usedBy'], outgoing)
        changed = copy.deepcopy(self.source)
        changed['title'] = 'Fictional source renamed'
        changed['sections']['requirements'][1]['behavior'] = 'Changed source wording.'
        self.store.mutate(changed['id'], changed['revision'], candidate=changed)
        self.assertEqual(self.store.get(self.target['id']), saved)
        self.assertEqual(self.store.relationships(self.target['id'])['imports'][0]['sourceTitle'], self.source['title'])

    def test_new_ids_skip_retired_ids_and_proof_and_review_are_not_copied(self):
        verification = Verification(self.store)
        source_review = verification.update(self.source['id'], 'R-002', {
            'expectedPrdRevision': self.source['revision'], 'expectedRevision': 0,
            'owners': ['Fictional engineering role'], 'proof': 'Synthetic proof.'})
        source_review = verification.update(self.source['id'], 'R-002', {
            'expectedPrdRevision': self.source['revision'], 'expectedRevision': source_review['revision'],
            'status': 'Complete', 'reviewer': 'Fictional test role'}, review=True)
        verification.attach(self.source['id'], 'R-002', self.source['revision'], source_review['revision'],
                            'synthetic-proof.txt', b'Synthetic attachment')
        source_evidence = verification.get(self.source['id'])
        target = copy.deepcopy(self.target)
        target['sections']['requirements'] = []
        self.target = self.store.mutate(target['id'], target['revision'], candidate=target)
        imported = self.import_selected(requirement_ids=['R-002'])['doc']
        self.assertEqual(imported['sections']['requirements'][0]['id'], 'R-002')
        item = verification.get(self.target['id'])['items'][0]
        self.assertEqual(item['status'], 'Not reviewed')
        self.assertEqual(item['owners'], [])
        self.assertEqual(item['proof'], '')
        self.assertEqual(item['attachments'], [])
        self.assertEqual(verification.get(self.source['id']), source_evidence)

    def test_import_rejects_stale_missing_self_duplicates_and_archived_atomically(self):
        before = self.store.get(self.target['id'])
        history = self.store.history(self.target['id'])
        cases = [(409, {'expected': 0}), (409, {'source_revision': 0}),
                 (422, {'source_id': self.target['id']}), (404, {'source_id': 'missing'}),
                 (404, {'requirement_ids': ['R-001', 'R-999']}),
                 (422, {'requirement_ids': []}), (422, {'requirement_ids': ['R-001', 'R-001']}),
                 (422, {'requirement_ids': [1]}), (422, {'confirmed': False}),
                 (422, {'expected': True}), (422, {'source_revision': True})]
        for status, change in cases:
            with self.subTest(change=change):
                self.rejected(status, lambda: self.import_selected(**change))
                self.assertEqual(self.store.get(self.target['id']), before)
                self.assertEqual(self.store.history(self.target['id']), history)
                self.assertEqual(self.store.relationships(self.target['id'])['imports'], [])
        imported = self.import_selected()['doc']
        self.rejected(409, lambda: self.import_selected(expected=imported['revision'], requirement_ids=['R-001', 'R-002']))
        self.assertEqual(self.store.get(self.target['id']), imported)
        self.assertEqual(len(self.store.relationships(self.target['id'])['imports']), 1)
        archived = self.store.mutate(self.target['id'], imported['revision'], action='archive')
        self.rejected(422, lambda: self.import_selected(expected=archived['revision'], requirement_ids=['R-001']))

    def test_provenance_survives_requirement_removal(self):
        result = self.import_selected(requirement_ids=['R-001'])
        changed = copy.deepcopy(result['doc'])
        changed['sections']['requirements'] = changed['sections']['requirements'][:1]
        self.store.mutate(changed['id'], changed['revision'], candidate=changed)
        self.assertFalse(self.store.relationships(self.target['id'])['imports'][0]['targetRequirementPresent'])
        self.assertTrue(self.store.relationships(self.target['id'])['imports'][0]['sourceRequirementPresent'])
        self.rejected(409, lambda: self.import_selected(expected=changed['revision'] + 1, requirement_ids=['R-001']))

    def test_archived_source_can_be_reused_without_altering_it(self):
        self.source = self.store.mutate(self.source['id'], self.source['revision'], action='archive')
        history = self.store.history(self.source['id'])
        imported = self.import_selected()['doc']
        self.assertEqual(len(imported['sections']['requirements']), 2)
        self.assertEqual(self.store.get(self.source['id']), self.source)
        self.assertEqual(self.store.history(self.source['id']), history)

    def test_failure_recording_provenance_rolls_back_document_and_history(self):
        before = self.store.get(self.target['id'])
        history = self.store.history(self.target['id'])
        with patch.object(self.store, '_relationships', side_effect=InputError('Synthetic failure.')):
            self.rejected(422, self.import_selected)
        self.assertEqual(self.store.get(self.target['id']), before)
        self.assertEqual(self.store.history(self.target['id']), history)
        self.assertEqual(self.store.relationships(self.target['id'])['imports'], [])

    def test_schema_addition_preserves_legacy_payload_and_export_shape(self):
        with self.store.connection() as db:
            before = {table: db.execute(f'SELECT * FROM {table}').fetchall() for table in ('documents', 'revisions')}
            db.execute('DROP TABLE requirement_imports')
            db.execute('DROP TABLE project_documents')
            db.execute('DROP TABLE projects')
        reopened = Store(self.directory.name)
        with reopened.connection() as db:
            for table in ('documents', 'revisions'):
                self.assertEqual(db.execute(f'SELECT * FROM {table}').fetchall(), before[table])
        self.assertEqual(reopened.get(self.source['id']), self.source)
        self.assertEqual(reopened.relationships(self.source['id'])['imports'], [])
        self.assertEqual(reopened.summaries()[0]['projectIds'], [])
        self.assertEqual(reopened.create('Fictional exported copy', True, self.source)['sections'], self.source['sections'])


class ProjectReuseHttpTests(unittest.TestCase):
    setUp = fixtures.HttpTests.setUp
    stop_server = fixtures.HttpTests.stop_server
    request = fixtures.HttpTests.request

    def json_request(self, method, path, body=None):
        status, _, value = self.request(method, path, None if body is None else json.dumps(body),
                                        {'Content-Type': 'application/json'})
        return status, json.loads(value)

    def test_project_and_import_routes_return_contract_shapes(self):
        source = self.http.store.create('Fictional source', True)
        source['sections']['requirements'] = [fixtures.requirement()]
        source = self.http.store.mutate(source['id'], source['revision'], candidate=source)
        target = self.http.store.create('Fictional target', True)
        status, project = self.json_request('POST', '/api/projects', {'name': 'Fictional project', 'privacyConfirmed': True})
        self.assertEqual(status, 201)
        self.assertEqual(self.json_request('GET', '/api/projects')[1], {'projects': [project]})
        prefix = f"/api/prds/{target['id']}"
        status, linked = self.json_request('PUT', prefix + '/projects',
                                           {'expectedProjectIds': [], 'projectIds': [project['id']]})
        self.assertEqual(status, 200)
        self.assertEqual(linked['projectIds'], [project['id']])
        self.assertEqual(self.json_request('GET', prefix + '/projects')[1], linked)
        summaries = {d['id']: d for d in self.json_request('GET', '/api/state')[1]['docs']}
        self.assertEqual(summaries[target['id']]['projectIds'], [project['id']])
        status, imported = self.json_request('POST', prefix + '/import-requirements', {
            'expectedRevision': target['revision'], 'sourceDocumentId': source['id'],
            'sourceRevision': source['revision'], 'requirementIds': ['R-001'], 'privacyConfirmed': True})
        self.assertEqual(status, 200)
        self.assertEqual(imported['doc']['revision'], target['revision'] + 1)
        self.assertEqual(len(imported['imports']), 1)
        self.assertEqual(self.json_request('GET', prefix + '/relationships')[1]['imports'], imported['imports'])
        self.assertEqual(self.json_request('GET', f"/api/prds/{source['id']}/relationships")[1]['usedBy'], imported['imports'])
        self.assertEqual(self.json_request('GET', f"/api/prds/{source['id']}/history/{source['revision']}")[1], source)


if __name__ == '__main__':
    unittest.main()
