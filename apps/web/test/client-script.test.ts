/**
 * The shipped browser script's reconnect policy (W9R1-10).
 *
 * `public/app.js` is a build artefact the server serves verbatim: it has no bundler
 * and no test harness of its own, so the browser-side facts the acceptance criteria
 * name are asserted against the shipped source. The reconnect ladder is one of them:
 * the previous fixed 2s infinite loop is exactly what `AC-078` bounds.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = readFileSync(fileURLToPath(new URL('../public/app.js', import.meta.url)), 'utf8');

/**
 * The required failure-test suite (`W9R2-06`).
 *
 * The disconnect case used to assert `typeof notice.id === 'string' || true`, which
 * is true under every outcome and therefore evidence of nothing. The assertion is
 * now a real field check; this guard keeps it that way, because the defect is the
 * test itself and a vacuous assertion cannot fail at runtime.
 */
const failures = readFileSync(
  fileURLToPath(new URL('./workbench-failures.integration.test.ts', import.meta.url)),
  'utf8',
);

describe('required failure-test hygiene (W9R2-06)', () => {
  it('contains no always-true assertion', () => {
    // `x || true`, `expect(true)`, `toBeTruthy()` on a literal — any of them would
    // pin the suite green regardless of the product.
    expect(failures).not.toMatch(/\|\|\s*true\s*\)/u);
    expect(failures).not.toMatch(/expect\(true\)/u);
  });

  it('asserts the real reconnect attempt of the disconnection notice', () => {
    expect(failures).toMatch(/notice\.attempt/u);
    expect(failures).toMatch(
      /expect\(Number\.isInteger\(notice\.attempt\) && \(notice\.attempt \?\? 0\) > 0\)\.toBe\(true\)/u,
    );
    expect(failures).not.toMatch(/notice\.id === 'string'/u);
  });
});

/** The shipped policy object, parsed out of the script source. */
function shippedPolicy(): {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly maxAttempts: number;
} {
  const block = /const reconnectPolicy = \{([\s\S]*?)\};/u.exec(script)?.[1] ?? '';
  const value = (key: string): number => {
    const match = new RegExp(`${key}:\\s*([0-9_]+)`, 'u').exec(block);
    if (match === null) throw new Error(`${key} is not in the shipped policy`);
    return Number((match[1] ?? '').replaceAll('_', ''));
  };
  return {
    baseDelayMs: value('baseDelayMs'),
    maxDelayMs: value('maxDelayMs'),
    maxAttempts: value('maxAttempts'),
  };
}

/**
 * The shipped delay function, evaluated from its own source.
 *
 * The body is extracted rather than re-implemented, so the test fails if the
 * script's arithmetic drifts away from the bounded policy.
 */
function shippedDelay(attempt: number): number {
  const body = /function reconnectDelay\(attempt\) \{([\s\S]*?)\n {2}\}/u.exec(script)?.[1];
  if (body === undefined) throw new Error('reconnectDelay is not in the shipped script');
  const policy = shippedPolicy();
  // The shipped function body is evaluated as source, so the test fails if its
  // arithmetic drifts; it is a fixed literal from this repository, not user input.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const evaluate = new Function('attempt', 'reconnectPolicy', body) as (
    attempt: number,
    shipped: { readonly baseDelayMs: number; readonly maxDelayMs: number },
  ) => number;
  return evaluate(attempt, policy);
}

describe('browser reconnect policy (W9R1-10)', () => {
  it('uses the same bounded exponential ladder as the client package', () => {
    const policy = shippedPolicy();
    expect(policy.baseDelayMs).toBe(1000);
    expect(policy.maxDelayMs).toBe(30000);
    expect(policy.maxAttempts).toBeGreaterThan(0);
    expect(policy.maxAttempts).toBeLessThanOrEqual(10);
    expect(shippedDelay(1)).toBe(1000);
    expect(shippedDelay(2)).toBe(2000);
    expect(shippedDelay(3)).toBe(4000);
    expect(shippedDelay(4)).toBe(8000);
    expect(shippedDelay(5)).toBe(16000);
    // The ladder is capped, never unbounded.
    expect(shippedDelay(6)).toBe(30000);
    expect(shippedDelay(50)).toBe(30000);
    expect(shippedDelay(0)).toBe(1000);
  });

  it('caps the attempts and reports the honest closed state instead of looping', () => {
    // The fixed 2s loop is gone, the attempt counter advances, and a socket that did
    // open resets the ladder so the next break starts at the base delay again.
    expect(script).not.toMatch(/setTimeout\(openSocket,\s*2000\)/u);
    expect(script).toMatch(/state\.reconnectAttempt \+= 1/u);
    expect(script).toMatch(/state\.reconnectAttempt > reconnectPolicy\.maxAttempts/u);
    expect(script).toMatch(/state\.reconnectAttempt = 0/u);
    expect(script).toMatch(/window\.setTimeout\(openSocket, delay\)/u);
    expect(script).toMatch(/showConnection\('closed'\)/u);
    expect(script).toMatch(/if \(state\.connection === 'expired'\) return/u);
  });
});

