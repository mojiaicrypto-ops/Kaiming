/**
 * The TOML subset used by `~/.agentdev/config.toml` and the Project override.
 *
 * `ARCHITECTURE.md` §5 fixes the file format but not a parser dependency, and the
 * dependency list is pinned, so this module implements the subset the configuration
 * document needs: table headers (`[a.b]`), arrays of tables (`[[providers]]`),
 * dotted keys, strings, integers, floats, booleans and inline arrays of scalars.
 * Anything outside the subset is a hard error — an unreadable configuration must
 * never be silently reinterpreted (`protocol.md` §5 validates every value).
 */

export type TomlScalar = string | number | boolean;
export type TomlValue = TomlScalar | readonly TomlScalar[] | TomlTable | readonly TomlTable[];
export interface TomlTable {
  readonly [key: string]: TomlValue;
}

export class TomlError extends Error {
  readonly line: number;

  constructor(message: string, line: number) {
    super(`line ${String(line)}: ${message}`);
    this.name = 'TomlError';
    this.line = line;
  }
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/;

/** True for a plain object (a TOML table), never an array or scalar. */
export function isTomlTable(value: TomlValue): value is TomlTable {
  return typeof value === 'object' && !Array.isArray(value);
}

/** Splits `a.b."c d"` into its key parts, respecting quoted segments. */
function splitDottedKey(raw: string, line: number): string[] {
  const parts: string[] = [];
  let current = '';
  let quoted = false;
  for (const character of raw) {
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (character === '.' && !quoted) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (quoted) throw new TomlError('unterminated quoted key', line);
  parts.push(current.trim());
  for (const part of parts) {
    if (part.length === 0) throw new TomlError('empty key segment', line);
    if (!BARE_KEY.test(part) && !/^".*"$/.test(part)) {
      throw new TomlError(`unsupported key ${part}`, line);
    }
  }
  return parts;
}

function unquoteKey(part: string): string {
  return /^".*"$/.test(part) ? part.slice(1, -1) : part;
}

function readString(text: string, index: number, line: number): [string, number] {
  if (text.startsWith('"""', index) || text.startsWith("'''", index)) {
    throw new TomlError('multi-line strings are not supported', line);
  }
  const quote = text[index] as string;
  let cursor = index + 1;
  let value = '';
  while (cursor < text.length) {
    const character = text[cursor] as string;
    if (character === quote) return [value, cursor + 1];
    if (character === '\\') {
      const escape = text[cursor + 1];
      const mapping: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };
      const mapped = escape === undefined ? undefined : mapping[escape];
      if (mapped === undefined) throw new TomlError(`unsupported escape \\${escape ?? ''}`, line);
      value += mapped;
      cursor += 2;
      continue;
    }
    value += character;
    cursor += 1;
  }
  throw new TomlError('unterminated string', line);
}

/** Parses one scalar or inline scalar array at `index`. */
function readInlineValue(
  text: string,
  index: number,
  line: number,
): [TomlScalar | TomlScalar[], number] {
  const character = text[index] as string;
  if (character === '"' || character === "'") {
    const [value, next] = readString(text, index, line);
    return [value, next];
  }
  if (character === '[') {
    const items: TomlScalar[] = [];
    let cursor = index + 1;
    for (;;) {
      while (text[cursor] === ' ' || text[cursor] === '\t' || text[cursor] === '\n') cursor += 1;
      if (text[cursor] === ']') return [items, cursor + 1];
      if (text[cursor] === undefined) throw new TomlError('unterminated array', line);
      const [item, next] = readInlineValue(text, cursor, line);
      if (Array.isArray(item)) throw new TomlError('nested arrays are not supported', line);
      items.push(item);
      cursor = next;
      while (text[cursor] === ' ' || text[cursor] === '\t' || text[cursor] === '\n') cursor += 1;
      if (text[cursor] === ',') {
        cursor += 1;
        continue;
      }
      if (text[cursor] === ']') return [items, cursor + 1];
      throw new TomlError('expected "," or "]" in array', line);
    }
  }
  const token = /^[^\s,\]]+/.exec(text.slice(index))?.[0];
  if (token === undefined) throw new TomlError('missing value', line);
  const next = index + token.length;
  if (token === 'true') return [true, next];
  if (token === 'false') return [false, next];
  if (/^[+-]?\d+$/.test(token)) return [Number.parseInt(token, 10), next];
  if (/^[+-]?\d+\.\d+$/.test(token)) return [Number.parseFloat(token), next];
  throw new TomlError(`unsupported value ${token}`, line);
}

/** Removes a trailing comment, ignoring `#` inside strings. */
function stripComment(line: string): string {
  let quoted: string | undefined;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted !== undefined) {
      if (character === quoted && line[index - 1] !== '\\') quoted = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quoted = character;
      continue;
    }
    if (character === '#') return line.slice(0, index);
  }
  return line;
}

type MutableTable = Record<string, TomlValue>;

/** The tables of an array-of-tables value, or `undefined` for anything else. */
function tableArray(value: TomlValue | undefined): MutableTable[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value as readonly TomlValue[];
  if (!items.every((item) => isTomlTable(item))) return undefined;
  return items as MutableTable[];
}

