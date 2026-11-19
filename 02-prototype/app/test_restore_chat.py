import copy
import tempfile
import unittest

import prd_store


class RestoreKeepsConversationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.store = prd_store.Store(self.directory.name)

    def test_restore_keeps_current_conversation(self):
        first = self.store.create('Fictional reading list')
        candidate = copy.deepcopy(first)
        candidate['sections']['problem'] = 'Fictional readers lose track of shared books.'
        edited = self.store.mutate(first['id'], first['revision'], candidate=candidate)
        chat = [{'role': 'user', 'content': 'Clarify the fictional reading list.'}, {'role': 'assistant', 'content': 'A fictional reply.'}]
        talked = self.store.update_chat(edited['id'], edited['revision'], chat)
        restored = self.store.mutate(talked['id'], talked['revision'], action='restore', revision=first['revision'])
        self.assertEqual(restored['sections'], first['sections'])
        self.assertEqual(restored['chat'], chat)
        self.assertEqual(self.store.get(restored['id'])['chat'], chat)


if __name__ == '__main__':
    unittest.main()
