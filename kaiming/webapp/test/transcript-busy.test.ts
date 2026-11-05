/**
 * The working line is a state of the run, not of the gaps between messages: with a streaming
 * assistant entry present - the normal case for most of a turn - it must still render.
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

describe('the transcript busy line', () => {
  it('renders while a message is streaming', async () => {
    // The module reads the i18n context; the shell always provides it, so this mirrors the app.
    const { I18nProvider } = await import('../src/i18n/I18nProvider');
    const { Transcript } = await import('../src/chat/Transcript');
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { locale: 'en', onLocale: () => undefined, children: [] },
        createElement(Transcript, {
          variant: 'chief',
          busy: 'processing',
          items: [
            {
              entryId: 'live-1',
              role: 'assistant',
              content: [{ type: 'text', text: '正在想' }],
              streaming: true,
            },
          ],
        }),
      ),
    );
    expect(html).toContain('data-testid="chief-working"');
    expect(html).toContain('dots');
  });

  it('is gone when the session is idle', async () => {
    const { I18nProvider } = await import('../src/i18n/I18nProvider');
    const { Transcript } = await import('../src/chat/Transcript');
    const html = renderToStaticMarkup(
      createElement(
        I18nProvider,
        { locale: 'en', onLocale: () => undefined, children: [] },
        createElement(Transcript, { variant: 'chief', busy: 'idle', items: [] }),
      ),
    );
    expect(html).not.toContain('data-testid="chief-working"');
  });
});
