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
import {
  ControlError,
  controlTools,
  createControlClient,
  type ControlClient,
} from '../src/control-client.js';

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
});

describe('runner control tools', () => {
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
      onStageSubmitted: () => delivered.push('stage'),
    });
    const stage = tools.find((tool) => tool.name === 'stage_yield');
    if (stage === undefined) throw new Error('unreachable');
    expect(await stage.execute({ status: 'success', summary: '' }, { signal: undefined })).toEqual({
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
