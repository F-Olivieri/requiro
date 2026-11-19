"""Synthetic checks that documents, files and dates are recognizable (R-051)."""

import http.client
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from prd_store import local_time, markdown
import server


class RecognitionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.http = server.make_server(self.directory.name, port=0)
        self.store = self.http.store
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join(timeout=2)

    def request(self, path):
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        try:
            connection.request('GET', path)
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_export_filenames_use_a_safe_title_slug(self):
        doc = self.store.create('Shared garden task board v3')
        for query, name in (('markdown', 'shared-garden-task-board-v3.md'), ('json', 'shared-garden-task-board-v3.json')):
            status, headers, _ = self.request(f"/api/export/{doc['id']}?format={query}")
            self.assertEqual(status, 200)
            self.assertIn(f'filename="{name}"', headers['Content-Disposition'])
        status, headers, _ = self.request(f"/api/prds/{doc['id']}/completion-report")
        self.assertIn('filename="shared-garden-task-board-v3-delivery-review.zip"', headers['Content-Disposition'])
        self.assertEqual(server.export_name({'id': 'PRD-1', 'title': 'Café / Ölweg: Plan!'}), 'cafe-olweg-plan')
        self.assertEqual(server.export_name({'id': 'PRD-1', 'title': '读书清单'}), 'PRD-1')
        self.assertEqual(server.export_name({'id': 'PRD-1', 'title': '-' * 300}), 'PRD-1')
        self.assertLessEqual(len(server.export_name({'id': 'PRD-1', 'title': 'a ' * 200})), 80)

    def test_import_history_names_the_source_prd_by_title(self):
        source = self.store.create('Fictional source list')
        source['sections']['requirements'] = [{'id': 'R-001', 'priority': 'Must', 'proposed': False, 'appliesTo': 'A member saves a list.',
                                               'outcome': 'Keep the list.', 'behavior': 'A member can save a list.', 'acceptance': 'The list remains after reload.'}]
        source = self.store.mutate(source['id'], source['revision'], candidate=source)
        target = self.store.create('Fictional target list')
        result = self.store.import_requirements(target['id'], target['revision'], source['id'], source['revision'], ['R-001'])
        reason = self.store.history(target['id'])[0]['reason']
        self.assertEqual(reason, f"Imported 1 requirement(s) from “Fictional source list” revision {source['revision']}")
        self.assertNotIn(source['id'], reason)
        with self.store.connection() as db:
            db.execute('UPDATE revisions SET reason=? WHERE document_id=? AND revision=?',
                       (f"Imported 1 requirement(s) from {source['id']} revision {source['revision']}", target['id'], result['doc']['revision']))
        self.assertEqual(self.store.history(target['id'])[0]['reason'], reason)
        with self.store.connection() as db:
            db.execute('UPDATE revisions SET reason=? WHERE document_id=? AND revision=?',
                       ('Imported 1 requirement(s) from PRD-000000000000 revision 2', target['id'], result['doc']['revision']))
        self.assertIn('PRD-000000000000', self.store.history(target['id'])[0]['reason'])

    def test_markdown_dates_are_local_and_unambiguous(self):
        doc = self.store.create('Fictional dated list')
        doc['updatedAt'] = '2026-11-11T00:41:05+00:00'
        self.addCleanup(time.tzset)
        with patch.dict('os.environ', {'TZ': 'America/Los_Angeles'}):
            time.tzset()
            self.assertEqual(local_time(doc['updatedAt']), 'Nov 10, 2026, 16:41 (UTC-08:00)')
            self.assertIn('Updated: Nov 10, 2026, 16:41 (UTC-08:00)', markdown(doc))
        self.assertEqual(local_time(None), '')
        self.assertEqual(local_time('not a date'), '')

    def test_format_module_is_served(self):
        status, headers, body = self.request('/format.js')
        self.assertEqual(status, 200)
        self.assertTrue(headers['Content-Type'].startswith('text/javascript'))
        self.assertIn(b'export function formatDateTime', body)


if __name__ == '__main__':
    unittest.main()
