/**
 * The context meter's visible contract: the exact reading, the warning/danger threshold, and the
 * two different unknowns (right after compaction vs no instance in this process).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { ContextMeter } from '../src/app/ContextMeter';
import type { ContextView } from '../src/api/stream';

function render(context: ContextView): string {
  return renderToStaticMarkup(
    createElement(I18nProvider, {
      locale: 'en',
      onLocale: () => undefined,
      children: createElement(ContextMeter, {
        context,
        activity: 'idle',
        compacting: false,
        onCompact: async () => ({ status: 'nothing' as const }),
      }),
    }),
  );
}

const base: ContextView = {
  tokens: 616_855,
  contextWindow: 1_000_000,
  percent: 61.6855,
  autoCompaction: true,
  live: true,
};

describe('context meter', () => {
  it('shows the absolute pair and the percentage, with meter semantics', () => {
    const html = render(base);
    expect(html).toContain('616.9k / 1M');
    expect(html).toContain('61.7%');
    expect(html).toContain('data-state="normal"');
    expect(html).toContain('role="meter"');
    expect(html).toContain('aria-valuenow="62"');
    expect(html).toContain('auto-compaction on');
    // The reading is the manual-compaction entry; the panel itself is closed until clicked.
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('context-panel');
  });

  it('marks 70% as a warning and 90% as danger', () => {
    expect(render({ ...base, tokens: 724_000, percent: 72.4 })).toContain('data-state="warn"');
    expect(render({ ...base, tokens: 910_000, percent: 91 })).toContain('data-state="danger"');
  });

  it('distinguishes "measured after compaction" from "no instance in this process"', () => {
    const compacted = render({ ...base, tokens: null, percent: null, live: true, autoCompaction: null });
    expect(compacted).toContain('? / 1M');
    expect(compacted).toContain('after the next response');
    expect(compacted).not.toContain('role="meter"');

    const cold = render({ ...base, tokens: null, percent: null, live: false, autoCompaction: null });
    expect(cold).toContain('— / 1M');
    expect(cold).toContain('unknown until this session runs here');
    expect(cold).not.toContain('role="meter"');
  });

  it('renders nothing when the model declares no window', () => {
    expect(render({ ...base, contextWindow: 0, tokens: null, percent: null })).toBe('');
  });
});
