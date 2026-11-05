import unittest
from render import render

class RenderTests(unittest.TestCase):
    def test_backup_gate_and_persistent_storage(self):
        image = 'ghcr.io/mnlauaa/trek@sha256:' + 'a'*64
        items = render(image, 'b'*40, 'docker.io/library/python@sha256:'+'c'*64)['items']
        deployment = next(x for x in items if x['kind'] == 'Deployment')
        self.assertEqual(deployment['spec']['strategy']['type'], 'Recreate')
        self.assertEqual(deployment['spec']['replicas'], 1)
        self.assertEqual(deployment['spec']['template']['spec']['containers'][0]['image'], image)
        self.assertFalse(any(x['kind'] in ['Secret','PersistentVolume','PersistentVolumeClaim'] for x in items))
        hooks = [x for x in items if x['kind']=='Job']
        self.assertEqual({x['metadata']['annotations']['argocd.argoproj.io/hook'] for x in hooks}, {'PreSync','PostSync','SyncFail'})
        for hook in hooks:
            spec = hook['spec']['template']['spec']
            self.assertEqual(spec['serviceAccountName'],'trek-backup')
            if hook['metadata']['annotations']['argocd.argoproj.io/hook'] == 'PreSync':
                self.assertEqual(spec['initContainers'][0]['image'],image)
                self.assertEqual(spec['initContainers'][0]['command'],['/usr/bin/true'])
                self.assertNotIn('volumeMounts',spec['initContainers'][0])
            self.assertEqual(hook['spec']['backoffLimit'],0)
            mounts = {m['name']:m for m in spec['containers'][0]['volumeMounts']}
            self.assertTrue(mounts['data']['readOnly'])
            self.assertTrue(mounts['uploads']['readOnly'])
            self.assertNotIn('app',hook['spec']['template'].get('metadata',{}).get('labels',{}))

    def test_release_runtime_stays_unprivileged(self):
        items = render('ghcr.io/mnlauaa/trek@sha256:' + 'a'*64,
                       'b'*40, 'docker.io/library/python@sha256:' + 'c'*64)['items']
        deployment = next(item for item in items if item['kind'] == 'Deployment')
        pod = deployment['spec']['template']['spec']
        self.assertFalse(pod['automountServiceAccountToken'])
        self.assertTrue(pod['securityContext']['runAsNonRoot'])
        self.assertEqual(pod['securityContext']['runAsUser'], 1000)
        self.assertEqual(pod['securityContext']['seccompProfile']['type'], 'RuntimeDefault')
        app = pod['containers'][0]
        self.assertEqual(app['startupProbe']['httpGet']['path'], '/api/health')
        startup_budget = app['startupProbe']['failureThreshold'] * app['startupProbe']['periodSeconds']
        self.assertEqual(startup_budget, 600)
        self.assertGreater(deployment['spec']['progressDeadlineSeconds'], startup_budget)
        self.assertFalse(app['securityContext']['allowPrivilegeEscalation'])
        self.assertEqual(app['securityContext']['capabilities']['drop'], ['ALL'])
        self.assertEqual(app['workingDir'], '/app/server')
        self.assertEqual(app['command'], ['/usr/bin/dumb-init', '--', 'node',
                                         '--require', 'tsconfig-paths/register', 'dist/index.js'])
        self.assertTrue(any(item['kind'] == 'NetworkPolicy' for item in items))

    def test_mutable_image_rejected(self):
        with self.assertRaises(ValueError):
            render('ghcr.io/mnlauaa/trek:latest','b'*40,'docker.io/library/python@sha256:'+'c'*64)
