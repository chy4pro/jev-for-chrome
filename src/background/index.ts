import { AppSettings, ExtensionMessage, mergeSettings } from '../shared/types';
import { AgentRunner } from './agent';

const runner = new AgentRunner();

async function getStoredSettings(): Promise<AppSettings> {
  const result = await chrome.storage.local.get(['jev_settings']);
  return mergeSettings(result.jev_settings as Partial<AppSettings> | undefined);
}

async function saveStoredSettings(settings: AppSettings): Promise<void> {
  const merged = mergeSettings(settings);
  await chrome.storage.local.set({ jev_settings: merged });
  runner.setSettings(merged);
}

/** Always reload settings before a run: the service worker may have just woken up. */
async function refreshRunnerSettings(): Promise<AppSettings> {
  const settings = await getStoredSettings();
  runner.setSettings(settings);
  return settings;
}

refreshRunnerSettings().catch(() => undefined);

/** The tab to act on: an explicit id (detached popup, tests) or the active tab of the current window. */
async function resolveTabId(explicit?: number): Promise<number> {
  if (typeof explicit === 'number') {
    const tab = await chrome.tabs.get(explicit);
    if (tab.id === undefined) throw new Error(`Tab ${explicit} not found`);
    return tab.id;
  }
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  if (!activeTab || activeTab.id === undefined) {
    throw new Error('No active tab found');
  }
  return activeTab.id;
}

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: unknown) => void) => {
    (async () => {
      try {
        switch (message.type) {
          case 'GET_SETTINGS': {
            sendResponse({ type: 'SETTINGS_RESPONSE', settings: await getStoredSettings() });
            return;
          }
          case 'SAVE_SETTINGS': {
            await saveStoredSettings(message.settings);
            sendResponse({ success: true });
            return;
          }
          case 'GET_PROGRESS': {
            sendResponse({ progress: runner.getProgress() });
            return;
          }
          case 'START_AGENT': {
            const goal = (message.goal || '').trim();
            if (!goal) throw new Error('Goal is empty');
            await refreshRunnerSettings();
            const tabId = await resolveTabId(message.tabId);
            void runner.start(goal, tabId); // runs in the background; progress arrives via PROGRESS_UPDATE
            sendResponse({ success: true });
            return;
          }
          case 'STEP_AGENT': {
            const goal = (message.goal || runner.getProgress().goal || '').trim();
            if (!goal) throw new Error('Goal is empty');
            await refreshRunnerSettings();
            const tabId = await resolveTabId(message.tabId);
            void runner.step(goal, tabId);
            sendResponse({ success: true });
            return;
          }
          case 'STOP_AGENT': {
            runner.stop();
            sendResponse({ success: true });
            return;
          }
          case 'MAIN_WORLD_CLICK': {
            // A javascript: link clicked from the extension's isolated world is checked against
            // the extension's CSP and blocked. Clicking it from the page's own world runs it
            // under the page's CSP, exactly like a user's click.
            const tabId = _sender.tab?.id;
            if (tabId === undefined) throw new Error('MAIN_WORLD_CLICK needs a tab');
            const [result] = await chrome.scripting.executeScript({
              target: { tabId, frameIds: _sender.frameId !== undefined ? [_sender.frameId] : undefined },
              world: 'MAIN',
              func: (token: string) => {
                const el = document.querySelector(`[data-jev-click="${token}"]`) as HTMLElement | null;
                if (!el) return false;
                el.removeAttribute('data-jev-click');
                el.click();
                return true;
              },
              args: [message.token],
            });
            sendResponse({ success: result?.result === true });
            return;
          }
          case 'TOGGLE_OVERLAY': {
            const settings = await getStoredSettings();
            await saveStoredSettings({ ...settings, showOverlay: message.show });
            const tabId = await resolveTabId(message.tabId);
            await chrome.tabs.sendMessage(tabId, message).catch(() => undefined);
            sendResponse({ success: true });
            return;
          }
          default:
            return;
        }
      } catch (err: any) {
        sendResponse({ success: false, error: err?.message || String(err) });
      }
    })();
    return true; // keep sendResponse open for async work
  }
);
