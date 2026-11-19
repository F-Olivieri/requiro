"""Synthetic local lifecycle and HTTP boundary tests. Run: python3 -B test_server.py."""

import copy
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch

import server
import prd_store


def requirement(number=1):
    return {
        'id': f'R-{number:03d}', 'priority': 'Must', 'proposed': False,
        'appliesTo': 'U-001: a member edits a draft list.', 'outcome': 'O-001',
        'behavior': 'A member can add an item to a draft list.',
        'acceptance': 'The added item appears once in the draft list.',
    }


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = prd_store.Store(self.directory.name)

    def create(self):
        return self.store.create('Fictional list builder')

    def save(self, doc):
        return self.store.mutate(doc['id'], doc['revision'], candidate=doc)

    def ready(self):
        doc = self.create()
        doc['sections'].update(
            problem='Draft lists lose their intended order.', users='List members.',
            outcomes='O-001: preserve the chosen order.',
            useCases='U-001: a member adds an item to a draft list.',
            scope='Draft lists only.', requirements=[requirement()],
        )
        return self.save(doc)

    def assert_rejected(self, status, operation):
        with self.assertRaises(prd_store.InputError) as caught:
            operation()
        self.assertEqual(caught.exception.status, status)

    def test_create_needs_no_privacy_confirmation_and_keeps_stored_label(self):
        doc = self.create()
        self.assertEqual((doc['status'], doc['privacy']), ('Draft', 'synthetic-or-approved-nonconfidential'))
        self.assertEqual(self.store.create_project('Fictional unconfirmed project')['name'], 'Fictional unconfirmed project')

    def test_store_rejects_unencodable_text_and_preserves_valid_unicode(self):
        for value in ('\ud800', '\udfff'):
            with self.subTest(value=repr(value)):
                self.assert_rejected(422, lambda: self.store.create(value))
        self.assertEqual(self.store.summaries(), [])
        self.assertEqual(self.store.create('Fictional list 😀 ✓')['title'], 'Fictional list 😀 ✓')

    def test_stale_save_rejects_without_changing_document_or_history(self):
        initial = self.create()
        candidate = copy.deepcopy(initial)
        candidate['sections']['problem'] = 'A fictional list loses its order.'
        saved = self.save(candidate)
        history = self.store.history(initial['id'])
        initial['title'] = 'Stale replacement'
        self.assert_rejected(409, lambda: self.save(initial))
        self.assertEqual(self.store.get(saved['id']), saved)
        self.assertEqual(self.store.history(saved['id']), history)

    def test_chat_only_changes_keep_revision_status_and_history(self):
        draft = self.ready()
        review = self.store.mutate(draft['id'], draft['revision'], action='review')
        approved = self.store.mutate(review['id'], review['revision'], action='approve')
        history = self.store.history(approved['id'])
        candidate = copy.deepcopy(approved)
        candidate['chat'] = [{'role': 'user', 'content': 'Clarify the fictional list order.'}]
        saved = self.save(candidate)
        kept = lambda doc: (doc['revision'], doc['status'], doc['approvedRevision'], doc['updatedAt'])
        self.assertEqual(kept(saved), kept(approved))
        self.assertEqual(self.store.get(approved['id'])['chat'], candidate['chat'])
        replied = self.store.update_chat(approved['id'], approved['revision'], [{'role': 'assistant', 'content': 'A fictional reply.'}])
        self.assertEqual([item['role'] for item in replied['chat']], ['user', 'assistant'])
        self.assertEqual(kept(replied), kept(approved))
        cleared = self.store.update_chat(approved['id'], approved['revision'], clear=True)
        self.assertEqual(cleared['chat'], [])
        self.assertEqual(kept(self.store.get(approved['id'])), kept(approved))
        self.assertEqual(self.store.history(approved['id']), history)
        self.assert_rejected(409, lambda: self.store.update_chat(approved['id'], approved['revision'] - 1, clear=True))
        self.assert_rejected(422, lambda: self.store.update_chat(approved['id'], approved['revision'], [{'role': 'system', 'content': 'x'}]))
        full = [{'role': 'user', 'content': 'Fictional question.'}] * 100
        self.assert_rejected(422, lambda: self.store.update_chat(approved['id'], approved['revision'], full + full[:1]))
        edited = copy.deepcopy(cleared)
        edited['sections']['scope'] = 'Draft and shared fictional lists.'
        edited = self.save(edited)
        self.assertEqual((edited['revision'], edited['status']), (approved['revision'] + 1, 'Draft'))
        archived = self.store.mutate(edited['id'], edited['revision'], action='archive')
        self.assert_rejected(422, lambda: self.store.update_chat(archived['id'], archived['revision'], clear=True))

    def test_approval_is_exact_and_edit_preserves_prior_baseline(self):
        draft = self.ready()
        review = self.store.mutate(draft['id'], draft['revision'], action='review')
        before = self.store.history(draft['id'])
        self.assert_rejected(409, lambda: self.store.mutate(draft['id'], draft['revision'], action='approve'))
        self.assertEqual(self.store.history(draft['id']), before)
        approved = self.store.mutate(review['id'], review['revision'], action='approve')
        self.assertEqual(approved['status'], 'Approved')
        self.assertEqual(approved['approvedRevision'], approved['revision'])
        candidate = copy.deepcopy(approved)
        candidate['sections']['scope'] = 'Draft lists with at most ten synthetic items.'
        edited = self.save(candidate)
        self.assertEqual(edited['status'], 'Draft')
        self.assertEqual(edited['revision'], approved['revision'] + 1)
        self.assertEqual(edited['approvedRevision'], approved['revision'])
        self.assertEqual(self.store.get(approved['id'], approved['revision']), approved)

    def test_save_cannot_forge_approval_or_revision_metadata(self):
        candidate = self.create()
        expected = candidate['revision']
        candidate.update(status='Approved', approvedRevision=999, revision=999,
                         nextRequirementNumber=-5, privacy='forged')
        candidate['sections']['problem'] = 'A fictional list needs a stable order.'
        saved = self.store.mutate(candidate['id'], expected, candidate=candidate)
        self.assertEqual(saved['status'], 'Draft')
        self.assertIsNone(saved['approvedRevision'])
        self.assertEqual(saved['revision'], expected + 1)
        self.assertGreaterEqual(saved['nextRequirementNumber'], 1)
        self.assertEqual(saved['privacy'], 'synthetic-or-approved-nonconfidential')

    def test_approval_requires_review_and_agreed_priority(self):
        draft = self.ready()
        self.assert_rejected(422, lambda: self.store.mutate(draft['id'], draft['revision'], action='approve'))
        draft['sections']['requirements'][0]['proposed'] = True
        saved = self.save(draft)
        review = self.store.mutate(saved['id'], saved['revision'], action='review')
        self.assert_rejected(422, lambda: self.store.mutate(review['id'], review['revision'], action='approve'))
        self.assertEqual(self.store.get(review['id']), review)

    def test_removed_requirement_id_cannot_be_reused(self):
        doc = self.ready()
        doc['sections']['requirements'] = []
        retired = self.save(doc)
        history = self.store.history(retired['id'])
        candidate = copy.deepcopy(retired)
        candidate['sections']['requirements'] = [requirement(1)]
        self.assert_rejected(422, lambda: self.save(candidate))
        self.assertEqual(self.store.history(retired['id']), history)
        candidate['sections']['requirements'] = [requirement(retired['nextRequirementNumber'])]
        self.assertEqual(len(self.save(candidate)['sections']['requirements']), 1)

    def test_restore_creates_new_draft_and_preserves_monotonic_counter(self):
        historical = self.ready()
        candidate = copy.deepcopy(historical)
        candidate['sections']['requirements'].append(requirement(historical['nextRequirementNumber']))
        changed = self.save(candidate)
        changed['sections']['requirements'] = changed['sections']['requirements'][1:]
        current = self.save(changed)
        restored = self.store.mutate(current['id'], current['revision'], action='restore', revision=historical['revision'])
        self.assertEqual(restored['sections'], historical['sections'])
        self.assertEqual(restored['revision'], current['revision'] + 1)
        self.assertEqual(restored['status'], 'Draft')
        self.assertGreaterEqual(restored['nextRequirementNumber'], current['nextRequirementNumber'])
        self.assertEqual(self.store.get(historical['id'], historical['revision']), historical)
        restored['sections']['requirements'].append(requirement(restored['nextRequirementNumber']))
        self.assertEqual(len(self.save(restored)['sections']['requirements']), 2)

    def test_import_has_new_identity_and_cannot_inherit_approval(self):
        source = self.ready()
        source.update(status='Approved', approvedRevision=900, revision=900)
        imported = self.store.create(source['title'], imported=source)
        self.assertNotEqual(imported['id'], source['id'])
        self.assertEqual(imported['revision'], 1)
        self.assertEqual(imported['status'], 'Draft')
        self.assertIsNone(imported['approvedRevision'])
        self.assertEqual(imported['sections'], source['sections'])

    def test_duplicate_requirement_import_is_atomic(self):
        source = self.ready()
        source['sections']['requirements'].append(copy.deepcopy(source['sections']['requirements'][0]))
        before = self.store.summaries()
        self.assert_rejected(422, lambda: self.store.create('Fictional duplicate import', imported=source))
        self.assertEqual(self.store.summaries(), before)

    def test_unknown_or_missing_sections_are_rejected_without_history_change(self):
        doc = self.create()
        history = self.store.history(doc['id'])
        for unknown in (True, False):
            candidate = copy.deepcopy(doc)
            if unknown:
                candidate['sections']['injectedSection'] = 'Unsupported synthetic field'
            else:
                del candidate['sections']['problem']
            self.assert_rejected(422, lambda: self.save(candidate))
        self.assertEqual(self.store.get(doc['id']), doc)
        self.assertEqual(self.store.history(doc['id']), history)

    def test_packet_contains_only_selected_document_context(self):
        selected = self.create()
        selected['chat'] = [{'role': 'user', 'content': 'SYNTHETIC_SELECTED_CONTEXT'}]
        selected = self.save(selected)
        other = self.create()
        other['sections']['problem'] = 'SYNTHETIC_OTHER_DOCUMENT_CONTEXT'
        other = self.save(other)
        value = server.packet(selected, 'Clarify the fictional list behavior.')
        self.assertIn(selected['id'], value)
        self.assertIn('SYNTHETIC_SELECTED_CONTEXT', value)
        self.assertNotIn(other['id'], value)
        self.assertNotIn('SYNTHETIC_OTHER_DOCUMENT_CONTEXT', value)
        self.assertEqual(prd_store.Store(self.directory.name).get(selected['id']), selected)


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.http = server.make_server(self.directory.name, port=0)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(timeout=2)

    def request(self, method='GET', path='/api/state', body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        try:
            connection.request(method, path, body=body, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def restart_with_environment(self, environment):
        self.stop_server()
        with patch.dict(server.os.environ, environment):
            self.http = server.make_server(self.directory.name, port=0)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()

    def test_codespaces_forwarded_requests_are_exact_and_https_only(self):
        self.restart_with_environment({
            'CODESPACES': 'true', 'CODESPACE_NAME': 'fictional-workspace',
            'GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN': 'example.invalid',
        })
        host = f'fictional-workspace-{self.http.server_port}.example.invalid'
        origin = f'https://{host}'
        self.assertEqual(self.http.server_address[0], '127.0.0.1')
        self.assertEqual(self.request(headers={'Host': host, 'Origin': origin})[0], 200)
        self.assertEqual(self.request(headers={'Origin': origin})[0], 200)
        self.assertEqual(self.request()[0], 200)
        body = json.dumps({'title': 'Fictional forwarded list', 'privacyConfirmed': True})
        self.assertEqual(self.request('POST', '/api/prds', body, {
            'Host': host, 'Origin': origin, 'Content-Type': 'application/json',
        })[0], 201)
        before = self.http.store.summaries()
        for bad_host in ('other.example.invalid', host + '.example.invalid', host + ':443'):
            with self.subTest(host=bad_host):
                self.assertEqual(self.request(headers={'Host': bad_host, 'Origin': origin})[0], 403)
        for bad_origin in ('http://' + host, origin + '/', origin + '.example.invalid', 'null'):
            with self.subTest(origin=bad_origin):
                self.assertEqual(self.request(headers={'Host': host, 'Origin': bad_origin})[0], 403)
                self.assertEqual(self.request('POST', '/api/prds', body, {
                    'Host': host, 'Origin': bad_origin, 'Content-Type': 'application/json',
                })[0], 403)
        self.assertEqual(self.http.store.summaries(), before)

    def test_codespaces_environment_does_not_enable_remote_access_locally(self):
        self.restart_with_environment({
            'CODESPACES': 'false', 'CODESPACE_NAME': 'fictional-workspace',
            'GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN': 'example.invalid',
        })
        host = f'fictional-workspace-{self.http.server_port}.example.invalid'
        self.assertEqual(self.request()[0], 200)
        self.assertEqual(self.request(headers={'Host': host})[0], 403)
        self.assertEqual(self.request(headers={'Origin': f'https://{host}'})[0], 403)

    def test_invalid_codespaces_address_stops_before_opening_data(self):
        environment = {
            'CODESPACES': 'true', 'CODESPACE_NAME': 'fictional-workspace',
            'GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN': 'example.invalid',
        }
        cases = (
            ('CODESPACE_NAME', ''), ('CODESPACE_NAME', 'bad.name'),
            ('CODESPACE_NAME', 'bad/name'), ('CODESPACE_NAME', '-bad'),
            ('CODESPACE_NAME', 'bad-'), ('CODESPACE_NAME', 'a' * 63),
            ('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', ''),
            ('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'https://example.invalid'),
            ('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'example.invalid/path'),
            ('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'example.invalid:443'),
            ('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'example.invalid@other.invalid'),
            ('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'bad..invalid'),
            ('GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN', 'bad_domain.invalid'),
        )
        data = Path(self.directory.name) / 'unopened-codespaces-data'
        for key, value in cases:
            with self.subTest(key=key, value=value), patch.dict(server.os.environ, {**environment, key: value}):
                with self.assertRaisesRegex(RuntimeError, 'Codespaces address'):
                    with server.make_server(data, port=0):
                        pass
                self.assertFalse(data.exists())

    def test_loopback_server_accepts_only_local_host_headers(self):
        self.assertEqual(self.http.server_address[0], '127.0.0.1')
        self.assertEqual(self.request()[0], 200)
        self.assertEqual(self.request(headers={'Host': f'localhost:{self.http.server_port}'})[0], 200)
        for host in ('example.invalid', '127.0.0.1:1', 'localhost', ''):
            with self.subTest(host=host):
                self.assertEqual(self.request(headers={'Host': host})[0], 403)

    def test_cross_origin_read_and_write_are_rejected(self):
        local_origin = f'http://127.0.0.1:{self.http.server_port}'
        self.assertEqual(self.request(headers={'Origin': local_origin})[0], 200)
        for origin in ('https://example.invalid', 'null', 'http://localhost:1'):
            with self.subTest(origin=origin):
                self.assertEqual(self.request(headers={'Origin': origin})[0], 403)
                status, _, _ = self.request('POST', '/api/prds', json.dumps({
                    'title': 'Fictional list', 'privacyConfirmed': True,
                }), {'Origin': origin, 'Content-Type': 'application/json'})
                self.assertEqual(status, 403)
        self.assertEqual(self.http.store.summaries(), [])

    def test_content_type_and_json_boundaries_prevent_writes(self):
        body = json.dumps({'title': 'Fictional list'})
        for content_type in ('text/plain', 'application/x-www-form-urlencoded', ''):
            with self.subTest(content_type=content_type):
                self.assertEqual(self.request('POST', '/api/prds', body, {'Content-Type': content_type})[0], 415)
        self.assertEqual(self.request('POST', '/api/prds', '{', {'Content-Type': 'application/json'})[0], 400)
        self.assertEqual(self.request('POST', '/api/prds', '[]', {'Content-Type': 'application/json'})[0], 422)
        self.assertEqual(self.http.store.summaries(), [])
        self.assertEqual(self.request('POST', '/api/prds', body, {'Content-Type': 'application/json; charset=utf-8'})[0], 201)

    def test_create_import_example_and_reuse_need_no_privacy_confirmation(self):
        headers = {'Content-Type': 'application/json'}
        post = lambda path, data: self.request('POST', path, json.dumps(data), headers)
        status, _, payload = post('/api/prds', {'title': 'Fictional unconfirmed list'})
        self.assertEqual(status, 201)
        created = json.loads(payload)
        self.assertEqual(created['privacy'], 'synthetic-or-approved-nonconfidential')
        for legacy in (True, False, None, 'true'):
            with self.subTest(legacy=legacy):
                self.assertEqual(post('/api/prds', {'title': 'Fictional older client', 'privacyConfirmed': legacy})[0], 201)
        status, _, example = self.request(path='/api/example')
        self.assertEqual(status, 200)
        status, _, payload = post('/api/import', {'doc': json.loads(example)})
        self.assertEqual(status, 201)
        source = json.loads(payload)
        self.assertEqual(source['privacy'], 'synthetic-or-approved-nonconfidential')
        self.assertEqual(post('/api/import', {'doc': source, 'privacyConfirmed': False})[0], 201)
        self.assertEqual(post('/api/projects', {'name': 'Fictional unconfirmed project'})[0], 201)
        status, _, payload = post(f"/api/prds/{created['id']}/import-requirements", {
            'expectedRevision': created['revision'], 'sourceDocumentId': source['id'],
            'sourceRevision': source['revision'], 'requirementIds': [source['sections']['requirements'][0]['id']]})
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(payload)['doc']['sections']['requirements']), 1)
        status, _, page = self.request(path='/')
        self.assertEqual(status, 200)
        for marker in (b'privacy-consent', b'privacy-banner', b'privacy-indicator', b'data-use'):
            self.assertNotIn(marker, page)

    def test_invalid_unicode_is_rejected_before_writes_across_json_routes(self):
        doc = self.http.store.create('Fictional Unicode boundary')
        doc['sections']['requirements'] = [requirement()]
        doc = self.http.store.mutate(doc['id'], doc['revision'], candidate=doc)
        history = self.http.store.history(doc['id'])
        verification = self.http.verification.get(doc['id'])
        review_history = self.http.verification.history(doc['id'], 'R-001')
        imported = copy.deepcopy(doc)
        imported['chat'] = [{'role': 'user', 'content': '\ud800'}]
        cases = (
            ('POST', '/api/prds', {'title': '\ud800', 'privacyConfirmed': True}),
            ('POST', '/api/projects', {'name': '\udfff', 'privacyConfirmed': True}),
            ('POST', '/api/import', {'doc': imported, 'privacyConfirmed': True}),
            ('POST', f"/api/prds/{doc['id']}/import-requirements", {
                'expectedRevision': doc['revision'], 'sourceDocumentId': '\ud800',
                'sourceRevision': 1, 'requirementIds': ['R-001'], 'privacyConfirmed': True}),
            ('POST', f"/api/prds/{doc['id']}/verification/R-001/review", {
                'expectedPrdRevision': doc['revision'], 'expectedRevision': 0,
                'status': 'To discuss', 'reviewer': 'Test role', 'notes': '\udfff'}),
            ('PUT', f"/api/prds/{doc['id']}/verification/R-001", {
                'expectedPrdRevision': doc['revision'], 'expectedRevision': 0,
                'owners': ['Test role'], 'proof': '\ud800'}),
            ('POST', '/api/prds', {'title': 'Fictional ignored field', 'privacyConfirmed': True,
                                   'extra': [{'\ud800': 'value'}]}),
        )
        for repeat in range(2):
            for method, path, body in cases:
                with self.subTest(repeat=repeat, path=path):
                    status, _, payload = self.request(method, path, json.dumps(body), {'Content-Type': 'application/json'})
                    self.assertEqual(status, 422)
                    self.assertIn('invalid Unicode', json.loads(payload)['error'])
                    self.assertEqual(self.http.store.get(doc['id']), doc)
                    self.assertEqual(self.http.store.history(doc['id']), history)
                    self.assertEqual(self.http.verification.get(doc['id']), verification)
                    self.assertEqual(self.http.verification.history(doc['id'], 'R-001'), review_history)
                    self.assertEqual(self.http.store.projects(), {'projects': []})
                    self.assertEqual(len(self.http.store.summaries()), 1)
        for title in ('Fictional 😀 ✓', r'Fictional \ud800'):
            status, _, payload = self.request('POST', '/api/prds', json.dumps({
                'title': title, 'privacyConfirmed': True}), {'Content-Type': 'application/json'})
            self.assertEqual(status, 201)
            self.assertEqual(json.loads(payload)['title'], title)

    def test_history_and_restore_reject_out_of_range_revisions_without_writes(self):
        doc = self.http.store.create('Fictional numeric revision bounds')
        history = self.http.store.history(doc['id'])
        for repeat in range(2):
            for revision in ('9' * 5000, str(2 ** 63), str(10 ** 20)):
                with self.subTest(repeat=repeat, digits=len(revision)):
                    self.assertEqual(self.request(path=f"/api/prds/{doc['id']}/history/{revision}")[0], 422)
            for revision in (2 ** 63, 10 ** 20, 0, -1, True):
                with self.subTest(repeat=repeat, revision=revision):
                    status, _, _ = self.request('POST', f"/api/prds/{doc['id']}/action", json.dumps({
                        'expectedRevision': doc['revision'], 'action': 'restore', 'revision': revision,
                    }), {'Content-Type': 'application/json'})
                    self.assertEqual(status, 422)
                    self.assertEqual(self.http.store.get(doc['id']), doc)
                    self.assertEqual(self.http.store.history(doc['id']), history)
        self.assertEqual(self.request(path=f"/api/prds/{doc['id']}/history/{2 ** 63 - 1}")[0], 404)
        self.assertEqual(self.request(path=f"/api/prds/{doc['id']}/history/1")[0], 200)
        status, _, payload = self.request('POST', f"/api/prds/{doc['id']}/action", json.dumps({
            'expectedRevision': doc['revision'], 'action': 'restore', 'revision': 1,
        }), {'Content-Type': 'application/json'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(payload)['revision'], doc['revision'] + 1)

    def test_boot_script_is_served_before_first_paint(self):
        status, headers, body = self.request(path='/boot.js')
        self.assertEqual(status, 200)
        self.assertTrue(headers['Content-Type'].startswith('text/javascript'))
        self.assertIn(b'requiro-display', body)
        self.assertNotIn(b'consent', body)
        self.assertNotIn(b'import ', body)
        _, _, page = self.request(path='/')
        head = page.split(b'</head>')[0]
        self.assertIn(b'<script src="/boot.js"></script>', head)
        self.assertLess(head.index(b'/boot.js'), head.index(b'/style.css'))

    def test_static_path_traversal_cannot_read_source_or_data(self):
        for path in ('/server.py', '/requiro.sqlite3', '/juno.sqlite3', '/../server.py', '/%2e%2e/server.py',
                     '/..%2fserver.py', '/api/../server.py', '/app.js/../server.py'):
            with self.subTest(path=path):
                status, _, body = self.request(path=path)
                self.assertEqual(status, 404)
                self.assertNotIn(b'import sqlite3', body)
                self.assertNotIn(b'SQLite format', body)

    def test_use_case_context_and_readable_export_keep_saved_json_unchanged(self):
        doc = self.http.store.create('Fictional named-use-case PRD')
        doc['sections']['useCases'] = 'UC-01: A member keeps a draft.'
        doc['sections']['requirements'] = [{**requirement(), 'appliesTo': 'UC-01'}]
        doc = self.http.store.mutate(doc['id'], doc['revision'], candidate=doc)
        path = f"/api/prds/{doc['id']}/use-cases?revision={doc['revision']}"
        status, _, body = self.request(path=path)
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['labels']['R-001']['label'], 'A member keeps a draft.')
        self.assertIn(b'Use case: A member keeps a draft. (reference: UC-01)', self.request(path=f"/api/export/{doc['id']}?format=markdown")[2])
        self.assertEqual(json.loads(self.request(path=f"/api/export/{doc['id']}")[2]), doc)
        for value in ('0', '-1', 'abc', '9' * 21):
            self.assertEqual(self.request(path=f"/api/prds/{doc['id']}/use-cases?revision={value}")[0], 422)
        self.assertEqual(self.http.store.get(doc['id']), doc)

    def test_packet_endpoint_enforces_current_revision_and_document_isolation(self):
        chosen = self.http.store.create('Fictional chosen list')
        other = self.http.store.create('Fictional unrelated list')
        path = f"/api/prds/{chosen['id']}/packet"
        status, _, body = self.request('POST', path, json.dumps({
            'expectedRevision': chosen['revision'], 'message': 'Review the draft.',
        }), {'Content-Type': 'application/json'})
        self.assertEqual(status, 200)
        value = json.loads(body)['packet']
        self.assertIn(chosen['id'], value)
        self.assertNotIn(other['id'], value)
        self.assertEqual(self.request('POST', path, json.dumps({
            'expectedRevision': 0, 'message': 'Review the draft.',
        }), {'Content-Type': 'application/json'})[0], 409)

    def test_copy_for_assistant_then_save_keeps_reply_revision_and_approval(self):
        store = self.http.store
        doc = store.create('Fictional approved list')
        doc['sections'].update(problem='Lists lose order.', users='List members.', outcomes='O-001: keep order.',
                               useCases='U-001: a member reorders a list.', scope='Draft lists.', requirements=[requirement()])
        doc = store.mutate(doc['id'], doc['revision'], candidate=doc)
        doc = store.mutate(doc['id'], doc['revision'], action='review')
        approved = store.mutate(doc['id'], doc['revision'], action='approve')
        history = store.history(approved['id'])
        json_headers = {'Content-Type': 'application/json'}
        status, _, body = self.request('POST', f"/api/prds/{approved['id']}/packet", json.dumps({
            'expectedRevision': approved['revision'], 'message': '  Check the fictional scope.  ',
        }), json_headers)
        self.assertEqual(status, 200)
        result = json.loads(body)
        self.assertIn(f'"revision": {approved["revision"]}', result['packet'])
        self.assertEqual(result['doc']['chat'], [{'role': 'user', 'content': 'Check the fictional scope.'}])
        status, _, body = self.request('PUT', f"/api/prds/{approved['id']}", json.dumps({
            'expectedRevision': approved['revision'], 'doc': result['doc'],
        }), json_headers)
        self.assertEqual(status, 200)
        saved = json.loads(body)
        self.assertEqual((saved['revision'], saved['status']), (approved['revision'], 'Approved'),
                         'A reply prepared for this revision must still match after saving.')
        status, _, body = self.request('POST', f"/api/prds/{approved['id']}/chat", json.dumps({
            'expectedRevision': approved['revision'], 'append': [{'role': 'assistant', 'content': 'A fictional reply.'}],
        }), json_headers)
        self.assertEqual(status, 200)
        self.assertEqual(len(json.loads(body)['chat']), 2)
        status, _, body = self.request('POST', f"/api/prds/{approved['id']}/chat", json.dumps({
            'expectedRevision': approved['revision'], 'clear': True,
        }), json_headers)
        self.assertEqual(status, 200)
        current = store.get(approved['id'])
        self.assertEqual((current['chat'], current['revision'], current['status']), ([], approved['revision'], 'Approved'))
        self.assertEqual(store.history(approved['id']), history)
        self.assertEqual(self.request('POST', f"/api/prds/{approved['id']}/chat", json.dumps({
            'expectedRevision': approved['revision'], 'clear': 'yes',
        }), json_headers)[0], 422)


if __name__ == '__main__':
    unittest.main()
