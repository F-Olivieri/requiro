"""Fictional use-case labels, source context and display-only preservation."""

import copy
import io
import tempfile
import unittest
import zipfile

from prd_store import Store, markdown, store_fingerprint
from use_cases import describe_use_case, use_case_choices
from verification import Verification
from test_server import requirement


class UseCaseTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = Store(directory.name)
        self.source = self.create('Fictional tool library', 'A member borrows a tool.')
        self.target = self.create('Fictional workshop', 'A participant signs up.')

    def create(self, title, description):
        doc = self.store.create(title, True)
        doc['sections']['useCases'] = 'UC-01: ' + description
        doc['sections']['requirements'] = [{**requirement(), 'appliesTo': 'UC-01'}]
        return self.store.mutate(doc['id'], doc['revision'], candidate=doc)

    def test_named_labels_and_reports_never_rewrite_saved_records(self):
        verification = Verification(self.store)
        before = store_fingerprint(self.store.directory)
        doc = self.store.get(self.source['id'])
        context = self.store.use_case_context(doc)
        self.assertEqual(context['labels']['R-001']['label'], 'A member borrows a tool.')
        self.assertIn('Use case: A member borrows a tool. (reference: UC-01)', markdown(doc, context))
        with zipfile.ZipFile(io.BytesIO(verification.report(doc['id']))) as bundle:
            for name in ('prd.md', 'delivery-review.md'):
                self.assertIn('Use case: A member borrows a tool. (reference: UC-01)', bundle.read(name).decode())
        self.assertEqual(store_fingerprint(self.store.directory), before)
        self.assertEqual(self.store.get(doc['id']), doc)

    def test_import_keeps_pinned_source_meaning_across_colliding_codes(self):
        result = self.store.import_requirements(self.target['id'], self.target['revision'], self.source['id'], self.source['revision'], ['R-001'], True)
        target = result['doc']
        labels = self.store.use_case_context(target)['labels']
        self.assertEqual(labels['R-001']['label'], 'A participant signs up.')
        self.assertEqual(labels['R-002']['label'], 'A member borrows a tool.')
        self.assertTrue(labels['R-002']['imported'])
        changed = copy.deepcopy(self.source)
        changed['sections']['useCases'] = 'UC-01: A member buys a tool.'
        self.store.mutate(changed['id'], changed['revision'], candidate=changed)
        self.assertEqual(self.store.use_case_context(target)['labels']['R-002']['label'], 'A member borrows a tool.')
        again = self.create('Fictional third PRD', 'A member views a list.')
        nested = self.store.import_requirements(again['id'], again['revision'], target['id'], target['revision'], ['R-002'], True)['doc']
        self.assertEqual(self.store.use_case_context(nested)['labels']['R-002']['label'], 'A member borrows a tool.')
        target['sections']['requirements'][1]['appliesTo'] = 'A participant signs up.'
        edited = self.store.mutate(target['id'], target['revision'], candidate=target)
        self.assertFalse(self.store.use_case_context(edited)['labels']['R-002']['imported'])
        original = self.store.get(self.source['id'], self.source['revision'])
        self.assertEqual(self.store.use_case_context(original)['labels']['R-001']['label'], 'A member borrows a tool.')

    def test_duplicate_missing_multiple_and_custom_descriptions(self):
        definitions = 'UC-01: First meaning\nUC-01: Conflicting meaning\nUC-02: Clear meaning'
        self.assertEqual(use_case_choices(definitions), [{'reference': 'UC-02', 'label': 'Clear meaning'}])
        self.assertEqual(describe_use_case('UC-01', definitions)['label'], 'Use case description missing')
        self.assertEqual(describe_use_case('UC-02; UC-99', definitions)['label'], 'Clear meaning; Use case description missing')
        self.assertEqual(describe_use_case('U-001: A member edits a list.')['label'], 'A member edits a list.')
        self.assertEqual(describe_use_case('All fictional situations', definitions)['label'], 'All fictional situations')
        self.assertEqual(describe_use_case('', definitions)['label'], 'Not documented')


if __name__ == '__main__':
    unittest.main()
