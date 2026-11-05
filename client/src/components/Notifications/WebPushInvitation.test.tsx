import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildUser } from '../../../tests/helpers/factories';
import { render } from '../../../tests/helpers/render';
import { useAuthStore } from '../../store/authStore';
import WebPushInvitation from './WebPushInvitation';

const mock = vi.hoisted(() => ({
  webPushConfig: vi.fn(),
  webPushDevices: vi.fn(),
  enableWebPush: vi.fn(),
  detectWebPushCapability: vi.fn(),
}));
vi.mock('../../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/client')>();
  return { ...actual, notificationsApi: { ...actual.notificationsApi, ...mock } };
});
vi.mock('../../services/webPush', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/webPush')>();
  return { ...actual, ...mock, getWebPushInstallationId: () => 'installation' };
});
const config = { enabled: true, available: true, publicKey: 'key', maxDevices: 10 };

beforeEach(() => {
  localStorage.clear();
  mock.webPushConfig.mockResolvedValue(config);
  mock.webPushDevices.mockResolvedValue({ devices: [] });
  mock.detectWebPushCapability.mockReturnValue('supported');
  mock.enableWebPush.mockResolvedValue({ state: 'active' });
  useAuthStore.setState({ isAuthenticated: true, user: buildUser({ id: 42 }) });
});

describe('Web Push invitation', () => {
  it('does not request permission before the user chooses to enable', async () => {
    render(<WebPushInvitation />);
    const enable = await screen.findByRole('button', { name: 'Turn on for this device' });
    expect(mock.enableWebPush).not.toHaveBeenCalled();
    await userEvent.click(enable);
    await waitFor(() => expect(mock.enableWebPush).toHaveBeenCalledWith(config));
    expect(enable).not.toBeInTheDocument();
  });

  it('remembers dismissal for this account and installation', async () => {
    const { unmount } = render(<WebPushInvitation />);
    await userEvent.click(await screen.findByRole('button', { name: /not now/i }));
    expect(localStorage.getItem('trek_web_push_invitation_dismissed:42:installation')).toBe('1');
    unmount();
    render(<WebPushInvitation />);
    expect(screen.queryByRole('button', { name: /not now/i })).not.toBeInTheDocument();
  });
});
