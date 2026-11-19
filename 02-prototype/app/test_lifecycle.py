import io
import re
import tempfile
import unittest
import zipfile
from pathlib import Path

from prd_store import SECTION_LABELS, InputError, Store, approval_gaps, markdown
from verification import Verification


class LifecycleMessagesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(self.tmp.name)
        self.doc = self.store.create('Fictional lending shelf')

    def tearDown(self):
        self.tmp.cleanup()

    def complete(self, doc):
        sections = {**doc['sections'], 'problem': 'Members cannot find a tool.', 'users': 'Fictional members.', 'outcomes': 'Members borrow a tool.', 'useCases': 'UC-01: A member borrows a tool.', 'scope': 'Borrowing only.'}
        sections['requirements'] = [{'id': 'R-001', 'priority': 'Must', 'proposed': False, 'behavior': 'Show available tools.', 'appliesTo': 'UC-01', 'outcome': 'Members borrow a tool.', 'acceptance': 'Available tools appear.'}]
        return self.store.mutate(doc['id'], doc['revision'], candidate={**doc, 'sections': sections})

    def test_gaps_are_plain_sentences(self):
        gaps = approval_gaps(self.doc)
        self.assertEqual(gaps[0], '“The problem” is empty')
        self.assertIn('Add at least one requirement', gaps)
        draft = self.complete(self.doc)
        draft['sections']['requirements'][0].update(appliesTo='', acceptance='', proposed=True)
        self.assertEqual(approval_gaps(draft), ['R-001 needs its use case and acceptance criteria', 'R-001 priority is not yet agreed'])

    def test_actions_explain_what_to_do(self):
        with self.assertRaisesRegex(InputError, '^Send this version for approval before approving it.$'):
            self.store.mutate(self.doc['id'], 1, action='approve')
        sent = self.store.mutate(self.doc['id'], 1, action='review')
        self.assertEqual(sent['status'], 'In review')
        with self.assertRaisesRegex(InputError, '^Only a draft can be sent for approval.$'):
            self.store.mutate(self.doc['id'], 2, action='review')
        with self.assertRaises(InputError) as blocked:
            self.store.mutate(self.doc['id'], 2, action='approve')
        self.assertTrue(str(blocked.exception).startswith('Approval is blocked. “The problem” is empty. '))
        self.assertNotIn('behavior', str(blocked.exception))

    def test_approval_creates_the_next_version(self):
        draft = self.complete(self.doc)
        sent = self.store.mutate(draft['id'], draft['revision'], action='review')
        approved = self.store.mutate(sent['id'], sent['revision'], action='approve')
        self.assertEqual((approved['status'], approved['revision'], approved['approvedRevision']), ('Approved', sent['revision'] + 1, sent['revision'] + 1))
        self.assertEqual(approved['sections'], sent['sections'])
        self.assertEqual([item['reason'] for item in self.store.history(draft['id'])], ['approve', 'review', 'Edited', 'Created'])

    def test_markdown_uses_display_labels(self):
        draft = self.complete(self.doc)
        sent = self.store.mutate(draft['id'], draft['revision'], action='review')
        text = markdown(sent)
        self.assertIn('Awaiting approval', text)
        self.assertIn(f"v{sent['revision']}", text)
        self.assertIn('Approval', text)
        self.assertIn('Last approved version: None', text)
        self.assertIn('Intended outcome: Members borrow a tool.', text)
        self.assertNotIn('In review', text)
        for heading in ('## The problem', '## Who it is for', '## The intended outcome', '## Out of scope', '## Requirements', '## Evidence and assumptions'):
            self.assertIn(f'\n{heading}\n', text)
        self.assertNotIn('## Problem\n', text)

    def test_markdown_headings_match_app_labels(self):
        source = (Path(__file__).parent / 'ui' / 'app.js').read_text()
        block = source[source.index('const fields = {'):source.index('};', source.index('const fields = {'))]
        app_labels = dict(re.findall(r"^  (\w+): \['([^']+)'", block, re.M))
        self.assertEqual(app_labels, {key: label for key, label in SECTION_LABELS.items() if key != 'requirements'})

    def test_unagreed_priority_wording(self):
        draft = self.complete(self.doc)
        draft['sections']['requirements'][0]['proposed'] = True
        self.assertIn('R-001 · Must (not yet agreed)', markdown(draft))
        self.assertNotIn('proposed', markdown(draft))

    def test_restore_messages_say_what_to_do(self):
        archived = self.store.mutate(self.doc['id'], 1, action='archive')
        with self.assertRaisesRegex(InputError, '^Reopen the PRD before restoring an earlier version.$'):
            self.store.mutate(archived['id'], archived['revision'], action='restore', revision=1)
        reopened = self.store.mutate(archived['id'], archived['revision'], action='reopen')
        with self.assertRaisesRegex(InputError, '^Choose a saved version number, such as 1 for v1.$'):
            self.store.mutate(reopened['id'], reopened['revision'], action='restore', revision='v1')
        with self.assertRaisesRegex(InputError, '^That version of this PRD was not found.$'):
            self.store.mutate(reopened['id'], reopened['revision'], action='restore', revision=99)

    def test_delivery_report_uses_glossary(self):
        draft = self.complete(self.doc)
        with zipfile.ZipFile(io.BytesIO(Verification(self.store).report(draft['id']))) as bundle:
            self.assertNotIn('completion-report.md', bundle.namelist())
            report = bundle.read('delivery-review.md').decode()
        self.assertTrue(report.startswith('# Delivery review: Fictional lending shelf'))
        self.assertIn(f"Saved PRD v{draft['revision']}", report)
        for label in ('Intended outcome:', 'Requirement:', 'Acceptance criteria:', 'Proof recorded for PRD version: Not recorded'):
            self.assertIn(label, report)
        self.assertNotIn('Completion', report)
        self.assertNotIn('Behavior:', report)


if __name__ == '__main__':
    unittest.main()
