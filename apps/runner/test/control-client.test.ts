/**
 * Control-channel tests for the Runner (WP-12 T2.3).
 *
 * `protocol.md` §6 is the channel the Chief submits its assessment through and a
 * professional Run submits its stage result through. These tests drive the real loopback
 * client against a recording Core endpoint, so what is asserted is the wire contract: the
 * capability is presented as a Bearer token, the documented path carries the documented
 * body, a refusal keeps its protocol code, and each tool reports its own delivery.
 */
import { createServer, type Server } from 'node:http';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stageResultContentSchema } from '@agentdev/contracts';
import type { PiToolSpec } from '@agentdev/pi-runtime';
import {
  ControlError,
  controlTools,
  createControlClient,
  type ControlClient,
} from '../src/control-client.js';
import { createReadLedger } from '../src/read-ledger.js';

interface Recorded {
  readonly path: string;
  readonly authorization: string | undefined;
  readonly body: Record<string, unknown>;
}

let server: Server;
let port: number;
let recorded: Recorded[];
let answer: { status: number; body: unknown };
let calls: string[];

async function listen(): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  return address !== null && typeof address === 'object' ? address.port : 0;
}

beforeEach(async () => {
  recorded = [];
  calls = [];
  answer = { status: 200, body: { saved: true } };
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      recorded.push({
        path: request.url ?? '',
        authorization: request.headers.authorization,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>,
      });
      response.writeHead(answer.status, { 'content-type': 'application/json' });
      response.end(`${JSON.stringify(answer.body)}\n`);
    });
  });
  port = await listen();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client(): ControlClient {
  return createControlClient({
    url: `http://127.0.0.1:${String(port)}`,
    capability: 'attempt-capability',
    attemptId: 'attempt-1',
    epoch: 3,
  });
}

/**
 * The Attempt's read-ledger seal.
 *
 * `stage_yield` writes it into every submission (`AC-085`), so a tool built without one
 * cannot produce a Core-valid payload and says so instead of spending a Schema strike.
 */
const SEAL = createReadLedger().seal();