/**
 * The shipped provider helpers, evaluated from their own source (WP-12 T1.2B).
 *
 * `public/app.js` has no module boundary, so the function body is extracted and
 * executed with its documented parameter — the same technique the reconnect test
 * uses. A drift in the shipped rule changes this result instead of merely changing
 * a string that a looser assertion would still match.
 */
function shippedFunction<T>(name: string, parameter: string): (input: unknown) => T {
  const pattern = new RegExp(`function ${name}\\(${parameter}\\) \\{([\\s\\S]*?)\\n {2}\\}`, 'u');
  const body = pattern.exec(script)?.[1];
  if (body === undefined) throw new Error(`${name} is not in the shipped script`);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(parameter, body) as (input: unknown) => T;
}

interface ProviderUpsertResult {
  readonly ok: boolean;
  readonly params?: {
    readonly provider: Record<string, unknown>;
    readonly secret?: string;
  };
  readonly error?: { readonly code: string; readonly message: string };
}

interface ProviderTestOutcome {
  readonly accepted: boolean | null;
  readonly detail: string;
}

describe('provider editor parameters (WP-12 T1.2B)', () => {
  const build = shippedFunction<ProviderUpsertResult>('providerUpsertParams', 'input');

  const fields = (overrides: Record<string, unknown> = {}): unknown => ({
    providerId: 'p1',
    type: 'openai-compatible',
    baseUrl: 'https://api.example/v1',
    enabled: true,
    models: '[]',
    secret: '',
    ...overrides,
  });

  it('omits the secret when the API key field is empty, which keeps the credential', () => {
    const result = build(fields());
    expect(result.ok).toBe(true);
    expect(result.params?.provider).toEqual({
      providerId: 'p1',
      type: 'openai-compatible',
      baseUrl: 'https://api.example/v1',
      enabled: true,
      models: [],
    });
    expect(result.params !== undefined && 'secret' in result.params).toBe(false);
  });

  it('sends the typed secret beside the provider and never inside it', () => {
    const result = build(fields({ secret: 'sk-live-123' }));
    expect(result.params?.secret).toBe('sk-live-123');
    expect(Object.keys(result.params?.provider ?? {})).not.toContain('secret');
    expect(JSON.stringify(result.params?.provider ?? {})).not.toContain('sk-live-123');
  });

  it('omits a blank provider id so the server creates one', () => {
    const result = build(fields({ providerId: '   ' }));
    expect(result.ok).toBe(true);
    expect(result.params?.provider).not.toHaveProperty('providerId');
  });

  it('refuses an invalid type, a missing base URL and non-array models before any request', () => {
    expect(build(fields({ type: 'nope' })).error?.code).toBe('VALIDATION_ERROR');
    expect(build(fields({ baseUrl: '  ' })).ok).toBe(false);
    expect(build(fields({ models: 'not json' })).ok).toBe(false);
    expect(build(fields({ models: '{"id":"m"}' })).ok).toBe(false);
  });

  it('classifies a provider.test_completed summary without inventing success', () => {
    const outcome = shippedFunction<ProviderTestOutcome>('providerTestOutcome', 'data');
    expect(outcome({ ok: true, modelId: 'm', latencyMs: 12 }).accepted).toBe(true);
    expect(
      outcome({ accepted: false, error: 'PROVIDER_UNAVAILABLE: no credential' }).accepted,
    ).toBe(false);
    // An event the UI cannot classify stays null: never a success.
    expect(outcome({}).accepted).toBe(null);
    expect(outcome({ ok: true, latencyMs: 12 }).detail).toContain('latencyMs: 12');
  });

  it('posts the documented commands, preserves a rejection and handles the event', () => {
    expect(script).toContain("'provider.upsert'");
    expect(script).toContain("'provider.test'");
    // The save handler, up to the connection-test control it installs.
    const saveHandler = script.slice(
      script.indexOf('function initProviderEditor'),
      script.indexOf('const testButton = editor.querySelector'),
    );
    expect(saveHandler).toContain('showProviderError(editor, answer.error, true);');
    // The rejection branch returns without touching any field: the typed API key
    // stays exactly as the operator left it, like the existing configForm pattern.
    const rejectBranch = saveHandler.slice(
      saveHandler.indexOf('if (!answer.ok)'),
      saveHandler.indexOf("showProviderResult(editor, 'saved')"),
    );
    expect(rejectBranch).toContain('return;');
    expect(rejectBranch).not.toContain(".value = ''");
    // The value is only ever cleared, and only after the accepted answer.
    const clearAt = saveHandler.indexOf("secretField.value = ''");
    expect(clearAt).toBeGreaterThan(saveHandler.indexOf("showProviderResult(editor, 'saved')"));
    expect(clearAt).toBeGreaterThan(-1);
    // The persistent event drives the result line.
    expect(script).toContain("frame.name !== 'provider.test_completed'");
    expect(script).toContain("showProviderResult(editor, 'test-accepted')");
    expect(script).toContain("showProviderResult(editor, 'test-completed')");
    // An immediate `accepted:false` result is a refusal, not a running test.
    expect(script).toContain('answer.result.accepted === false');
    // No secret value is ever written into a `data-*` attribute or rendered text.
    expect(script).not.toMatch(/dataset\.[A-Za-z]*[Ss]ecret\s*=/u);
    expect(script).not.toMatch(/textContent\s*=\s*[^;\n]*secretField/u);
    // The settings page subscribes, so the completion event can reach the editor.
    expect(script).toMatch(/page === 'settings'/u);
  });
});

