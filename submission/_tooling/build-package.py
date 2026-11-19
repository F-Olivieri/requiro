"""Build and audit the local course-source archive; never read runtime stores."""

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import re
import stat
import tempfile
from urllib.parse import unquote, urlsplit
from zipfile import ZipFile, ZIP_DEFLATED, ZipInfo


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'submission' / 'requiro-course-source.zip'
DIRECTORIES = {
    '01-prompting', '02-prototype', '03-harness-prd', '04-agentic-workflows',
    '05-evals', '06-metrics', 'examples', 'prd-system', '.devcontainer',
}
EXTENSIONS = {'.md', '.py', '.mjs', '.js', '.html', '.css', '.svg', '.json', '.csv', '.txt'}
ROOT_FILES = {'README.md', '.gitignore', 'final-presentation.html'}
EVIDENCE = {
    'prototype-python-tests.txt', 'prototype-node-tests.json',
    'rubric-structure-check.txt', 'prototype-verification.json', 'feature-expansion-verification.json',
}
BLOCKED = {'data', 'attachments', '.git', '.juno-data', '__pycache__'}
SCREENSHOTS = {'assets/screenshots/' + name for name in (
    'document-view.png', 'requirements-table.png', 'suggestion-review.png',
    'comments.png', 'delivery-review.png', 'version-history.png', 'projects-reuse.png')}
REQUIRED = ROOT_FILES | {
    '01-prompting/skill-file.md', '02-prototype/prototype.md',
    '02-prototype/app/server.py', '02-prototype/app/ui/index.html',
    '03-harness-prd/prd.md', '04-agentic-workflows/agent-control-panel.md',
    '05-evals/human-rubric.md', '06-metrics/metrics-plan.md',
    '06-metrics/reflection.md', '.devcontainer/devcontainer.json',
    'submission/_tooling/build-package.py',
} | {'submission/evidence/' + name for name in EVIDENCE} | SCREENSHOTS


def allowed(name):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or set(path.parts) & BLOCKED:
        return False
    if path.name in {'AGENTS.md', '.DS_Store'}:
        return False
    if name in ROOT_FILES or name == 'submission/_tooling/build-package.py':
        return True
    if path.parts[:2] == ('submission', 'evidence'):
        return len(path.parts) == 3 and path.name in EVIDENCE
    if path.parts[:2] == ('assets', 'screenshots'):
        return name in SCREENSHOTS
    return path.parts[0] in DIRECTORIES and path.suffix in EXTENSIONS


def select_files(root):
    selected = []
    for directory, subdirs, files in os.walk(root, followlinks=False):
        relative = Path(directory).relative_to(root)
        subdirs[:] = [name for name in subdirs
                      if name not in BLOCKED and not (Path(directory) / name).is_symlink()
                      and (relative.parts or name in DIRECTORIES | {'submission', 'assets'})
                      and (relative != Path('submission') or name in {'evidence', '_tooling'})
                      and (relative != Path('assets') or name == 'screenshots')
                      and relative != Path('assets/screenshots')]
        for name in files:
            path = Path(directory) / name
            if not path.is_symlink() and allowed(path.relative_to(root).as_posix()):
                selected.append(path)
    return sorted(selected)


def self_check():
    for name in ['data/prds/private.json', '02-prototype/app/.juno-data/private.json',
                 '02-prototype/app/__pycache__/test.py', 'examples/attachments/private.txt',
                 'AGENTS.md', '../README.md', '/README.md', 'submission/old.zip',
                 'submission/evidence/unreviewed.json', '02-prototype/app/store.sqlite3',
                 'assets/unreviewed.png', 'assets/screenshots/reply.js',
                 'assets/screenshots/nested/document-view.png',
                 'assets/screenshots/document-view.jpg', 'assets/screenshots/other.png',
                 'assets/screenshots/requirements-table.jpg',
                 'assets/screenshots/suggestion-review.jpg',
                 'assets/screenshots/other.jpg', '02-prototype/app/document-view.png']:
        assert not allowed(name), name
    assert allowed('02-prototype/app/server.py')
    assert len(SCREENSHOTS) == 7
    assert all(allowed(name) for name in SCREENSHOTS)
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / '01-prompting').mkdir()
        (root / '01-prompting' / 'secret.md').symlink_to('/nonexistent-package-test')
        (root / 'data').mkdir()
        (root / 'data' / 'excluded.json').write_text('not course content')
        (root / 'README.md').write_text('fixture')
        (root / 'assets' / 'screenshots').mkdir(parents=True)
        for name in SCREENSHOTS:
            (root / name).write_bytes(b'PNG selection fixture')
        (root / 'assets' / 'screenshots' / 'document-view.jpg').write_bytes(b'excluded fixture')
        (root / 'assets' / 'excluded.jpg').write_bytes(b'excluded fixture')
        assert {path.relative_to(root).as_posix() for path in select_files(root)} == {'README.md'} | SCREENSHOTS


