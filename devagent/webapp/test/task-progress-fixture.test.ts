/**
 * The browser flow and the external surface must answer "what are the Task's steps" identically.
 * Both read `test-fixtures/task-progress.json`: this is the webapp half of the pin (the server has
 * the other half in `test/task-progress.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flowOf } from '../src/chat/task-flow';
import { rosterGroupsOf } from '../src/chat/TaskTodo';

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
}

const fixture = JSON.parse(readFileSync(new URL('../../test-fixtures/task-progress.json', import.meta.url), 'utf8')) as {
  readonly cases: readonly Case[];
};

const stateOf = (step: { readonly kind: string; readonly done: boolean }): string =>
  step.kind === 'plan' ? 'planned' : step.done ? 'completed' : 'in_progress';

describe('the shared Task flow fixture', () => {
  for (const testCase of fixture.cases) {
    it(testCase.name, () => {
      const groups = rosterGroupsOf(testCase.members, testCase.task.phase);
      const flow = flowOf({
        task: testCase.task,
        members: testCase.members.map((member) => ({
          phase: member.phase,
          activity: member.activity,
          lastInputStatus: member.lastInputStatus as 'completed' | 'failed' | 'stopped' | 'interrupted' | null,
          latestVerdict: member.latestVerdict ?? null,
        })),
        pendingQuestions: 0,
      });
      // Real steps keep their phase-round identity; the tail is the plan only.
      expect(groups.map((group) => ({ phase: group.phase, round: group.round }))).toEqual(
        testCase.steps.filter((step) => step.state !== 'planned').map((step) => ({ phase: step.phase, round: step.round })),
      );
      expect(flow.map((step) => ({ phase: step.phase, round: step.round, state: stateOf(step) }))).toEqual(testCase.steps);
    });
  }
});
