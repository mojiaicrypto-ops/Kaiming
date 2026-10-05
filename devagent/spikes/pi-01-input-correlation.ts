/**
 * PI-01 (input correlation, runnable part): proves the host can tie one inputId to the exact
 * native root entry, that the session file appears only after real content, that custom entries
 * (markers) and custom messages (notices) are distinguishable, and that a reopen keeps the
 * correlation.
 *
 * Not covered here: compaction / branch-summary correlation (needs a long context); recorded as
 * not-covered in the P0 test report and planned as PI-01b.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  SessionManager,
  createSyntheticSourceInfo,
  type AgentSessionEvent,
  type InlineExtension,
  type PromptTemplate,
  type SessionEntry,
  type TurnEndEvent,
} from '@earendil-works/pi-coding-agent';
import {
  INPUT_MARKER_CUSTOM_TYPE,
  NOTICE_CUSTOM_TYPE,
  createChecker,
  createStubEnv,
  descendantsOf,
  findMarker,
  openSession,
  startStubModelServer,
  type InputMarker,
} from './harness/pi-env.ts';

const checker = createChecker();

function describeEntry(entry: SessionEntry): string {
  if (entry.type === 'message') {
    return `message(${entry.message.role}) id=${entry.id} parent=${entry.parentId ?? 'root'}`;
  }
  if (entry.type === 'custom' || entry.type === 'custom_message') {
    return `${entry.type}(${entry.customType}) id=${entry.id} parent=${entry.parentId ?? 'root'}`;
  }
  return `${entry.type} id=${entry.id} parent=${entry.parentId ?? 'root'}`;
}

/** customType of a bookmark/notice entry, '' for every other entry kind. */
function customTypeOf(entry: SessionEntry): string {
  return entry.type === 'custom' || entry.type === 'custom_message' ? entry.customType : '';
}

