/**
 * Historical replay of the report retry ledger (plan `.kaiming/work/report-retry-budget-20261114`,
 * acceptance 2). Reads the real workbench transcripts, splits each session file per input by the
 * `kaiming.input-marker` entries, and feeds every `agent_report` toolResult to a fresh guard per
 * input, mirroring the runner: first trip = one corrective turn + streak reset, second trip =
 * terminal.
 *
 * Assertions (calibrated 2026-11-14 against this data directory):
 *  - exactly one input terminal-trips: the settler incident `i-f485624c` in the 16:37 session
 *    (44 consecutive failures in that input; 48 across the session's two inputs);
 *  - exactly one input corrective-trips without terminating: the 17:32 calibration session, which
 *    failed five times and then delivered on the next attempt;
 *  - every other historical input — including the developer/tester loops that ended REPORT_MISSING
 *    through other paths — never trips.
 *
 * Run: node checks/report-ledger-replay.ts [dataDir]   (default: .kaiming-data)
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ModelOutputGuard } from '../src/runtime/model-output-guard.ts';

const dataDir = process.argv[2] ?? '.kaiming-data';
const sessionsDir = join(dataDir, 'sessions');

interface LedgerRun {
  readonly file: string;
  readonly inputId: string;
  readonly guard: ModelOutputGuard;
  results: number;
  correctiveUsed: boolean;
  terminal: boolean;
}

const runs: LedgerRun[] = [];
for (const file of readdirSync(sessionsDir).filter((name) => name.endsWith('.jsonl')).sort()) {
  const byInput = new Map<string, LedgerRun>();
  let currentInputId: string | null = null;
  for (const line of readFileSync(join(sessionsDir, file), 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof entry !== 'object' || entry === null || !('type' in entry)) continue;
    if (entry.type === 'custom' && 'customType' in entry && entry.customType === 'kaiming.input-marker') {
      const data = 'data' in entry && typeof entry.data === 'object' && entry.data !== null ? entry.data : {};
      if ('inputId' in data && typeof data.inputId === 'string' && !byInput.has(data.inputId)) {
        const run: LedgerRun = {
          file,
          inputId: data.inputId,
          guard: new ModelOutputGuard(),
          results: 0,
          correctiveUsed: false,
          terminal: false,
        };
        byInput.set(data.inputId, run);
        currentInputId = data.inputId;
      }
      continue;
    }
    if (entry.type !== 'message' || currentInputId === null) continue;
    if (!('message' in entry) || typeof entry.message !== 'object' || entry.message === null) continue;
    const message = entry.message;
    if (!('role' in message) || message.role !== 'toolResult') continue;
    if (!('toolName' in message) || message.toolName !== 'agent_report') continue;
    const run = byInput.get(currentInputId);
    if (run === undefined) continue;
    const isError = 'isError' in message && message.isError === true;
    const content = 'content' in message && Array.isArray(message.content) ? message.content : [];
    run.results += isError ? 1 : 0;
    // One trip aborts the run; the runner then performs its corrective turn and the streak
    // restarts — mirrored here so the replay exercises the same budget as production.
    if (run.guard.observeEvent({
      type: 'message_end',
      message: { role: 'toolResult', toolName: 'agent_report', isError, content },
    })) {
      if (!run.correctiveUsed) {
        run.correctiveUsed = true;
        run.guard.retryUsed = true;
        run.guard.fault = undefined;
        run.guard.resetReportStreak();
      } else {
        run.terminal = true;
      }
    }
  }
  runs.push(...byInput.values());
}

const terminals = runs.filter((run) => run.terminal);
const correctiveOnly = runs.filter((run) => run.correctiveUsed && !run.terminal);
const failure = (message: string): never => {
  console.error(`FAIL ${message}`);
  for (const run of runs.filter((candidate) => candidate.results > 0)) {
    console.error(`  ${run.file} ${run.inputId} failedResults=${String(run.results)} corrective=${String(run.correctiveUsed)} terminal=${String(run.terminal)}`);
  }
  process.exit(1);
};

const settlerTerminal = terminals.filter((run) => run.file.startsWith('2026-11-13T16-37-00') && run.inputId === 'i-f485624c');
if (terminals.length !== 1 || settlerTerminal.length !== 1) {
  failure(`expected exactly one terminal trip (the settler incident input), got [${terminals.map((run) => `${run.file}:${run.inputId}`).join(', ')}]`);
}
const calibrationTrip = correctiveOnly.filter((run) => run.file.startsWith('2026-11-13T17-32-50'));
if (correctiveOnly.length !== 1 || calibrationTrip.length !== 1) {
  failure(`expected exactly one corrective-only trip (the 17:32 calibration input), got [${correctiveOnly.map((run) => `${run.file}:${run.inputId}`).join(', ')}]`);
}
console.log(`PASS: ${String(runs.length)} inputs replayed across the transcripts in ${dataDir}`);
console.log('  terminal trip (expected): settler incident i-f485624c — 44 consecutive failures in the input (48 across the session), budget 5 + corrective + 5');
console.log('  corrective trip (expected): 17:32 calibration input — 5 failures then a valid report; the run completes');
console.log('  every other input: no trip');
