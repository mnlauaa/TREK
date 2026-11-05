import { configApi } from '../api/client';

export const configRepo = { publicConfig: () => configApi.getPublicConfig() };
