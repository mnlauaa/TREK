import { useState } from 'react';
import { useTranslation } from '../../../i18n';
import { useToast } from '../../shared/Toast';
export const validClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const button =
  'min-h-9 [@media(pointer:coarse)]:min-h-11 rounded px-2 py-1 text-caption text-accent-on hover:bg-accent-subtle focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50';

export function useTimingSave() {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { t } = useTranslation();
  const run = async (save: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await save();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('common.unknownError'));
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}