/** Text of a user message entry, read with narrowing (no unchecked cast). */
function userTextOf(entry: SessionEntry | undefined): string {
  if (entry === undefined || entry.type !== 'message' || entry.message.role !== 'user') {
    return '';
  }
  const content = entry.message.content;
  if (typeof content === 'string') {
    return content;
  }
  return content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

const probeTemplate: PromptTemplate = {
  name: 'pi01-probe',
  description: 'P0 template-expansion probe',
  filePath: '<sdk:pi01-probe>',
  sourceInfo: createSyntheticSourceInfo('<sdk:pi01-probe>', { source: 'sdk' }),
  content: 'PI01-TEMPLATE-BODY $1 $ARGUMENTS',
};
const server = await startStubModelServer([
  { kind: 'text', text: 'spike-ack-1' },
  { kind: 'text', text: 'spike-ack-2' },
]);
const env = await createStubEnv(server.baseUrl);

const turnEnds: TurnEndEvent[] = [];
const settled: string[] = [];
const extension: InlineExtension = (pi) => {
  pi.registerTool({
    name: 'spike_probe',
    label: 'spike_probe',
    description: 'probe tool used only to prove extension tool registration',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    async execute() {
      return { content: [{ type: 'text', text: 'probe' }], details: {} };
    },
  });
  pi.on('turn_end', (event) => {
    turnEnds.push(event);
  });
  pi.on('agent_settled', () => {
    settled.push('agent_settled');
  });
};

const publicEvents: string[] = [];
const publicTurnEnds: AgentSessionEvent[] = [];
let sessionFileBefore: string | undefined;
let markerId = '';
let userEntryId = '';
let fileAfterPrompt: string | undefined;

try {
  const first = await openSession(env, {
    extensionFactories: [extension],
    tools: ['spike_probe'],
    promptTemplates: [probeTemplate],
  });
  const { session, sessionManager } = first;

  session.subscribe((event) => {
    publicEvents.push(event.type);
    if (event.type === 'turn_end') {
      publicTurnEnds.push(event);
    }
  });

  sessionFileBefore = sessionManager.getSessionFile();
  checker.check(
    'first-file-rule: no session file on disk before any message',
    sessionFileBefore === undefined || !existsSync(sessionFileBefore),
    `getSessionFile()=${String(sessionFileBefore)} exists=${sessionFileBefore !== undefined && existsSync(sessionFileBefore)}`,
  );

  checker.check(
    'extension tool registered and active',
    session.getActiveToolNames().includes('spike_probe'),
    `active=[${session.getActiveToolNames().join(',')}]`,
  );

  const marker: InputMarker = {
    inputId: 'input-1',
    requestDigest: 'digest-1',
    generation: { serverEpoch: 1, claim: 1 },
  };
  markerId = sessionManager.appendCustomEntry(INPUT_MARKER_CUSTOM_TYPE, marker);
  checker.check(
    'marker appended as custom entry',
    markerId.length > 0,
    `markerId=${markerId}`,
  );

  await session.prompt('hello from pi-01');

  fileAfterPrompt = sessionManager.getSessionFile();
  checker.check(
    'session file created after real message',
    typeof fileAfterPrompt === 'string' && existsSync(fileAfterPrompt),
    `file=${String(fileAfterPrompt)} exists=${fileAfterPrompt !== undefined && existsSync(fileAfterPrompt)}`,
  );

  const entries = sessionManager.getEntries();
  console.log('\nentries after first prompt:');
  for (const entry of entries) {
    console.log(`  ${describeEntry(entry)}`);
  }
  const storedMarker = findMarker(entries, 'input-1');
  const chain = storedMarker ? descendantsOf(entries, storedMarker.id) : [];
  const userEntry = chain.find(
    (entry) => entry.type === 'message' && entry.message.role === 'user',
  );
  userEntryId = userEntry?.id ?? '';

  checker.check(
    'marker locatable by customType+inputId after run',
    storedMarker !== undefined,
    `markerId=${storedMarker?.id ?? 'none'}`,
  );
  checker.check(
    'native root user entry is a descendant of the marker',
    userEntry !== undefined,
    `userEntryId=${userEntryId} parentId=${userEntry?.parentId ?? 'none'} chain=[${chain
      .map((entry) => describeEntry(entry))
      .join(' > ')}]`,
  );
  checker.check(
    'extension turn_end messageEntryId belongs to this input marker subtree',
    turnEnds.length > 0 &&
      turnEnds.every((event) => chain.some((entry) => entry.id === event.messageEntryId)),
    `turnEnds=${turnEnds.length} messageEntryIds=[${turnEnds
      .map((event) => event.messageEntryId)
      .join(',')}] isRootUserEntry=${turnEnds[0]?.messageEntryId === userEntryId}`,
  );
  checker.check(
    'agent_settled delivered to extension after run',
    settled.length === 1,
    `settled=${settled.length}`,
  );
  const publicTurnEndHasEntryId = publicTurnEnds.some((event) => 'messageEntryId' in event);
  checker.check(
    'public subscribe turn_end does not expose messageEntryId while the extension event does',
    publicTurnEnds.length > 0 && !publicTurnEndHasEntryId && turnEnds.length > 0,
    `publicTurnEnds=${publicTurnEnds.length} publicHasEntryId=${publicTurnEndHasEntryId} extensionTurnEnds=${turnEnds.length}`,
  );

  const fileText = fileAfterPrompt ? await readFile(fileAfterPrompt, 'utf8') : '';
  const fileEntries = fileText
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  const fileMarker = fileEntries.find(
    (entry) =>
      entry['type'] === 'custom' &&
      entry['customType'] === INPUT_MARKER_CUSTOM_TYPE &&
      (entry['data'] as InputMarker | undefined)?.inputId === 'input-1',
  );
  checker.check(
    'marker persisted verbatim in the JSONL file on disk',
    fileMarker !== undefined,
    `lines=${fileEntries.length} markerFound=${fileMarker !== undefined}`,
  );

  const messageEntriesBefore = sessionManager
    .getEntries()
    .filter((entry) => entry.type === 'message').length;
  await session.sendCustomMessage({
    customType: NOTICE_CUSTOM_TYPE,
    content: 'recovery notice from spike',
    display: true,
  });
  const afterNotice = sessionManager.getEntries();
  const noticeEntry = afterNotice[afterNotice.length - 1];
  const messageEntriesAfter = afterNotice.filter((entry) => entry.type === 'message').length;
  const noticeType = noticeEntry?.type ?? 'none';
  const noticeCustomType =
    noticeEntry !== undefined && noticeEntry.type === 'custom_message'
      ? noticeEntry.customType
      : 'none';
  checker.check(
    'notice is a custom_message entry under its own name, distinct from the bookmark',
    noticeEntry !== undefined &&
      noticeEntry.type === 'custom_message' &&
      noticeEntry.customType === NOTICE_CUSTOM_TYPE,
    `lastEntryType=${noticeType} customType=${noticeCustomType}`,
  );
  checker.check(
    'bookmark scan by name finds the marker and never the notice',
    afterNotice.filter((entry) => customTypeOf(entry) === INPUT_MARKER_CUSTOM_TYPE).length === 1 &&
      afterNotice.filter((entry) => entry.type === 'custom' && customTypeOf(entry) === INPUT_MARKER_CUSTOM_TYPE)
        .length === 1 &&
      afterNotice.filter((entry) => customTypeOf(entry) === NOTICE_CUSTOM_TYPE).length === 1,
    `markerNamed=${afterNotice.filter((entry) => customTypeOf(entry) === INPUT_MARKER_CUSTOM_TYPE).length} markerKind=${afterNotice.filter((entry) => entry.type === 'custom' && customTypeOf(entry) === INPUT_MARKER_CUSTOM_TYPE).length} notice=${afterNotice.filter((entry) => customTypeOf(entry) === NOTICE_CUSTOM_TYPE).length}`,
  );
  checker.check(
    'sendCustomMessage did not append a user message',
    messageEntriesAfter === messageEntriesBefore,
    `messagesBefore=${messageEntriesBefore} messagesAfter=${messageEntriesAfter}`,
  );

  // Second input on the same session: markers must partition inputs (no text/position matching).
  const marker2 = sessionManager.appendCustomEntry(INPUT_MARKER_CUSTOM_TYPE, {
    inputId: 'input-2',
    requestDigest: 'digest-2',
    generation: { serverEpoch: 1, claim: 2 },
  } satisfies InputMarker);
  await session.prompt('second input from pi-01');
  const entries2 = sessionManager.getEntries();
  const storedMarker2 = findMarker(entries2, 'input-2');
  const chain2 = storedMarker2 ? descendantsOf(entries2, storedMarker2.id) : [];
  const userEntry2 = chain2.find(
    (entry) => entry.type === 'message' && entry.message.role === 'user',
  );
  const chain1After = storedMarker ? descendantsOf(entries2, storedMarker.id) : [];
  const userUnderMarker1 = chain1After.find(
    (entry) => entry.type === 'message' && entry.message.role === 'user',
  );
  // The entry chain is one append-only line, so marker2 nests inside marker1's subtree.
  // Correlation must therefore take the *first* role=user descendant of each marker.
  checker.check(
    'multi-input: each marker resolves to its own input, despite nested subtrees',
    storedMarker2 !== undefined &&
      userEntry2 !== undefined &&
      userEntry2.id !== userEntryId &&
      userUnderMarker1?.id === userEntryId &&
      chain2.some((entry) => entry.id === userEntryId) === false,
    `marker1=${markerId} user1=${userEntryId} firstUserUnderMarker1=${userUnderMarker1?.id ?? 'none'} marker2=${marker2} user2=${userEntry2?.id ?? 'none'} marker2NestedInMarker1=${chain1After.some((entry) => entry.id === marker2)}`,
  );

  // Third input delivered as a prompt-template command: expansion happens before the message
  // enters the agent and must not break marker->root-entry correlation.
  const marker3 = sessionManager.appendCustomEntry(INPUT_MARKER_CUSTOM_TYPE, {
    inputId: 'input-3',
    requestDigest: 'digest-3',
    generation: { serverEpoch: 1, claim: 3 },
  } satisfies InputMarker);
  await session.prompt('/pi01-probe tpl-arg');
  const entries3 = sessionManager.getEntries();
  const storedMarker3 = findMarker(entries3, 'input-3');
  const chain3 = storedMarker3 ? descendantsOf(entries3, storedMarker3.id) : [];
  const userEntry3 = chain3.find(
    (entry) => entry.type === 'message' && entry.message.role === 'user',
  );
  const user3Text = userTextOf(userEntry3);
  checker.check(
    'template input: /pi01-probe expands before entering the agent and still correlates to its own marker',
    userEntry3 !== undefined &&
      user3Text.includes('PI01-TEMPLATE-BODY') &&
      user3Text.includes('tpl-arg') &&
      userEntry3.id !== userEntryId &&
      userEntry3.id !== userEntry2?.id,
    `user3=${userEntry3?.id ?? 'none'} text=${JSON.stringify(user3Text.slice(0, 60))} textHasBody=${user3Text.includes('PI01-TEMPLATE-BODY')} textHasArg=${user3Text.includes('tpl-arg')}`,
  );

  session.dispose();

  // Cold reopen from the exact file (R4: 恢复先检查指定文件，再 open).
  const reopenedManager = fileAfterPrompt
    ? SessionManager.open(fileAfterPrompt, env.sessionDir, env.cwd)
    : SessionManager.create(env.cwd, env.sessionDir);
  const reopenedEntries: SessionEntry[] = reopenedManager.getEntries();
  const reopenedMarker = findMarker(reopenedEntries, 'input-1');
  checker.check(
    'reopen: marker and its user entry survive a cold restart',
    reopenedMarker !== undefined &&
      descendantsOf(reopenedEntries, reopenedMarker.id).some(
        (entry) => entry.type === 'message' && entry.message.role === 'user',
      ),
    `entries=${reopenedEntries.length} markerId=${reopenedMarker?.id ?? 'none'}`,
  );

  const second = await openSession(env, {
    extensionFactories: [extension],
    sessionManager: reopenedManager,
    tools: ['spike_probe'],
  });
  checker.check(
    'reopen: resumed session keeps the same file and history',
    second.sessionManager.getSessionFile() === fileAfterPrompt &&
      second.session.messages.length > 0,
    `file=${String(second.sessionManager.getSessionFile())} messages=${second.session.messages.length}`,
  );
  await second.session.prompt('continue after restart');
  checker.check(
    'reopen: continuation runs on native history',
    second.sessionManager.getEntries().length > reopenedEntries.length,
    `entries ${reopenedEntries.length} -> ${second.sessionManager.getEntries().length}`,
  );
  second.session.dispose();
} finally {
  console.log(`\npublic subscribe event types: ${[...new Set(publicEvents)].sort().join(',')}`);
  console.log(`stub requests: ${server.requests.length}`);
  await server.close();
  await env.cleanup();
  checker.finish();
}