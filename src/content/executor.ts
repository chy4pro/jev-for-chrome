import { ActFailure, ActResult, PageAction, PrepareResult } from '../shared/types';
import { clickRect, getCache, isFresh, isVisible, sameComponent } from './snapshot';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const nextFrame = () =>
  new Promise<void>((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));

const fail = (code: ActFailure, message: string): { ok: false; code: ActFailure; message: string } => ({ ok: false, code, message });

/** Input types whose value cannot be typed; the value is assigned directly instead. */
const DIRECT_VALUE_TYPES = new Set(['date', 'datetime-local', 'month', 'week', 'time', 'color', 'range', 'number']);

/**
 * Waits until the page has stopped changing: no DOM mutation for `quiet` ms, at most `cap` ms.
 * Covers what used to be special cases (autocomplete lists appearing, in-page sorts) with one
 * rule, and stays cheap on a calm page.
 */
export function settle(quiet = 80, cap = 500): Promise<void> {
  return new Promise<void>((resolve) => {
    let observer: MutationObserver | null = null;
    let timer: ReturnType<typeof setTimeout>;
    const done = () => {
      observer?.disconnect();
      clearTimeout(timer);
      clearTimeout(hard);
      resolve();
    };
    const hard = setTimeout(done, cap);
    timer = setTimeout(done, quiet);
    if (typeof MutationObserver !== 'function' || !document.documentElement) return;
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(done, quiet);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
  });
}

/** Short description of an element for diagnostics: tag, id and up to three classes. */
function describeElement(e: Element): string {
  const cls = typeof e.className === 'string' ? e.className.trim().split(/\s+/).filter(Boolean).slice(0, 3) : [];
  return `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${cls.length ? '.' + cls.join('.') : ''}`;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  // Use the prototype setter so React-style value trackers notice the change.
  const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  if (descriptor?.set) descriptor.set.call(el, value);
  else el.value = value;
}

function fireInput(el: Element, data: string): void {
  el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Empties a text field or contenteditable so typed text does not append to the old value. */
function clearField(el: HTMLElement): void {
  if (el.isContentEditable) {
    const selection = window.getSelection();
    if (selection) {
      selection.selectAllChildren(el);
      selection.deleteFromDocument();
    }
    el.textContent = '';
  } else {
    setNativeValue(el as HTMLInputElement, '');
  }
}

function inView(r: DOMRect): boolean {
  return r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth;
}

/** The click point once the element is in view and has stopped moving (up to ~10 frames). */
async function stablePoint(el: Element): Promise<DOMRect> {
  let rect = clickRect(el);
  if (!inView(rect)) {
    if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" as ScrollBehavior });
    rect = clickRect(el);
  }
  for (let i = 0; i < 10; i++) {
    await nextFrame();
    const next = clickRect(el);
    const same = Math.abs(next.x - rect.x) < 1 && Math.abs(next.y - rect.y) < 1 && next.width === rect.width && next.height === rect.height;
    rect = next;
    if (same) break;
  }
  return rect;
}

/**
 * Everything that must be true before input reaches the target, in one place: the decision is
 * still fresh, the element exists, is usable, is in view, has settled, and nothing covers it.
 * Actions the page can complete on its own (wait, scroll, select, direct values) finish here.
 * For the rest the target is focused and its click point returned; who dispatches the input
 * (trusted DevTools input or synthetic events) is the caller's choice.
 */
export async function prepareAction(action: PageAction, text?: string): Promise<PrepareResult> {
  if (!isFresh(action)) return fail('stale', 'Page changed since this decision.');

  if (action.kind === 'wait') {
    await sleep(100);
    return { ok: true, done: true };
  }
  if (action.kind === 'scroll') {
    window.scrollBy({ top: action.delta || 0, behavior: 'instant' as ScrollBehavior });
    await settle();
    return { ok: true, done: true };
  }

  if (typeof action.node !== 'number') return fail('invalid', 'Action has no observed node.');
  const element = getCache().nodes.get(action.node) as HTMLElement | undefined;
  if (!element || !element.isConnected) return fail('missing', 'Target element is no longer in the DOM.');
  if (element.matches(':disabled') || element.closest('[aria-disabled="true"],[inert]') || !isVisible(element)) {
    return fail('disabled', 'Target is disabled or hidden.');
  }

  if (action.kind === 'select') {
    if (element.tagName !== 'SELECT') return fail('invalid', 'Target element is not a <select>.');
    const selectEl = element as unknown as HTMLSelectElement;
    const option = Array.from(selectEl.options).find(
      (o) => o.value === action.value && !o.disabled && !o.closest('optgroup[disabled]')
    );
    if (!option) return fail('missing', 'Dropdown option is no longer available.');
    selectEl.value = option.value;
    selectEl.dispatchEvent(new Event('input', { bubbles: true }));
    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    return { ok: true, done: true };
  }

  if (action.kind === 'fill') {
    const inp = element as HTMLInputElement;
    if (inp.readOnly || element.getAttribute('aria-readonly') === 'true') return fail('disabled', 'Target field became read-only.');
    if (!element.isContentEditable && DIRECT_VALUE_TYPES.has(inp.type)) {
      element.focus();
      setNativeValue(inp, text ?? '');
      fireInput(element, text ?? '');
      await settle();
      return { ok: true, done: true };
    }
  }

  const r = await stablePoint(element);
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  if (!r.width || !r.height || x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
    return fail('offscreen', 'Target has no visible area in the viewport.');
  }
  const hit = document.elementFromPoint(x, y);
  if (hit && !element.contains(hit) && !hit.contains(element) && !sameComponent(element, hit)) {
    return fail('covered', `Target is covered by another element (${describeElement(hit)}).`);
  }

  if (action.kind === 'fill') clearField(element);
  if (action.kind === 'fill' || action.kind === 'key') element.focus();
  return { ok: true, done: false, x, y };
}

// ---------------------------------------------------------------------------------------------
// Synthetic dispatch: DOM events from the extension's isolated world. Used when trusted input
// is off or unavailable. Pages cannot tell these from scripted events (isTrusted is false), so
// a few things a real pointer gets for free are reproduced by hand below.
// ---------------------------------------------------------------------------------------------

function dispatchPointerSequence(el: Element, x: number, y: number): void {
  const init: MouseEventInit = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 };
  const pointer = typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
  el.dispatchEvent(new pointer('pointerdown', { ...init, pointerId: 1, isPrimary: true } as PointerEventInit));
  el.dispatchEvent(new MouseEvent('mousedown', init));
  el.dispatchEvent(new pointer('pointerup', { ...init, pointerId: 1, isPrimary: true } as PointerEventInit));
  el.dispatchEvent(new MouseEvent('mouseup', init));
}

