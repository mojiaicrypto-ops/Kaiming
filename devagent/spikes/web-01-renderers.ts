/**
 * WEB-01 (renderer selection & measurement): loads the exact vendored ESM artifacts that
 * `devagent/web/vendor/` ships to the browser and measures them. Nothing here goes through a
 * bundler: each library is imported straight from its vendored published build, which is what the
 * browser will do at runtime.
 *
 *   node --experimental-strip-types spikes/web-01-renderers.ts
 *
 * It answers the P4-h0 questions and exits non-zero when a library cannot be loaded or a measured
 * number is unreasonable: (a) markdown-it + highlight.js over a 2 000-line fenced block,
 * (b) a 30-row GFM table, (c) ANSI log colouring (anser, plus the vendored browser ESM replacement),
 * (d) @tanstack/virtual-core range computation for a 5 000-item list in a 600px viewport.
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];

function check(name: string, ok: boolean, detail: string): void {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} :: ${detail}`);
}

/** Absolute file URL for a file under devagent/web/vendor. */
function vendorUrl(rel: string): URL {
  return new URL(`../web/vendor/${rel}`, import.meta.url);
}

/** Absolute file URL for a file under devagent/node_modules (used to read package metadata). */
function moduleFileUrl(rel: string): URL {
  return new URL(`../node_modules/${rel}`, import.meta.url);
}

