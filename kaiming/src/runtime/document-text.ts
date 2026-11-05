/**
 * The text marker that carries an uploaded document to the model while leaving enough metadata
 * for the browser to render it as a document instead of a wall of extracted text.
 *
 * Pi's prompt content is only text/image. A document therefore travels as a text block shaped as:
 *
 *   \u2063kaiming-document {"id":"…","name":"spec.pdf","mimeType":"application/pdf"}
 *   <extracted text>
 *   \u2063/kaiming-document
 *
 * The leading invisible character makes an accidental collision with a user's own text unlikely
 * without hiding the marker from the model. The webapp parses the same shape in
 * `state/normalize.ts`; keep the two in sync.
 */
const START = '\u2063kaiming-document ';
const END = '\u2063/kaiming-document';

export function formatDocumentText(id: string, name: string, mimeType: string, text: string): string {
  return `${START}${JSON.stringify({ id, name, mimeType })}\n${text}\n${END}`;
}
