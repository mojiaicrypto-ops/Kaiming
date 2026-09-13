/**
 * Subscriptions: snapshot vs replay, ordered delivery, watermark resume, scope
 * change and the local authorisation guard.
 *
 * AC-054 (UI断开) needs an exact replay: `resume(since)` must deliver every event
 * after the watermark and no event twice. AC-078 needs "订阅扩大" refused: a
 * subscription for another Project, or for a kind the caller may not observe, is
 * refused before the request reaches the server.
 */
import { describe, expect, it } from 'vitest';
import { ClientError, scopeKey, validateScope } from '../src/index.js';
import { createHarness, flush } from './helpers.js';

const PROJECT = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';

async function nextEvents(
  subscription: { events: () => AsyncGenerator<{ cursor: number }, void, undefined> },
  count: number,
): Promise<number[]> {
  const cursors: number[] = [];
  const iterator = subscription.events();
  for (let index = 0; index < count; index += 1) {
    const step = await iterator.next();
    if (step.done === true) break;
    cursors.push(step.value.cursor);
  }
  return cursors;
}

describe('subscriptions', () => {
  it('subscribes with a snapshot and then delivers ordered events', async () => {
    const { client, server } = createHarness();
    await client.connect();
    const subscription = await client.subscribe({
      projectId: PROJECT,
      scope: { kind: 'work', id: 'work-1' },
    });
    expect(subscription.batch?.mode).toBe('snapshot');
    expect(subscription.subscriptionId).toBe('sub-1');

    const first = server.record('work.control_changed', { status: 'running' });
    const second = server.record('stage.completed', { stage: 'develop' });
    subscription.deliver(first);
    subscription.deliver(second);
    const cursors = await nextEvents(subscription, 2);
    expect(cursors).toEqual([1, 2]);
    expect(subscription.watermark).toBe(2);
    expect(subscription.stats.duplicates).toBe(0);
    expect(subscription.stats.gaps).toBe(0);
    client.end();
  });

  it('replays exactly the events after the watermark on resume', async () => {
    const { client, server } = createHarness();
    await client.connect();
    const subscription = await client.subscribe({
      projectId: PROJECT,
      scope: { kind: 'work', id: 'work-1' },
    });
    subscription.deliver(server.record('work.control_changed', { seq: 1 }));
    subscription.deliver(server.record('stage.completed', { seq: 2 }));
    expect(await nextEvents(subscription, 2)).toEqual([1, 2]);
    expect(subscription.watermark).toBe(2);

    // Two more events arrive while the client is not reading; the replay must
    // hand them over in cursor order.
    server.record('run.started', { seq: 3 });
    server.record('run.ended', { seq: 4 });

    const batch = await client.resume(subscription);
    expect(batch.mode).toBe('replay');
    // The replay delivers the missed events straight after the response.
    for (const event of server.log.filter((candidate) => candidate.cursor > 2)) {
      subscription.deliver(event);
    }
    const replayed = await nextEvents(subscription, 2);
    expect(replayed).toEqual([3, 4]);
    expect(subscription.watermark).toBe(4);
    expect(subscription.stats.duplicates).toBe(0);
    expect(subscription.stats.gaps).toBe(0);

    // The replay carried the watermark as `afterCursor`, not a fresh snapshot.
    const subscribes = server.requests.filter((request) => request.method === 'project.subscribe');
    expect(subscribes).toHaveLength(2);
    expect(subscribes[0]?.params['afterCursor']).toBeUndefined();
    expect(subscribes[1]?.params['afterCursor']).toBe(2);
    client.end();
  });

  it('drops duplicates and never re-delivers an event below the watermark', async () => {
    const { client, server } = createHarness();
    await client.connect();
    const subscription = await client.subscribe({
      projectId: PROJECT,
      scope: { kind: 'work', id: 'work-1' },
    });
    const first = server.record('work.control_changed', { seq: 1 });
    subscription.deliver(first);
    expect(await nextEvents(subscription, 1)).toEqual([1]);

    // A well-behaved server never repeats a cursor; a misbehaving one must not
    // corrupt the caller's view.
    subscription.deliver(server.record('work.control_changed', { seq: 2 }));
    const delivered = subscription.deliver({ ...first, cursor: 1 });
    expect(delivered).toBe('duplicate');
    expect(subscription.watermark).toBe(2);
    expect(subscription.stats.duplicates).toBe(1);
    client.end();
  });

  it('accepts an empty batch watermark without inventing events', async () => {
    const { client, server } = createHarness();
    await client.connect();
    const subscription = await client.subscribe({
      projectId: PROJECT,
      scope: { kind: 'work', id: 'work-1' },
    });
    server.batchEnd(subscription.subscriptionId ?? 'sub-1', 7);
    await flush();
    expect(subscription.watermark).toBe(7);
    const iterator = subscription.events();
    const step = await Promise.race([
      iterator.next(),
      new Promise<'idle'>((resolve) => setTimeout(() => resolve('idle'), 5)),
    ]);
    expect(step).toBe('idle');
    client.end();
  });

  it('carries the watermark across a reconnect and replays only what was missed', async () => {
    const { client, server, clientTransport, clock } = createHarness();
    await client.connect();
    const subscription = await client.subscribe({
      projectId: PROJECT,
      scope: { kind: 'work', id: 'work-1' },
    });
    subscription.deliver(server.record('work.control_changed', { seq: 1 }));
    expect(await nextEvents(subscription, 1)).toEqual([1]);

    clientTransport.drop(1006, 'network lost');
    server.record('run.started', { seq: 2 });
    await flush();
    expect(client.state).toBe('reconnecting');
    await clock.advance(1_000);
    await flush();

    expect(client.state).toBe('open');
    for (const event of server.log.filter((candidate) => candidate.cursor > 1)) {
      subscription.deliver(event);
    }
    expect(await nextEvents(subscription, 1)).toEqual([2]);
    expect(subscription.watermark).toBe(2);
    const subscribes = server.requests.filter((request) => request.method === 'project.subscribe');
    expect(subscribes[1]?.params['afterCursor']).toBe(1);
    client.end();
  });

  it('re-snapshots when the server reports the cursor was truncated', async () => {
    const { client, server } = createHarness({ retainedFrom: 5 });
    await client.connect();
    const subscription = await client.subscribe({
      projectId: PROJECT,
      scope: { kind: 'work', id: 'work-1' },
      since: 1,
    });
    expect(client.resyncCount).toBe(1);
    expect(subscription.batch?.mode).toBe('snapshot');
    const subscribes = server.requests.filter((request) => request.method === 'project.subscribe');
    expect(subscribes).toHaveLength(2);
    expect(subscribes[1]?.params['afterCursor']).toBeUndefined();
    client.end();
  });

  it('acknowledges a cursor after the whole batch was applied', async () => {
    const { client, server } = createHarness();
    await client.connect();
    const subscription = await client.subscribe({
      projectId: PROJECT,
      scope: { kind: 'work', id: 'work-1' },
    });
    const acknowledged = await client.ack(subscription, 3);
    expect(acknowledged).toBe(3);
    const ack = server.requests.find((request) => request.method === 'project.events.ack');
    expect(ack?.params).toMatchObject({ subscriptionId: 'sub-1', cursor: 3 });
    client.end();
  });

  it('asks for a fresh snapshot when the scope changes', async () => {
    const { client, server } = createHarness();
    await client.connect();
    const subscription = await client.subscribe({
      projectId: PROJECT,
      scope: { kind: 'work', id: 'work-1' },
    });
    await client.setScope(subscription, { kind: 'conversation', id: 'conversation-1' });
    const subscribes = server.requests.filter((request) => request.method === 'project.subscribe');
    expect(subscribes).toHaveLength(2);
    expect(subscribes[1]?.params['scope']).toEqual({
      kind: 'conversation',
      id: 'conversation-1',
    });
    expect(subscribes[1]?.params['afterCursor']).toBeUndefined();
    client.end();
  });

  it('removes a subscription on the server and locally', async () => {
    const { client, server } = createHarness();
    await client.connect();
    const subscription = await client.subscribe({
      projectId: PROJECT,
      scope: { kind: 'work', id: 'work-1' },
    });
    expect(await client.remove(subscription)).toBe(true);
    expect(subscription.isActive).toBe(false);
    expect(server.requests.some((request) => request.method === 'subscription.remove')).toBe(true);
    expect(client.subscriptions).toHaveLength(0);
    client.end();
  });

  it('validates a scope before sending anything', async () => {
    const { client, server } = createHarness();
    await client.connect();
    const before = server.requests.length;
    let error: ClientError | undefined;
    try {
      await client.subscribe({ projectId: PROJECT, scope: { kind: 'work' } });
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error?.code).toBe('VALIDATION_ERROR');
    expect(server.requests.length).toBe(before);
    expect(() => validateScope({ kind: 'summary', id: 'x' })).toThrow(ClientError);
    client.end();
  });
});

