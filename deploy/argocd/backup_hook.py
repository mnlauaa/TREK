#!/usr/bin/env python3
import fcntl
import hashlib
import gzip
import json
import os
from pathlib import Path
import re
import shutil
import ssl
import sys
import tarfile
import time
import urllib.request


class Kubernetes:
    def __init__(self):
        account = Path('/var/run/secrets/kubernetes.io/serviceaccount')
        self.token = (account / 'token').read_text().strip()
        self.context = ssl.create_default_context(cafile=str(account / 'ca.crt'))
        self.base = 'https://kubernetes.default.svc'

    def request(self, path, patch=None):
        headers = {'Authorization': 'Bearer ' + self.token}
        data = None
        if patch is not None:
            headers['Content-Type'] = 'application/merge-patch+json'
            data = json.dumps(patch).encode()
        request = urllib.request.Request(self.base + path, data=data, headers=headers,
                                         method='PATCH' if patch is not None else 'GET')
        with urllib.request.urlopen(request, context=self.context, timeout=30) as response:
            return json.load(response)

    def deployment(self):
        return self.request('/apis/apps/v1/namespaces/trek/deployments/trek')

    def scale(self, replicas):
        return self.request('/apis/apps/v1/namespaces/trek/deployments/trek/scale',
                            {'spec': {'replicas': replicas}})

    def pods(self):
        return self.request('/api/v1/namespaces/trek/pods?labelSelector=app%3Dtrek')['items']

    def claim(self, name):
        return self.request('/api/v1/namespaces/trek/persistentvolumeclaims/trek-' + name)

    def volume(self, name):
        return self.request('/api/v1/persistentvolumes/trek-' + name)

    def health(self):
        with urllib.request.urlopen('http://trek.trek.svc.cluster.local:3000/api/health',
                                    timeout=15) as response:
            if response.status != 200 or json.load(response).get('status') != 'ok':
                raise RuntimeError('Application health check failed')


def fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_json(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as stream:
        os.chmod(temporary, 0o600)
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    fsync_directory(path.parent)


def validate_archive(path):
    with gzip.open(path, 'rb') as stream:
        while stream.read(1024 * 1024):
            pass
    roots = set()
    with tarfile.open(path, 'r:gz') as archive:
        for member in archive:
            roots.add(member.name.split('/')[0])
            if member.isfile():
                with archive.extractfile(member) as stream:
                    while stream.read(1024 * 1024):
                        pass
    if roots != {'data', 'uploads'}:
        raise RuntimeError('Backup is missing a persistent directory')
    with path.open('rb') as stream:
        checksum = hashlib.sha256()
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            checksum.update(chunk)
        digest = checksum.hexdigest()
        os.fsync(stream.fileno())
    return digest


class Hook:
    def __init__(self, api, image, sha, root=Path('/var/lib/trek-gitops'),
                 data=Path('/srv/trek'), backups=Path('/var/backups/trek')):
        if not re.fullmatch(r'ghcr\.io/mnlauaa/trek@sha256:[0-9a-f]{64}', image):
            raise RuntimeError('Candidate must be a pinned TREK image digest')
        if not re.fullmatch(r'[0-9a-f]{40}', sha):
            raise RuntimeError('Source revision must be a full commit SHA')
        self.api, self.image, self.sha = api, image, sha
        self.root, self.data, self.backups = root, data, backups
        self.state_path = root / 'state.json'
        self.state = json.loads(self.state_path.read_text())
        if self.state.get('phase') not in {'healthy', 'quiescing', 'prepared', 'blocked'}:
            raise RuntimeError('Invalid deployment state; operator recovery required')
        if not isinstance(self.state.get('image'), str) or not self.state['image']:
            raise RuntimeError('Deployment state has no known healthy image')

    def save(self, **changes):
        state = {**self.state, **changes, 'updated_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        write_json(self.state_path, state)
        self.state = state

    def healthy(self, image, verify_digest=False):
        deployment = self.api.deployment()
        spec, status = deployment['spec'], deployment.get('status', {})
        containers = spec['template']['spec']['containers']
        if (len(containers) != 1 or containers[0]['image'] != image or spec.get('replicas') != 1
                or status.get('observedGeneration', 0) < deployment['metadata']['generation']
                or status.get('updatedReplicas') != 1 or status.get('availableReplicas') != 1):
            raise RuntimeError('Deployment does not match the healthy expected image')
        pods = self.api.pods()
        if len(pods) != 1 or pods[0]['metadata'].get('deletionTimestamp'):
            raise RuntimeError('Expected exactly one live TREK pod')
        pod = pods[0]
        containers = pod['spec']['containers']
        statuses = pod.get('status', {}).get('containerStatuses', [])
        if (len(containers) != 1 or containers[0]['image'] != image or len(statuses) != 1
                or not statuses[0].get('ready') or not statuses[0].get('imageID')):
            raise RuntimeError('TREK pod is not ready with the expected image')
        if verify_digest:
            actual = statuses[0]['imageID'].split('@')[-1].removeprefix('containerd://').removeprefix('docker-pullable://')
            if actual != image.split('@')[1]:
                raise RuntimeError('Running image digest differs from the candidate')
        self.api.health()

    def verify_storage(self):
        for name in ('data', 'uploads'):
            claim, volume = self.api.claim(name), self.api.volume(name)
            if (claim.get('status', {}).get('phase') != 'Bound'
                    or claim['spec'].get('volumeName') != 'trek-' + name
                    or volume['spec'].get('local', {}).get('path') != '/srv/trek/' + name
                    or volume['spec'].get('claimRef', {}).get('uid') != claim['metadata']['uid']
                    or volume['spec'].get('persistentVolumeReclaimPolicy') != 'Retain'):
                raise RuntimeError('Persistent volume binding/path changed')
            path = self.data / name
            if not path.is_dir() or path.is_symlink():
                raise RuntimeError('Unexpected persistent directory')
        volumes = self.api.deployment()['spec']['template']['spec'].get('volumes', [])
        claims = {item['name']: item.get('persistentVolumeClaim', {}).get('claimName') for item in volumes}
        if claims.get('data') != 'trek-data' or claims.get('uploads') != 'trek-uploads':
            raise RuntimeError('Deployment uses unexpected persistent volumes')

    def stop(self):
        self.api.scale(0)
        deadline = time.monotonic() + 180
        while self.api.pods():
            if time.monotonic() >= deadline:
                raise RuntimeError('TREK pods did not terminate; refusing backup')
            time.sleep(2)

    def backup(self):
        name = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + self.sha[:12] + '-' + str(time.time_ns()) + '.tar.gz'
        final = self.backups / name
        temporary = final.with_suffix('.partial')
        with tarfile.open(temporary, 'w:gz', dereference=False) as archive:
            os.chmod(temporary, 0o600)
            for name in ('data', 'uploads'):
                archive.add(self.data / name, arcname=name)
        digest = validate_archive(temporary)
        os.replace(temporary, final)
        checksum = final.with_suffix('.gz.sha256')
        with checksum.open('w') as stream:
            os.chmod(checksum, 0o600)
            stream.write(digest + '  ' + final.name + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        write_json(final.with_suffix('.gz.json'), {
            'previous_image': self.state['image'], 'previous_sha': self.state.get('last_success'),
            'candidate_image': self.image, 'candidate_sha': self.sha,
            'archive': str(final), 'sha256': digest,
        })
        fsync_directory(self.backups)
        return str(final), digest

    def pre(self):
        if self.state['phase'] != 'healthy':
            raise RuntimeError('Previous transaction requires operator recovery; refusing a new backup')
        self.healthy(self.state['image'], verify_digest='@sha256:' in self.state['image'])
        self.verify_storage()
        used = sum(path.stat().st_size for path in self.data.rglob('*') if path.is_file() and not path.is_symlink())
        if shutil.disk_usage(self.backups).free < max(2 * 1024**3, 2 * used + 1024**3):
            raise RuntimeError('Insufficient disk for complete backup')
        self.save(phase='quiescing', candidate_image=self.image, candidate_sha=self.sha, error=None)
        self.stop()
        backup, digest = self.backup()
        self.save(phase='prepared', backup=backup, backup_sha256=digest)
        print('Verified offline backup ' + backup, flush=True)

    def post(self):
        if (self.state['phase'] != 'prepared' or self.state.get('candidate_image') != self.image
                or self.state.get('candidate_sha') != self.sha):
            raise RuntimeError('No prepared backup matches this deployment')
        self.verify_storage()
        self.healthy(self.image, verify_digest=True)
        self.save(phase='healthy', image=self.image, last_success=self.sha, error=None)
        print('Healthy deployment ' + self.image, flush=True)

    def fail(self):
        if self.state['phase'] == 'healthy':
            print('No interrupted transaction; preserving healthy application', flush=True)
            return
        try:
            self.save(phase='blocked', error='Argo sync failed or was interrupted; matched data/image recovery required')
        finally:
            self.stop()
        print('Blocked deployment; preserved backup ' + str(self.state.get('backup')), flush=True)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in {'pre', 'post', 'fail'}:
        raise RuntimeError('Usage: backup_hook.py pre|post|fail')
    os.umask(0o077)
    root = Path('/var/lib/trek-gitops')
    with (root / 'transaction.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        hook = Hook(Kubernetes(), os.environ['CANDIDATE_IMAGE'], os.environ['SOURCE_SHA'], root=root)
        getattr(hook, sys.argv[1])()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('TREK backup hook failed: ' + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
