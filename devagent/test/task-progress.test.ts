/**
 * The external surface must describe a Task exactly as the browser does: same phase-rounds, same
 * planned tail. Both implementations read `test-fixtures/task-progress.json`; this test is the
 * server half of that pin (the webapp has the other half).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { taskProgress } from '../src/runtime/task-progress.ts';

interface Case {
  readonly name: string;
  readonly task: { readonly type: string; readonly phase: string; readonly status: string; readonly requiresTest: boolean };
  readonly members: readonly {
    readonly phase: string;
    readonly roleId: string;
    readonly label: string;
    readonly activity: string;
    readonly lastInputStatus: string | null;
    readonly latestVerdict?: string | null;
  }[];
  readonly steps: readonly { readonly phase: string; readonly round: number; readonly state: string }[];
  readonly stepsDone: number;
  readonly stepsTotal: number;
}

const fixture = JSON.parse(readFileSync(new URL('../test-fixtures/task-progress.json', import.meta.url), 'utf8')) as {
  readonly cases: readonly Case[];
};

describe('the flow of a Task as an external caller sees it', () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const progress = taskProgress({ task: testCase.task, members: testCase.members });
      expect(progress.steps.map((step) => ({ phase: step.phase, round: step.round, state: step.state }))).toEqual(
        testCase.steps,
      );
      expect(progress.stepsDone).toBe(testCase.stepsDone);
      expect(progress.stepsTotal).toBe(testCase.stepsTotal);
    });
  }

  it('reports a member that did not pass as evidence, not as a completed step', () => {
    const rework = fixture.cases.find((entry) => entry.name.startsWith('rework'));
    expect(rework).toBeDefined();
    const progress = taskProgress({ task: rework!.task, members: rework!.members });
    const review = progress.steps.find((step) => step.phase === 'review');
    expect(review?.state).toBe('in_progress');
    expect(review?.members.map((member) => member.passed)).toEqual([false]);
  });
});
