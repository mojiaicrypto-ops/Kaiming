import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectCatalog, roleContractSentence } from '../src/prepare-run.js';

const dir = mkdtempSync(join(tmpdir(), 'agentdev-prepare-run-'));

function write(name: string, content: string): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

describe('per-Attempt catalog inspection (WP-12 R4)', () => {
  it('accepts the catalog the daemon writes', () => {
    const path = write(
      'good.json',
      JSON.stringify({
        providers: {
          'agentdev-gateway': {
            baseUrl: 'http://127.0.0.1:1',
            api: 'openai-completions',
            apiKey: 'cap',
            models: [{ id: 'm', api: 'openai-completions' }],
          },
        },
      }),
    );
    expect(inspectCatalog(path)).toBeNull();
  });

  it('names the concrete reason a Runner would otherwise only report as MODEL_UNAVAILABLE', () => {
    expect(inspectCatalog(join(dir, 'missing.json'))).toBe('the file does not exist');
    expect(inspectCatalog(write('empty.json', ''))).toBe('the file is empty');
    expect(inspectCatalog(write('bad.json', '{oops'))).toBe('the file is not valid JSON');
    expect(inspectCatalog(write('none.json', '{}'))).toBe('it declares no providers');
    expect(inspectCatalog(write('other.json', '{"providers":{"other":{}}}'))).toBe(
      'it declares no agentdev-gateway provider',
    );
    expect(
      inspectCatalog(write('nomodels.json', '{"providers":{"agentdev-gateway":{"models":[]}}}')),
    ).toBe('its gateway provider lists no models');
  });
});

describe('role contract sentence (WP-12 T2-fix-delivery)', () => {
  it('tells a professional role to do the work, deliver through stage_yield, and still deliver after asking for a role', () => {
    const sentence = roleContractSentence('backend');
    // (a) do the work with the role's tools, (b) deliver through stage_yield with the
    // documented fields, (c) a dispatch request is not a delivery.
    expect(sentence).toContain('Do this stage yourself with your tools');
    expect(sentence).toContain('`stage_yield`');
    expect(sentence).toContain('status (success/needs_input/failed)');
    expect(sentence).toContain('artifactRefs are {id,version,hash} pins');
    expect(sentence).toContain('evidenceRefs/findingIds are ids of existing');
    expect(sentence).toContain('`request_dispatch` call do not discharge this stage');
    expect(sentence).toContain('use `request_dispatch` only when the work genuinely needs');
    // The honest blocked delivery is named, so a role that cannot act still delivers.
    expect(sentence).toContain('`status=failed` or `needs_input`');
    // The Product/Plan stages run before any Task exists, so their file tools have no
    // Grant yet; the context channel is the documented way to read there (WP-12 W4).
    expect(sentence).toContain('read the sources you need through `context.request`');
  });

  it('keeps the Chief contract on assessment_submit plus agent_dispatch', () => {
    const sentence = roleContractSentence('chief');
    expect(sentence).toContain('`assessment_submit`');
    expect(sentence).toContain('`agent_dispatch`');
    // The dispatch's stage is what the read ledger opens the Run's context from, so the Chief
    // is told the canonical vocabulary instead of guessing a spelling the ACL has no row for.
    expect(sentence).toContain('canonical stage of that role');
    expect(sentence).toContain('backend|frontend→develop-L1/develop-L2/develop-L3');
    expect(sentence).toContain('readable context and it can never deliver');
    // `workflow.md` §3: the L2/L3 code route is Product→Plan→Develop, and the develop Run's
    // Task/Grant come from the approved Plan — so the Chief may not dispatch it first.
    expect(sentence).toContain('Route order is not optional for an L2/L3 code delivery');
    expect(sentence).toContain('dispatch `planning` first');
    expect(sentence).toContain('before an approved Plan exists');
    // The Chief must survive each stage to trigger the next one, and a 'none' dispatch lets
    // its Run end before an approved Plan can reach its develop Run.
    expect(sentence).toContain("joinPolicy: 'all'");
  });
});
