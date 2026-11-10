"""Synthetic storage migration and UI/data separation tests."""

from contextlib import closing
import copy
import http.client
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

import prd_store
import server
from comments import Comments
from verification import Verification


EXAMPLE_PATH = Path(__file__).resolve().parents[2] / 'examples' / 'reading-list.json'


def files_under(directory):
    return {str(path.relative_to(directory)): path.read_bytes()
            for path in directory.rglob('*') if path.is_file()}


def rows_at(directory):
    path = next(directory / name for name in ('requiro.sqlite3', 'juno.sqlite3') if (directory / name).exists())
    with closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)) as db:
        return {
            'documents': db.execute('SELECT * FROM documents ORDER BY id').fetchall(),
            'revisions': db.execute('SELECT * FROM revisions ORDER BY document_id, revision').fetchall(),
        }


class DataDirectoryTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.scratch = Path(directory.name)
        self.repo = self.scratch / 'repository'
        self.app = self.repo / '02-prototype' / 'app'
        self.app.mkdir(parents=True)
        self.legacy = self.app / '.juno-data'
        self.target = self.repo / 'data' / 'prds'
        self.root_patch = patch.object(server, 'ROOT', self.app)
        self.root_patch.start()
        self.addCleanup(self.root_patch.stop)
        self.env_patch = patch.dict(os.environ)
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        os.environ.pop('JUNO_DATA_DIR', None)
        os.environ.pop('REQUIRO_DATA_DIR', None)

    def rich_store(self, directory):
        store = prd_store.Store(directory)
        example = json.loads(EXAMPLE_PATH.read_text())
        doc = store.create('Fictional migration list', True, imported=example)
        for requirement in doc['sections']['requirements']:
            requirement['proposed'] = False
        doc['chat'] = [
            {'role': 'user', 'content': 'Use a single fictional reading list.'},
            {'role': 'assistant', 'content': 'The proposed scope is one list.'},
        ]
        doc = store.mutate(doc['id'], doc['revision'], candidate=doc)
        doc = store.mutate(doc['id'], doc['revision'], action='review')
        approved = store.mutate(doc['id'], doc['revision'], action='approve')
        changed = copy.deepcopy(approved)
        changed['sections']['decisions'] = 'Decide whether to retain completed suggestions.'
        changed = store.mutate(changed['id'], changed['revision'], candidate=changed)
        other = store.create('Fictional archived list', True)
        store.mutate(other['id'], other['revision'], action='archive')
        if directory == self.legacy:
            store.path.rename(directory / 'juno.sqlite3')
            store.path = directory / 'juno.sqlite3'
        return store, approved, changed

    def test_default_data_path_is_repository_relative_regardless_of_cwd(self):
        elsewhere = self.scratch / 'unrelated-directory'
        elsewhere.mkdir()
        previous = Path.cwd()
        try:
            os.chdir(elsewhere)
            self.assertEqual(server.data_directory(), self.target)
        finally:
            os.chdir(previous)
        self.assertFalse(self.target.exists())
        self.assertFalse((elsewhere / 'data').exists())

    def test_override_is_used_without_migrating_legacy_store(self):
        self.rich_store(self.legacy)
        before = files_under(self.legacy)
        override = self.scratch / 'configured-data'
        os.environ['JUNO_DATA_DIR'] = str(override)
        self.assertEqual(server.data_directory(), override.resolve())
        self.assertEqual(files_under(self.legacy), before)
        self.assertFalse(self.target.exists())
        self.assertFalse(override.exists())

    def test_empty_override_is_rejected_without_starting_a_store(self):
        for name in ('REQUIRO_DATA_DIR', 'JUNO_DATA_DIR'):
            for value in ('', '  \t'):
                with self.subTest(name=name, value=value), patch.dict(os.environ, {name: value}):
                    with self.assertRaisesRegex(RuntimeError, name):
                        server.data_directory()
        self.assertFalse(self.target.exists())

    def test_new_setting_and_legacy_alias_resolve_the_same_library(self):
        configured = self.scratch / 'configured-data'
        for variables in ({'REQUIRO_DATA_DIR': str(configured)},
                          {'JUNO_DATA_DIR': str(configured)},
                          {'REQUIRO_DATA_DIR': str(configured), 'JUNO_DATA_DIR': str(configured / '.')}):
            with self.subTest(variables=variables), patch.dict(os.environ, variables):
                self.assertEqual(server.data_directory(), configured.resolve())
        with patch.dict(os.environ, {'REQUIRO_DATA_DIR': str(configured), 'JUNO_DATA_DIR': str(self.target)}):
            with self.assertRaisesRegex(RuntimeError, 'different directories'):
                server.data_directory()
        self.assertFalse(configured.exists())
        self.assertFalse(self.target.exists())

    def test_migration_preserves_entire_directory_and_every_history_row(self):
        _, approved, working = self.rich_store(self.legacy)
        (self.legacy / 'migration-sentinel.txt').write_bytes(b'SYNTHETIC_EXTRA_FILE\n')
        before_files = files_under(self.legacy)
        before_rows = rows_at(self.legacy)
        resolved = server.data_directory()
        self.assertEqual(resolved, self.target)
        self.assertFalse(self.legacy.exists())
        self.assertEqual(files_under(resolved), before_files)
        self.assertEqual(rows_at(resolved), before_rows)
        moved = prd_store.Store(resolved)
        self.assertEqual(moved.path.name, 'requiro.sqlite3')
        self.assertFalse((resolved / 'juno.sqlite3').exists())
        self.assertEqual(moved.get(working['id']), working)
        self.assertEqual(moved.get(approved['id'], approved['revision']), approved)
        self.assertEqual(moved.get(working['id'])['status'], 'Draft')
        self.assertEqual(moved.get(working['id'])['approvedRevision'], approved['revision'])

    def test_conflicting_directories_leave_both_stores_unchanged(self):
        self.rich_store(self.legacy)
        prd_store.Store(self.target).create('Fictional separate list', True)
        before_legacy = files_under(self.legacy)
        before_target = files_under(self.target)
        with self.assertRaises(RuntimeError):
            server.data_directory()
        self.assertEqual(files_under(self.legacy), before_legacy)
        self.assertEqual(files_under(self.target), before_target)

    def test_active_legacy_directory_is_not_moved_before_migration_stops(self):
        self.rich_store(self.legacy)
        with closing(sqlite3.connect(self.legacy / 'juno.sqlite3')) as reader:
            reader.execute('BEGIN')
            reader.execute('SELECT * FROM documents').fetchall()
            before = files_under(self.legacy)
            with self.assertRaisesRegex(RuntimeError, 'in use'):
                server.data_directory()
            self.assertEqual(files_under(self.legacy), before)
            self.assertFalse(self.target.exists())

    def test_unrecognized_legacy_directory_does_not_create_blank_database(self):
        self.legacy.mkdir()
        (self.legacy / 'unknown-synthetic-data.txt').write_text('Preserve this synthetic file.')
        before = files_under(self.legacy)
        with self.assertRaises(RuntimeError):
            server.data_directory()
        self.assertEqual(files_under(self.legacy), before)
        self.assertFalse(self.target.exists())
        self.assertFalse((self.legacy / 'juno.sqlite3').exists())

    def test_corrupt_legacy_database_is_not_replaced_or_moved(self):
        self.legacy.mkdir()
        (self.legacy / 'juno.sqlite3').write_bytes(b'SYNTHETIC_INVALID_DATABASE')
        before = files_under(self.legacy)
        with self.assertRaises((RuntimeError, sqlite3.DatabaseError)):
            server.data_directory()
        self.assertEqual(files_under(self.legacy), before)
        self.assertFalse(self.target.exists())

    def test_unrecognized_legacy_schema_is_not_repaired_into_empty_store(self):
        self.legacy.mkdir()
        with closing(sqlite3.connect(self.legacy / 'juno.sqlite3')) as db:
            db.execute('CREATE TABLE unrelated (value TEXT)')
            db.execute("INSERT INTO unrelated VALUES ('Synthetic preserved row')")
        before = files_under(self.legacy)
        with self.assertRaises(RuntimeError):
            server.data_directory()
        self.assertEqual(files_under(self.legacy), before)
        self.assertFalse(self.target.exists())


