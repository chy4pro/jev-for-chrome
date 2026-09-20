/**
 * Trusted input through the DevTools protocol (chrome.debugger). Events dispatched this way
 * are what a mouse and keyboard produce: `isTrusted` is true, CSS :hover applies, javascript:
 * links and framework handlers that ignore scripted events all work, and the page's own CSP
 * is what applies. This is how nanobrowser, Taxy and browser-use drive pages.
 *
 * Attaching is best effort. It fails when the optional "debugger" permission was declined,
 * when DevTools already owns the tab, or on pages extensions cannot touch; the caller then
 * falls back to synthetic events. Chrome shows an info bar on the tab while attached and
 * detaches when the user dismisses it; that ends the run.
 */
export class TrustedInput {
  private tabId: number | null = null;
  private listening = false;
  /** Called when the user cancels the debugging session from Chrome's info bar. */
  public onCancelled: ((tabId: number) => void) | null = null;

  public get attachedTab(): number | null {
    return this.tabId;
  }

  /** True when the debugger permission is granted (the API namespace only exists once it is). */
  public static async permitted(): Promise<boolean> {
    try {
      if (typeof chrome === 'undefined' || !chrome.permissions?.contains) return false;
      return await chrome.permissions.contains({ permissions: ['debugger'] });
    } catch {
      return false;
    }
  }

  /** Attaches to the tab, moving from a previous one. Returns false when attaching is impossible. */
  public async attach(tabId: number): Promise<boolean> {
    if (this.tabId === tabId) return true;
    if (!(await TrustedInput.permitted()) || typeof chrome.debugger === 'undefined') return false;
    await this.detach();
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
    } catch {
      return false; // DevTools open on the tab, another extension attached, or a chrome:// page
    }
    this.tabId = tabId;
    if (!this.listening) {
      this.listening = true;
      chrome.debugger.onDetach.addListener((source, reason) => {
        if (source.tabId !== this.tabId) return;
        const cancelled = this.tabId;
        this.tabId = null;
        if (reason === 'canceled_by_user' && cancelled !== null) this.onCancelled?.(cancelled);
      });
    }
    return true;
  }

  public async detach(): Promise<void> {
    const tabId = this.tabId;
    this.tabId = null;
    if (tabId === null) return;
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // Already gone (tab closed, user cancelled)
    }
  }

  private send(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.tabId === null) return Promise.reject(new Error('Trusted input is not attached'));
    return chrome.debugger.sendCommand({ tabId: this.tabId }, method, params) as Promise<unknown>;
  }

  /** One left click at viewport coordinates: move (so :hover applies), press, release. */
  public async click(x: number, y: number): Promise<void> {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  /** Inserts text at the caret of the focused element, as an IME commit would. */
  public async insertText(text: string): Promise<void> {
    await this.send('Input.insertText', { text });
  }

  /** A real Enter keystroke in the focused element: submits forms, picks suggestions. */
  public async pressEnter(): Promise<void> {
    const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', text: '\r', unmodifiedText: '\r', ...key });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  }
}
