import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppErrorBoundary } from '../src/app/ErrorBoundary';

describe('render failure fallback', () => {
  it('names the exception and offers a reload instead of an empty root', () => {
    expect(AppErrorBoundary.getDerivedStateFromError(new Error('render broke'))).toEqual({
      error: expect.any(Error),
    });
    const boundary = new AppErrorBoundary({ children: null });
    boundary.state = { error: new Error('render broke') };
    const html = renderToStaticMarkup(boundary.render() as ReactElement);

    expect(html).toContain('data-testid="app-error"');
    expect(html).toContain('render broke');
    expect(html).toContain('data-testid="app-error-reload"');
    expect(html).not.toContain('data-testid="composer"');
  });
});