class DatabaseNameMigrationTests(unittest.TestCase):
    def setUp(self):
        scratch = tempfile.TemporaryDirectory()
        self.addCleanup(scratch.cleanup)
        self.directory = Path(scratch.name)
        self.store = prd_store.Store(self.directory)
        example = json.loads(EXAMPLE_PATH.read_text())
        doc = self.store.create('Fictional migration PRD', True, imported=example)
        for requirement in doc['sections']['requirements']:
            requirement['proposed'] = False
        doc = self.store.mutate(doc['id'], doc['revision'], candidate=doc)
        doc = self.store.mutate(doc['id'], doc['revision'], action='review')
        self.doc = self.store.mutate(doc['id'], doc['revision'], action='approve')
        project = self.store.create_project('Fictional migration project', True)
        self.store.link_projects(doc['id'], [], [project['id']])
        target = self.store.create('Fictional reuse destination', True)
        self.store.import_requirements(target['id'], target['revision'], self.doc['id'], self.doc['revision'], ['R-001'], True)
        verification = Verification(self.store)
        item = verification.update(doc['id'], 'R-001', {
            'expectedPrdRevision': self.doc['revision'], 'expectedRevision': 0,
            'owners': ['Engineering role'], 'proof': 'Fictional test passed.'})
        item = verification.attach(doc['id'], 'R-001', self.doc['revision'], item['revision'], 'proof.txt', b'SYNTHETIC_PROOF')
        verification.update(doc['id'], 'R-001', {
            'expectedPrdRevision': self.doc['revision'], 'expectedRevision': item['revision'],
            'status': 'Complete', 'reviewer': 'Test role'}, review=True)
        source = self.doc['sections']['requirements'][0]['behavior']
        Comments(self.store).create(doc['id'], 'R-001', {
            'expectedPrdRevision': self.doc['revision'], 'privacyConfirmed': True,
            'author': 'Product role', 'text': 'Fictional discussion.',
            'anchor': {'field': 'behavior', 'start': 0, 'end': 1, 'quote': source[:1], 'sourceText': source}})
        self.current = self.directory / 'requiro.sqlite3'
        self.legacy = self.directory / 'juno.sqlite3'
        self.store.path.rename(self.legacy)
        self.store.path = self.legacy

    def test_direct_store_migration_preserves_all_tables_and_proof_bytes(self):
        before = files_under(self.directory)
        fingerprint = server._store_fingerprint(self.directory)
        moved = prd_store.Store(self.directory)
        self.assertEqual(moved.path, self.current)
        self.assertFalse(self.legacy.exists())
        self.assertEqual(server._store_fingerprint(self.directory), fingerprint)
        self.assertEqual(moved.get(self.doc['id']), self.doc)
        expected_files = {('requiro.sqlite3' if name == 'juno.sqlite3' else name): data for name, data in before.items()}
        self.assertEqual(files_under(self.directory), expected_files)
        self.assertEqual(len(Comments(moved).get(self.doc['id'])['threads']), 1)
        self.assertEqual(Verification(moved).get(self.doc['id'])['items'][0]['status'], 'Verified')
        self.assertEqual(prd_store.Store(self.directory).get(self.doc['id']), self.doc)
        with self.assertRaises(sqlite3.OperationalError):
            self.store.get(self.doc['id'])
        self.assertFalse(self.legacy.exists(), 'A stale store must not recreate an empty legacy database.')

    def test_explicit_server_directory_migrates_before_serving(self):
        with server.make_server(self.directory, port=0) as service:
            self.assertEqual(service.store.path, self.current)
            self.assertEqual(service.store.get(self.doc['id']), self.doc)

    def test_both_names_stop_without_changing_either_file(self):
        self.current.write_bytes(b'SYNTHETIC_CONFLICT')
        before = files_under(self.directory)
        with self.assertRaisesRegex(RuntimeError, 'Both'):
            prd_store.Store(self.directory)
        self.assertEqual(files_under(self.directory), before)

    def test_recovery_files_stop_migration_without_changing_files(self):
        for name in ('juno.sqlite3', 'requiro.sqlite3'):
            for suffix in ('-wal', '-shm', '-journal'):
                sidecar = self.directory / (name + suffix)
                sidecar.write_bytes(b'SYNTHETIC_RECOVERY_FILE')
                before = files_under(self.directory)
                with self.subTest(name=name, suffix=suffix), self.assertRaisesRegex(RuntimeError, 'recovery files'):
                    prd_store.Store(self.directory)
                self.assertEqual(files_under(self.directory), before)
                sidecar.unlink()

    def test_active_reader_stops_migration_then_clean_retry_succeeds(self):
        with closing(sqlite3.connect(self.legacy)) as reader:
            reader.execute('BEGIN')
            reader.execute('SELECT * FROM documents').fetchall()
            before = files_under(self.directory)
            with self.assertRaisesRegex(RuntimeError, 'in use'):
                prd_store.Store(self.directory)
            self.assertEqual(files_under(self.directory), before)
        self.assertEqual(prd_store.Store(self.directory).get(self.doc['id']), self.doc)

    def test_legacy_recovery_files_beside_current_database_stop_startup(self):
        self.legacy.rename(self.current)
        for suffix in ('-wal', '-shm', '-journal'):
            sidecar = self.directory / ('juno.sqlite3' + suffix)
            sidecar.write_bytes(b'SYNTHETIC_RECOVERY_FILE')
            before = files_under(self.directory)
            with self.subTest(suffix=suffix), self.assertRaisesRegex(RuntimeError, 'recovery files'):
                prd_store.Store(self.directory)
            self.assertEqual(files_under(self.directory), before)
            sidecar.unlink()

    def test_collision_during_migration_never_overwrites_new_file(self):
        original_link = os.link
        def competing_start(source, destination):
            destination.write_bytes(b'SYNTHETIC_COMPETING_DATABASE')
            original_link(source, destination)
        original = self.legacy.read_bytes()
        with patch.object(prd_store.os, 'link', competing_start), self.assertRaises(FileExistsError):
            prd_store.Store(self.directory)
        self.assertEqual(self.legacy.read_bytes(), original)
        self.assertEqual(self.current.read_bytes(), b'SYNTHETIC_COMPETING_DATABASE')

    def test_invalid_existing_store_is_never_repaired_into_empty_library(self):
        for name in ('juno.sqlite3', 'requiro.sqlite3'):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / name
                path.write_bytes(b'SYNTHETIC_INVALID_DATABASE')
                before = files_under(Path(directory))
                with self.assertRaises(sqlite3.DatabaseError):
                    prd_store.Store(directory)
                self.assertEqual(files_under(Path(directory)), before)


