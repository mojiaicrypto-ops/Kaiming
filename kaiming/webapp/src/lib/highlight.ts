/**
 * The one place highlight.js grammars are registered. The transcript's markdown fences and the
 * file viewer both colour code, and they must agree: two registration lists would mean `.ts` is
 * coloured in a file but not in a message, or the reverse.
 *
 * Registration is per grammar, not automatic: `highlight.js/lib/core` ships none, which is what
 * keeps the bundle small. A language not in this list renders as plain text on purpose.
 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import less from 'highlight.js/lib/languages/less';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

let registered = false;

/** Register every grammar the workbench colours with. Idempotent: callers never need to check. */
export function registerLanguages(): void {
  if (registered) return;
  registered = true;
  const grammars: ReadonlyArray<readonly [string, unknown]> = [
    ['bash', bash],
    ['c', c],
    ['cpp', cpp],
    ['csharp', csharp],
    ['css', css],
    ['diff', diff],
    ['dockerfile', dockerfile],
    ['go', go],
    ['ini', ini],
    ['java', java],
    ['javascript', javascript],
    ['json', json],
    ['kotlin', kotlin],
    ['less', less],
    ['makefile', makefile],
    ['markdown', markdown],
    ['php', php],
    ['python', python],
    ['ruby', ruby],
    ['rust', rust],
    ['scss', scss],
    ['sql', sql],
    ['swift', swift],
    ['typescript', typescript],
    ['xml', xml],
    ['yaml', yaml],
  ];
  for (const [name, grammar] of grammars) {
    hljs.registerLanguage(name, grammar as Parameters<typeof hljs.registerLanguage>[1]);
  }
}

/** True when this grammar is registered; an unknown one stays plain rather than guessing. */
export function hasLanguage(language: string): boolean {
  registerLanguages();
  return language !== '' && hljs.getLanguage(language) !== undefined;
}

/** Colour one file's whole text. `''` means "no grammar", which the viewer draws uncoloured. */
export function highlightToHtml(code: string, language: string): string {
  if (!hasLanguage(language)) return '';
  return hljs.highlight(code, { language }).value;
}

export { hljs };
