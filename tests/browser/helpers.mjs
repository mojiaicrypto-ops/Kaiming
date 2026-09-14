/**
 * Small helpers shared by the real-browser specs (WP-12 T7a).
 *
 * They only do transport/plumbing: sign in through the real login form, read the
 * fixture `globalSetup` wrote, address the isolated preview frame and call the real
 * `/rpc` from inside the browser. No product behaviour is simulated — an assertion that
 * needs a value gets it from the real page or the real HTTP answer.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { expect } from '@playwright/test';

import { FIXTURE_ENV, FIXTURE_PATH } from './fixture-path.mjs';

let cachedFixture;

/** The fixture `globalSetup` wrote (ephemeral URLs, token and seeded ids). */
export function browserFixture() {
  if (cachedFixture !== undefined) return cachedFixture;
  const file = process.env[FIXTURE_ENV] ?? FIXTURE_PATH;
  cachedFixture = JSON.parse(readFileSync(file, 'utf8'));
  return cachedFixture;
}

/**
 * Signs in through the real `#loginForm` with the installation token.
 *
 * The page's own script posts `/auth/login` and redirects to `/projects`; the helper
 * waits for that redirect, so a failed sign-in fails the spec instead of the next
 * assertion.
 */
export async function signIn(page, fixture = browserFixture()) {
  await page.goto(`${fixture.webUrl}/`);
  await expect(page.locator('#loginForm')).toBeVisible();
  await page.fill('#token', fixture.installationToken);
  await Promise.all([
    page.waitForURL('**/projects', { timeout: 20_000 }),
    page.click('#loginForm button[type="submit"]'),
  ]);
  await expect(page.locator('#shell')).toBeVisible();
}

/** Navigates to a path on the running BFF. */
export async function openPage(page, fixture, path) {
  await page.goto(`${fixture.webUrl}${path}`);
  await expect(page.locator('#shell')).toBeVisible();
}

/**
 * The iframe that hosts the isolated preview.
 *
 * The client sets `src` only after it has read the artifact's real mime from
 * `artifact.get`, so waiting for the frame to carry the preview URL is itself evidence
 * that the card resolved against the real protocol.
 */
export async function previewFrame(page) {
  await expect
    .poll(() => page.frames().filter((frame) => frame.url().includes('/preview')).length, {
      message: 'the isolated preview frame never navigated to /artifacts/<id>/preview',
    })
    .toBeGreaterThan(0);
  const frame = page.frames().find((candidate) => candidate.url().includes('/preview'));
  if (frame === undefined) throw new Error('preview frame disappeared');
  return frame;
}

/**
 * Calls one workbench method through the browser's own authenticated fetch.
 *
 * Used when a spec needs the server's answer as a value (for example a Run row before
 * and after a UI-only interaction) without going through the page's rendering.
 */
export async function rpcInBrowser(page, fixture, method, params = {}) {
  return page.evaluate(
    async (input) => {
      const session = await (await fetch('/api/session')).json();
      const response = await fetch('/rpc', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'x-csrf-token': session.csrfToken ?? '',
        },
        body: JSON.stringify({
          v: 1,
          type: 'request',
          id: `browser-${String(Date.now())}`,
          method: input.method,
          projectId: input.projectId,
          params: input.params,
        }),
      });
      return response.json();
    },
    { method, params, projectId: fixture.projectId },
  );
}

/** The temporary project's current revision, read with real Git. */
export function gitRevision(repoRoot, reference = 'HEAD') {
  return execFileSync('git', ['-C', repoRoot, 'rev-parse', reference], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  }).trim();
}

/** `git status --porcelain` of the temporary project. */
export function gitStatus(repoRoot) {
  return execFileSync('git', ['-C', repoRoot, 'status', '--porcelain'], {
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
  }).trim();
}

/** The URL path of the preview the page will load, for header assertions. */
export function previewPath(fixture) {
  return `/artifacts/${fixture.htmlArtifactId}/preview`;
}

/** The absolute `/rpc` requests the page issued, as `{method, params}` objects. */
export function rpcRequests(requests) {
  return requests
    .filter((entry) => entry.url.endsWith('/rpc'))
    .map((entry) => {
      try {
        return JSON.parse(entry.postData ?? '{}');
      } catch {
        return {};
      }
    });
}