class UiSeparationHttpTests(unittest.TestCase):
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

    def request(self, path, method='GET', body=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.http.server_port, timeout=5)
        try:
            headers = {'Content-Type': 'application/json'} if body is not None else {}
            connection.request(method, path, body=json.dumps(body) if body is not None else None,
                               headers=headers)
            response = connection.getresponse()
            return response.status, response.getheader('Content-Type'), response.read()
        finally:
            connection.close()

    def test_public_static_routes_serve_files_from_ui_directory(self):
        self.assertEqual(server.UI_ROOT, Path(server.__file__).resolve().parent / 'ui')
        for route, filename, mime in (
            ('/', 'index.html', 'text/html'),
            ('/logo.svg', 'logo.svg', 'image/svg+xml'),
            ('/app.js', 'app.js', 'text/javascript'),
            ('/prd-views.js', 'prd-views.js', 'text/javascript'),
            ('/prd-views.css', 'prd-views.css', 'text/css'),
            ('/workspace-controls.js', 'workspace-controls.js', 'text/javascript'),
            ('/theme.css', 'theme.css', 'text/css'),
            ('/requirement-status.js', 'requirement-status.js', 'text/javascript'),
            ('/style.css', 'style.css', 'text/css'),
        ):
            with self.subTest(route=route):
                status, content_type, body = self.request(route)
                self.assertEqual(status, 200)
                self.assertTrue(content_type.startswith(mime))
                self.assertEqual(body, (server.UI_ROOT / filename).read_bytes())

    def test_example_endpoint_returns_separate_fixture(self):
        status, _, body = self.request('/api/example')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), json.loads(EXAMPLE_PATH.read_text()))

    def test_prd_api_does_not_depend_on_ui_files(self):
        self.assertIs(server.Store, prd_store.Store)
        self.assertIs(server.InputError, prd_store.InputError)
        with patch.object(server, 'UI_ROOT', Path(self.directory.name) / 'missing-ui'):
            status, _, body = self.request('/api/state')
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body)['docs'], [])
            status, _, body = self.request('/api/prds', 'POST', {
                'title': 'Fictional headless list', 'privacyConfirmed': True,
            })
            self.assertEqual(status, 201)
            created = json.loads(body)
            status, _, body = self.request('/api/prds/' + created['id'])
            self.assertEqual(status, 200)
            self.assertEqual(json.loads(body), created)
            self.assertEqual(prd_store.Store(self.directory.name).get(created['id']), created)

    def test_raw_data_and_storage_source_paths_are_not_static_assets(self):
        self.http.store.create('SYNTHETIC_DATA_NOT_STATIC', True)
        for path in ('/data/prds/requiro.sqlite3', '/requiro.sqlite3', '/ui/../../data/prds/requiro.sqlite3',
                     '/data/prds/juno.sqlite3', '/.juno-data/juno.sqlite3',
                     '/juno.sqlite3', '/prd_store.py', '/ui/../../data/prds/juno.sqlite3',
                     '/%2e%2e/data/prds/juno.sqlite3'):
            with self.subTest(path=path):
                status, _, body = self.request(path)
                self.assertEqual(status, 404)
                self.assertNotIn(b'SQLite format', body)
                self.assertNotIn(b'SYNTHETIC_DATA_NOT_STATIC', body)


if __name__ == '__main__':
    unittest.main()
