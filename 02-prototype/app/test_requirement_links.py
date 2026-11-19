"""Synthetic relation, reference, concurrency, and copy-portability tests."""

import copy
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

from prd_store import InputError, Store, markdown
from requirement_links import RequirementLinks, references


def requirement(number, **changes):
    return {'id': f'R-{number:03}', 'priority': 'Must', 'proposed': False,
            'behavior': 'A fictional member keeps a reading list.',
            'acceptance': 'One entry appears.', 'appliesTo': 'A member keeps a list.',
            'outcome': 'Keep a book for later.', **changes}


class RequirementLinksTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = Store(self.directory.name)
        self.source = self.create('Fictional source', [requirement(1), requirement(2)])
        self.target = self.create('Fictional target', [requirement(1)])
        self.links = RequirementLinks(self.store)

    def create(self, title, reqs):
        doc = self.store.create(title)
        candidate = copy.deepcopy(doc)
        candidate['sections']['requirements'] = reqs
        return self.store.mutate(doc['id'], doc['revision'], candidate=candidate)

    def body(self, **changes):
        return {'kind': 'Connected to', 'sourceDocumentId': self.source['id'],
                'sourceRequirementId': 'R-001', 'targetDocumentId': self.target['id'],
                'targetRequirementId': 'R-001', 'expectedSourcePrdRevision': self.source['revision'],
                'expectedTargetPrdRevision': self.target['revision'], **changes}

    def rejected(self, status, operation):
        with self.assertRaises(InputError) as caught:
            operation()
        self.assertEqual(caught.exception.status, status)

    def removal(self, item, **changes):
        revisions = {doc['id']: doc['revision'] for doc in self.links.snapshot()['documents']}
        return {'expectedRevision': item['revision'],
                'expectedSourcePrdRevision': revisions[item['sourceDocumentId']],
                'expectedTargetPrdRevision': revisions[item['targetDocumentId']], **changes}

    def test_symmetric_link_duplicate_self_missing_and_stale_checks_preserve_prds(self):
        before = self.store.get(self.source['id'])
        history = self.store.history(self.source['id'])
        item = self.links.add(self.body())
        reverse = self.body(sourceDocumentId=self.target['id'], targetDocumentId=self.source['id'])
        self.rejected(409, lambda: self.links.add(reverse))
        self.rejected(422, lambda: self.links.add(self.body(targetDocumentId=self.source['id'])))
        self.rejected(404, lambda: self.links.add(self.body(targetRequirementId='R-999')))
        self.rejected(409, lambda: self.links.add(self.body(kind='Depends on', expectedSourcePrdRevision=1)))
        self.assertEqual(self.store.get(self.source['id']), before)
        self.assertEqual(self.store.history(self.source['id']), history)
        self.assertEqual(self.links.snapshot()['links'], [item])

    def test_directed_dependencies_allow_cycle_and_graph_keeps_isolates(self):
        self.links.add(self.body(kind='Depends on'))
        self.links.add(self.body(kind='Depends on', sourceDocumentId=self.target['id'], targetDocumentId=self.source['id']))
        snapshot = self.links.snapshot()
        self.assertEqual(len(snapshot['nodes']), 3)
        self.assertEqual(len(snapshot['links']), 2)
        self.assertEqual({node['id'] for node in snapshot['nodes']}, {
            self.source['id'] + '/R-001', self.source['id'] + '/R-002', self.target['id'] + '/R-001'})
        self.assertTrue(all(link['kind'] == 'Depends on' for link in snapshot['links']))

    def test_references_cover_four_fields_backlinks_missing_and_utf16_offsets(self):
        candidate = copy.deepcopy(self.source)
        req = candidate['sections']['requirements'][0]
        req.update(behavior='🚀 See [[R-002]] and [[R-002]].', acceptance=f"Check [[{self.target['id']}/R-001]].",
                   appliesTo='See [[R-999]].', outcome='Keep [[R-002]].')
        self.source = self.store.mutate(self.source['id'], self.source['revision'], candidate=candidate)
        refs = self.links.snapshot()['references']
        self.assertEqual(len(refs), 5)
        self.assertEqual({ref['field'] for ref in refs}, {'behavior', 'acceptance', 'appliesTo', 'outcome'})
        behavior = [ref for ref in refs if ref['field'] == 'behavior']
        self.assertEqual(behavior[0]['start'], 7)
        self.assertNotEqual(behavior[0]['start'], behavior[1]['start'])
        for ref in refs:
            raw = req[ref['field']].encode('utf-16-le')
            self.assertEqual(raw[ref['start'] * 2:ref['end'] * 2].decode('utf-16-le'), ref['text'])
        self.assertFalse(next(ref for ref in refs if ref['targetRequirementId'] == 'R-999')['targetPresent'])
        self.assertEqual(sum(ref['targetDocumentId'] == self.target['id'] for ref in refs), 1)
        candidate = copy.deepcopy(self.source)
        candidate['sections']['requirements'][0]['behavior'] = 'No text links here.'
        self.store.mutate(self.source['id'], self.source['revision'], candidate=candidate)
        self.assertEqual(len(self.links.snapshot()['references']), 3)

    def test_remove_is_revision_checked_persistent_and_can_readd(self):
        item = self.links.add(self.body())
        self.rejected(409, lambda: self.links.remove(item['id'], self.removal(item, expectedRevision=99)))
        self.links.remove(item['id'], self.removal(item))
        self.rejected(409, lambda: self.links.remove(item['id'], self.removal(item)))
        self.assertEqual(RequirementLinks(Store(self.directory.name)).snapshot()['links'], [])
        self.assertNotEqual(self.links.add(self.body())['id'], item['id'])

    def test_removed_requirement_retains_visible_dangling_link_and_can_unlink(self):
        item = self.links.add(self.body(kind='Depends on'))
        candidate = copy.deepcopy(self.target)
        candidate['sections']['requirements'] = []
        self.target = self.store.mutate(self.target['id'], self.target['revision'], candidate=candidate)
        current = self.links.snapshot()['links'][0]
        self.assertFalse(current['targetPresent'])
        self.rejected(409, lambda: self.links.remove(item['id'], self.removal(item, expectedTargetPrdRevision=1)))
        self.links.remove(item['id'], self.removal(item))
        self.assertEqual(self.links.snapshot()['links'], [])

    def test_schema_initialization_preserves_legacy_documents_revisions_and_export(self):
        with self.store.connection() as db:
            before = {name: db.execute('SELECT * FROM ' + name).fetchall() for name in ('documents', 'revisions')}
            db.execute('DROP TABLE requirement_links')
        RequirementLinks(self.store)
        with self.store.connection() as db:
            for name in before:
                self.assertEqual(db.execute('SELECT * FROM ' + name).fetchall(), before[name])
        self.assertEqual(self.store.create('Fictional imported copy', self.source)['sections'], self.source['sections'])

    def test_copy_remaps_selected_links_qualifies_unselected_and_keeps_other_prd(self):
        candidate = copy.deepcopy(self.source)
        req = candidate['sections']['requirements'][0]
        value = f"[[R-001]] [[R-002]] [[{self.source['id']}/R-002]] [[{self.target['id']}/R-001]] [[R-999]]"
        for field in ('behavior', 'acceptance', 'appliesTo', 'outcome'):
            req[field] = value
        self.source = self.store.mutate(self.source['id'], self.source['revision'], candidate=candidate)
        copied = self.store.import_requirements(self.target['id'], self.target['revision'], self.source['id'], self.source['revision'], ['R-001', 'R-002'])['doc']
        expected = f"[[R-002]] [[R-003]] [[R-003]] [[{self.target['id']}/R-001]] [[{self.source['id']}/R-999]]"
        for field in ('behavior', 'acceptance', 'appliesTo', 'outcome'):
            self.assertEqual(copied['sections']['requirements'][1][field], expected)
        self.assertEqual(self.store.get(self.source['id']), self.source)
        self.assertIn(expected, markdown(copied))
        self.assertEqual(self.store.create('Fictional portable copy', copied)['sections'], copied['sections'])
        single = self.create('Fictional one-item copy', [])
        result = self.store.import_requirements(single['id'], single['revision'], self.source['id'], self.source['revision'], ['R-001'])['doc']
        self.assertIn(f"[[{self.source['id']}/R-002]]", result['sections']['requirements'][0]['behavior'])

    def test_reference_parser_ignores_noncanonical_markup_without_evaluating_it(self):
        self.assertEqual(list(references('<script>[[javascript:alert(1)]] [[R-1]]</script>', self.source['id'])), [])

    def test_concurrent_duplicate_creates_keep_one_symmetric_link(self):
        def create():
            try:
                return self.links.add(self.body())['revision']
            except InputError as error:
                return error.status
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: create(), range(2)))
        self.assertEqual(sorted(results), [1, 409])
        self.assertEqual(len(self.links.snapshot()['links']), 1)

    def test_canonical_symmetric_order_keeps_each_documents_expected_revision(self):
        candidate = copy.deepcopy(self.target)
        candidate['title'] = 'Fictional revised target'
        self.target = self.store.mutate(self.target['id'], self.target['revision'], candidate=candidate)
        self.links.add(self.body(sourceDocumentId=self.target['id'], targetDocumentId=self.source['id'],
                                 expectedSourcePrdRevision=self.target['revision'],
                                 expectedTargetPrdRevision=self.source['revision']))
        self.assertEqual(len(self.links.snapshot()['links']), 1)


if __name__ == '__main__':
    unittest.main()
