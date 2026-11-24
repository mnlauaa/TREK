import { DEFAULT_LANGUAGE } from '../../../src/config';
import { ConfigController } from '../../../src/nest/config/config.controller';

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllEnvs());

describe('ConfigController', () => {
  it('publishes the default language and the configured source release', () => {
    vi.stubEnv('SOURCE_CODE_URL', 'https://example.test/trek/5.1.0');
    expect(new ConfigController().getConfig()).toEqual({
      defaultLanguage: DEFAULT_LANGUAGE,
      sourceCodeUrl: 'https://example.test/trek/5.1.0',
      version: expect.any(String),
    });
  });
});
