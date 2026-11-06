import { readEnv } from '../../app-config';
import { DEFAULT_LANGUAGE } from '../../config';
import { Public } from '../auth-core/public.decorator';
import { Controller, Get } from '@nestjs/common';
import type { PublicConfig } from '@trek/shared';

@Public('public bootstrap config the login screen reads before any session exists')
@Controller('api/config')
export class ConfigController {
  @Get()
  getConfig(): PublicConfig {
    const app = readEnv().app;
    return {
      defaultLanguage: DEFAULT_LANGUAGE,
      sourceCodeUrl: app.sourceCodeUrl || 'https://github.com/mnlauaa/TREK',
      version: app.appVersion ?? require('../../../package.json').version,
    };
  }
}