/**
 * The shipped pure helpers, evaluated from their own source (WP-12 T4).
 *
 * The same technique as above: the function body is extracted and executed with its
 * documented parameters, so the client rules are asserted as behaviour rather than
 * as strings a looser assertion would still match.
 */
function shippedPure<T>(name: string, parameters: readonly string[]): (...args: unknown[]) => T {
  const signature = parameters
    .map((parameter) => parameter.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join(', ');
  const pattern = new RegExp(`function ${name}\\(${signature}\\) \\{([\\s\\S]*?)\\n {2}\\}`, 'u');
  const body = pattern.exec(script)?.[1];
  if (body === undefined) throw new Error(`${name} is not in the shipped script`);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(...parameters, body) as (...args: unknown[]) => T;
}

interface ActionRequest {
  readonly ok: boolean;
  readonly method?: string;
  readonly params?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string };
}

describe('requirement actions (WP-12 T4)', () => {
  const build = shippedPure<ActionRequest>('boardActionRequest', ['action', 'data']);

  it('routes every action to the real command that expresses it', () => {
    expect(build('continue', { requirement: 'r1' })).toEqual({
      ok: true,
      method: 'requirement.continue',
      params: { requirementId: 'r1' },
    });
    expect(build('archive', { requirement: 'r1' })).toMatchObject({
      method: 'requirement.archive',
      params: { requirementId: 'r1' },
    });
    expect(build('complete', { requirement: 'r1' })).toMatchObject({
      method: 'requirement.save',
      params: { requirementId: 'r1', patch: { lifecycle: 'completed' } },
    });
    expect(build('pause', { work: 'w1', reason: 'workbench' })).toMatchObject({
      method: 'work.control',
      params: { action: 'pause', workId: 'w1', reason: 'workbench' },
    });
    expect(build('resume', { work: 'w1' })).toMatchObject({
      method: 'work.control',
      params: { action: 'resume', workId: 'w1' },
    });
    // A Queued requirement without local Work cancels by requirement id (AC-068).
    expect(build('cancel', { requirement: 'r1' })).toMatchObject({
      method: 'work.control',
      params: { action: 'cancel', requirementId: 'r1' },
    });
    expect(build('cancel', { work: 'w1' })).toMatchObject({
      params: { action: 'cancel', workId: 'w1' },
    });
    expect(build('nope', { requirement: 'r1' }).error?.code).toBe('VALIDATION_ERROR');
  });

  it('sends an idempotency key and keeps the protocol code on a refusal', () => {
    const handler = script.slice(
      script.indexOf('async function runRequirementAction'),
      script.indexOf('async function initBoard'),
    );
    expect(handler).toContain('newIdempotencyKey(`requirement-${action}`)');
    // `work.control` compares the Work version, so the card's version travels.
    expect(handler).toContain("built.method === 'work.control'");
    expect(handler).toContain('options.expectedVersion = version');
    // The refusal branch renders the code and message and returns before any reload:
    // the card keeps exactly the state it was rendered from.
    const refusal = handler.slice(
      handler.indexOf('if (!answer.ok)'),
      handler.indexOf('showError(errorId, null)'),
    );
    expect(refusal).toContain('showError(errorId, answer.error);');
    expect(refusal).toContain('return;');
    expect(refusal).not.toContain('location.reload');
    expect(refusal).not.toContain('.value =');
    // Only an accepted answer reloads, so the next state is read from the server.
    expect(handler.indexOf('location.reload')).toBeGreaterThan(
      handler.indexOf('showError(errorId, null)'),
    );
    // The detail page wires the same handler, so both surfaces behave identically.
    expect(script).toContain("runRequirementAction(button, 'detailError')");
  });
});

