import { afterEach, describe, expect, it, vi } from 'vitest';
import { notificationPermission, showBrowserNotification } from '../src/lib/notifications';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
  if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else Object.defineProperty(globalThis, 'window', originalWindow);
});

interface NotificationInstance {
  readonly title: string;
  readonly options: NotificationOptions;
  readonly close: () => void;
  onclick?: () => void;
}

function installNotification(permission: NotificationPermission): {
  readonly instances: NotificationInstance[];
  readonly focus: () => void;
} {
  const instances: NotificationInstance[] = [];
  class FakeNotification implements NotificationInstance {
    static readonly permission = permission;
    static requestPermission = vi.fn(async () => permission);
    readonly title: string;
    readonly options: NotificationOptions;
    readonly close = vi.fn();
    onclick?: () => void;
    constructor(title: string, options: NotificationOptions = {}) {
      this.title = title;
      this.options = options;
      instances.push(this);
    }
  }
  const focus = vi.fn();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { Notification: FakeNotification, focus },
  });
  return { instances, focus };
}

describe('browser notification helper', () => {
  it('reports unsupported when the host has no Notification constructor', () => {
    expect(notificationPermission()).toBe('unsupported');
    expect(showBrowserNotification({ title: 't', body: 'b', tag: 'x', onClick: () => undefined })).toBe(false);
  });

  it('shows a granted notification and focuses/activates on click', () => {
    const harness = installNotification('granted');
    const onClick = vi.fn();

    expect(notificationPermission()).toBe('granted');
    expect(showBrowserNotification({ title: 'Kaiming', body: 'Conversation finished', tag: 's-1:complete', onClick })).toBe(true);

    expect(harness.instances).toHaveLength(1);
    expect(harness.instances[0]?.title).toBe('Kaiming');
    expect(harness.instances[0]?.options).toMatchObject({ body: 'Conversation finished', tag: 's-1:complete' });
    harness.instances[0]?.onclick?.();
    expect(harness.focus).toHaveBeenCalledOnce();
    expect(onClick).toHaveBeenCalledOnce();
    expect(harness.instances[0]?.close).toHaveBeenCalledOnce();
  });

  it('does not show a notification without permission, and falls back on constructor failure', () => {
    installNotification('denied');
    expect(showBrowserNotification({ title: 't', body: 'b', tag: 'x', onClick: () => undefined })).toBe(false);

    class ThrowingNotification {
      static readonly permission = 'granted' as NotificationPermission;
      static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
      constructor() {
        throw new Error('constructor refused');
      }
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { Notification: ThrowingNotification, focus: vi.fn() },
    });
    expect(showBrowserNotification({ title: 't', body: 'b', tag: 'x', onClick: () => undefined })).toBe(false);
  });
});
