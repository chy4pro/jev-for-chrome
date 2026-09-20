/**
 * The "debugger" permission is optional: declared in the manifest, granted on request.
 * Chrome only shows the prompt inside a user gesture, so callers run this straight from a
 * click handler, before any await. A declined prompt is not an error: the run falls back to
 * synthetic events and says so.
 */
export async function ensureTrustedInputPermission(wanted: boolean): Promise<boolean> {
  if (!wanted) return false;
  try {
    if (await chrome.permissions.contains({ permissions: ['debugger'] })) return true;
    return await chrome.permissions.request({ permissions: ['debugger'] });
  } catch {
    return false;
  }
}

export async function releaseTrustedInputPermission(): Promise<void> {
  try {
    if (await chrome.permissions.contains({ permissions: ['debugger'] })) {
      await chrome.permissions.remove({ permissions: ['debugger'] });
    }
  } catch {
    // Nothing to release
  }
}
