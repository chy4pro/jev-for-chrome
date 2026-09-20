import { typesafe } from 'jev-dev-kit';
import { JevRequest, JevResponse, TypeSafeConfig } from '../types';

export async function callTypeSafe(config: TypeSafeConfig, request: JevRequest): Promise<JevResponse> {
  if (!(config.apiKey || '').trim()) throw new Error('TypeSafe API Key is not configured. Please set it in Options.');
  const model = (config.model || '').trim() || 'jev-latest';
  return typesafe({ apiKey: config.apiKey, model, endpoint: config.endpoint || undefined })({ ...request, model });
}
