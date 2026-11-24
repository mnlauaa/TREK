#!/usr/bin/env python3
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.request

REPO = 'mnlauaa/TREK'


def api(path, method='GET', body=None):
    request = urllib.request.Request('https://api.github.com/repos/' + REPO + '/' + path,
        data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
                 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def main():
    sha = os.environ['SOURCE_SHA']
    if not re.fullmatch('[a-f0-9]{40}', sha):
        raise ValueError('Invalid source SHA')
    if api('git/ref/heads/release')['object']['sha'] != sha:
        print('Release advanced; skipping stale image promotion')
        return
    content = Path('/tmp/trek-manifests.json').read_text()
    json.loads(content)
    tree = api('git/trees', 'POST', {'tree': [
        {'path': 'deploy/gitops/manifests.json', 'mode': '100644', 'type': 'blob', 'content': content}]})
    try:
        parent = api('git/ref/heads/gitops')['object']['sha']
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        parent = None
    commit = api('git/commits', 'POST', {'message': 'Deploy release ' + sha,
        'tree': tree['sha'], 'parents': [parent] if parent else []})
    if api('git/ref/heads/release')['object']['sha'] != sha:
        print('Release advanced; leaving GitOps unchanged')
        return
    if parent:
        api('git/refs/heads/gitops', 'PATCH', {'sha': commit['sha'], 'force': False})
    else:
        api('git/refs', 'POST', {'ref': 'refs/heads/gitops', 'sha': commit['sha']})
    payload = json.dumps({'ref': 'refs/heads/gitops', 'before': parent or '0' * 40,
        'after': commit['sha'], 'deleted': False,
        'repository': {'id': 1325418586, 'full_name': REPO, 'name': 'TREK',
            'html_url': 'https://github.com/' + REPO,
            'clone_url': 'https://github.com/' + REPO + '.git',
            'default_branch': 'main', 'owner': {'name': 'mnlauaa', 'login': 'mnlauaa'}}}).encode()
    signature = hmac.new(os.environ['ARGOCD_WEBHOOK_SECRET'].encode(), payload, hashlib.sha256).hexdigest()
    request = urllib.request.Request('https://deploy.sam-lau.dev/hooks/trek-release', data=payload,
        headers={'Content-Type': 'application/json', 'X-GitHub-Event': 'push',
                 'X-Hub-Signature-256': 'sha256=' + signature, 'User-Agent': 'GitHub-Actions-TREK'})
    with urllib.request.urlopen(request, timeout=60) as response:
        print('Promoted', sha, 'GitOps', commit['sha'], 'webhook HTTP', response.status)


if __name__ == '__main__':
    main()
