#!/usr/bin/env node
// Verifies that the extracted design-system CSS is byte-faithful to the mock.
//
// Source of truth: webui/index.html <style> block (previous-round prototype).
// Targets: devagent/web/styles/{tokens,components,views}.css
//
// For every (media-context, selector) pair found in the mock:
//   - the selector must appear in exactly one target file (missing/duplicated reported);
//   - the concatenated declarations must be identical (whitespace-insensitive).
// Selector identity includes the enclosing media query, so a base rule and its
// responsive overrides are distinct keys and may live in different files.
//
// Exit code 0 = all good; 1 = any missing, duplicated, or mismatched selector.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..'); // repo root
const mockPath = path.join(root, 'webui', 'index.html');
const files = {
  tokens: path.join(here, 'tokens.css'),
  components: path.join(here, 'components.css'),
  views: path.join(here, 'views.css'),
};

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const normalizeSelector = (s) => s.replace(/\s+/g, ' ').trim();
const normalizeDecl = (s) => stripComments(s).replace(/\s+/g, '');

// Parse a CSS string into rules with an optional enclosing media context.
function parseCss(css, media = null) {
  const out = [];
  let i = 0;
  const n = css.length;
  const skipWs = () => {
    while (i < n) {
      if (/\s/.test(css[i])) { i++; continue; }
      if (css.startsWith('/*', i)) { i = css.indexOf('*/', i) + 2; continue; }
      break;
    }
  };
  while (i < n) {
    skipWs();
    if (i >= n) break;
    const start = i;
    let j = i;
    let quote = null;
    while (j < n) {
      const c = css[j];
      if (quote) { if (c === '\\') { j += 2; continue; } if (c === quote) quote = null; j++; continue; }
      if (c === '"' || c === "'") { quote = c; j++; continue; }
      if (c === '{') break;
      j++;
    }
    const prelude = css.slice(i, j).trim();
    let k = j;
    let depth = 0;
    let quote2 = null;
    for (; k < n; k++) {
      const c = css[k];
      if (quote2) { if (c === '\\') { k++; continue; } if (c === quote2) quote2 = null; continue; }
      if (c === '"' || c === "'") { quote2 = c; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { k++; break; } }
    }
    if (prelude.startsWith('@media')) {
      const inner = css.slice(j + 1, k - 1);
      out.push(...parseCss(inner, normalizeSelector(prelude)));
    } else if (prelude.startsWith('@')) {
      // Other at-rules (e.g. @font-face) would be carried verbatim; none in this mock.
      out.push({ media, selectors: [normalizeSelector(prelude)], decl: css.slice(j, k) });
    } else {
      const decl = css.slice(j, k);
      for (const sel of prelude.split(',')) {
        out.push({ media, selectors: [normalizeSelector(sel)], decl });
      }
    }
    i = k;
  }
  return out;
}

const keyOf = (media, selector) => (media ? media + ' :: ' : '') + selector;
const keyed = (rules) => {
  const map = new Map();
  for (const r of rules) {
    for (const sel of r.selectors) {
      const key = keyOf(r.media, sel);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(normalizeDecl(r.decl));
    }
  }
  return map;
};

const mockHtml = fs.readFileSync(mockPath, 'utf8');
const mockCss = mockHtml.slice(mockHtml.indexOf('<style>') + '<style>'.length, mockHtml.indexOf('</style>'));
const mockMap = keyed(parseCss(mockCss));

const fileMaps = {};
for (const [name, p] of Object.entries(files)) {
  fileMaps[name] = keyed(parseCss(fs.readFileSync(p, 'utf8')));
}

const missing = [];
const duplicated = [];
const mismatched = [];
let matched = 0;

for (const [key, decls] of mockMap) {
  const expected = decls.join('');
  const holders = Object.entries(fileMaps).filter(([, m]) => m.has(key));
  if (holders.length === 0) { missing.push(key); continue; }
  if (holders.length > 1) { duplicated.push(`${key} -> ${holders.map(([f]) => f).join(', ')}`); continue; }
  const actual = fileMaps[holders[0][0]].get(key).join('');
  if (actual !== expected) { mismatched.push(key); continue; }
  matched++;
}

// Extra selectors present in the targets but not in the mock (informational only).
const extras = [];
for (const [name, m] of Object.entries(fileMaps)) {
  for (const key of m.keys()) if (!mockMap.has(key)) extras.push(`${key} (${name})`);
}

const total = mockMap.size;
console.log('CSS fidelity check vs webui/index.html <style>');
console.log(`  selectors found in mock : ${total}`);
console.log(`  matched                 : ${matched}`);
console.log(`  missing                 : ${missing.length}`);
console.log(`  duplicated              : ${duplicated.length}`);
console.log(`  mismatched declarations : ${mismatched.length}`);
console.log(`  extra (not in mock)     : ${extras.length}`);
for (const m of missing) console.log('  MISSING   ', m);
for (const d of duplicated) console.log('  DUPLICATED', d);
for (const m of mismatched) console.log('  MISMATCH  ', m);
for (const e of extras) console.log('  EXTRA     ', e);

const ok = missing.length === 0 && duplicated.length === 0 && mismatched.length === 0;
process.exit(ok ? 0 : 1);
