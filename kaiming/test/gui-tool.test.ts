/**
 * `gui` tool: the fixed capture contract, TCC/helper failures and real attachment storage.
 *
 * The unit suite never launches a real macOS screen capture (that needs a TCC-granted signed app);
 * the real helper build is checked separately. A fake launcher writes the same PNG bytes the helper
 * would, so storage and the model-visible image block are exercised without pretending TCC passed.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createGuiTool,
  helperArguments,
  parseGuiParams,
  type GuiCaptureRequest,
  type GuiRunResult,
} from '../src/tools/gui-tool.ts';
import { imageIdOf, readImage } from '../src/server/attachments.ts';
import type { ToolOutcome } from '../src/tools/tool-kit.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kaiming-gui-'));
  dirs.push(dir);
  return dir;
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function textOf(outcome: ToolOutcome): string {
  return outcome.content.map((block) => block.text).join('\n');
}

function makeTool(options: {
  readonly dir?: string;
  readonly launcher?: (request: GuiCaptureRequest, helperPath: string) => GuiRunResult;
  readonly platform?: NodeJS.Platform;
  readonly helperPath?: string;
} = {}) {
  return createGuiTool({
    agentDir: options.dir ?? agentDir(),
    platform: options.platform ?? 'darwin',
    ...(options.launcher !== undefined ? { launcher: options.launcher } : {}),
    ...(options.helperPath !== undefined ? { helperPath: options.helperPath } : {}),
  });
}

describe('gui parameter contract', () => {
  it('accepts the three fixed targets and their own fields', () => {
    expect(parseGuiParams({ target: 'screen' })).toEqual({ ok: true, params: { target: 'screen' } });
    expect(parseGuiParams({ target: 'screen', display: 1 })).toEqual({
      ok: true,
      params: { target: 'screen', display: 1 },
    });
    expect(parseGuiParams({ target: 'window', windowId: 42 })).toEqual({
      ok: true,
      params: { target: 'window', windowId: 42 },
    });
    expect(parseGuiParams({ target: 'region', x: -10, y: 20, width: 375, height: 812 })).toEqual({
      ok: true,
      params: { target: 'region', x: -10, y: 20, width: 375, height: 812 },
    });
  });

  it('rejects unknown keys, cross-target fields and invalid numbers before any helper launch', () => {
    const cases: Array<Record<string, unknown>> = [
      { target: 'screen', x: 0, y: 0, width: 1, height: 1 },
      { target: 'screen', windowId: 1 },
      { target: 'screen', display: 32 },
      { target: 'window', windowId: 0 },
      { target: 'window', windowId: 1, width: 1 },
      { target: 'region', x: 0, y: 0, width: 0, height: 1 },
      { target: 'region', x: 0, y: 0, width: 1 },
      { target: 'region', display: 0, x: 0, y: 0, width: 1, height: 1 },
      { target: 'region', x: 3.5, y: 0, width: 1, height: 1 },
      { target: 'screen', path: '/tmp/anywhere.png' },
      { target: 'other' },
      {},
    ];
    for (const params of cases) {
      expect(parseGuiParams(params), JSON.stringify(params)).toEqual({
        ok: false,
        message: expect.any(String),
      });
    }
  });

  it('builds only the fixed helper argv, with host-generated output and status paths', () => {
    expect(helperArguments({ target: 'screen', display: 2 }, '/tmp/out.png', '/tmp/status.json')).toEqual([
      '--out', '/tmp/out.png', '--status', '/tmp/status.json', '--target', 'screen', '--display', '2',
    ]);
    expect(helperArguments({ target: 'window', windowId: 7 }, '/tmp/out.png', '/tmp/status.json')).toEqual([
      '--out', '/tmp/out.png', '--status', '/tmp/status.json', '--target', 'window', '--window-id', '7',
    ]);
    expect(helperArguments({ target: 'region', x: 1, y: 2, width: 3, height: 4 }, '/tmp/out.png', '/tmp/status.json')).toEqual([
      '--out', '/tmp/out.png', '--status', '/tmp/status.json', '--target', 'region', '--x', '1', '--y', '2', '--width', '3', '--height', '4',
    ]);
  });
});

describe('gui execution', () => {
  it('stores a successful PNG exactly once and returns the attachment id', async () => {
    const dir = agentDir();
    const requests: GuiCaptureRequest[] = [];
    const tool = makeTool({
      dir,
      launcher: (request) => {
        requests.push(request);
        writeFileSync(request.outPath, PNG);
        return { ok: true };
      },
    });
    const outcome = await tool.execute('call-1', { target: 'region', x: 0, y: 0, width: 1, height: 1 });
    expect(outcome.isError).toBe(false);
    expect(outcome.details['attachmentId']).toBe(imageIdOf(PNG));
    expect(outcome.details['target']).toBe('region');
    expect(outcome.details['width']).toBe(1);
    expect(textOf(outcome)).toContain(imageIdOf(PNG));
    expect(outcome.images?.[0]?.mimeType).toBe('image/png');
    expect(readImage(dir, imageIdOf(PNG))?.bytes.equals(PNG)).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.outPath).not.toBe('/tmp/out.png');
  });

  it('turns a TCC denial into a real tool error with no attachment', async () => {
    const tool = makeTool({
      launcher: () => ({ ok: false, code: 'TCC_DENIED', message: 'screen recording is denied' }),
    });
    const outcome = await tool.execute('call-2', { target: 'screen' });
    expect(outcome.isError).toBe(true);
    expect(outcome.details['code']).toBe('TCC_DENIED');
    expect(outcome.details['permission']).toBe('screen-recording');
    expect(textOf(outcome)).toContain('Screen Recording');
    expect(outcome.images).toBeUndefined();
  });

  it('reports a missing helper and a missing output instead of claiming success', async () => {
    const tool = makeTool({
      launcher: () => ({ ok: false, code: 'HELPER_UNAVAILABLE', message: 'not built' }),
    });
    const missing = await tool.execute('call-3', { target: 'screen' });
    expect(missing.isError).toBe(true);
    expect(missing.details['code']).toBe('HELPER_UNAVAILABLE');

    const noFile = makeTool({ launcher: () => ({ ok: true }) });
    const outcome = await noFile.execute('call-4', { target: 'screen' });
    expect(outcome.isError).toBe(true);
    expect(outcome.details['code']).toBe('CAPTURE_FAILED');
  });

  it('refuses a non-PNG payload rather than attaching an unrelated file', async () => {
    const tool = makeTool({
      launcher: (request) => {
        writeFileSync(request.outPath, 'not an image');
        return { ok: true };
      },
    });
    const outcome = await tool.execute('call-5', { target: 'screen' });
    expect(outcome.isError).toBe(true);
    expect(outcome.details['code']).toBe('STORAGE_UNAVAILABLE');
  });

  it('does not invoke a helper on unsupported platforms', async () => {
    let launched = false;
    const tool = makeTool({
      platform: 'linux',
      launcher: () => {
        launched = true;
        return { ok: true };
      },
    });
    const outcome = await tool.execute('call-6', { target: 'screen' });
    expect(outcome.isError).toBe(true);
    expect(outcome.details['code']).toBe('UNSUPPORTED_PLATFORM');
    expect(launched).toBe(false);
  });
});