def build():
    self_check()
    files = select_files(ROOT)
    names = {path.relative_to(ROOT).as_posix() for path in files}
    assert REQUIRED <= names, f'Missing required files: {sorted(REQUIRED - names)}'
    content = {path.relative_to(ROOT).as_posix(): path.read_bytes() for path in files}
    screenshots = [name for name in content if name.startswith('assets/screenshots/')]
    assert set(screenshots) == SCREENSHOTS, 'Include exactly the seven named app screenshots'
    private_home = re.compile(r'/(?:' + 'Users' + r'|' + 'home' + r')/[^\s<>\"\']+')
    employer = re.compile(r'\b(?:' + 'cis' + 'co' + '|' + 'web' + 'ex' + r')\b', re.I)
    dead_links = []
    checked_links = 0
    for name, data in content.items():
        if name in screenshots:
            assert data.startswith(b'\x89PNG\r\n\x1a\n') and data.endswith(b'\x00\x00\x00\x00IEND\xaeB`\x82'), f'Invalid PNG signature: {name}'
            continue
        text = data.decode('utf-8')
        assert not private_home.search(text), f'Personal machine path in {name}'
        assert not employer.search(text), f'Employer identifier in {name}'
        if not name.endswith('.md'):
            continue
        for target in re.findall(r'!?\[[^\]]*\]\(([^)\n]+)\)', text):
            target = target.strip().split(' "', 1)[0].strip('<>')
            parsed = urlsplit(target)
            if parsed.scheme or parsed.netloc or not parsed.path:
                continue
            resolved = posixpath.normpath(posixpath.join(posixpath.dirname(name), unquote(parsed.path)))
            checked_links += 1
            if resolved not in names:
                dead_links.append({'source': name, 'target': target, 'resolved': resolved})
    assert not dead_links, f'Dead package-relative Markdown links: {dead_links}'
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    temporary = OUTPUT.with_suffix('.tmp')
    try:
        with ZipFile(temporary, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
            for name, data in sorted(content.items()):
                info = ZipInfo('requiro/' + name, date_time=(2026, 11, 19, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                archive.writestr(info, data)
        assert temporary.stat().st_size < 10_000_000, 'Archive exceeds course file-size limit'
        with ZipFile(temporary) as archive:
            assert archive.testzip() is None, 'ZIP CRC failure'
            for info in archive.infolist():
                path = PurePosixPath(info.filename)
                assert path.parts[0] == 'requiro' and not path.is_absolute() and '..' not in path.parts
                assert not stat.S_ISLNK(info.external_attr >> 16)
                assert allowed(PurePosixPath(*path.parts[1:]).as_posix())
        temporary.replace(OUTPUT)
    finally:
        temporary.unlink(missing_ok=True)
    report = {
        'builtAt': datetime.now(timezone.utc).isoformat(),
        'archive': OUTPUT.name,
        'bytes': OUTPUT.stat().st_size,
        'sha256': hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
        'fileCount': len(files),
        'crc': 'pass', 'selfCheck': 'pass',
        'packageRelativeMarkdownLinksChecked': checked_links,
        'deadLinks': dead_links,
        'excluded': sorted(BLOCKED | {'AGENTS.md', '.DS_Store', '*.zip', 'unallowlisted files'}),
        'privacyScan': 'No personal home paths or employer identifiers in included UTF-8 source.',
        'screenshots': {'files': screenshots, 'signatureCheck': 'pass',
                        'scanLimit': 'PNG pixels and metadata bypass the UTF-8 text scan; review separately.'},
        'files': [{'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
                  for name, data in sorted(content.items())],
    }
    (OUTPUT.parent / 'package-audit.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({key: report[key] for key in ['archive', 'bytes', 'fileCount', 'crc', 'selfCheck',
                                                 'packageRelativeMarkdownLinksChecked', 'deadLinks']}, indent=2))


if __name__ == '__main__':
    build()
