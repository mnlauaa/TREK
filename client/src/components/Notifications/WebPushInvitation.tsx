import type { WebPushConfigResult } from '@trek/shared';
import React, { useEffect, useMemo, useState } from 'react';

import { useTranslation } from '../../i18n';
import { webPushRepo } from '../../repo/webPushRepo';
import { detectWebPushCapability, enableWebPush, getWebPushInstallationId } from '../../services/webPush';
import { useAuthStore } from '../../store/authStore';

export default function WebPushInvitation(): React.ReactElement | null {
  const { t } = useTranslation();
  const user = useAuthStore((state) => state.user);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const [config, setConfig] = useState<WebPushConfigResult | null>(null);
  const [busy, setBusy] = useState(false);
  const capability = detectWebPushCapability();
  const installationId = useMemo(() => getWebPushInstallationId(), []);
  const dismissKey = user ? `trek_web_push_invitation_dismissed:${user.id}:${installationId}` : '';

  useEffect(() => {
    if (!isAuthenticated || !user || !dismissKey || localStorage.getItem(dismissKey) === '1') {
      setConfig(null);
      return;
    }
    if (capability === 'unsupported' || capability === 'denied') return;
    let cancelled = false;
    void Promise.all([webPushRepo.config(), webPushRepo.devices()])
      .then(([config, result]) => {
        const current = result.devices.some((device) => device.installationId === installationId);
        if (!cancelled) setConfig(config.enabled && config.available && !current ? config : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [capability, dismissKey, installationId, isAuthenticated, user]);
  if (!config || !isAuthenticated || !user) return null;

  const dismiss = () => {
    localStorage.setItem(dismissKey, '1');
    setConfig(null);
  };
  const enable = async () => {
    setBusy(true);
    try {
      if ((await enableWebPush(config)).state === 'active') setConfig(null);
    } catch {
      /* detailed state is available in Settings */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md rounded-xl border border-edge bg-surface p-4 shadow-xl md:bottom-6">
      <p className="text-body font-semibold text-content">{t('settings.webPush.title')}</p>
      <p className="mt-1 text-caption text-content-muted">
        {capability === 'ios-install-required' ? t('settings.webPush.iosInstall') : t('settings.webPush.description')}
      </p>
      <div className="mt-3 flex gap-2">
        {capability === 'supported' && (
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="rounded-md bg-content px-3 py-2 text-caption font-medium text-surface disabled:opacity-50"
          >
            {busy ? t('settings.webPush.enabling') : t('settings.webPush.enable')}
          </button>
        )}
        <button
          type="button"
          onClick={dismiss}
          className="rounded-md border border-edge px-3 py-2 text-caption text-content-muted"
        >
          {t('settings.webPush.notNow')}
        </button>
      </div>
    </div>
  );
}
