import { DEFAULT_OPENROUTER_MODEL, normalizeOpenRouterModel, openrouter, openRouterHeaders } from 'jev-dev-kit';
import { JevRequest, JevResponse, OpenRouterConfig } from '../types';

export { DEFAULT_OPENROUTER_MODEL, normalizeOpenRouterModel };

const ATTRIBUTION = { referer: 'https://github.com/chy4pro/jev-for-chrome', title: 'Jev for Chrome' };
export const OPENROUTER_HEADERS = openRouterHeaders(ATTRIBUTION);

/** OpenRouter's Decisions API through jev-dev-kit, with the Options hint on an unknown model id. */
export async function callOpenRouter(config: OpenRouterConfig, request: JevRequest): Promise<JevResponse> {
  if (!(config.apiKey || '').trim()) throw new Error('OpenRouter API Key is not configured. Please set it in Options.');
  const model = normalizeOpenRouterModel(config.model);
  const client = openrouter({ apiKey: config.apiKey, model, endpoint: config.endpoint || undefined, ...ATTRIBUTION });
  try {
    return await client({ ...request, model });
  } catch (err: any) {
    const message = err?.message || String(err);
    if (/does not exist|not found|invalid model/i.test(message)) {
      throw new Error(`${message} Open Options and set it to "${DEFAULT_OPENROUTER_MODEL}" (or use Reset to defaults).`);
    }
    throw err;
  }
}
