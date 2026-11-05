import { describe, expect, it } from 'vitest';
import { resolveLink } from '../src/files/link-target';

const PROJECT = '/Users/me/work/aisuangua';

describe('where a link in a report points', () => {
  it('turns the host path an agent wrote into a project path', () => {
    // The user's case, exactly: this href must never become a browser navigation.
    expect(resolveLink(`${PROJECT}/.dev/work/t-acbbb5bd/shots/zoom-1440.png`, PROJECT)).toEqual({
      kind: 'project',
      path: '.dev/work/t-acbbb5bd/shots/zoom-1440.png',
    });
  });

  it('resolves a relative path against the document that holds it', () => {
    expect(resolveLink('./shots/a.png', PROJECT, '.dev/work/t-x')).toEqual({
      kind: 'project',
      path: '.dev/work/t-x/shots/a.png',
    });
    // `..` climbs within the project, and never lands on whatever is above it.
    expect(resolveLink('../other/b.md', PROJECT, '.dev/work/t-x')).toEqual({
      kind: 'project',
      path: '.dev/work/other/b.md',
    });
    expect(resolveLink('a.png', PROJECT)).toEqual({ kind: 'project', path: 'a.png' });
  });

  it('refuses to climb above the project root', () => {
    expect(resolveLink('../../etc/passwd', PROJECT, '.dev')).toEqual({ kind: 'outside', path: '../../etc/passwd' });
  });

  it('calls a host path outside the project what it is', () => {
    expect(resolveLink('/etc/hosts', PROJECT)).toEqual({ kind: 'outside', path: '/etc/hosts' });
    // A sibling project is outside this one, even though both live under the same parent.
    expect(resolveLink('/Users/me/work/other/a.md', PROJECT).kind).toBe('outside');
    // A prefix that only looks shared is not inside the project.
    expect(resolveLink('/Users/me/work/aisuangua2/a.md', PROJECT).kind).toBe('outside');
  });

  it('leaves a real URL to the browser, and a fragment to the page', () => {
    expect(resolveLink('https://example.com/x', PROJECT)).toEqual({ kind: 'external', href: 'https://example.com/x' });
    expect(resolveLink('mailto:a@b.c', PROJECT).kind).toBe('external');
    expect(resolveLink('#section-2', PROJECT)).toEqual({ kind: 'anchor' });
    expect(resolveLink('   ', PROJECT)).toEqual({ kind: 'anchor' });
  });

  it('reads a file:// URL as a path, because that is what it is', () => {
    expect(resolveLink(`file://${PROJECT}/.dev/a.md`, PROJECT)).toEqual({ kind: 'project', path: '.dev/a.md' });
    expect(resolveLink('file:///etc/hosts', PROJECT).kind).toBe('outside');
  });

  it('accepts the project root itself', () => {
    expect(resolveLink(PROJECT, PROJECT)).toEqual({ kind: 'project', path: '.' });
  });
});
