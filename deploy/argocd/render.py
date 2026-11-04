#!/usr/bin/env python3
import json
from pathlib import Path
import re
import sys


def render(image, source_sha, hook_image):
    if not re.fullmatch(r'ghcr\.io/mnlauaa/trek@sha256:[a-f0-9]{64}', image):
        raise ValueError('Expected immutable TREK image digest')
    if not re.fullmatch(r'[a-f0-9]{40}', source_sha):
        raise ValueError('Expected source commit SHA')
    if not re.fullmatch(r'docker\.io/library/python@sha256:[a-f0-9]{64}', hook_image):
        raise ValueError('Expected pinned Python hook image')
    resources = json.loads(Path(__file__).with_name('workload.json').read_text())
    deployment = next(r for r in resources if r['kind'] == 'Deployment')
    deployment['metadata'].setdefault('annotations', {})['trek.deploy/revision'] = source_sha
    deployment['spec']['template']['spec']['containers'][0].update(image=image, imagePullPolicy='IfNotPresent')
    for phase, mode in [('PreSync', 'pre'), ('PostSync', 'post'), ('SyncFail', 'fail')]:
        resources.append({
            'apiVersion': 'batch/v1', 'kind': 'Job',
            'metadata': {'name': 'trek-backup-' + mode, 'namespace': 'trek', 'annotations': {
                'argocd.argoproj.io/hook': phase,
                'argocd.argoproj.io/hook-delete-policy': 'BeforeHookCreation'}},
            'spec': {'backoffLimit': 0, 'activeDeadlineSeconds': 2400,
                'template': {'spec': {
                    'serviceAccountName': 'trek-backup', 'restartPolicy': 'Never',
                    'nodeSelector': {'kubernetes.io/hostname': 'ip-172-26-7-24'},
                    'containers': [{
                        'name': 'backup', 'image': hook_image,
                        'command': ['python3', '/opt/trek-gitops/backup_hook.py', mode],
                        'env': [{'name': 'CANDIDATE_IMAGE', 'value': image},
                                {'name': 'SOURCE_SHA', 'value': source_sha},
                                {'name': 'PYTHONDONTWRITEBYTECODE', 'value': '1'}],
                        'resources': {'requests': {'cpu': '50m', 'memory': '64Mi'},
                                      'limits': {'cpu': '500m', 'memory': '256Mi'}},
                        'securityContext': {'allowPrivilegeEscalation': False,
                                            'readOnlyRootFilesystem': True,
                                            'capabilities': {'drop': ['ALL'], 'add': ['DAC_READ_SEARCH']}},
                        'volumeMounts': [
                            {'name': 'script', 'mountPath': '/opt/trek-gitops', 'readOnly': True},
                            {'name': 'data', 'mountPath': '/srv/trek/data', 'readOnly': True},
                            {'name': 'uploads', 'mountPath': '/srv/trek/uploads', 'readOnly': True},
                            {'name': 'backups', 'mountPath': '/var/backups/trek'},
                            {'name': 'state', 'mountPath': '/var/lib/trek-gitops'}]}],
                    'volumes': [
                        {'name': 'script', 'hostPath': {'path': '/opt/trek-gitops', 'type': 'Directory'}},
                        {'name': 'data', 'persistentVolumeClaim': {'claimName': 'trek-data', 'readOnly': True}},
                        {'name': 'uploads', 'persistentVolumeClaim': {'claimName': 'trek-uploads', 'readOnly': True}},
                        {'name': 'backups', 'hostPath': {'path': '/var/backups/trek', 'type': 'Directory'}},
                        {'name': 'state', 'hostPath': {'path': '/var/lib/trek-gitops', 'type': 'Directory'}}]}}}})
    return {'apiVersion': 'v1', 'kind': 'List', 'items': resources}


if __name__ == '__main__':
    print(json.dumps(render(*sys.argv[1:]), indent=2))