/** The module namespace of a library, narrowed to an indexable record. */
function asRecord(value: unknown): Record<string, unknown> {
  // Unchecked cast at the library boundary: dynamic import returns `unknown`-ish and we only probe
  // known keys right below.
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** Raw and gzip byte length of a vendored file. */
function fileSizes(rel: string): { raw: number; gzip: number } {
  const bytes = readFileSync(vendorUrl(rel));
  return { raw: bytes.byteLength, gzip: gzipSync(bytes, { level: 9 }).byteLength };
}

function moduleVersion(pkg: string): string {
  const manifest = asRecord(JSON.parse(readFileSync(moduleFileUrl(`${pkg}/package.json`), 'utf8')));
  return typeof manifest.version === 'string' ? manifest.version : 'unknown';
}

function ms(rounds: number, run: () => unknown): number {
  const start = performance.now();
  for (let i = 0; i < rounds; i++) {
    run();
  }
  return performance.now() - start;
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

// Minimal structural typings for the library surface this spike uses. The vendored files live
// outside tsconfig and ship without type declarations, so we declare the slice we touch instead of
// pulling in a build step.
interface MarkdownItInstance {
  render(source: string): string;
}
type MarkdownItConstructor = new (options: {
  html?: boolean;
  linkify?: boolean;
  highlight?: (source: string, lang: string) => string;
}) => MarkdownItInstance;

interface HighlightInstance {
  registerLanguage(name: string, grammar: unknown): void;
  getLanguage(name: string): unknown;
  highlight(source: string, options: { language: string; ignoreIllegals?: boolean }): { value: string };
}

interface AnsiConverter {
  ansiToHtml(input: string): string;
}
type AnsiConstructor = new (options?: Record<string, unknown>) => AnsiConverter;

interface AnsiUpInstance {
  use_classes: boolean;
  ansi_to_html(input: string): string;
}
type AnsiUpConstructor = new () => AnsiUpInstance;

interface VirtualRange {
  startIndex: number;
  endIndex: number;
}
interface VirtualizerInstance {
  calculateRange(): VirtualRange | null;
  getTotalSize(): number;
}
type VirtualizerConstructor = new (options: {
  count: number;
  estimateSize: (index: number) => number;
  getScrollElement: () => null;
  initialRect: { width: number; height: number };
  initialOffset: number;
}) => VirtualizerInstance;

// ---------------------------------------------------------------------------------------------
// Vendored artifacts (the files the browser loads; see web/vendor/README.md).
// ---------------------------------------------------------------------------------------------
const vendorInputs = [
  'markdown-it/index.mjs',
  'markdown-it/lib/index.mjs',
  'highlight.js/es/core.min.js',
  'highlight.js/es/languages/javascript.min.js',
  'highlight.js/es/languages/typescript.min.js',
  'highlight.js/es/languages/bash.min.js',
  'highlight.js/styles/atom-one-dark.min.css',
  'ansi_up/ansi_up.js',
  'virtual-core/index.js',
  'virtual-core/utils.js',
];

let markdownItVersion = 'unknown';
let highlightVersion = 'unknown';
let ansiUpVersion = 'unknown';
let virtualCoreVersion = 'unknown';
try {
  markdownItVersion = moduleVersion('markdown-it');
  highlightVersion = moduleVersion('@highlightjs/cdn-assets');
  ansiUpVersion = moduleVersion('ansi_up');
  virtualCoreVersion = moduleVersion('@tanstack/virtual-core');
} catch (error) {
  check('read vendored package metadata', false, String(error));
}

console.log('# P4-h0 renderer spike');
console.log(
  `versions: markdown-it ${markdownItVersion} · highlight.js ${highlightVersion} · ansi_up ${ansiUpVersion} · @tanstack/virtual-core ${virtualCoreVersion}`,
);
console.log('\n## Vendored browser artifacts');

let totalRaw = 0;
let totalGzip = 0;
for (const rel of vendorInputs) {
  try {
    const { raw, gzip } = fileSizes(rel);
    totalRaw += raw;
    totalGzip += gzip;
    console.log(`  ${rel.padEnd(46)} raw ${kb(raw).padStart(9)}  gzip ${kb(gzip).padStart(9)}`);
  } catch (error) {
    check(`size ${rel}`, false, String(error));
  }
}
console.log(`  ${'(sampled subset)'.padEnd(46)} raw ${kb(totalRaw).padStart(9)}  gzip ${kb(totalGzip).padStart(9)}`);

// ---------------------------------------------------------------------------------------------
// markdown-it + highlight.js
// ---------------------------------------------------------------------------------------------
// Dynamic imports: the target is the vendored browser artifact, not the npm entry (no bundler, so
// the browser resolves these exact URLs), and those files carry no type declarations.
let md: MarkdownItInstance | undefined;
let hljs: HighlightInstance | undefined;
try {
  const markdownItModule = asRecord(await import(vendorUrl('markdown-it/index.mjs').href));
  const MarkdownIt = markdownItModule.default as MarkdownItConstructor;
  const highlightModule = asRecord(await import(vendorUrl('highlight.js/es/core.min.js').href));
  hljs = highlightModule.default as HighlightInstance;
  for (const lang of ['javascript', 'typescript', 'bash']) {
    const grammarModule = asRecord(
      await import(vendorUrl(`highlight.js/es/languages/${lang}.min.js`).href),
    );
    hljs.registerLanguage(lang, grammarModule.default);
  }
  md = new MarkdownIt({
    html: false,
    linkify: true,
    highlight(source: string, lang: string): string {
      if (lang && hljs && hljs.getLanguage(lang)) {
        return hljs.highlight(source, { language: lang, ignoreIllegals: true }).value;
      }
      return '';
    },
  });
  check(
    'markdown-it + highlight.js load from vendored ESM',
    typeof MarkdownIt === 'function' && typeof hljs.highlight === 'function',
    `markdown-it ${markdownItVersion}, highlight.js ${highlightVersion}, languages: bash,javascript,typescript`,
  );
} catch (error) {
  check('markdown-it + highlight.js load from vendored ESM', false, String(error));
}

// (a) 2 000-line fenced code block ------------------------------------------------
if (md) {
  const lines = Array.from(
    { length: 2000 },
    (_, i) => `const value${i} = compute(${i}); // line ${i}`,
  );
  const doc = `Before the block.\n\n\`\`\`javascript\n${lines.join('\n')}\n\`\`\`\n\nAfter.\n`;
  const first = md.render(doc);
  const perRender = ms(5, () => md.render(doc)) / 5;
  check(
    'markdown-it renders a 2 000-line fenced block with highlight.js markup',
    first.includes('<pre>') && first.includes('hljs-') && perRender < 250,
    `${perRender.toFixed(1)} ms/render over 5 runs; ${first.length} chars output`,
  );
}

// (b) 30-row GFM table ------------------------------------------------------------
if (md) {
  const rows = Array.from({ length: 30 }, (_, i) => `| row ${i} | ${i * i} | ok |`);
  const doc = `| name | square | state |\n| --- | ---: | :---: |\n${rows.join('\n')}\n`;
  const html = md.render(doc);
  const trCount = (html.match(/<tr>/g) ?? []).length;
  check('markdown-it renders a 30-row GFM table', html.includes('<table>') && trCount === 31, `${trCount} <tr> rows (header + 30)`);
}

// (c) ANSI colouring: anser (candidate, Node-only) vs the vendored ansi_up browser ESM ----------
const ansiSample =
  '\x1b[31merror\x1b[0m: cannot open file\n' +
  '\x1b[1;33mwarn\x1b[0m: deprecated flag\n' +
  '\x1b[32mok\x1b[0m: wrote \x1b[36m42 bytes\x1b[0m\n';

try {
  // Dynamic import: anser is CJS (`export =`), which a static ESM import cannot type under
  // NodeNext; we only need it to show the candidate colourises in Node and to record its rejection.
  const anserModule = asRecord(await import('anser'));
  const Anser = anserModule.default as AnsiConstructor;
  const converter = new Anser();
  const html = converter.ansiToHtml(ansiSample);
  check('anser converts an ANSI sample (Node CJS interop)', html.includes('<span'), 'rejected as a browser dependency; not vendored');
} catch (error) {
  check('anser converts an ANSI sample (Node CJS interop)', false, String(error));
}

try {
  const ansiUpModule = asRecord(await import(vendorUrl('ansi_up/ansi_up.js').href));
  const AnsiUp = ansiUpModule.AnsiUp as AnsiUpConstructor;
  const converter = new AnsiUp();
  converter.use_classes = true;
  const html = converter.ansi_to_html(ansiSample);
  check(
    'vendored ansi_up converts an ANSI sample to classed HTML',
    html.includes('<span class="ansi-') && html.includes('error'),
    `ansi_up ${ansiUpVersion} output ${html.length} chars`,
  );
} catch (error) {
  check('vendored ansi_up converts an ANSI sample to classed HTML', false, String(error));
}

// (d) virtual-core range computation for a 5 000-item list in a 600px viewport ------------------
try {
  const virtualCoreModule = asRecord(await import(vendorUrl('virtual-core/index.js').href));
  const Virtualizer = virtualCoreModule.Virtualizer as VirtualizerConstructor;
  const make = (initialOffset: number): VirtualizerInstance =>
    new Virtualizer({
      count: 5000,
      estimateSize: () => 24,
      getScrollElement: () => null,
      initialRect: { width: 800, height: 600 },
      initialOffset,
    });
  const topRange = make(0).calculateRange();
  const middleRange = make(1200).calculateRange();
  const total = make(0).getTotalSize();
  const rangeMs = ms(20, () => make(1200).calculateRange());
  const ok =
    topRange !== null &&
    middleRange !== null &&
    topRange.startIndex === 0 &&
    topRange.endIndex === 24 &&
    middleRange.startIndex === 50 &&
    middleRange.endIndex === 74 &&
    total === 120000;
  check(
    'virtual-core computes the visible range for 5 000 items at a 600px viewport',
    ok,
    `offset 0 -> [${topRange?.startIndex}, ${topRange?.endIndex}], offset 1200 -> [${middleRange?.startIndex}, ${middleRange?.endIndex}], total ${total}px; ${(rangeMs / 20).toFixed(3)} ms/range`,
  );
} catch (error) {
  check('virtual-core computes the visible range for 5 000 items at a 600px viewport', false, String(error));
}

// ---------------------------------------------------------------------------------------------
console.log('\n## Verdict');
console.log('Bundler needed: no — markdown-it, @highlightjs/cdn-assets, ansi_up and @tanstack/virtual-core');
console.log('all publish plain browser ESM and are vendored byte-identical (see web/vendor/README.md).');
console.log('Rejected: anser and the highlight.js core `es/` build are CJS-backed (would require a bundler).');

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) {
  process.exitCode = 1;
}
