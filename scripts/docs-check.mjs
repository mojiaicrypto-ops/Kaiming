#!/usr/bin/env node
/**
 * `pnpm docs:check` — validates the formal documentation set.
 *
 * Contract (docs/delivery/implementation.md §3): "Markdown 链接、Schema 引用和需求映射"
 * must have no broken link or undefined reference. This script checks, over
 * `docs/**`:
 *
 * 1. every relative Markdown link resolves to a file that exists;
 * 2. every link anchor resolves to a heading in the target document;
 * 3. every `AC-NNN` referenced by `delivery/implementation.md` exists in
 *    `delivery/acceptance.md`, and no AC is defined twice;
 * 4. every defined `AC-NNN` is referenced by at least one work package;
 * 5. every `REQ-*` used by an acceptance case is declared in the index;
 * 6. every work package id is unique and its declared dependencies exist.
 *
 * Exit code is 0 only when every check passes.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const docsRoot = join(repoRoot, 'docs');

/** @param {string} dir @returns {string[]} */
function markdownFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...markdownFiles(full));
    else if (entry.endsWith('.md')) out.push(full);
  }
  return out.sort();
}

/** GitHub-style heading slug, kept ASCII-safe for the anchors used in docs/. */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function headingsOf(text) {
  const slugs = new Set();
  for (const line of text.split('\n')) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) slugs.add(slugify(match[2]));
  }
  return slugs;
}

/** @param {string} line @returns {Array<{target: string}>} */
function linksOf(line) {
  const links = [];
  const pattern = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let match = pattern.exec(line);
  while (match !== null) {
    links.push({ target: match[1] });
    match = pattern.exec(line);
  }
  return links;
}

const files = markdownFiles(docsRoot);
const contents = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]));
const headingCache = new Map();

/** @param {string} file */
function headings(file) {
  let cached = headingCache.get(file);
  if (cached === undefined) {
    cached = headingsOf(contents.get(file) ?? '');
    headingCache.set(file, cached);
  }
  return cached;
}

const errors = [];

// 1 + 2: links and anchors.
let linkCount = 0;
for (const file of files) {
  const lines = (contents.get(file) ?? '').split('\n');
  lines.forEach((line, index) => {
    for (const { target } of linksOf(line)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      linkCount += 1;
      const [rawPath, rawAnchor] = target.split('#');
      const anchor = rawAnchor ?? '';
      let targetFile = file;
      if (rawPath !== undefined && rawPath !== '') {
        targetFile = resolve(dirname(file), decodeURIComponent(rawPath));
        let exists = true;
        try {
          statSync(targetFile);
        } catch {
          exists = false;
        }
        if (!exists) {
          errors.push(`${relative(repoRoot, file)}:${index + 1}: broken link target ${target}`);
          continue;
        }
      }
      if (anchor !== '' && targetFile.endsWith('.md') && !headings(targetFile).has(anchor)) {
        errors.push(
          `${relative(repoRoot, file)}:${index + 1}: missing anchor #${anchor} in ${relative(repoRoot, targetFile)}`,
        );
      }
    }
  });
}

// 3 + 4: acceptance-case mapping.
const acceptanceFile = join(docsRoot, 'delivery/acceptance.md');
const implementationFile = join(docsRoot, 'delivery/implementation.md');
const acceptanceText = contents.get(acceptanceFile) ?? '';
const implementationText = contents.get(implementationFile) ?? '';

const definedAcs = [...acceptanceText.matchAll(/^### (AC-\d{3})\b/gm)].map((m) => m[1]);
const duplicateAcs = definedAcs.filter((id, i) => definedAcs.indexOf(id) !== i);
if (duplicateAcs.length > 0) {
  errors.push(
    `acceptance.md: duplicate acceptance id(s): ${[...new Set(duplicateAcs)].join(', ')}`,
  );
}

const definedSet = new Set(definedAcs);
const referencedAcs = new Set(implementationText.match(/AC-\d{3}/g) ?? []);
for (const id of referencedAcs) {
  if (!definedSet.has(id)) {
    errors.push(`implementation.md: references undefined acceptance case ${id}`);
  }
}
for (const id of definedSet) {
  if (!referencedAcs.has(id)) {
    errors.push(`acceptance.md: acceptance case ${id} is not mapped to any work package`);
  }
}

// 5: requirement index covers every requirement referenced by an acceptance case.
const declaredReqs = new Set(
  [...acceptanceText.matchAll(/^\| (REQ-[A-Z]+-\d{3})/gm)].map((m) => m[1]),
);
const usedReqs = new Set(
  [...acceptanceText.matchAll(/关联：(REQ-[A-Z]+-\d{3})/g)].map((m) => m[1]),
);
for (const id of usedReqs) {
  if (!declaredReqs.has(id))
    errors.push(`acceptance.md: ${id} used by a case but absent from the index`);
}
for (const id of declaredReqs) {
  if (!usedReqs.has(id)) errors.push(`acceptance.md: ${id} declared but no case references it`);
}

// 6: work packages.
const wpBlocks = [...implementationText.matchAll(/^### (WP-\d{2}) (.*)$/gm)];
const wpIds = wpBlocks.map((m) => m[1]);
const duplicateWps = wpIds.filter((id, i) => wpIds.indexOf(id) !== i);
if (duplicateWps.length > 0) {
  errors.push(
    `implementation.md: duplicate work package id(s): ${[...new Set(duplicateWps)].join(', ')}`,
  );
}
const wpSet = new Set(wpIds);
for (const match of implementationText.matchAll(/依赖：([^\n]*)/g)) {
  for (const dep of match[1].match(/WP-\d{2}/g) ?? []) {
    if (!wpSet.has(dep))
      errors.push(`implementation.md: dependency ${dep} is not a defined work package`);
  }
}

if (errors.length > 0) {
  for (const error of errors) process.stderr.write(`docs:check ${error}\n`);
  process.stderr.write(`docs:check failed with ${errors.length} problem(s)\n`);
  process.exit(1);
}

process.stdout.write(
  `docs:check ok — ${files.length} documents, ${linkCount} internal links, ` +
    `${definedSet.size} acceptance cases, ${declaredReqs.size} requirements, ${wpSet.size} work packages\n`,
);
