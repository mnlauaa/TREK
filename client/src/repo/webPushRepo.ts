import { notificationsApi } from '../api/client';

export const webPushRepo = {
  config: () => notificationsApi.webPushConfig(),
  devices: () => notificationsApi.webPushDevices(),
  register: (...args: Parameters<typeof notificationsApi.webPushCurrent>) => notificationsApi.webPushCurrent(...args),
  rename: (...args: Parameters<typeof notificationsApi.renameWebPushDevice>) =>
    notificationsApi.renameWebPushDevice(...args),
  revoke: (id: number) => notificationsApi.revokeWebPushDevice(id),
  test: (id: number) => notificationsApi.testWebPushDevice(id),
};
