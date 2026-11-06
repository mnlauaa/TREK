#!/usr/bin/env python3
"""Boot an image with isolated synthetic release data and check retained values."""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
import subprocess
import time
import uuid


def command(*args, **kwargs):
    return subprocess.check_output(args, text=True, **kwargs)


def rehearse(image, output):
    repo = Path(__file__).resolve().parents[2]
    output.mkdir(parents=True, exist_ok=False)
    workload = json.loads((repo / 'deploy/argocd/workload.json').read_text())
    deployment = next(item for item in workload if item['kind'] == 'Deployment')
    pod = deployment['spec']['template']['spec']
    app = pod['containers'][0]
    image_id = command('docker', 'image', 'inspect', image, '--format', '{{.Id}}').strip()
    results = {'image': image_id}
    queries = [
        'SELECT id, applied_at FROM fork_schema_migrations ORDER BY id',
        'SELECT id, timing_json FROM days ORDER BY id',
        'SELECT id, day_id, place_id, stay_minutes, times_explicit, assignment_time, assignment_end_time FROM day_assignments ORDER BY id',
        'SELECT id, reservation_time, reservation_end_time FROM reservations ORDER BY id',
        'SELECT id, place_time, end_time, duration_minutes FROM places ORDER BY id',
    ]
    for source in ['fresh', 'release']:
        data = output / source / 'data'
        uploads = output / source / 'uploads'
        data.mkdir(parents=True)
        uploads.mkdir()
        data.chmod(0o777)
        uploads.chmod(0o777)
        database = data / 'trek.db'
        expected = None
        if source == 'release':
            fixture = repo / 'server/tests/fixtures/legacy/fork-v244-itinerary.sql'
            with sqlite3.connect(database) as db:
                db.executescript(fixture.read_text())
                expected = [db.execute(query).fetchall() for query in queries]
            database.chmod(0o666)
        name = 'trek-release-rehearsal-' + uuid.uuid4().hex[:12]
        user = pod['securityContext']
        command('docker', 'run', '-d', '--name', name, '--network', 'none',
                '--read-only', '--tmpfs', '/tmp', '--cap-drop', 'ALL',
                '--security-opt', 'no-new-privileges', '--user', f"{user['runAsUser']}:{user['runAsGroup']}",
                '-v', f'{data}:/app/data', '-v', f'{uploads}:/app/uploads',
                '-e', 'NODE_ENV=production', '-e', 'TREK_SERVICES=off',
                '-e', 'TREK_DB_FILE=/app/data/trek.db',
                '-e', 'ENCRYPTION_KEY=' + '0' * 64,
                '-e', 'APP_URL=https://trek.example.invalid',
                '-w', app['workingDir'], '--entrypoint', app['command'][0],
                image_id, *app['command'][1:])
        try:
            deadline = time.monotonic() + 60
            while time.monotonic() < deadline:
                try:
                    health = json.loads(command('docker', 'exec', name, 'node', '-e',
                        "fetch('http://127.0.0.1:3000/api/health').then(async r=>console.log(JSON.stringify({status:r.status,body:await r.json(),node:process.version,uid:process.getuid()})))",
                        stderr=subprocess.DEVNULL))
                    if health['status'] == 200:
                        break
                except subprocess.CalledProcessError:
                    pass
                time.sleep(1)
            else:
                raise RuntimeError(f'{source} fixture did not become healthy within 60 seconds')
        finally:
            command('docker', 'stop', '-t', '10', name)
            (output / source / 'container.log').write_text(command('docker', 'logs', name, stderr=subprocess.STDOUT))
        before = hashlib.sha256(database.read_bytes()).hexdigest()
        audit = command('node', '--import', 'tsx', 'scripts/audit-v4-upgrade.ts',
                        '--db', str(database), '--require-current', cwd=repo / 'server')
        (output / source / 'audit.json').write_text(audit)
        assert hashlib.sha256(database.read_bytes()).hexdigest() == before, 'Audit changed database'
        with sqlite3.connect(f'file:{database}?mode=ro', uri=True) as db:
            assert db.execute('PRAGMA integrity_check').fetchone() == ('ok',)
            assert db.execute('PRAGMA foreign_key_check').fetchall() == []
            if expected is not None:
                assert [db.execute(query).fetchall() for query in queries] == expected, 'Release values changed'
                assert len(list(data.glob('pre-migrate-legacy-244-*.db'))) == 1, 'Missing source snapshot'
        results[source] = {'health': health, 'audit_read_only_sha256': before,
                           'preserved_queries': queries if expected is not None else []}
        (output / 'result.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(results, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--image', required=True)
    parser.add_argument('--output', type=Path, required=True, help='New directory for disposable data and receipts')
    args = parser.parse_args()
    rehearse(args.image, args.output.resolve())