/** Walks (creating as needed) the table addressed by `path`. */
function descend(root: MutableTable, path: readonly string[], line: number): MutableTable {
  let cursor: MutableTable = root;
  for (const rawPart of path) {
    const part = unquoteKey(rawPart);
    const existing = cursor[part];
    if (existing === undefined) {
      const created: MutableTable = {};
      cursor[part] = created;
      cursor = created;
      continue;
    }
    const elements = tableArray(existing);
    if (elements !== undefined) {
      cursor = elements[elements.length - 1] as MutableTable;
      continue;
    }
    if (!isTomlTable(existing)) {
      throw new TomlError(`${part} is not a table`, line);
    }
    cursor = existing;
  }
  return cursor;
}

/** Parses the supported TOML subset; throws `TomlError` on anything else. */
export function parseToml(text: string): TomlTable {
  const root: MutableTable = {};
  let table: MutableTable = root;
  const lines = text.split(/\r?\n/);
  for (const [index, rawLine] of lines.entries()) {
    const line = index + 1;
    const stripped = stripComment(rawLine).trim();
    if (stripped.length === 0) continue;

    if (stripped.startsWith('[[')) {
      if (!stripped.endsWith(']]')) throw new TomlError('unterminated array table header', line);
      const path = splitDottedKey(stripped.slice(2, -2), line);
      const lastName = unquoteKey(path[path.length - 1] as string);
      const parent = descend(root, path.slice(0, -1), line);
      const existing = parent[lastName];
      const entry: MutableTable = {};
      const elements = tableArray(existing);
      if (elements !== undefined) {
        elements.push(entry);
      } else if (existing === undefined) {
        parent[lastName] = [entry];
      } else {
        throw new TomlError(`${lastName} is not an array of tables`, line);
      }
      table = entry;
      continue;
    }

    if (stripped.startsWith('[')) {
      if (!stripped.endsWith(']')) throw new TomlError('unterminated table header', line);
      table = descend(root, splitDottedKey(stripped.slice(1, -1), line), line);
      continue;
    }

    const equals = stripped.indexOf('=');
    if (equals < 0) throw new TomlError('expected "key = value"', line);
    const keyPath = splitDottedKey(stripped.slice(0, equals), line);
    let valueStart = equals + 1;
    while (stripped[valueStart] === ' ' || stripped[valueStart] === '\t') valueStart += 1;
    const [value] = readInlineValue(stripped, valueStart, line);
    const parent = descend(table, keyPath.slice(0, -1), line);
    const key = unquoteKey(keyPath[keyPath.length - 1] as string);
    if (key in parent) throw new TomlError(`duplicate key ${key}`, line);
    parent[key] = value;
  }
  return root;
}

function quote(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

function writeScalar(value: TomlScalar): string {
  if (typeof value === 'string') return quote(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (!Number.isFinite(value)) throw new TomlError('non-finite numbers are not supported', 0);
  return String(value);
}

function isArrayOfTables(value: TomlValue): value is readonly TomlTable[] {
  // An empty array is written inline as `[]`; only a non-empty array of tables
  // becomes `[[section]]` blocks.
  return Array.isArray(value) && value.length > 0 && tableArray(value) !== undefined;
}

function writeInline(value: TomlValue): string {
  if (Array.isArray(value)) {
    return `[${(value as readonly TomlScalar[]).map((item) => writeScalar(item)).join(', ')}]`;
  }
  if (isTomlTable(value)) throw new TomlError('cannot inline a table', 0);
  return writeScalar(value as TomlScalar);
}

/** Serializes the subset back to TOML; nested tables become `[a.b]` sections. */
export function stringifyToml(table: TomlTable): string {
  const lines: string[] = [];
  const header = (path: readonly string[], array = false): void => {
    if (lines.length > 0) lines.push('');
    const name = path.join('.');
    lines.push(array ? `[[${name}]]` : `[${name}]`);
  };
  const writeTable = (current: TomlTable, path: readonly string[]): void => {
    if (path.length > 0) header(path);
    for (const [key, value] of Object.entries(current)) {
      if (isTomlTable(value) || isArrayOfTables(value)) continue;
      lines.push(`${key} = ${writeInline(value)}`);
    }
    for (const [key, value] of Object.entries(current)) {
      if (isTomlTable(value)) {
        writeTable(value, [...path, key]);
        continue;
      }
      if (isArrayOfTables(value)) {
        for (const element of value) {
          header([...path, key], true);
          for (const [itemKey, item] of Object.entries(element)) {
            if (isTomlTable(item) || isArrayOfTables(item)) continue;
            lines.push(`${itemKey} = ${writeInline(item)}`);
          }
          for (const [itemKey, item] of Object.entries(element)) {
            if (isTomlTable(item)) {
              writeTable(item, [...path, key, itemKey]);
            } else if (isArrayOfTables(item)) {
              for (const nestedElement of item) {
                header([...path, key, itemKey], true);
                for (const [leafKey, leaf] of Object.entries(nestedElement)) {
                  if (isTomlTable(leaf) || isArrayOfTables(leaf)) continue;
                  lines.push(`${leafKey} = ${writeInline(leaf)}`);
                }
              }
            }
          }
        }
      }
    }
  };
  writeTable(table, []);
  return `${lines.join('\n')}\n`;
}
