import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginThroughUi, startHarness } from './harness.ts';
import { expect, test } from '@playwright/test';
import { Store } from '../src/store/store.ts';

/**
 * U11: a failed member's roster row must name the reason in the user's language — the catalog
 * sentence for a known terminal error code, the raw code when none exists. This is the surface
 * the 2026-11-13 incident diagnosis called for: the chief (and the user) must see WHY a member
 * failed without opening its transcript.
 */

test('a failed member row resolves its terminal error code, with a raw-code fallback', async ({ page }) => {
  const harness = await startHarness();
  try {
    const project = harness.project;
    if (project === null) throw new Error('the harness must seed a project');
    // The spec writes the Task's rows through a second Store connection (WAL): the same rows the
    // browser's task.get reads, with the store's own invariants instead of hand-written SQL.
    const store = new Store({ path: join(harness.dataDir, 'state.db'), serverEpoch: 1 });
    const task = store.createTask({
      id: 't-u11',
      projectId: project.projectId,
      chiefSessionId: project.sessionId,
      ownerEpoch: 1,
      type: 'write',
      requiresTest: false,
      goal: 'deliver the change',
      scope: 'account',
      acceptanceRefs: [],
      basisRefs: [],
      planRef: { storage: 'server', path: '/tmp/u11-plan.md', sha256: 'x' },
      authorizationRefs: ['i-dec'],
      sourceInputId: 'i-1',
    });
    store.updateTask({ taskId: task.id, phase: 'develop' });
    store.createTaskSessions({
      taskId: task.id,
      members: [
        {
          sessionId: 's-u11-exhausted',
          taskId: task.id,
          roleId: 'developer',
          phase: 'develop',
          label: 'implement',
          instructions: 'do it',
          refs: [],
          dependencies: [],
          expectedKind: 'implementation',
          writeScope: ['src/feature.ts'],
          inputId: 'i-u11-exhausted',
          inputPayload: { content: [{ type: 'text', text: 'do it' }] },
        },
        {
          sessionId: 's-u11-unknown',
          taskId: task.id,
          roleId: 'developer',
          phase: 'develop',
          label: 'implement-2',
          instructions: 'do it too',
          refs: [],
          dependencies: [],
          expectedKind: 'implementation',
          writeScope: ['src/other.ts'],
          inputId: 'i-u11-unknown',
          inputPayload: { content: [{ type: 'text', text: 'do it too' }] },
        },
        {
          sessionId: 's-u11-plain',
          taskId: task.id,
          roleId: 'developer',
          phase: 'develop',
          label: 'implement-3',
          instructions: 'do it three',
          refs: [],
          dependencies: [],
          expectedKind: 'implementation',
          writeScope: ['src/more.ts'],
          inputId: 'i-u11-plain',
          inputPayload: { content: [{ type: 'text', text: 'do it three' }] },
        },
      ],
    });
    // The roster reads the plan text; a real file with a matching digest keeps the strip on its
    // normal path instead of the missing-plan branch.
    writeFileSync('/tmp/u11-plan.md', '# u11 plan\n');
    const planSha = createHash('sha256').update('# u11 plan\n').digest('hex');
    store.updateTask({ taskId: task.id, planRef: { storage: 'server', path: '/tmp/u11-plan.md', sha256: planSha } });
    for (const [sessionId, inputId, errorCode] of [
      ['s-u11-exhausted', 'i-u11-exhausted', 'REPORT_RETRY_EXHAUSTED'],
      ['s-u11-unknown', 'i-u11-unknown', 'SOMETHING_NEW'],
      ['s-u11-plain', 'i-u11-plain', 'SOMETHING_NEW'],
    ] as const) {
      const claimed = store.claimNextInput(sessionId);
      if (claimed.kind !== 'claimed') throw new Error(`claim failed for ${sessionId}: ${claimed.kind}`);
      const input = store.getInput(claimed.input.inputId);
      const finished = store.finishInput({
        inputId,
        expectedRevision: input.revision,
        status: 'failed',
        errorCode,
        errorMessage: 'agent_report failed 5 consecutive times',
      });
      if (!finished) throw new Error(`finish failed for ${inputId}`);
    }
    // The unknown code keeps its own name on a plain failure (a delivered report exists, so the
    // row is not "Report missing"); a missing-report row with an unknown code keeps the generic
    // note — the missing fact is the accurate one there.
    store.recordResult({
      resultId: 'r-u11-plain',
      taskId: task.id,
      sessionId: 's-u11-plain',
      inputId: 'i-u11-plain',
      roleId: 'developer',
      kind: 'implementation',
      summary: 'partial delivery',
      deliveryState: { digest: 'x', paths: [] },
      bodyRef: { storage: 'server', path: '/tmp/u11-plain.md', sha256: 'x' },
      basisRefs: [],
      checks: [],
    });
    // Bind the chief session to the Task the way dispatch would: the shell fetches the roster
    // only when the open session's currentTaskId is set.
    const bind = new DatabaseSync(join(harness.dataDir, 'state.db'));
    bind.prepare("UPDATE sessions SET currentTaskId = 't-u11' WHERE id = ?").run(project.sessionId);
    bind.close();
    await page.goto(harness.url);
    // A fresh browser profile has no remembered project: log in, then open the seeded project
    // through the switcher exactly as a person does.
    await loginThroughUi(page, harness.accessPassword);
    await page.locator('[data-testid="project-switcher"]').click();
    await page.locator('[data-testid="project-path"]').fill(project.projectPath);
    await page.locator('[data-testid="project-path"]').press('Enter');
    await page.locator('[data-testid="task-member-row"]').first().waitFor({ timeout: 20_000 });
    const rows = page.locator('[data-testid="task-member-row"]');
    await expect(rows).toHaveCount(3);
    // The roster order is not the creation order: match rows by their label, not by index.
    const texts = await rows.allTextContents();
    console.log('roster rows:', JSON.stringify(texts));
    expect(texts).toHaveLength(3);
    expect(texts.some((t) => t.includes('The report failed repeatedly'))).toBe(true);
    expect(texts.some((t) => t.includes('implement-3') && t.includes('SOMETHING_NEW'))).toBe(true);
    expect(texts.some((t) => t.includes('implement-2') && t.includes('Report missing'))).toBe(true);
    // A resolvable code never leaks its raw name when a sentence exists.
    expect(texts.some((t) => t.includes('REPORT_RETRY_EXHAUSTED'))).toBe(false);
    await page.screenshot({ path: 'test-results/u11-roster.png', fullPage: true });
  } finally {
    await harness.close();
  }
});
