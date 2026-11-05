import { describe, expect, it } from 'vitest';
import { fileKindOf, languageOf } from '../src/files/file-kind';

describe('how the viewer decides what a file is', () => {
  it('reads every textual file as source, .html and .md included', () => {
    for (const path of ['src/app.ts', 'note.html', 'README.md', 'data.json', 'style.css', 'Dockerfile']) {
      expect(fileKindOf(path), path).toBe('text');
    }
  });

  it('uses the browser’s own player for images and media', () => {
    expect(fileKindOf('shot.png')).toBe('image');
    expect(fileKindOf('frames/01.JPG')).toBe('image');
    expect(fileKindOf('run.webm')).toBe('video');
    expect(fileKindOf('note.mp3')).toBe('audio');
  });

  it('offers a download instead of a view for bytes with no display', () => {
    expect(fileKindOf('report.pdf')).toBe('binary');
    expect(fileKindOf('bundle.zip')).toBe('binary');
    expect(fileKindOf('font.woff2')).toBe('binary');
  });

  it('an unknown extension is text: the content decides, not the name', () => {
    expect(fileKindOf('LICENSE')).toBe('text');
    expect(fileKindOf('notes.weird')).toBe('text');
  });

  it('names a grammar only when one is registered, never a guess', () => {
    expect(languageOf('src/app.ts')).toBe('typescript');
    expect(languageOf('main.go')).toBe('go');
    expect(languageOf('Dockerfile')).toBe('dockerfile');
    expect(languageOf('notes.weird')).toBeUndefined();
    // .html is coloured as markup, but it is still shown as source, not rendered.
    expect(languageOf('report.html')).toBe('xml');
  });
});
