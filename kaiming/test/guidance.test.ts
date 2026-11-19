import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Store, type TaskRow } from '../src/store/store.ts';
import { guidanceFor } from '../src/tools/guidance.ts';

const dirs: string[] = [];
const stores: Store[] = [];

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function settleTask(store: Store, cwd: string): TaskRow {
  store.createProject({ id: 'p-1', realPath: cwd });
  store.createSession({ id: 'c-1', projectId: 'p-1', roleId: 'chief', cwd });
  return store.createTask({
    id: 't-settle',
    projectId: 'p-1',
    chiefSessionId: 'c-1',
    ownerEpoch: 1,
    type: 'write',
    requiresTest: false,
    initialPhase: 'settle',
    goal: 'deliver the page',
    scope: 'page',
    acceptanceRefs: [],
    basisRefs: [],
    planRef: { storage: 'server', path: '/tmp/plan.md', sha256: 'x' },
    authorizationRefs: [],
    sourceInputId: 'i-dec',
  });
}

describe('settlement guidance', () => {
  it('closes delivered backlog items without advertising a new backlog item for side findings', () => {
    const root = mkdtempSync(join(tmpdir(), 'kaiming-guidance-'));
    dirs.push(root);
    const cwd = join(root, 'project');
    mkdirSync(cwd, { recursive: true });
    const store = new Store({ path: join(root, 'state.db'), serverEpoch: 1 });
    stores.push(store);

    // The guidance row carries the Task's backlog link; the stored Task supplies the completion facts.
    const task = { ...settleTask(store, cwd), backlogIds: ['B-1'] };
    const settlement = guidanceFor(store, task).nextActions.find((action) =>
      action.action.includes('backlog(op=close'),
    );

    expect(settlement).toBeDefined();
    expect(settlement?.action).not.toContain('backlog(op=add)');
    expect(settlement?.action).not.toContain('record leftovers');
    expect(settlement?.action).toContain('side findings in the settlement report');
    expect(settlement?.reason).toContain('keeps side findings in the report');
  });
});
