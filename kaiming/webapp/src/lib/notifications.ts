/**
 * Browser notification support for chat reminders. The page stays authoritative: when the window
 * is focused and on the chat screen the caller shows an in-page toast; this module is only the
 * cross-window path for a hidden/unfocused tab.
 *
 * Notification permission is requested from a user gesture (the first send), never on page load:
 * browsers ignore or silently suppress a request that is not tied to an interaction.
 */
export type NotificationSupport = NotificationPermission | 'unsupported';

let permissionRequested = false;

/** The browser's current permission, or `unsupported` when this environment has no Notification. */
export function notificationPermission(): NotificationSupport {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

/**
 * Ask for permission once per page lifetime. A non-default permission (granted or denied) is
 * already the user's answer; a second prompt would only be noise.
 */
export async function ensureNotificationPermission(): Promise<NotificationSupport> {
  const current = notificationPermission();
  if (current === 'unsupported' || current !== 'default') return current;
  if (permissionRequested) return current;
  permissionRequested = true;
  try {
    return await window.Notification.requestPermission();
  } catch {
    // Some hosts expose the constructor but refuse the request (e.g. a restrictive browser shell).
    return notificationPermission();
  }
}

/**
 * Show one browser notification. Returns whether the browser accepted it; the caller falls back
 * to a toast when it did not (permission denied, unsupported host, or constructor failure).
 */
export function showBrowserNotification(params: {
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly onClick: () => void;
}): boolean {
  if (notificationPermission() !== 'granted') return false;
  try {
    const notification = new window.Notification(params.title, {
      body: params.body,
      tag: params.tag,
    });
    notification.onclick = () => {
      window.focus();
      params.onClick();
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}
