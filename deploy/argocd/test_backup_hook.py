import json
import gzip
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import backup_hook as module

OLD = 'localhost/trek:sha-' + 'a' * 40
IMAGE = 'ghcr.io/mnlauaa/trek@sha256:' + 'b' * 64
SHA = 'c' * 40


class API:
    def __init__(self):
        self.image = OLD
        self.replicas = 1
        self.scales = []
        self.digest = IMAGE.split('@')[1]
        self.volume_path = '/srv/trek/'

    def deployment(self):
        return {'metadata': {'generation': 1}, 'spec': {'replicas': self.replicas, 'template': {'spec': {
            'containers': [{'image': self.image}], 'volumes': [
                {'name': name, 'persistentVolumeClaim': {'claimName': 'trek-' + name}}
                for name in ('data', 'uploads')]} }},
            'status': {'observedGeneration': 1, 'updatedReplicas': self.replicas, 'availableReplicas': self.replicas}}

    def scale(self, replicas):
        self.scales.append(replicas)
        self.replicas = replicas

    def pods(self):
        if self.replicas == 0:
            return []
        return [{'metadata': {}, 'spec': {'containers': [{'image': self.image}]},
                 'status': {'containerStatuses': [{'ready': True, 'imageID': 'ghcr.io/mnlauaa/trek@' + self.digest}]}}]

    def claim(self, name):
        return {'status': {'phase': 'Bound'}, 'spec': {'volumeName': 'trek-' + name}, 'metadata': {'uid': name}}

    def volume(self, name):
        return {'spec': {'local': {'path': self.volume_path + name}, 'claimRef': {'uid': name},
                         'persistentVolumeReclaimPolicy': 'Retain'}}

    def health(self):
        return None


class BackupHookTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)
        self.root, self.data, self.backups = [self.path / part for part in ('state', 'app', 'backups')]
        for path in (self.root, self.backups, self.data / 'data', self.data / 'uploads'):
            path.mkdir(parents=True)
        (self.data / 'data' / 'travel.db').write_bytes(b'sqlite fixture')
        (self.data / 'data' / '.encryption_key').write_text('hidden fixture')
        (self.data / 'uploads' / 'photo.jpg').write_bytes(b'upload fixture')
        (self.root / 'state.json').write_text(json.dumps({'phase': 'healthy', 'image': OLD, 'last_success': 'a' * 40}))
        self.api = API()
        self.hook = self.reload()

    def reload(self):
        return module.Hook(self.api, IMAGE, SHA, self.root, self.data, self.backups)

    def prepare(self):
        with patch.object(module.shutil, 'disk_usage') as disk:
            disk.return_value.free = 100 * 1024**3
            self.hook.pre()

    def test_complete_backup_includes_uploads_hidden_key_and_metadata(self):
        self.prepare()
        state = self.reload().state
        self.assertEqual(state['phase'], 'prepared')
        self.assertEqual(self.api.scales, [0])
        archive = Path(state['backup'])
        with tarfile.open(archive) as stream:
            self.assertEqual(stream.extractfile('data/.encryption_key').read(), b'hidden fixture')
            self.assertEqual(stream.extractfile('uploads/photo.jpg').read(), b'upload fixture')
        self.assertEqual(module.validate_archive(archive), state['backup_sha256'])
        self.assertEqual(archive.stat().st_mode & 0o777, 0o600)
        metadata = json.loads(archive.with_suffix('.gz.json').read_text())
        self.assertEqual(metadata['previous_image'], OLD)
        self.assertEqual(metadata['candidate_image'], IMAGE)
        self.api.image, self.api.replicas = IMAGE, 1
        self.reload().post()
        self.assertEqual(self.reload().state['phase'], 'healthy')
        self.assertEqual(self.reload().state['image'], IMAGE)

    def test_blocked_pre_preserves_backup_and_never_scales_up(self):
        self.prepare()
        self.hook.fail()
        archive = self.reload().state['backup']
        with self.assertRaisesRegex(RuntimeError, 'operator recovery'):
            self.reload().pre()
        self.reload().fail()
        self.assertEqual(self.reload().state['backup'], archive)
        self.assertNotIn(1, self.api.scales)

    def test_backup_failure_leaves_durable_quiescing_then_blocks(self):
        with patch.object(module, 'validate_archive', side_effect=RuntimeError('corrupt archive')):
            with self.assertRaisesRegex(RuntimeError, 'corrupt'):
                self.prepare()
        self.assertEqual(self.reload().state['phase'], 'quiescing')
        self.reload().fail()
        self.assertEqual(self.reload().state['phase'], 'blocked')
        self.assertEqual(self.api.replicas, 0)
        self.assertFalse(list(self.backups.glob('*.tar.gz')))

    def test_interruption_after_backup_refuses_overwrite(self):
        self.prepare()
        before = set(self.backups.iterdir())
        with self.assertRaisesRegex(RuntimeError, 'operator recovery'):
            self.reload().pre()
        self.assertEqual(set(self.backups.iterdir()), before)

    def test_image_digest_mismatch_cannot_commit_healthy(self):
        self.prepare()
        self.api.image, self.api.replicas = IMAGE, 1
        self.api.digest = 'sha256:' + 'e' * 64
        with self.assertRaisesRegex(RuntimeError, 'digest differs'):
            self.reload().post()
        self.reload().fail()
        self.assertEqual(self.reload().state['phase'], 'blocked')
        self.assertEqual(self.api.replicas, 0)

    def test_post_without_prepared_backup_refuses(self):
        with self.assertRaisesRegex(RuntimeError, 'No prepared'):
            self.hook.post()
        self.assertEqual(self.reload().state['phase'], 'healthy')

    def test_wrong_pv_rejected_before_quiescing(self):
        self.api.volume_path = '/wrong/'
        with self.assertRaisesRegex(RuntimeError, 'binding/path'):
            self.prepare()
        self.assertEqual(self.api.scales, [])
        self.assertEqual(self.reload().state['phase'], 'healthy')

    def test_state_fsync_failure_prevents_scale_down(self):
        with patch.object(module.os, 'fsync', side_effect=OSError('disk failure')):
            with self.assertRaisesRegex(OSError, 'disk failure'):
                self.prepare()
        self.assertEqual(self.api.scales, [])
        self.assertEqual(self.reload().state['phase'], 'healthy')

    def test_healthy_fail_is_no_op(self):
        self.hook.fail()
        self.assertEqual(self.api.scales, [])
        self.assertEqual(self.reload().state['phase'], 'healthy')

    def test_disk_shortage_keeps_old_app_running(self):
        with patch.object(module.shutil, 'disk_usage') as disk:
            disk.return_value.free = 0
            with self.assertRaisesRegex(RuntimeError, 'Insufficient disk'):
                self.hook.pre()
        self.assertEqual(self.api.scales, [])

    def test_archive_missing_uploads_rejected(self):
        archive = self.backups / 'incomplete.tar.gz'
        with tarfile.open(archive, 'w:gz') as stream:
            stream.add(self.data / 'data', arcname='data')
        with self.assertRaisesRegex(RuntimeError, 'missing'):
            module.validate_archive(archive)

    def test_archive_corruption_rejected(self):
        archive = self.backups / 'corrupt.tar.gz'
        archive.write_bytes(b'invalid compressed archive')
        with self.assertRaises((tarfile.ReadError, gzip.BadGzipFile)):
            module.validate_archive(archive)

    def test_failure_stops_candidate_even_if_state_disk_fails(self):
        self.prepare()
        self.api.image, self.api.replicas = IMAGE, 1
        with patch.object(module, 'write_json', side_effect=OSError('disk failure')):
            with self.assertRaisesRegex(OSError, 'disk failure'):
                self.reload().fail()
        self.assertEqual(self.api.replicas, 0)
        self.assertEqual(self.reload().state['phase'], 'prepared')

    def test_candidate_must_be_immutable(self):
        with self.assertRaisesRegex(RuntimeError, 'pinned'):
            module.Hook(self.api, 'ghcr.io/mnlauaa/trek:latest', SHA, self.root, self.data, self.backups)


if __name__ == '__main__':
    unittest.main()
