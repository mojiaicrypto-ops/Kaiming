/**
 * Documents (U6): the upload accepts PDF/DOCX and research text files, extracts their text for
 * the model, and keeps the original bytes addressable for preview/download.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_BYTES,
  isDocumentName,
  readAttachment,
  readAttachmentBytes,
  readDocument,
  storeDocument,
} from '../src/server/attachments.ts';
import { docxBytes, pdfBytes } from './document-fixtures.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function agentDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'kaiming-documents-'));
  dirs.push(dir);
  return dir;
}

describe('document attachments', () => {
  it('extracts PDF and DOCX text and keeps the original bytes', async () => {
    const dir = agentDir();
    const pdf = pdfBytes('R&D PDF');
    const docx = docxBytes('R&D DOCX');

    const storedPdf = await storeDocument(dir, pdf, 'research.pdf');
    const storedDocx = await storeDocument(dir, docx, 'spec.docx');
    expect(storedPdf.ok).toBe(true);
    expect(storedDocx.ok).toBe(true);
    if (!storedPdf.ok || !storedDocx.ok) return;

    expect(storedPdf.document.kind).toBe('document');
    expect(storedPdf.document.mimeType).toBe('application/pdf');
    expect(readDocument(dir, storedPdf.document.id)?.text).toContain('R&D PDF');
    expect(storedDocx.document.mimeType).toContain('wordprocessingml');
    expect(readDocument(dir, storedDocx.document.id)?.text).toContain('R&D DOCX');
    expect(readAttachmentBytes(dir, storedPdf.document.id)?.equals(pdf)).toBe(true);
    expect(readAttachment(dir, storedDocx.document.id)?.kind).toBe('document');
  });

  it('accepts research text files and rejects opaque binaries instead of pretending', async () => {
    const dir = agentDir();
    const text = await storeDocument(dir, Buffer.from('# Notes\n\nexport const x = 1;\n'), 'notes.md');
    expect(text.ok).toBe(true);
    if (text.ok) {
      expect(readDocument(dir, text.document.id)?.text).toContain('export const x = 1;');
      expect(text.document.mimeType).toBe('text/markdown');
    }

    const binary = await storeDocument(dir, Buffer.from([0, 1, 2, 3, 4]), 'scan.exe');
    expect(binary.ok).toBe(false);
    if (!binary.ok) expect(binary.code).toBe('INVALID_ARGUMENT');

    const big = await storeDocument(dir, Buffer.alloc(MAX_DOCUMENT_BYTES + 1), 'huge.pdf');
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.code).toBe('TOO_LARGE');
  });

  it('recognises the document extensions it advertises', () => {
    for (const name of ['a.pdf', 'a.docx', 'a.pptx', 'a.xlsx', 'a.md', 'a.ts']) {
      expect(isDocumentName(name)).toBe(true);
    }
    expect(isDocumentName('a.docx.bin')).toBe(false);
  });
});