/** A real pointer lands on the innermost element at the point; SVG nodes have no click(). */
function clickableAt(element: HTMLElement, hit: Element | null): HTMLElement {
  let node: Element | null = hit;
  while (node && node !== element && element.contains(node)) {
    if (node instanceof HTMLElement && typeof node.click === 'function') return node;
    node = node.parentElement;
  }
  return element;
}

function isJavascriptLink(el: Element): boolean {
  const link = el.closest('a[href]');
  return !!link && /^\s*javascript:/i.test(link.getAttribute('href') || '');
}

/** The extension's CSP blocks javascript: URLs run from this world; the page's world may run them. */
async function clickInMainWorld(el: Element): Promise<boolean> {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  el.setAttribute('data-jev-click', token);
  try {
    const res = await chrome.runtime.sendMessage({ type: 'MAIN_WORLD_CLICK', token });
    return res?.success === true;
  } catch {
    return false;
  } finally {
    el.removeAttribute('data-jev-click');
  }
}

/** Key events for scripts that listen for them, then the form submits unless a handler cancelled. */
function pressEnter(field: HTMLElement): void {
  const init: KeyboardEventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  const down = field.dispatchEvent(new KeyboardEvent('keydown', init));
  const press = field.dispatchEvent(new KeyboardEvent('keypress', init));
  field.dispatchEvent(new KeyboardEvent('keyup', init));
  const form = (field as HTMLInputElement).form;
  if (down && press && form) {
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
  }
}

/** Dispatches a prepared click/fill/key with synthetic events, then waits for the page to settle. */
export async function dispatchSynthetic(action: PageAction, point: { x: number; y: number }, text?: string): Promise<ActResult> {
  const element = getCache().nodes.get(action.node ?? -1) as HTMLElement | undefined;
  if (!element || !element.isConnected) return fail('missing', 'Target element is no longer in the DOM.');
  try {
    if (action.kind === 'click') {
      const hit = document.elementFromPoint(point.x, point.y);
      const target = hit && element.contains(hit) ? clickableAt(element, hit) : element;
      dispatchPointerSequence(target, point.x, point.y);
      element.focus();
      // One click only: click() runs the activation behaviour (toggle, navigate, submit).
      if (!(isJavascriptLink(target) && (await clickInMainWorld(target)))) target.click();
    } else if (action.kind === 'fill') {
      const value = text ?? '';
      dispatchPointerSequence(element, point.x, point.y);
      element.focus();
      if (element.isContentEditable) element.textContent = value;
      else setNativeValue(element as HTMLInputElement, value);
      fireInput(element, value);
      // No synthetic Enter: submitting or picking a suggestion is the model's next decision.
    } else if (action.kind === 'key') {
      element.focus();
      pressEnter(element);
    } else {
      return fail('invalid', `Unknown action kind: ${String(action.kind)}`);
    }
  } catch (err: any) {
    return fail('failed', err?.message || String(err));
  }
  await settle();
  return { ok: true, via: 'synthetic' };
}

/** Prepare and dispatch inside the page. The path taken when trusted input is not in use. */
export async function executeAction(action: PageAction, text?: string): Promise<ActResult> {
  try {
    const prep = await prepareAction(action, text);
    if (!prep.ok) return prep;
    if (prep.done) return { ok: true, via: 'page' };
    return await dispatchSynthetic(action, prep, text);
  } catch (err: any) {
    return fail('failed', err?.message || String(err));
  }
}