describe('inbox actions (WP-12 T4c, AC-074)', () => {
  const build = shippedPure<ActionRequest>('inboxActionRequest', ['action', 'data']);

  it('routes a saved decision choice through decision.resolve', () => {
    expect(build('accept', { decision: 'd1', choice: 'accept' })).toEqual({
      ok: true,
      method: 'decision.resolve',
      params: { decisionId: 'd1', choice: 'accept' },
    });
    expect(build('', { decision: 'd1', choice: '' }).error?.code).toBe('VALIDATION_ERROR');
    expect(build('accept', { decision: '', choice: 'accept' }).ok).toBe(false);
  });

  it('routes approve and deny through permission.respond', () => {
    expect(build('approve', { decision: 'd1', choice: 'approve', permission: true })).toEqual({
      ok: true,
      method: 'permission.respond',
      params: { decisionId: 'd1', choice: 'approve' },
    });
    expect(
      build('deny', { decision: 'd1', choice: 'deny', permission: true, reason: '  too broad  ' }),
    ).toEqual({
      ok: true,
      method: 'permission.respond',
      params: { decisionId: 'd1', choice: 'deny', reason: 'too broad' },
    });
    expect(build('maybe', { decision: 'd1', choice: 'maybe', permission: true }).error?.code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('refuses a denial with no recorded reason before any request', () => {
    const denied = build('deny', { decision: 'd1', choice: 'deny', permission: true, reason: ' ' });
    expect(denied.ok).toBe(false);
    expect(denied.error?.code).toBe('VALIDATION_ERROR');
    expect(denied.method).toBeUndefined();
  });

  it('wires the handler with an idempotency key, the target version and no reload on refusal', () => {
    const handler = script.slice(
      script.indexOf('async function initInbox'),
      script.indexOf('async function initSettings'),
    );
    expect(handler).toContain('newIdempotencyKey(');
    expect(handler).toContain("built.method === 'permission.respond'");
    expect(handler).toContain('expectedVersion: targetVersion');
    expect(handler).toContain("translateClient('inbox.denyReasonRequired')");
    // The refusal branch renders the protocol code and message and returns before any
    // refresh: the entry keeps exactly the state it was rendered from.
    const refusal = handler.slice(
      handler.indexOf('if (!answer.ok)'),
      handler.indexOf('const denied ='),
    );
    expect(refusal).toContain("showError('inboxError', answer.error)");
    expect(refusal).toContain('return;');
    expect(refusal).not.toContain('location.reload');
    expect(refusal).not.toContain('refreshInbox');
    // Only an applied answer reads the new state back from the server.
    expect(handler.indexOf('refreshInbox()')).toBeGreaterThan(handler.indexOf('if (!answer.ok)'));
    // An expired/conflicting entry is disabled rather than retried (AC-074).
    expect(handler).toContain("answer.error.code === 'INVALID_STATE'");
    expect(handler).toContain("answer.error.code === 'VERSION_CONFLICT'");
  });

  it('never approves on its own and shows the binding before the deliberate click', () => {
    expect(script).toContain('button.dataset.permission');
    expect(script).toContain('applyPermissionBindings');
    expect(script).toContain('querySelectorAll(\'button[data-permission="approve"]\')');
    // The binding arrives from the documented refusal event, keyed by tool operation.
    expect(script).toContain("frame.name === 'tool.refused'");
    expect(script).toContain('rememberToolRefusal');
    expect(script).toContain('row.dataset.toolOperation');
    // There is no unconditional submit of an approval anywhere in the script.
    expect(script).not.toMatch(/permission\.respond['"]\s*,\s*\{\s*choice:\s*'approve'/u);
  });

  it('refreshes the Inbox from the server on the documented live events', () => {
    expect(script).toMatch(/inboxEvents = \[/u);
    for (const name of ['decision.created', 'decision.resolved', 'permission.resolved']) {
      expect(script).toContain(`'${name}'`);
    }
    expect(script).toContain('bestEffort(refreshInbox)');
    expect(script).toContain('handleInboxEvent(frame)');
    // A GET of the same page: refreshing the list cannot change a Run.
    expect(script).toContain('fetch(window.location.pathname');
    expect(script).toContain("showError('inboxRefreshError'");
  });
});

describe('interface language switching (WP-12 T4)', () => {
  it('writes the agentdev_language cookie so the choice survives a reload', () => {
    const cookie = shippedPure<string>('languageCookie', ['language']);
    expect(cookie('zh')).toBe('agentdev_language=zh; path=/; max-age=31536000; SameSite=Lax');
    expect(cookie('en')).toContain('agentdev_language=en;');
    expect(script).toContain('document.cookie = languageCookie(language)');
  });

  it('derives the Live-panel aria-label from the dictionary, never from the DOM', () => {
    const label = shippedPure<string>('panelAriaLabel', [
      'key',
      'language',
      'strings',
      'dictionary',
    ]);
    expect(
      label(
        'aria.liveDockCompact',
        'en',
        {},
        {
          en: { 'aria.liveDockCompact': 'Live panel, compact' },
          zh: {},
        },
      ),
    ).toBe('Live panel, compact');
    expect(
      label(
        'aria.liveDockHidden',
        'zh',
        {},
        {
          en: {},
          zh: { 'aria.liveDockHidden': '实时面板，已隐藏' },
        },
      ),
    ).toBe('实时面板，已隐藏');
    // The daemon catalogue is still honoured where the local dictionary has no key.
    expect(
      label('aria.liveDockOpen', 'en', { 'aria.liveDockOpen': 'Live panel, open' }, { en: {} }),
    ).toBe('Live panel, open');
    // The regression: with no dictionary entry the key is the fallback, never the
    // label the button already carried (`data-mode="compact"` + "Live panel, open").
    expect(label('aria.liveDockCompact', 'en', {}, { en: {} })).toBe('aria.liveDockCompact');
    expect(script).not.toContain("toggle.getAttribute('aria-label') || mode");
    expect(script).toContain(
      'panelAriaLabel(key, state.language, state.strings, state.dictionary)',
    );
  });

  it('merges the embedded dictionary over the daemon catalogue for the whole page', () => {
    expect(script).toContain('readClientDictionary');
    expect(script).toContain("document.getElementById('uiStrings')");
    expect(script).toMatch(
      /state\.strings = \{ \.\.\.resolved, \.\.\.\(state\.dictionary\[language\]/u,
    );
    // Strings the client renders itself resolve through the dictionary as well.
    expect(script).toContain('translateClient(reasonKey)');
    expect(script).toContain("translateClient('board.pauseQueuedRefused')");
    expect(script).toContain("translateClient('connection.reconnecting')");
  });

  it('returns focus to the Live restore control when the overlay closes (AC-071)', () => {
    const closeHandler = script.slice(
      script.indexOf("const close = document.getElementById('liveDockClose')"),
      script.indexOf('function appendLive'),
    );
    expect(closeHandler).toContain("setPanelMode('compact')");
    expect(closeHandler).toContain('toggle.focus()');
  });
});
