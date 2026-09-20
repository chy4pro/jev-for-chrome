/**
 * Core type definitions for Jev for Chrome
 */

export type JevProviderType = 'typesafe' | 'openrouter' | 'cloudflare';
export type TextHelperProvider = 'openrouter' | 'deepseek' | 'openai';

export interface TypeSafeConfig {
  apiKey: string;
  model: string;
  endpoint: string;
}

export interface OpenRouterConfig {
  apiKey: string;
  model: string;
  endpoint: string;
}

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  model: string;
  endpoint?: string;
}

export interface TextHelperConfig {
  provider: TextHelperProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Defaults applied when the text helper's base URL or model is left empty. */
export const TEXT_HELPER_PRESETS: Record<TextHelperProvider, { baseUrl: string; model: string }> = {
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat' },
  deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
};

export interface AppSettings {
  activeProvider: JevProviderType;
  typesafe: TypeSafeConfig;
  openrouter: OpenRouterConfig;
  cloudflare: CloudflareConfig;
  textHelper: TextHelperConfig;
  maxSteps: number;
  stepDelayMs: number;
  showOverlay: boolean;
  /**
   * Dispatch clicks and keystrokes through the DevTools protocol (chrome.debugger) so pages
   * receive trusted input, as a person's mouse and keyboard would produce. Needs the optional
   * "debugger" permission; without it, or when DevTools already owns the tab, the content
   * script's synthetic events are used instead.
   */
  trustedInput: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  activeProvider: 'openrouter',
  typesafe: {
    apiKey: '',
    model: 'jev-latest',
    endpoint: 'https://api.typesafe.ai/v1/systemone',
  },
  openrouter: {
    apiKey: '',
    model: 'typesafe/jev-1.13',
    endpoint: 'https://openrouter.ai/api/alpha/decisions',
  },
  cloudflare: {
    accountId: '',
    apiToken: '',
    model: 'typesafe/jev',
  },
  textHelper: {
    provider: 'openrouter',
    apiKey: '',
    baseUrl: TEXT_HELPER_PRESETS.openrouter.baseUrl,
    model: TEXT_HELPER_PRESETS.openrouter.model,
  },
  maxSteps: 30,
  stepDelayMs: 300,
  showOverlay: true,
  trustedInput: true,
};

/**
 * Model ids that earlier versions of this extension stored as defaults but that the provider
 * rejects today. They are rewritten on load so an old install keeps working after an update.
 * OpenRouter has no `typesafe/jev-latest`; that alias only exists on the TypeSafe API.
 */
export { OBSOLETE_OPENROUTER_JEV_MODELS } from 'jev-dev-kit';
import { OBSOLETE_OPENROUTER_JEV_MODELS } from 'jev-dev-kit';

/** Bare DeepSeek ids are only valid on api.deepseek.com; OpenRouter needs the vendor prefix. */
export const OBSOLETE_OPENROUTER_TEXT_MODELS: Record<string, string> = {
  'deepseek-chat': 'deepseek/deepseek-chat',
  'deepseek-reasoner': 'deepseek/deepseek-r1',
};

/** Deep-merges stored settings over the defaults and migrates values known to be obsolete. */
export function mergeSettings(stored: Partial<AppSettings> | undefined | null): AppSettings {
  const s = stored || {};
  const merged: AppSettings = {
    ...DEFAULT_SETTINGS,
    ...s,
    typesafe: { ...DEFAULT_SETTINGS.typesafe, ...(s.typesafe || {}) },
    openrouter: { ...DEFAULT_SETTINGS.openrouter, ...(s.openrouter || {}) },
    cloudflare: { ...DEFAULT_SETTINGS.cloudflare, ...(s.cloudflare || {}) },
    textHelper: { ...DEFAULT_SETTINGS.textHelper, ...(s.textHelper || {}) },
  };

  const jevModel = (merged.openrouter.model || '').trim();
  merged.openrouter.model = OBSOLETE_OPENROUTER_JEV_MODELS[jevModel] || jevModel || DEFAULT_SETTINGS.openrouter.model;
  if (!(merged.openrouter.endpoint || '').trim()) merged.openrouter.endpoint = DEFAULT_SETTINGS.openrouter.endpoint;

  if (!(merged.typesafe.model || '').trim()) merged.typesafe.model = DEFAULT_SETTINGS.typesafe.model;
  if (!(merged.typesafe.endpoint || '').trim()) merged.typesafe.endpoint = DEFAULT_SETTINGS.typesafe.endpoint;
  if (!(merged.cloudflare.model || '').trim()) merged.cloudflare.model = DEFAULT_SETTINGS.cloudflare.model;

  const helper = merged.textHelper;
  if (!TEXT_HELPER_PRESETS[helper.provider]) helper.provider = DEFAULT_SETTINGS.textHelper.provider;
  const preset = TEXT_HELPER_PRESETS[helper.provider];
  if (!(helper.baseUrl || '').trim()) helper.baseUrl = preset.baseUrl;
  const textModel = (helper.model || '').trim();
  helper.model =
    (helper.baseUrl.includes('openrouter.ai') && OBSOLETE_OPENROUTER_TEXT_MODELS[textModel]) || textModel || preset.model;

  return merged;
}

// Jev question and answer primitives come from jev-dev-kit; the state shape below is this app's.
export type {
  ChoiceQuestion,
  NoulQuestion,
  ScoreQuestion,
  JevQuestion,
  JevQuestions,
  JevChoiceAnswer,
  JevNoulAnswer,
  JevScoreAnswer,
  JevResponse,
} from 'jev-dev-kit';
import type { JevQuestions as KitQuestions } from 'jev-dev-kit';

export interface ObservedElement {
  index: string;
  label: string;
  role?: string;
  /** Link destination (path and query only) so the model can tell similar links apart. */
  href?: string;
  /** Nearest heading above the element; where on the page it sits. */
  section?: string;
  value?: string;
  operations: string[];
  checked?: string;
  selected?: string;
  expanded?: string;
  options?: Array<{ index: string; label: string; value: string }>;
}

export interface RecentAction {
  step?: number;
  action?: string;
  kind?: string;
  text?: string;
  page_changed?: boolean;
  /** What visibly happened after the action, in words: navigated, page changed, scrolled, no change. */
  outcome?: string;
  /** URL after the action. */
  url?: string;
}

export interface RunProgressState {
  start_url: string;
  steps_taken: number;
  visited_urls: string[];
}

export interface JevState extends Record<string, unknown> {
  task: string;
  page: {
    url: string;
    title: string;
    text: string;
  };
  elements: ObservedElement[];
  recent_actions: RecentAction[];
  run?: RunProgressState;
}

export interface JevRequest {
  model: string;
  state: JevState;
  questions: KitQuestions;
}


// DOM Snapshot and Actions
export interface ElementRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ActionKind = 'click' | 'fill' | 'select' | 'scroll' | 'wait' | 'key';

export interface PageAction {
  id: string; // e.g. "e1", "e2", "scroll_down", "scroll_up", "wait"
  node?: number; // code-owned DOM node identity in the content script cache
  kind: ActionKind;
  role?: string;
  label: string;
  href?: string;
  section?: string;
  value?: string;
  current_value?: string;
  delta?: number;
  rect?: ElementRect;
  checked?: string;
  selected?: string;
  expanded?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  w: number;
  h: number;
  text: string;
  scroll: { y: number; height: number };
  actions: PageAction[];
  omitted_actions: number;
}

/**
 * Why an action could not run. Everything except `invalid` means the page is not (yet) in
 * the state the decision assumed, so the caller observes again instead of giving up.
 */
export type ActFailure =
  | 'stale' // the page changed since the snapshot
  | 'missing' // the target left the DOM
  | 'disabled' // disabled, hidden, read-only
  | 'offscreen' // no usable rect even after scrolling it into view
  | 'covered' // something else sits at the click point
  | 'failed' // the browser refused the input (attach lost, dispatch threw)
  | 'invalid'; // a programming error: unknown action, wrong element type

export type ActResult =
  | { ok: true; via: 'cdp' | 'synthetic' | 'page' }
  | { ok: false; code: ActFailure; message: string };

/** What the content script returns before the background dispatches trusted input. */
export type PrepareResult =
  | { ok: true; done: true } // the action was completed inside the page (scroll, wait, select, direct value)
  | { ok: true; done: false; x: number; y: number }
  | { ok: false; code: ActFailure; message: string };

export type AgentStatus = 'idle' | 'running' | 'paused' | 'done' | 'blocked' | 'error';

export interface AgentStepLog {
  step: number;
  timestamp: number;
  operation: string;
  targetId?: string;
  targetLabel?: string;
  targetValue?: string;
  confidence?: number;
  latencyMs: number;
  provider: JevProviderType;
  probabilities?: Record<string, number>;
  /** Independent cross-checks answered in the same request (0..1). */
  goalDone?: number;
  stuck?: number;
  error?: string;
}

export interface AgentProgress {
  status: AgentStatus;
  goal: string;
  currentStep: number;
  maxSteps: number;
  logs: AgentStepLog[];
  lastError?: string;
  /** How input reaches the page this run, when it is not the trusted path. */
  inputNote?: string;
}

// Messages between Extension components
export type ExtensionMessage =
  | { type: 'GET_SETTINGS' }
  | { type: 'SETTINGS_RESPONSE'; settings: AppSettings }
  | { type: 'SAVE_SETTINGS'; settings: AppSettings }
  | { type: 'START_AGENT'; goal: string; tabId?: number }
  | { type: 'STOP_AGENT' }
  | { type: 'STEP_AGENT'; goal: string; tabId?: number }
  | { type: 'GET_PROGRESS' }
  | { type: 'PROGRESS_UPDATE'; progress: AgentProgress }
  | { type: 'PING' }
  | { type: 'CONTENT_OBSERVE' }
  /** Whole action inside the page with synthetic events (fallback when trusted input is off). */
  | { type: 'CONTENT_ACT'; action: PageAction; text?: string }
  /** Checks, scrolls and focuses the target; returns the point for the background's trusted input. */
  | { type: 'CONTENT_PREPARE'; action: PageAction; text?: string }
  /** Synthetic dispatch on an already prepared target (trusted input failed mid-way). */
  | { type: 'CONTENT_DISPATCH'; action: PageAction; text?: string }
  /** Waits for the page to go quiet after trusted input. */
  | { type: 'CONTENT_SETTLE' }
  /** Content script → background: click a javascript: link in the page's main world (synthetic path only). */
  | { type: 'MAIN_WORLD_CLICK'; token: string }
  | { type: 'CONTENT_STATUS'; text?: string; latencyMs?: number; clear?: boolean }
  | { type: 'TOGGLE_OVERLAY'; show: boolean; tabId?: number };
