#!/usr/bin/env node
/**
 * `agentdev` command line entry point.
 *
 * WP-00 ships exactly one real command — `doctor` — because AC-048 requires the
 * environment to be probed before anything runs. Commands owned by later work
 * packages are not present here: an unimplemented command must fail loudly
 * rather than pretend, which is what the root `test:*` scripts do.
 */
import { pathToFileURL } from 'node:url';
import { PROTOCOL_VERSION } from '@agentdev/contracts';
import { buildDoctorReport, renderDoctorReport, repoRootFrom } from './doctor.js';

const USAGE = [
  'usage: agentdev <command> [options]',
  '',
  'commands:',
  '  doctor [--json]   probe node/pnpm/git/Pi SDK/Docker, directories and ports',
  '  version           print the CLI and protocol version',
].join('\n');

export interface CliIo {
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
  readonly exit: (code: number) => void;
}

export async function main(
  argv: readonly string[],
  io: CliIo = {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
    exit: (code) => process.exit(code),
  },
): Promise<void> {
  const [command, ...rest] = argv;

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    io.out(`${USAGE}\n`);
    io.exit(command === undefined ? 2 : 0);
    return;
  }

  if (command === 'version') {
    io.out(`agentdev 0.0.0 (protocol ${PROTOCOL_VERSION})\n`);
    io.exit(0);
    return;
  }

  if (command === 'doctor') {
    const json = rest.includes('--json');
    const report = await buildDoctorReport({ startDir: repoRootFrom(import.meta.url) });
    if (json) {
      io.out(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      io.out(`${renderDoctorReport(report)}\n`);
    }
    io.exit(report.executionReady ? 0 : 1);
    return;
  }

  io.err(`unknown command: ${command}\n${USAGE}\n`);
  io.exit(2);
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  await main(process.argv.slice(2));
}
