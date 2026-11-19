"""Synthetic requirement discussion storage, concurrency and actual HTTP tests."""

from concurrent.futures import ThreadPoolExecutor
import copy
import http.client
import json
import tempfile
import threading
import unittest

from comments import Comments
from prd_store import InputError, Store
import server
from test_server import requirement
from verification import Verification


def create_prd(store):
    doc = store.create('Fictional card board')
    req = requirement()
    req['behavior'] = 'A member can move 😀 cards between lists.'
    doc['sections']['requirements'] = [req]
    return store.mutate(doc['id'], doc['revision'], candidate=doc)


def body_for(doc, field='behavior', quote='😀'):
    source = doc['sections']['requirements'][0][field]
    start = source.index(quote)
    start = len(source[:start].encode('utf-16-le')) // 2
    return {'expectedPrdRevision': doc['revision'], 'anchor': {
        'field': field, 'start': start, 'end': start + len(quote.encode('utf-16-le')) // 2,
        'quote': quote, 'sourceText': source}, 'author': 'Product role',
        'text': 'Should moving a card preserve its position?', 'suggestion': ''}


class CommentsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = Store(self.directory.name)
        self.comments = Comments(self.store)
        self.verification = Verification(self.store)
        self.doc = create_prd(self.store)
        evidence = self.verification.update(self.doc['id'], 'R-001', {
            'expectedPrdRevision': self.doc['revision'], 'expectedRevision': 0,
            'owners': ['Engineering role'], 'proof': 'Fictional card movement check passed.'})
        self.verification.update(self.doc['id'], 'R-001', {
            'expectedPrdRevision': self.doc['revision'], 'expectedRevision': evidence['revision'],
            'status': 'Complete', 'reviewer': 'Test role', 'notes': 'Reviewed fictional proof.'}, review=True)

    def create(self):
        return self.comments.create(self.doc['id'], 'R-001', body_for(self.doc))

    def assert_rejected(self, status, operation):
        with self.assertRaises(InputError) as caught:
            operation()
        self.assertEqual(caught.exception.status, status)

    def authoring_and_delivery(self):
        return (self.store.get(self.doc['id']), self.store.history(self.doc['id']),
                self.verification.get(self.doc['id']), self.verification.history(self.doc['id'], 'R-001'))

    def test_utf16_anchors_persist_without_changing_authoring_or_delivery(self):
        before = self.authoring_and_delivery()
        thread = self.create()
        self.assertEqual(thread['anchor']['end'] - thread['anchor']['start'], 2)
        self.assertEqual(thread['anchor']['quote'], '😀')
        self.assertEqual(thread['createdPrdRevision'], self.doc['revision'])
        self.assertTrue(thread['requirementPresent'])
        self.assertTrue(thread['anchorCurrent'])
        saved = Comments(Store(self.directory.name)).get(self.doc['id'])
        self.assertEqual(saved['threads'], [thread])
        self.assertEqual(saved['prdRevision'], self.doc['revision'])
        self.assertEqual(self.authoring_and_delivery(), before)

    def test_each_allowed_field_can_anchor_a_comment(self):
        for field in ('behavior', 'acceptance', 'appliesTo', 'outcome'):
            source = self.doc['sections']['requirements'][0][field]
            thread = self.comments.create(self.doc['id'], 'R-001', body_for(self.doc, field, source))
            self.assertEqual(thread['anchor']['field'], field)
            self.assertEqual(thread['anchor']['quote'], source)

    def test_invalid_or_stale_anchors_reject_atomically(self):
        initial = body_for(self.doc)
        cases = []
        for changes, status in (({'start': True}, 422), ({'start': -1}, 422),
                                ({'end': 10000}, 422), ({'end': initial['anchor']['start']}, 422),
                                ({'start': initial['anchor']['start'] + 1}, 422),
                                ({'quote': 'different words'}, 422), ({'sourceText': 'Edited unsaved words'}, 409),
                                ({'field': 'priority'}, 422), ({'field': []}, 422)):
            value = copy.deepcopy(initial)
            value['anchor'].update(changes)
            cases.append((value, status))
        stale = copy.deepcopy(initial)
        stale['expectedPrdRevision'] -= 1
        cases.append((stale, 409))
        for body, status in cases:
            self.assert_rejected(status, lambda b=body: self.comments.create(self.doc['id'], 'R-001', b))
        self.assertEqual(self.comments.get(self.doc['id'])['threads'], [])

    def test_labels_limits_and_unicode_are_validated(self):
        for changes in ({'author': ''},
                        {'author': 'x' * 201}, {'text': '', 'suggestion': ''}, {'text': '\ud800'},
                        {'suggestion': '\udfff'}, {'author': '\ud800'}, {'text': 'x' * 20001}):
            body = {**body_for(self.doc), **changes}
            self.assert_rejected(422, lambda b=body: self.comments.create(self.doc['id'], 'R-001', b))
        body = {**body_for(self.doc), 'text': '', 'suggestion': 'Keep 😀 cards in their original order.'}
        thread = self.comments.create(self.doc['id'], 'R-001', body)
        self.assertEqual(thread['messages'][0]['suggestion'], body['suggestion'])
        for legacy in (True, False):
            self.assertEqual(self.comments.reply(self.doc['id'], 'R-001', thread['id'], {
                'author': 'Engineering role', 'text': 'Fictional older client reply', 'privacyConfirmed': legacy,
            })['messages'][-1]['text'], 'Fictional older client reply')

    def test_changed_or_removed_source_keeps_quote_and_allows_replies(self):
        thread = self.create()
        candidate = copy.deepcopy(self.doc)
        candidate['sections']['requirements'][0]['behavior'] = 'A member can move cards.'
        changed = self.store.mutate(self.doc['id'], self.doc['revision'], candidate=candidate)
        result = self.comments.get(self.doc['id'])['threads'][0]
        self.assertTrue(result['requirementPresent'])
        self.assertFalse(result['anchorCurrent'])
        self.assertEqual(result['anchor'], thread['anchor'])
        changed['sections']['requirements'] = []
        self.store.mutate(changed['id'], changed['revision'], candidate=changed)
        result = self.comments.reply(self.doc['id'], 'R-001', thread['id'], {
            'author': 'Engineering role', 'text': 'Retain the old decision context.', 'privacyConfirmed': True})
        self.assertFalse(result['requirementPresent'])
        self.assertFalse(result['anchorCurrent'])
        self.assertEqual(result['anchor']['quote'], '😀')
        self.assertEqual(len(result['messages']), 2)
        self.assertEqual(result['createdPrdRevision'], self.doc['revision'])

    def test_status_cas_and_suggestions_preserve_authoring_and_delivery(self):
        before = self.authoring_and_delivery()
        thread = self.create()
        body = {'expectedRevision': thread['revision'], 'status': 'Resolved',
                'author': 'Product role', 'privacyConfirmed': True}
        resolved = self.comments.set_status(self.doc['id'], 'R-001', thread['id'], body)
        self.assertEqual(resolved['status'], 'Resolved')
        self.assertEqual(resolved['messages'][-1]['author'], 'Product role')
        self.assert_rejected(409, lambda: self.comments.set_status(self.doc['id'], 'R-001', thread['id'], body))
        self.assertEqual(self.comments.get(self.doc['id'])['threads'], [resolved])
        reopened = self.comments.set_status(self.doc['id'], 'R-001', thread['id'], {
            **body, 'status': 'Open', 'expectedRevision': resolved['revision']})
        self.assertEqual(reopened['status'], 'Open')
        self.assertEqual(reopened['revision'], resolved['revision'] + 1)
        self.assertEqual(self.authoring_and_delivery(), before)

    def test_simultaneous_replies_are_both_retained(self):
        thread = self.create()
        barrier = threading.Barrier(2)
        def reply(number):
            barrier.wait()
            return self.comments.reply(self.doc['id'], 'R-001', thread['id'], {
                'author': f'Engineering role {number}', 'text': f'Fictional reply {number}', 'privacyConfirmed': True})
        with ThreadPoolExecutor(max_workers=2) as pool:
            list(pool.map(reply, (1, 2)))
        saved = self.comments.get(self.doc['id'])['threads'][0]
        self.assertEqual(saved['revision'], 3)
        self.assertEqual(len(saved['messages']), 3)
        self.assertEqual({m['text'] for m in saved['messages'][1:]}, {'Fictional reply 1', 'Fictional reply 2'})

    def test_thread_document_and_requirement_boundaries_are_enforced(self):
        thread = self.create()
        other = create_prd(self.store)
        body = {'author': 'Engineering role', 'text': 'Fictional reply', 'privacyConfirmed': True}
        self.assert_rejected(404, lambda: self.comments.reply(other['id'], 'R-001', thread['id'], body))
        self.assert_rejected(404, lambda: self.comments.reply(self.doc['id'], 'R-002', thread['id'], body))
        self.assertEqual(self.comments.get(other['id'])['threads'], [])
        self.assertEqual(self.comments.get(self.doc['id'])['threads'], [thread])


class CommentsHttpTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.service = server.make_server(self.directory.name, port=0)
        self.doc = create_prd(self.service.store)
        self.path = f"/api/prds/{self.doc['id']}/comments"
        self.thread = threading.Thread(target=self.service.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.service.shutdown()
        self.service.server_close()
        self.thread.join(timeout=2)

    def request(self, method='GET', path=None, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.service.server_port, timeout=5)
        try:
            connection.request(method, path or self.path, json.dumps(body) if body is not None else None,
                               {'Content-Type': 'application/json', **(headers or {})})
            response = connection.getresponse()
            return response.status, json.loads(response.read())
        finally:
            connection.close()

    def test_http_create_suggestion_reply_resolve_and_reopen(self):
        before = self.service.store.get(self.doc['id'])
        status, initial = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(initial, {'documentId': self.doc['id'], 'prdRevision': self.doc['revision'], 'threads': []})
        status, thread = self.request('POST', self.path + '/R-001', body_for(self.doc))
        self.assertEqual(status, 201)
        path = self.path + '/R-001/' + thread['id']
        status, thread = self.request('POST', path + '/replies', {
            'author': 'Engineering role', 'text': '', 'suggestion': 'Preserve card order 😀.', 'privacyConfirmed': True})
        self.assertEqual(status, 201)
        self.assertEqual(len(thread['messages']), 2)
        for target_status in ('Resolved', 'Open'):
            status, thread = self.request('PUT', path, {'expectedRevision': thread['revision'], 'status': target_status,
                'author': 'Product role', 'privacyConfirmed': True})
            self.assertEqual(status, 200)
            self.assertEqual(thread['status'], target_status)
        self.assertEqual(self.request()[1]['threads'], [thread])
        self.assertEqual(self.service.store.get(self.doc['id']), before)

    def test_http_stale_unicode_and_source_failures_do_not_create_threads(self):
        for changes, expected in (({'expectedPrdRevision': 1}, 409),
                                  ({'text': '\ud800'}, 422), ({'author': '\udfff'}, 422)):
            for repeat in range(2):
                with self.subTest(changes=repr(changes), repeat=repeat):
                    self.assertEqual(self.request('POST', self.path + '/R-001', {**body_for(self.doc), **changes})[0], expected)
        changed = body_for(self.doc)
        changed['anchor']['sourceText'] = 'Unsaved replacement words.'
        self.assertEqual(self.request('POST', self.path + '/R-001', changed)[0], 409)
        self.assertEqual(self.request()[1]['threads'], [])
        self.assertEqual(self.request(headers={'Origin': 'https://example.invalid'})[0], 403)

    def test_http_concurrent_replies_and_conflicting_status_are_atomic(self):
        status, thread = self.request('POST', self.path + '/R-001', body_for(self.doc))
        self.assertEqual(status, 201)
        path = self.path + '/R-001/' + thread['id']
        for repeat in (1, 2):
            barrier = threading.Barrier(2)
            def reply(number):
                barrier.wait()
                return self.request('POST', path + '/replies', {
                    'author': f'Engineering role {number}', 'text': f'Fictional reply {repeat}/{number}', 'privacyConfirmed': True})[0]
            with ThreadPoolExecutor(max_workers=2) as pool:
                self.assertEqual(sorted(pool.map(reply, (1, 2))), [201, 201])
        saved = self.request()[1]['threads'][0]
        self.assertEqual(len(saved['messages']), 5)
        self.assertEqual(saved['revision'], 5)
        stale = {'expectedRevision': thread['revision'], 'status': 'Resolved', 'author': 'Product role', 'privacyConfirmed': True}
        self.assertEqual(self.request('PUT', path, stale)[0], 409)
        self.assertEqual(self.request()[1]['threads'], [saved])
        barrier = threading.Barrier(2)
        def resolve(number):
            barrier.wait()
            return self.request('PUT', path, {**stale, 'expectedRevision': saved['revision'], 'author': f'Product role {number}'})[0]
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(resolve, (1, 2))), [200, 409])
        final = self.request()[1]['threads'][0]
        self.assertEqual(final['revision'], saved['revision'] + 1)
        self.assertEqual(final['status'], 'Resolved')


if __name__ == '__main__':
    unittest.main()
