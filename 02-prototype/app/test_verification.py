"""Synthetic completion evidence, stale-review, export, and HTTP boundary checks."""

import copy
import http.client
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.parse import quote, unquote
import zipfile

from prd_store import InputError, Store
import server
from verification import MAX_ATTACHMENT_BYTES, Verification


def create_prd(store):
    doc = store.create('Fictional list completion', True)
    doc['sections']['requirements'] = [
        {'id': f'R-{number:03}', 'priority': 'Must', 'proposed': False,
         'appliesTo': 'A member edits a draft list.', 'outcome': 'Preserve draft items.',
         'behavior': f'A member can add draft item {number}.',
         'acceptance': f'Draft item {number} appears exactly once.'}
        for number in range(1, 3)]
    return store.mutate(doc['id'], doc['revision'], candidate=doc)


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = Store(self.directory.name)
        self.doc = create_prd(self.store)
        self.verification = Verification(self.store)

    def update(self, revision=0, **changes):
        body = {'expectedPrdRevision': self.doc['revision'], 'expectedRevision': revision,
                'owners': ['Engineering lead'], 'proof': 'A local test added one item and checked its single occurrence.'}
        body.update(changes)
        return self.verification.update(self.doc['id'], 'R-001', body)

    def review(self, revision, status='Verified', **changes):
        body = {'expectedPrdRevision': self.doc['revision'], 'expectedRevision': revision,
                'status': status, 'reviewer': 'Test lead', 'notes': 'Reviewed the local result against acceptance.'}
        body.update(changes)
        return self.verification.update(self.doc['id'], 'R-001', body, review=True)

    def assert_rejected(self, status, operation):
        with self.assertRaises(InputError) as caught:
            operation()
        self.assertEqual(caught.exception.status, status)

    def test_defaults_cover_current_requirements_and_evidence_does_not_change_prd(self):
        before = self.store.get(self.doc['id'])
        history = self.store.history(self.doc['id'])
        defaults = self.verification.get(self.doc['id'])
        self.assertEqual(defaults['prdRevision'], self.doc['revision'])
        self.assertEqual([item['requirementId'] for item in defaults['items']], ['R-001', 'R-002'])
        self.assertTrue(all(item['status'] == 'Not reviewed' and item['revision'] == 0 for item in defaults['items']))
        item = self.update()
        item = self.review(item['revision'])
        self.assertEqual(item['status'], 'Verified')
        self.assertEqual(self.store.get(self.doc['id']), before)
        self.assertEqual(self.store.history(self.doc['id']), history)
        self.assertEqual(Verification(Store(self.directory.name)).get(self.doc['id']), self.verification.get(self.doc['id']))

    def test_verdict_needs_explicit_reviewer_owner_and_proof(self):
        self.assert_rejected(422, lambda: self.review(0))
        item = self.update(owners=[])
        self.assert_rejected(422, lambda: self.review(item['revision']))
        item = self.update(item['revision'], proof='TBC')
        self.assert_rejected(422, lambda: self.review(item['revision']))
        item = self.update(item['revision'])
        self.assert_rejected(422, lambda: self.review(item['revision'], reviewer=''))
        self.assert_rejected(422, lambda: self.review(item['revision'], status='Approved'))
        self.assertEqual(self.review(item['revision'])['status'], 'Verified')

    def test_complete_alias_keeps_existing_verification_gates_and_history(self):
        self.assert_rejected(422, lambda: self.review(0, status='Complete'))
        item = self.update()
        completed = self.review(item['revision'], status='Complete')
        self.assertEqual(completed['status'], 'Verified')
        discussed = self.review(completed['revision'], status='To discuss', reviewer='',
                                notes='Should an empty draft remain visible?')
        self.assertEqual(discussed['status'], 'To discuss')
        history = self.verification.history(self.doc['id'], 'R-001')
        self.assertEqual([entry['status'] for entry in history], ['To discuss', 'Verified', 'Not reviewed'])
        self.assertEqual(self.review(discussed['revision'], status='Complete')['status'], 'Verified')

    def test_discussion_without_proof_or_reviewer_reopens_and_counts_as_pending(self):
        item = self.verification.update(self.doc['id'], 'R-001', {
            'expectedPrdRevision': self.doc['revision'], 'expectedRevision': 0,
            'status': 'To discuss', 'notes': 'Which draft state should the team keep?'}, review=True)
        self.assertEqual(item['status'], 'To discuss')
        self.assertEqual(item['owners'], [])
        self.assertEqual(item['proof'], '')
        self.assertEqual(item['reviewer'], '')
        self.assertTrue(item['reviewedAt'])
        reopened = Verification(Store(self.directory.name)).get(self.doc['id'])['items'][0]
        self.assertEqual(reopened, item)
        self.assert_rejected(409, lambda: self.review(0, status='To discuss', reviewer=''))
        with zipfile.ZipFile(io.BytesIO(self.verification.report(self.doc['id']))) as bundle:
            report = bundle.read('completion-report.md').decode()
        self.assertIn('To discuss: 1', report)
        self.assertIn('Complete: 0', report)
        self.assertIn('## R-001 · To discuss', report)
        self.assertIn('Which draft state should the team keep?', report)
        self.assertIn('Completion has gaps', report)
        self.assertNotIn('All current requirements have', report)

    def test_open_discussion_survives_prd_and_evidence_changes(self):
        item = self.review(0, status='To discuss', reviewer='', notes='Review the draft behavior.')
        self.doc['sections']['requirements'][0]['behavior'] = 'A member can keep an empty draft.'
        self.doc = self.store.mutate(self.doc['id'], self.doc['revision'], candidate=self.doc)
        self.assertEqual(self.verification.get(self.doc['id'])['items'][0]['status'], 'To discuss')
        self.assert_rejected(409, lambda: self.review(item['revision'], status='To discuss',
                                                    expectedPrdRevision=self.doc['revision'] - 1))
        item = self.update(item['revision'])
        self.assertEqual(item['status'], 'To discuss')
        item = self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'],
                                        item['revision'], 'question.txt', b'SYNTHETIC DISCUSSION')
        self.assertEqual(item['status'], 'To discuss')
        self.assertEqual(item['reviewNotes'], 'Review the draft behavior.')
        completed = self.review(item['revision'], status='Complete')
        self.assertEqual(completed['status'], 'Verified')
        changed = self.update(completed['revision'], proof='A revised local test checked the empty draft.')
        self.assertEqual(changed['status'], 'Needs recheck')

    def test_verified_rejects_missing_behavior_or_acceptance_without_saving_verdict(self):
        item = self.update()
        original = copy.deepcopy(self.doc['sections']['requirements'][0])
        for field in ('behavior', 'acceptance'):
            for value in ('', 'Not documented', 'TBC'):
                with self.subTest(field=field, value=value):
                    self.doc['sections']['requirements'][0] = {**original, field: value}
                    self.doc = self.store.mutate(self.doc['id'], self.doc['revision'], candidate=self.doc)
                    self.assert_rejected(422, lambda: self.review(item['revision']))
                    self.assertEqual(len(self.verification.history(self.doc['id'], 'R-001')), 1)
                    self.assertNotEqual(self.verification.get(self.doc['id'])['items'][0]['status'], 'Verified')

    def test_report_flags_incomplete_preexisting_verified_records(self):
        self.doc['sections']['requirements'] = self.doc['sections']['requirements'][:1]
        self.doc = self.store.mutate(self.doc['id'], self.doc['revision'], candidate=self.doc)
        verified = self.review(self.update()['revision'])
        with zipfile.ZipFile(io.BytesIO(self.verification.report(self.doc['id']))) as bundle:
            self.assertIn('All current requirements have a recorded Complete team verdict.', bundle.read('completion-report.md').decode())
        for field, value, label in (('owners', [], 'engineering owner'), ('proof', '', 'proof explanation'),
                                    ('reviewer', '', 'reviewer role'), ('reviewedAt', None, 'review date')):
            for omitted in (False, True):
                with self.subTest(field=field, omitted=omitted):
                    malformed = copy.deepcopy(verified)
                    if omitted:
                        del malformed[field]
                    else:
                        malformed[field] = value
                    with self.store.connection() as db:
                        db.execute('UPDATE verification SET data=? WHERE document_id=? AND requirement_id=?',
                                   (json.dumps(malformed), self.doc['id'], 'R-001'))
                    self.assertEqual(self.verification.get(self.doc['id'])['items'][0]['status'], 'Needs recheck')
                    with zipfile.ZipFile(io.BytesIO(self.verification.report(self.doc['id']))) as bundle:
                        report = bundle.read('completion-report.md').decode()
                    self.assertIn('Completion has gaps', report)
                    self.assertIn('Required information gaps: ' + label, report)
                    self.assertNotIn('All current requirements have a recorded Complete team verdict.', report)

    def test_evidence_and_review_compare_both_revisions_and_preserve_history(self):
        item = self.update()
        self.assert_rejected(409, lambda: self.update())
        self.assert_rejected(409, lambda: self.review(0))
        self.assert_rejected(409, lambda: self.review(item['revision'], expectedPrdRevision=1))
        self.assert_rejected(422, lambda: self.update(item['revision'], expectedRevision=True))
        verified = self.review(item['revision'])
        changed = self.update(verified['revision'], proof='A repeat local test passed after adding two distinct items.')
        self.assertEqual(changed['status'], 'Needs recheck')
        with self.store.connection() as db:
            snapshots = [json.loads(row[0]) for row in db.execute(
                'SELECT data FROM verification_history ORDER BY revision')]
        self.assertEqual([snapshot['revision'] for snapshot in snapshots], [1, 2, 3])
        self.assertEqual(snapshots[1]['status'], 'Verified')
        self.assertNotEqual(snapshots[1]['proof'], snapshots[2]['proof'])
        history = self.verification.history(self.doc['id'], 'R-001')
        self.assertEqual(history, list(reversed(snapshots)))
        self.assertTrue(history[0]['savedAt'])

    def test_changed_requirement_scope_and_restored_baseline_require_new_review(self):
        item = self.review(self.update()['revision'])
        original = copy.deepcopy(self.doc)
        for field in ('behavior', 'acceptance', 'priority', 'appliesTo', 'outcome'):
            candidate = copy.deepcopy(self.doc)
            candidate['sections']['requirements'][0][field] = 'Nice to have' if field == 'priority' else 'Changed fictional requirement.'
            self.doc = self.store.mutate(candidate['id'], candidate['revision'], candidate=candidate)
            stale = self.verification.get(self.doc['id'])['items'][0]
            self.assertEqual(stale['status'], 'Needs recheck')
            self.assertNotEqual(stale['requirementFingerprint'], item['requirementFingerprint'])
            item = self.review(stale['revision'])
        for field in ('scope', 'useCases', 'inputsOutputs', 'nonGoals', 'quality'):
            self.doc['sections'][field] = 'Changed fictional context.'
            self.doc = self.store.mutate(self.doc['id'], self.doc['revision'], candidate=self.doc)
            stale = self.verification.get(self.doc['id'])['items'][0]
            self.assertEqual(stale['status'], 'Needs recheck')
            self.assertNotEqual(stale['requirementFingerprint'], item['requirementFingerprint'])
            item = self.review(stale['revision'])
        self.doc = self.store.mutate(self.doc['id'], self.doc['revision'], action='restore', revision=original['revision'])
        self.assertEqual(self.verification.get(self.doc['id'])['items'][0]['status'], 'Needs recheck')

    def test_unrelated_prd_edit_also_requires_exact_baseline_review(self):
        self.review(self.update()['revision'])
        self.doc['title'] = 'Fictional renamed list'
        self.doc = self.store.mutate(self.doc['id'], self.doc['revision'], candidate=self.doc)
        stale = self.verification.get(self.doc['id'])['items'][0]
        self.assertEqual(stale['status'], 'Needs recheck')
        self.assertEqual(self.review(stale['revision'])['status'], 'Verified')

    def test_attachments_keep_bytes_and_invalidate_verdict_without_touching_prd(self):
        item = self.review(self.update()['revision'])
        attached = self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'], item['revision'],
                                            'local proof.html', b'<script>synthetic</script>')
        self.assertEqual(attached['status'], 'Needs recheck')
        metadata = attached['attachments'][0]
        self.assertEqual(self.verification.attachment(self.doc['id'], 'R-001', metadata['id']),
                         (metadata, b'<script>synthetic</script>'))
        self.assertTrue((Path(self.directory.name) / 'attachments' / metadata['id']).is_file())
        self.assertEqual(self.store.get(self.doc['id']), self.doc)
        self.assert_rejected(409, lambda: self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'],
                                                                  item['revision'], 'stale.txt', b'Synthetic'))
        self.assertEqual(len(list((Path(self.directory.name) / 'attachments').iterdir())), 1)

    def test_attachment_digest_rejects_same_size_modified_evidence(self):
        item = self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'], 0, 'proof.txt', b'PASS')
        attachment = item['attachments'][0]
        (Path(self.directory.name) / 'attachments' / attachment['id']).write_bytes(b'FAIL')
        self.assert_rejected(500, lambda: self.verification.attachment(self.doc['id'], 'R-001', attachment['id']))
        self.assert_rejected(500, lambda: self.verification.report(self.doc['id']))

    def test_attachment_id_collision_does_not_delete_existing_proof(self):
        item = self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'], 0, 'proof.txt', b'SYNTHETIC')
        attachment_id = item['attachments'][0]['id']
        with patch('verification.uuid.uuid4') as identifier:
            identifier.return_value.hex = attachment_id
            with self.assertRaises(FileExistsError):
                self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'], item['revision'], 'other.txt', b'OTHER')
        self.assertEqual(self.verification.attachment(self.doc['id'], 'R-001', attachment_id)[1], b'SYNTHETIC')
        self.assertEqual(self.verification.get(self.doc['id'])['items'][0], item)

    def test_attachment_names_sizes_and_doc_requirement_boundaries(self):
        for name in ('../proof.txt', '/tmp/proof.txt', 'folder\\proof.txt', '.', '..', 'proof\r\n.txt', ''):
            self.assert_rejected(422, lambda: self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'], 0, name, b'x'))
        self.assert_rejected(413, lambda: self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'], 0, 'proof.txt', b''))
        with patch('verification.MAX_ATTACHMENT_BYTES', 1):
            self.assert_rejected(413, lambda: self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'], 0, 'proof.txt', b'xx'))
        item = self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'], 0, 'proof.txt', b'x')
        attachment_id = item['attachments'][0]['id']
        other = create_prd(self.store)
        self.assert_rejected(404, lambda: self.verification.attachment(other['id'], 'R-001', attachment_id))
        self.assert_rejected(404, lambda: self.verification.attachment(self.doc['id'], 'R-002', attachment_id))
        self.assert_rejected(404, lambda: self.verification.attachment(self.doc['id'], 'R-001', '../requiro.sqlite3'))

    def test_report_keeps_pending_rows_full_requirements_and_duplicate_named_proofs(self):
        item = self.update()
        for content in (b'SYNTHETIC_FIRST_PROOF', b'SYNTHETIC_SECOND_PROOF'):
            item = self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'], item['revision'], 'proof [one] (local).txt', content)
        self.review(item['revision'])
        with zipfile.ZipFile(io.BytesIO(self.verification.report(self.doc['id']))) as bundle:
            report = bundle.read('completion-report.md').decode()
            self.assertIn('Not reviewed: 1; To discuss: 0; Needs work: 0; Complete: 1; Needs recheck: 0', report)
            self.assertIn('## R-001 · Complete', report)
            self.assertNotIn('Verified', report)
            self.assertIn('Completion has gaps', report)
            self.assertIn('explicit recorded team verdict', report)
            for requirement in self.doc['sections']['requirements']:
                self.assertIn(requirement['behavior'], report)
                self.assertIn(requirement['acceptance'], report)
            self.assertIn('Engineering lead', report)
            self.assertIn('Test lead', report)
            self.assertIn('## Requirements', bundle.read('prd.md').decode())
            proofs = [name for name in bundle.namelist() if name.startswith('attachments/')]
            self.assertEqual(len(proofs), 2)
            self.assertEqual({bundle.read(path) for path in proofs}, {b'SYNTHETIC_FIRST_PROOF', b'SYNTHETIC_SECOND_PROOF'})
            for path in proofs:
                self.assertIn(f']({quote(path)})', report)

    def test_removed_requirements_disappear_without_losing_history_or_files(self):
        item = self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'], 0, 'proof.txt', b'SYNTHETIC')
        self.doc['sections']['requirements'] = self.doc['sections']['requirements'][1:]
        self.doc = self.store.mutate(self.doc['id'], self.doc['revision'], candidate=self.doc)
        self.assertEqual([i['requirementId'] for i in self.verification.get(self.doc['id'])['items']], ['R-002'])
        self.assertTrue((Path(self.directory.name) / 'attachments' / item['attachments'][0]['id']).exists())
        self.assert_rejected(404, lambda: self.update(item['revision']))

    def test_existing_core_database_and_relocation_preserve_completion_data(self):
        before_doc = self.store.get(self.doc['id'])
        before_history = self.store.history(self.doc['id'])
        self.update()
        self.assertEqual(self.store.get(self.doc['id']), before_doc)
        self.assertEqual(self.store.history(self.doc['id']), before_history)
        before = server._store_fingerprint(Path(self.directory.name))
        item = self.review(1)
        self.assertNotEqual(server._store_fingerprint(Path(self.directory.name)), before)
        item = self.verification.attach(self.doc['id'], 'R-001', self.doc['revision'], item['revision'], 'proof.txt', b'SYNTHETIC')
        expected = self.verification.get(self.doc['id'])
        scratch = Path(self.directory.name)
        app = scratch / 'repo' / '02-prototype' / 'app'
        app.mkdir(parents=True)
        legacy = app / '.juno-data'
        legacy.mkdir()
        (scratch / 'requiro.sqlite3').rename(legacy / 'juno.sqlite3')
        (scratch / 'attachments').rename(legacy / 'attachments')
        with patch.object(server, 'ROOT', app), patch.dict('os.environ', {}, clear=True):
            target = server.data_directory()
        moved = Verification(Store(target))
        self.assertEqual(moved.get(self.doc['id']), expected)
        self.assertEqual(moved.attachment(self.doc['id'], 'R-001', item['attachments'][0]['id'])[1], b'SYNTHETIC')
        self.assertEqual(Store(target).get(self.doc['id']), before_doc)


class VerificationHttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.http = server.make_server(self.directory.name, port=0)
        self.doc = create_prd(self.http.store)
        self.path = f"/api/prds/{self.doc['id']}/verification"
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(timeout=2)

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        try:
            connection.request(method, path, body, headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_http_evidence_review_report_and_safe_download(self):
        status, _, body = self.request('GET', self.path)
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(body)['items']), 2)
        body = {'expectedPrdRevision': self.doc['revision'], 'expectedRevision': 0,
                'owners': ['Engineering lead'], 'proof': 'A local test checked one draft addition.'}
        status, _, content = self.request('PUT', self.path + '/R-001', json.dumps(body), {'Content-Type': 'application/json'})
        self.assertEqual(status, 200)
        item = json.loads(content)
        headers = {'Content-Type': 'application/octet-stream', 'X-Filename': quote('synthetic proof [one].html'),
                   'X-Expected-Prd-Revision': str(self.doc['revision']), 'X-Expected-Revision': str(item['revision'])}
        status, _, content = self.request('POST', self.path + '/R-001/attachments', b'<script>synthetic</script>', headers)
        self.assertEqual(status, 201)
        item = json.loads(content)
        self.assertEqual(item['status'], 'Not reviewed')
        attachment_id = item['attachments'][0]['id']
        status, headers, content = self.request('GET', self.path + '/R-001/attachments/' + attachment_id)
        self.assertEqual(status, 200)
        self.assertEqual(content, b'<script>synthetic</script>')
        self.assertEqual(headers['Content-Type'], 'application/octet-stream')
        self.assertEqual(headers['X-Content-Type-Options'], 'nosniff')
        self.assertTrue(headers['Content-Disposition'].startswith('attachment;'))
        self.assertIn('synthetic proof [one].html', unquote(headers['Content-Disposition']))
        body.update(expectedRevision=item['revision'], status='Verified', reviewer='Test lead', notes='Reviewed the local proof.')
        status, _, content = self.request('POST', self.path + '/R-001/review', json.dumps(body), {'Content-Type': 'application/json'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(content)['status'], 'Verified')
        status, _, content = self.request('GET', self.path + '/R-001/history')
        self.assertEqual(status, 200)
        self.assertEqual([item['revision'] for item in json.loads(content)], [3, 2, 1])
        self.assertEqual(json.loads(content)[0]['status'], 'Verified')
        status, headers, content = self.request('GET', f"/api/prds/{self.doc['id']}/completion-report")
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'application/zip')
        self.assertTrue(zipfile.is_zipfile(io.BytesIO(content)))

    def test_upload_blocks_origin_traversal_size_and_invalid_headers(self):
        path = self.path + '/R-001/attachments'
        headers = {'Content-Type': 'application/octet-stream', 'X-Filename': 'proof.txt',
                   'X-Expected-Prd-Revision': str(self.doc['revision']), 'X-Expected-Revision': '0'}
        self.assertEqual(self.request('POST', path, b'x', {**headers, 'Origin': 'https://example.invalid'})[0], 403)
        self.assertEqual(self.request('POST', path, b'x', {**headers, 'X-Filename': '..%2Fproof.txt'})[0], 422)
        self.assertEqual(self.request('POST', path, b'x', {**headers, 'X-Filename': 'proof%0D%0A.txt'})[0], 422)
        self.assertEqual(self.request('POST', path, b'x', {**headers, 'Content-Length': str(MAX_ATTACHMENT_BYTES + 1)})[0], 413)
        self.assertEqual(self.request('POST', path, b'x', {**headers, 'X-Expected-Revision': 'invalid'})[0], 400)
        self.assertFalse((Path(self.directory.name) / 'attachments').exists())
        for raw in ('/verification.py', '/attachments/proof.txt', '/data/prds/attachments/proof.txt'):
            self.assertEqual(self.request('GET', raw)[0], 404)


if __name__ == '__main__':
    unittest.main()