describe('runner control client (protocol.md §6)', () => {
  it('posts each method to its documented path with the capability and the epoch', async () => {
    const control = client();
    await control.assessmentSubmit({ workId: 'work-1', assessment: { intent: 'delivery' } });
    await control.agentDispatch({ spec: { role: 'backend' } });
    await control.stageSubmit({ result: { status: 'success', summary: 'done' } });
    expect(recorded.map((entry) => entry.path)).toEqual([
      '/control/assessment.submit',
      '/control/agent.dispatch',
      '/control/stage.submit',
    ]);
    for (const entry of recorded) {
      expect(entry.authorization).toBe('Bearer attempt-capability');
      expect(entry.body['attemptId']).toBe('attempt-1');
      expect(entry.body['epoch']).toBe(3);
    }
    expect(recorded[0]?.body).toMatchObject({
      workId: 'work-1',
      assessment: { intent: 'delivery' },
    });
    expect(recorded[2]?.body).toMatchObject({
      result: { status: 'success', summary: 'done' },
    });
  });

  it('keeps the protocol code of a refusal instead of flattening it', async () => {
    answer = { status: 400, body: { error: { code: 'VALIDATION_ERROR', message: 'bad spec' } } };
    await expect(client().stageSubmit({ result: {} })).rejects.toMatchObject({
      name: 'ControlError',
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    await expect(client().stageSubmit({ result: {} })).rejects.toBeInstanceOf(ControlError);
  });

  it('remembers the read-ledger binding a context.request expansion answered with (AC-085)', async () => {
    // `context.request` is the control channel's own read path: its answer carries the
    // Attempt's binding after the expansion, and a later `stage_yield` has to report that
    // value instead of the tool bridge's stale one (WP-12 T2-fix-delivery).
    const control = client();
    expect(control.ledgerBinding?.()).toBeUndefined();
    answer = {
      status: 200,
      body: {
        status: 'applied',
        items: [],
        outOfScope: [],
        ledger: { seq: 6, hash: 'c'.repeat(64) },
      },
    };
    const expanded = await control.contextRequest?.({
      workId: 'work-1',
      requestedRefs: [{ path: 'src/theme.ts', reason: 'the target file' }],
      reason: 'read the target',
    });
    expect(expanded).toMatchObject({ status: 'applied' });
    expect(control.ledgerBinding?.()).toEqual({ seq: 6, hash: 'c'.repeat(64) });

    // A malformed ledger member never overwrites a good binding.
    answer = { status: 200, body: { status: 'applied', ledger: { seq: 'six', hash: 'nope' } } };
    await control.contextRequest?.({ workId: 'work-1', requestedRefs: [], reason: 'again' });
    expect(control.ledgerBinding?.()).toEqual({ seq: 6, hash: 'c'.repeat(64) });
  });
});

/** A client whose three methods record what the tool asked for. */
function fakeClient(): ControlClient {
  return {
    url: 'http://127.0.0.1:1',
    capability: 'token',
    attemptId: 'attempt-1',
    epoch: 1,
    assessmentSubmit: () => {
      calls.push('assessment');
      return Promise.resolve();
    },
    agentDispatch: () => {
      calls.push('dispatch');
      return Promise.resolve();
    },
    stageSubmit: () => {
      calls.push('stage');
      return Promise.resolve();
    },
  };
}

describe('runner control tools', () => {
  it('registers exactly the tools the role is documented to have (execution.md §7)', () => {
    const chief = controlTools({ client: fakeClient(), workId: 'work-1', role: 'chief' });
    expect(chief.map((tool) => tool.name)).toEqual(['assessment_submit', 'agent_dispatch']);
    const backend = controlTools({ client: fakeClient(), workId: 'work-1', role: 'backend' });
    expect(backend.map((tool) => tool.name)).toEqual(['stage_yield']);
    // A professional session never even sees the Chief's tools.
    expect(backend.map((tool) => tool.name)).not.toContain('agent_dispatch');
  });

  it('reports each delivery only when the call was accepted', async () => {
    const delivered: string[] = [];
    const hooks = {
      onStageSubmitted: () => delivered.push('stage'),
      onAssessmentSubmitted: () => delivered.push('assessment'),
      onDispatchSubmitted: () => delivered.push('dispatch'),
    };
    const backend = controlTools({
      client: fakeClient(),
      workId: 'work-1',
      role: 'backend',
      readLedgerBinding: () => SEAL,
      ...hooks,
    });
    const stage = backend.find((tool) => tool.name === 'stage_yield');
    if (stage === undefined) throw new Error('the professional session has no stage_yield');
    expect(
      await stage.execute({ status: 'success', summary: 'done' }, { signal: undefined }),
    ).toEqual({ text: 'stage result submitted' });

    const chief = controlTools({ client: fakeClient(), workId: 'work-1', role: 'chief', ...hooks });
    const assessment = chief.find((tool) => tool.name === 'assessment_submit');
    const dispatch = chief.find((tool) => tool.name === 'agent_dispatch');
    if (assessment === undefined || dispatch === undefined) throw new Error('unreachable');
    await assessment.execute(
      {
        intent: 'delivery',
        goal: 'do it',
        scope: { readPaths: [], writePaths: ['src'], operations: [], networkTargets: [] },
        level: 'L2',
        semanticImpact: false,
        riskFlags: [],
        uncertainties: [],
        policyRevision: 1,
        reason: 'asked',
      },
      { signal: undefined },
    );
    await dispatch.execute(
      {
        role: 'backend',
        purpose: 'implementation',
        goal: 'do it',
        scope: { readPaths: [], writePaths: ['src'], operations: [], networkTargets: [] },
        stage: 'develop',
        contextSelection: {
          goal: 'do it',
          sourceRefs: [],
          reasonPerSource: {},
          featureRefs: [],
          codePaths: [],
          artifactRefs: [],
          excluded: [],
          unknowns: [],
          readBudget: { initialTokens: 1, expansionTokens: 1 },
        },
        requiredOutputs: [],
        requiredChild: false,
        joinPolicy: 'none',
        budgetAllocation: 1,
      },
      { signal: undefined },
    );
    expect(calls).toEqual(['stage', 'assessment', 'dispatch']);
    expect(delivered).toEqual(['stage', 'assessment', 'dispatch']);
  });

  it('answers a refused call as a tool error without reporting delivery', async () => {
    const delivered: string[] = [];
    const tools = controlTools({
      client: {
        ...fakeClient(),
        stageSubmit: () =>
          Promise.reject(new ControlError(400, 'VALIDATION_ERROR', 'summary is required')),
      },
      workId: 'work-1',
      role: 'backend',
      readLedgerBinding: () => SEAL,
      onStageSubmitted: () => delivered.push('stage'),
    });
    const stage = tools.find((tool) => tool.name === 'stage_yield');
    if (stage === undefined) throw new Error('unreachable');
    expect(
      await stage.execute({ status: 'success', summary: 'done' }, { signal: undefined }),
    ).toEqual({
      text: 'VALIDATION_ERROR: summary is required',
      isError: true,
    });
    expect(delivered).toEqual([]);
  });

  it('refuses an assessment when the Run has no Work to name', async () => {
    const tools = controlTools({ client: fakeClient(), role: 'chief' });
    const assessment = tools.find((tool) => tool.name === 'assessment_submit');
    if (assessment === undefined) throw new Error('unreachable');
    const result = await assessment.execute({ intent: 'delivery' }, { signal: undefined });
    expect(result).toMatchObject({ isError: true });
    expect(calls).toEqual([]);
  });
});

/**
 * `stage_yield` is the professional Run's only delivery (`execution.md` §7, `rules/agents.md`
 * §4). The tool used to declare `evidenceRefs`/`artifactRefs` as plain strings while Core's
 * `stageResultContentSchema` requires entity ids and `{id,version,hash}` pins, so a model that
 * followed the tool description produced a payload Core refused; two refusals ended the Run as
 * `contract_violation` (WP-12 T2-fix-delivery). These tests pin the tool to Core's own schema:
 * a submission the tool accepts must be one Core accepts, and a shape Core would refuse is
 * refused locally instead of spending one of the two Schema strikes.
 */
describe('stage_yield and the StageResult contract (WP-12 T2-fix-delivery)', () => {
  const seal = SEAL;

  /** A Core-valid `ContextSelection`, so only the field under test varies. */
  function selection(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      goal: 'write the dark theme file',
      sourceRefs: [],
      reasonPerSource: {},
      featureRefs: [],
      codePaths: [],
      artifactRefs: [],
      excluded: [],
      unknowns: [],
      readBudget: { initialTokens: 24000, expansionTokens: 16000 },
      ...overrides,
    };
  }

  /** A Core-valid professional dispatch draft, so only the field under test varies. */
  function draft(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      role: 'backend',
      purpose: 'implementation',
      goal: 'write the dark theme file',
      scope: {
        readPaths: ['src'],
        writePaths: ['src/theme.txt'],
        operations: ['read', 'edit'],
        networkTargets: [],
      },
      stage: 'develop-L2',
      contextSelection: selection(),
      requiredOutputs: ['stage_result'],
      requiredChild: false,
      joinPolicy: 'none',
      budgetAllocation: 20000,
      ...overrides,
    };
  }

  function dispatchTool(dispatch: (input: { spec: unknown }) => Promise<void>): PiToolSpec {
    const tools = controlTools({
      client: { ...fakeClient(), agentDispatch: dispatch },
      role: 'chief',
      workId: 'work-1',
    });
    const tool = tools.find((entry) => entry.name === 'agent_dispatch');
    if (tool === undefined) throw new Error('the Chief session has no agent_dispatch');
    return tool;
  }

  function stageTool(submit: (input: { result: unknown }) => Promise<void>): PiToolSpec {
    const tools = controlTools({
      client: { ...fakeClient(), stageSubmit: submit },
      role: 'backend',
      readLedgerBinding: () => seal,
    });
    const stage = tools.find((tool) => tool.name === 'stage_yield');
    if (stage === undefined) throw new Error('the professional session has no stage_yield');
    return stage;
  }

  it('turns a minimal status+summary call into the StageResult Core documents', async () => {
    const submitted: unknown[] = [];
    const stage = stageTool(({ result }) => {
      submitted.push(result);
      return Promise.resolve();
    });
    expect(
      await stage.execute({ status: 'failed', summary: 'no approved Plan' }, { signal: undefined }),
    ).toEqual({ text: 'stage result submitted' });
    expect(submitted).toHaveLength(1);
    // The Runner owns readLedgerSeq/readLedgerHash and fills the documented (empty) lists.
    expect(submitted[0]).toMatchObject({
      status: 'failed',
      summary: 'no approved Plan',
      artifactRefs: [],
      evidenceRefs: [],
      changedPaths: [],
      findingIds: [],
      unknowns: [],
      requestedActions: [],
      readLedgerSeq: seal.seq,
      readLedgerHash: seal.hash,
    });
    // And the payload really is Core-valid, checked with Core's own schema.
    expect(stageResultContentSchema.safeParse(submitted[0]).success).toBe(true);
  });

  it('accepts the documented reference shapes and rejects a path where an id belongs', async () => {
    const submitted: unknown[] = [];
    const stage = stageTool(({ result }) => {
      submitted.push(result);
      return Promise.resolve();
    });
    const article = {
      id: '01a0a2db-a1d8-7e4b-b62a-7c2d46ccbf1e',
      version: 1,
      hash: 'a'.repeat(64),
    };
    const accepted = await stage.execute(
      {
        status: 'success',
        summary: 'changed the file',
        artifactRefs: [article],
        evidenceRefs: ['01a0a2db-a1d8-7e4b-b62a-7c2d46ccbf1e'],
        changedPaths: ['src/theme.ts'],
        unknowns: ['is the wording right?'],
        requestedActions: ['run the test suite'],
      },
      { signal: undefined },
    );
    expect(accepted).toEqual({ text: 'stage result submitted' });
    expect(submitted).toHaveLength(1);

    // A path in `evidenceRefs` (or a bare string in `artifactRefs`) is exactly the mistake a
    // real model made; it must be refused locally, with the field named, and never forwarded.
    const refused = await stage.execute(
      { status: 'success', summary: 'changed the file', evidenceRefs: ['src/theme.ts'] },
      { signal: undefined },
    );
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toContain('VALIDATION_ERROR');
    expect(refused.text).toContain('evidenceRefs.0');
    expect(submitted).toHaveLength(1);

    const wrongArtifact = await stage.execute(
      { status: 'success', summary: 'changed the file', artifactRefs: ['src/theme.ts'] },
      { signal: undefined },
    );
    expect(wrongArtifact).toMatchObject({ isError: true });
    expect(wrongArtifact.text).toContain('artifactRefs.0');
    expect(submitted).toHaveLength(1);
  });

  it('names an unknown field instead of letting Core count it as a Schema failure', async () => {
    const submitted: unknown[] = [];
    const stage = stageTool(({ result }) => {
      submitted.push(result);
      return Promise.resolve();
    });
    const refused = await stage.execute(
      { status: 'success', summary: 'done', evidence: ['src/theme.ts'] },
      { signal: undefined },
    );
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toContain('unknown field(s) evidence');
    expect(submitted).toEqual([]);
  });

  it('refuses to submit without the Attempt read-ledger seal Core requires', async () => {
    const submitted: unknown[] = [];
    const tools = controlTools({
      client: {
        ...fakeClient(),
        stageSubmit: ({ result }) => {
          submitted.push(result);
          return Promise.resolve();
        },
      },
      workId: 'work-1',
      role: 'backend',
    });
    const stage = tools.find((tool) => tool.name === 'stage_yield');
    if (stage === undefined) throw new Error('unreachable');
    const refused = await stage.execute(
      { status: 'failed', summary: 'blocked', readLedgerSeq: 0, readLedgerHash: 'a'.repeat(64) },
      { signal: undefined },
    );
    expect(refused).toMatchObject({ isError: true });
    expect(refused.text).toContain('no read-ledger seal');
    expect(submitted).toEqual([]);
  });

  it('tells the model that its own delivery is still owed after a dispatch request', () => {
    const tools = controlTools({
      client: { ...fakeClient(), agentRequestDispatch: () => Promise.resolve({}) },
      workId: 'work-1',
      role: 'backend',
    });
    const stage = tools.find((tool) => tool.name === 'stage_yield');
    const request = tools.find((tool) => tool.name === 'request_dispatch');
    if (stage === undefined || request === undefined) throw new Error('unreachable');
    expect(stage.description).toContain('`request_dispatch` does not deliver');
    expect(stage.description).toContain('{id, version, hash} pins');
    expect(request.description).toContain('does not deliver your stage');
    expect(request.description).toContain('must still call `stage_yield`');
    expect(request.description).toContain(
      'product/planning/backend/frontend/review/test/settlement',
    );
  });

  it('refuses a dispatch whose role or stage is outside the documented vocabulary', async () => {
    const dispatched: unknown[] = [];
    const tool = dispatchTool(({ spec }) => {
      dispatched.push(spec);
      return Promise.resolve();
    });

    // The two refusals a real Chief model produced: `planner` is not a role, and `implement`
    // is not a canonical stage (the ACL has no row for it, so that Run could never deliver).
    const wrongRole = await tool.execute(draft({ role: 'planner' }), { signal: undefined });
    expect(wrongRole).toMatchObject({ isError: true });
    expect(wrongRole.text).toContain(
      'product, planning, backend, frontend, review, test, settlement',
    );

    const wrongStage = await tool.execute(draft({ role: 'backend', stage: 'implement' }), {
      signal: undefined,
    });
    expect(wrongStage).toMatchObject({ isError: true });
    expect(wrongStage.text).toContain('develop-L1, develop-L2, develop-L3');

    const wrongRoleStage = await tool.execute(draft({ role: 'review', stage: 'test' }), {
      signal: undefined,
    });
    expect(wrongRoleStage).toMatchObject({ isError: true });
    expect(wrongRoleStage.text).toContain('document_check, review');

    expect(dispatched).toEqual([]);
  });

  it('canonicalizes the runtime stage alias and checks the draft with Core schema', async () => {
    const dispatched: Record<string, unknown>[] = [];
    const tool = dispatchTool(({ spec }) => {
      dispatched.push(spec as Record<string, unknown>);
      return Promise.resolve();
    });
    // `develop` is an alias Core's context layer normalizes to the canonical `develop-L2`; the
    // tool submits the canonical spelling, which is what makes the Run's read ledger openable.
    expect(await tool.execute(draft({ stage: 'develop' }), { signal: undefined })).toEqual({
      text: 'professional Run dispatched',
    });
    expect(dispatched[0]).toMatchObject({ role: 'backend', stage: 'develop-L2' });

    // The remaining draft fields are validated with Core's own `ProfessionalDispatchSpec`
    // schema, so a missing `contextSelection` array is named instead of arriving as a Zod dump.
    const incomplete = await tool.execute(
      draft({
        contextSelection: {
          goal: 'write the dark theme file',
          sourceRefs: [],
          reasonPerSource: {},
          readBudget: { initialTokens: 24000, expansionTokens: 16000 },
        },
      }),
      { signal: undefined },
    );
    expect(incomplete).toMatchObject({ isError: true });
    expect(incomplete.text).toContain('contextSelection.featureRefs');
    expect(dispatched).toHaveLength(1);

    // A sourceRef without its `reasonPerSource` entry is the documented MISSING_CONTEXT.
    const noReason = await tool.execute(
      draft({
        contextSelection: selection({
          sourceRefs: [{ kind: 'git', id: 'src/orders/cancel.ts', version: 'HEAD' }],
        }),
      }),
      { signal: undefined },
    );
    expect(noReason).toMatchObject({ isError: true });
    expect(noReason.text).toContain('reason');
    expect(dispatched).toHaveLength(1);
  });
});
