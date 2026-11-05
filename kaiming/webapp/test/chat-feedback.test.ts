/**
 * The user-visible feedback contract for queued messages and Task controls: a queued message is
 * the text the reader wrote (never an opaque input id), and a control that has been pressed says
 * so immediately instead of waiting for a poll.
 */
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { QueuedInputs } from '../src/chat/QueuedInputs';
import { TaskStrip } from '../src/chat/TaskStrip';
import type { TaskDetail } from '../src/state/slot';
function render(node: ReactNode): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, { locale: 'en', onLocale: () => undefined, children: node }),
  );
}

const detail = (status: string): TaskDetail => ({
  task: {
    taskId: 't-1',
    type: 'write',
    phase: 'develop',
    status,
    revision: 3,
    goal: 'goal',
    scope: 'scope',
    nextStep: null,
    requiresTest: true,
  },
  members: [],
  results: [],
});

describe('queued input feedback', () => {
  it('shows the message text and image count, not the internal input id', () => {
    const html = render(
      createElement(QueuedInputs, {
        inputs: [
          { inputId: 'c-internal-123', status: 'queued', text: '补充一下认证边界', imageCount: 2, documentCount: 0 },
          { inputId: 'c-image-only', status: 'queued', text: '', imageCount: 1, documentCount: 0 },
        ],
        onWithdraw: async () => undefined,
      }),
    );
    expect(html).toContain('补充一下认证边界');
    expect(html).toContain('2 image(s)');
    expect(html).toContain('1 image(s)');
    expect(html).not.toContain('c-internal-123');
    expect(html).not.toContain('c-image-only');
    expect(html).toContain('Handed to the chief after the current step');
  });
});

describe('Task control feedback', () => {
  it('shows a pending pause and disables the pause control', () => {
    const html = render(
      createElement(TaskStrip, {
        detail: detail('active'),
        pendingQuestions: 0,
        pending: 'pause',
        onPause: () => undefined,
        onResume: () => undefined,
        onOpenTask: () => undefined,
      }),
    );
    expect(html).toContain('Pause requested');
    expect(html).toContain('data-testid="task-pause"');
    expect(html).toContain('disabled=""');
    expect(html).toContain('aria-busy="true"');
  });

  it('shows a pending resume and disables the resume control', () => {
    const html = render(
      createElement(TaskStrip, {
        detail: detail('paused'),
        pendingQuestions: 0,
        pending: 'resume',
        onPause: () => undefined,
        onResume: () => undefined,
        onOpenTask: () => undefined,
      }),
    );
    expect(html).toContain('Resuming…');
    expect(html).toContain('disabled');
    expect(html).toContain('aria-busy="true"');
  });
});
