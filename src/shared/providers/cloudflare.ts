import { cloudflare } from 'jev-dev-kit';
import { CloudflareConfig, JevRequest, JevResponse } from '../types';

export async function callCloudflare(config: CloudflareConfig, request: JevRequest): Promise<JevResponse> {
  if (!(config.accountId || '').trim() || !(config.apiToken || '').trim()) {
    throw new Error('Cloudflare Account ID and API Token must be configured. Please set them in Options.');
  }
  const model = (config.model || '').trim() || 'typesafe/jev';
  return cloudflare({ accountId: config.accountId, apiToken: config.apiToken, model, endpoint: config.endpoint || undefined })({ ...request, model });
}
