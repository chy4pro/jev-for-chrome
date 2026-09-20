import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrustedInput } from '../src/background/input';

function installChrome(opts: { absent?: boolean; attachError?: string } = {}) {
  const commands: Array<{ method: string; params: any }> = [];
  let onDetach: ((source: any, reason: string) => void) | null = null;
  const debuggerMock = {
      attach: vi.fn(async () => {
        if (opts.attachError) throw new Error(opts.attachError);
      }),
      detach: vi.fn(async () => undefined),
      sendCommand: vi.fn(async (_target: any, method: string, params: any) => {
        commands.push({ method, params });
        return {};
      }),
      onDetach: { addListener: vi.fn((fn: any) => { onDetach = fn; }) },
  };
  const chromeMock = { debugger: debuggerMock };
  vi.stubGlobal('chrome', opts.absent ? {} : chromeMock);
  return { chromeMock, commands, fireDetach: (source: any, reason: string) => onDetach?.(source, reason) };
}

describe('TrustedInput', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('attaches once per tab and dispatches a move-press-release click', async () => {
    const { chromeMock, commands } = installChrome();
    const input = new TrustedInput();
    expect(await input.attach(7)).toBe(true);
    expect(await input.attach(7)).toBe(true);
    expect(chromeMock.debugger.attach).toHaveBeenCalledTimes(1);
    expect(chromeMock.debugger.attach).toHaveBeenCalledWith({ tabId: 7 }, '1.3');

    await input.click(10, 20);
    expect(commands.map((c) => `${c.method}:${c.params.type}`)).toEqual([
      'Input.dispatchMouseEvent:mouseMoved',
      'Input.dispatchMouseEvent:mousePressed',
      'Input.dispatchMouseEvent:mouseReleased',
    ]);
    expect(commands[1].params).toMatchObject({ x: 10, y: 20, button: 'left', clickCount: 1 });
  });

  it('types with insertText and sends a real Enter keystroke', async () => {
    const { commands } = installChrome();
    const input = new TrustedInput();
    await input.attach(7);
    await input.insertText('hello');
    await input.pressEnter();
    expect(commands[0]).toEqual({ method: 'Input.insertText', params: { text: 'hello' } });
    expect(commands[1].params).toMatchObject({ type: 'keyDown', key: 'Enter', text: '\r', windowsVirtualKeyCode: 13 });
    expect(commands[2].params).toMatchObject({ type: 'keyUp', key: 'Enter' });
  });

  it('reports false without the API or when Chrome refuses to attach', async () => {
    installChrome({ absent: true });
    expect(await new TrustedInput().attach(7)).toBe(false);
    installChrome({ attachError: 'Another debugger is already attached to the tab with id: 7.' });
    const input = new TrustedInput();
    expect(await input.attach(7)).toBe(false);
    expect(input.attachedTab).toBeNull();
    await expect(input.click(1, 1)).rejects.toThrow('not attached');
  });

  it('moves between tabs by detaching first, and notices when the user cancels', async () => {
    const { chromeMock, fireDetach } = installChrome();
    const input = new TrustedInput();
    const cancelled: number[] = [];
    input.onCancelled = (tabId) => cancelled.push(tabId);
    await input.attach(7);
    await input.attach(8);
    expect(chromeMock.debugger.detach).toHaveBeenCalledWith({ tabId: 7 });
    expect(input.attachedTab).toBe(8);

    fireDetach({ tabId: 8 }, 'canceled_by_user');
    expect(input.attachedTab).toBeNull();
    expect(cancelled).toEqual([8]);
    fireDetach({ tabId: 8 }, 'target_closed');
    expect(cancelled).toEqual([8]);
  });
});
