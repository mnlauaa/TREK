import type { PublicConfig } from '@trek/shared';
import { useEffect, useState } from 'react';

import { configRepo } from '../../repo/configRepo';

export function useLegalPage(): { config: PublicConfig | null } {
  const [config, setConfig] = useState<PublicConfig | null>(null);

  useEffect(() => {
    configRepo
      .publicConfig()
      .then(setConfig)
      .catch(() => {});
  }, []);

  return { config };
}
