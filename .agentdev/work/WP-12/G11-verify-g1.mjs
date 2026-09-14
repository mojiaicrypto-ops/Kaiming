#!/usr/bin/env node
/**
 * WP-12 G11 pre-check: does a Provider **with a real `secretRef`** let the Chief Run reach
 * `attempt.ready` and actually call the model? (T6 residual G1, fixed by T2.)
 *
 * This drives the same real installation the e2e `ops.backup-restore` check uses: the real
 * `agentdev` CLI boots a real daemon on a temporary `AGENTDEV_HOME`, `provider.upsert`
 * registers a credential, a message creates the Work and the Chief Run, and the loopback
 * model is asked to answer. Prints the raw facts and exits non-zero when the Run never
 * reached `attempt.ready` or the model was never called.
 *
 * Usage: node .agentdev/work/WP-12/G11-verify-g1.mjs
 */
import { cleanupTempDirs } from '../../../scripts/lib/e2e-runtime.mjs';
import { bootCredentialedInstallation } from '../../../scripts/lib/e2e-ops-drill.mjs';

let installation;
try {
  installation = await bootCredentialedInstallation();
  const listed = await installation.rpc('run.list', { workId: installation.workId });
  const run = (listed.items ?? []).find((entry) => entry.id === installation.runId);
  const attempt = (run?.attempts ?? []).find((entry) => entry.id === installation.attemptId);
  process.stdout.write(
    [
      `AGENTDEV_HOME=${installation.home}`,
      `project=${installation.repo}`,
      `projectId=${installation.projectId}`,
      `secretRef=${installation.secretRef} secretConfigured=true`,
      `workId=${installation.workId}`,
      `runId=${installation.runId} role=${run?.role} status=${run?.status}`,
      `attemptId=${installation.attemptId} status=${attempt?.status} runnerId=${attempt?.runnerId}`,
      `loopback model calls=${installation.modelCalls.length}`,
      run?.status === 'running' && attempt?.status === 'running' && installation.modelCalls.length > 0
        ? 'G1 VERIFIED: Chief Run reached attempt.ready and the credentialed Provider was called'
        : 'G1 NOT VERIFIED',
      '',
    ].join('\n'),
  );
  process.exitCode =
    run?.status === 'running' && attempt?.status === 'running' && installation.modelCalls.length > 0
      ? 0
      : 1;
} finally {
  if (installation !== undefined) await installation.stop();
  cleanupTempDirs();
}
