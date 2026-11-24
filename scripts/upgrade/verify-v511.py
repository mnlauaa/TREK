#!/usr/bin/env python3
"""Verify pinned release versions and immutable migration sources in a v5.1.1 checkout."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
UPSTREAM = '95d62b7a02f3209d927504f5d21b3efe5065d2bc'
FORK = '020a51a00968052f1bf1de16c9533b8727a8edcd'


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


for package in ['package.json', 'client/package.json', 'server/package.json', 'shared/package.json', 'plugin-sdk/package.json']:
    shipped = json.loads(git('show', f'{UPSTREAM}:{package}'))['version']
    current = json.loads((ROOT / package).read_text())['version']
    if current != shipped:
        raise SystemExit(f'{package}: expected upstream version {shipped}, got {current}')

prefix = 'server/src/db/migrations/'
checked = set()
for revision in [UPSTREAM, FORK]:
    paths = git('ls-tree', '-r', '--name-only', revision, '--', prefix).decode().splitlines()
    for path in paths:
        expected = git('show', f'{revision}:{path}')
        if not (ROOT / path).is_file() or (ROOT / path).read_bytes() != expected:
            raise SystemExit(f'Published migration changed or missing: {revision}:{path}')
        checked.add(path)

print(f'PASS: release versions match upstream; {len(checked)} published migrations preserved byte-for-byte.')
