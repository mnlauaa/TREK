# TREK release deployments

A push to `release` runs `.github/workflows/lightsail-release.yml`. GitHub Actions tests the backup hooks, builds the exact commit for linux/amd64, and publishes `ghcr.io/mnlauaa/trek:sha-<commit>`. It promotes the immutable image digest to the `gitops` branch only if that commit is still the current release head. Argo CD watches `deploy/gitops` on that branch. A signed webhook requests immediate refresh; Argo's periodic reconciliation catches missed notifications.

The workflow deliberately generates a GitOps branch containing only the deployment manifest. Argo does not deploy unbuilt source commits. Images must remain anonymously pullable from the public container package, matching the public source repository. No registry or Kubernetes administrator credential is stored in Actions.

## Backup and failure behavior

Argo's `PreSync` Job verifies the current app and retained PVC/PV bindings, records its transaction, scales TREK to zero, and waits for all TREK pods to terminate. It archives both `/srv/trek/data` and `/srv/trek/uploads`, including hidden encryption files. It reads the complete archive to verify gzip/tar integrity and persists a SHA-256 checksum plus old/new image metadata. Only then may Argo apply the new image.

`PostSync` verifies the running image digest and app health before marking the transaction healthy. A failed or interrupted transaction blocks subsequent upgrades. `SyncFail` stops TREK if the new image may have touched the database. There is no automatic image-only rollback. Backup failure after quiescing also requires operator recovery.

Backups remain on the instance in `/var/backups/trek`. The transaction is `/var/lib/trek-gitops/state.json`. Existing backups and TREK's in-app scheduled backup settings are retained. These local files do not protect against loss of the entire instance; off-instance replication is a separate task. Pre-deployment archives are not automatically pruned.

Every deployment has downtime during the offline backup and startup. The existing `Recreate` strategy prevents simultaneous application writers.

## Ownership and bootstrap

Argo CD is installed from the official `v3.6.0` manifest in namespace `argocd`, with official TLS and component defaults. Its Service remains ClusterIP. Only the existing Cloudflare path `https://deploy.sam-lau.dev/hooks/trek-release` is forwarded to `/api/webhook`, through nginx with upstream certificate verification. The Argo management interface is not public. Certificate rotation requires updating `/etc/nginx/trek-argocd-ca.pem`.

`bootstrap.json` creates narrow backup Job RBAC. The reviewed `backup_hook.py` is installed read-only at `/opt/trek-gitops/backup_hook.py`; ordinary application releases do not replace this privileged lifecycle script. A hook script change requires tests, review, installation on the host, and a complete sync. The pinned Python image and node name are configured in `render.py` and the workflow.

The database/upload PVs and PVCs, encryption Secret, backup state, and Cloudflare tunnel stay outside Argo pruning. `workload.json` owns the application Deployment, non-secret ConfigMap, and Service. Review changes to upstream chart settings and explicitly update this deployment baseline when needed.

The former `trek-update` timer/service and custom webhook listener/worker/path are disabled and masked. Their unit files are retained under `/opt/trek-gitops/retired-units`. Do not run `trek-update`, Helm upgrades, or restore those units while Argo owns TREK.

## Inspect and pause

On Lightsail:

```sh
sudo k3s kubectl -n argocd get application trek
sudo k3s kubectl -n argocd get application trek -o jsonpath='{.status.operationState}'
sudo k3s kubectl -n trek get jobs,pods
sudo k3s kubectl -n trek logs job/trek-backup-pre
sudo k3s kubectl -n trek logs job/trek-backup-post
sudo cat /var/lib/trek-gitops/state.json
```

Pause future automatic deployments:

```sh
sudo k3s kubectl -n argocd patch application trek --type merge \
  -p '{"spec":{"syncPolicy":{"automated":{"enabled":false}}}}'
```

This does not interrupt an operation already running. Let it finish before maintenance. Resume by setting `enabled` to `true` after confirming healthy transaction state.

Do not use selective/resource-only sync or `ApplyOutOfSyncOnly`. Those can skip backup hooks. Automatic pruning, self-healing, and automatic retry are deliberately disabled. Use complete application syncs only. Kubernetes administrators can bypass these safeguards, so avoid directly patching the app image.

## Recovery

Pause automatic sync and ensure no operation or backup Job is still active. Inspect transaction state and Argo operation results. Preserve the failed data and archive before recovery. Verify the recorded archive's checksum and `.tar.gz.json` metadata. Restore the matching database **and uploads**, including hidden encryption files, with the matching previous image. Do not start an older image against a potentially migrated database. Verify app health and data before explicitly recording a healthy transaction and resuming automatic deployment. Recovery is an operator procedure; the hooks never clear blocked state automatically.

## Verify changes

```sh
python3 -m unittest discover -s deploy/argocd -p 'test_*.py' -v
```

Unit tests cover backup contents, missing directories, corrupt archives, failure-state preservation, image verification, immutable manifest generation, and stale CI promotion. Live validation must also verify registry pulls, webhook signatures/TLS, actual Kubernetes image identity, and a complete backup/sync/health cycle.