describe('AC-078 subscription expansion is refused', () => {
  it('refuses a subscription naming another Project', async () => {
    const { client, server } = createHarness({ knownProjects: [PROJECT] });
    await client.connect();
    const before = server.requests.length;
    let error: ClientError | undefined;
    try {
      await client.subscribe({ projectId: OTHER, scope: { kind: 'work', id: 'work-1' } });
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error).toBeInstanceOf(ClientError);
    expect(error?.code).toBe('NOT_AUTHORIZED');
    expect(error?.retryable).toBe(false);
    // Nothing left the client, so nothing about the other Project can leak.
    expect(server.requests.length).toBe(before);
    expect(client.subscriptions).toHaveLength(0);
    client.end();
  });

  it('refuses a kind outside the session allowlist', async () => {
    const { client, server } = createHarness({ allowedKinds: ['summary'] });
    await client.connect();
    const before = server.requests.length;
    let error: ClientError | undefined;
    try {
      await client.subscribe({ projectId: PROJECT, scope: { kind: 'run', id: 'run-1' } });
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error?.code).toBe('NOT_AUTHORIZED');
    expect(server.requests.length).toBe(before);
    client.end();
  });

  it('surfaces the server refusal for a cross-Project id', async () => {
    // No local guard this time: the server is the authority and answers a Project
    // it does not know with NOT_FOUND rather than leaking that it exists.
    const { client } = createHarness();
    await client.connect();
    let error: ClientError | undefined;
    try {
      await client.subscribe({ projectId: OTHER, scope: { kind: 'summary' } });
    } catch (failure) {
      error = failure as ClientError;
    }
    expect(error).toBeInstanceOf(ClientError);
    expect(error?.code).toBe('NOT_FOUND');
    expect(client.subscriptions).toHaveLength(0);
    client.end();
  });

  it('keys a subscription by project and scope', () => {
    expect(scopeKey(PROJECT, { kind: 'work', id: 'w' })).toBe(`${PROJECT}/work/w`);
    expect(scopeKey(undefined, { kind: 'summary' })).toBe('*/summary/*');
  });
});
