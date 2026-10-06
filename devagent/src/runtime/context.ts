/**
 * Turn context (P3): what the model is told about the current input besides the user's own words.
 *
 * The host states facts (input id, task, overall Plan, authorization, the formal grounds to read) in
 * English and lets the model decide what they mean; it never interprets the user's intent here.
 */
export interface TurnContextInput {
  readonly inputId: string;
  /** Task summary as recorded by the chief, when the session belongs to a task. */
  readonly taskSummary?: string;
  /** Task phase, as written by the chief through updateTask. */
  readonly phase?: string;
  /** Path of the overall Plan the chief must follow. */
  readonly planPath?: string;
  /** References to the real user input or resolved interaction that authorized this work. */
  readonly authorizationRef?: string;
  /** Formal grounds the role should read before acting. */
  readonly refs?: readonly string[];
  /** Result ids from earlier steps the current step depends on. */
  readonly dependsOnResultIds?: readonly string[];
}

export function buildTurnContextText(context: TurnContextInput): string {
  const lines: string[] = [
    `Current input: ${context.inputId}`,
    `Task: ${context.taskSummary ?? 'none'}`,
    `Phase: ${context.phase ?? 'none'}`,
    `Overall Plan: ${context.planPath ?? 'none'}`,
    `Authorization: ${context.authorizationRef ?? 'none'}`,
  ];
  const refs = context.refs ?? [];
  lines.push(refs.length === 0 ? 'Formal grounds: none' : 'Formal grounds to read:');
  for (const ref of refs) {
    lines.push(`- ${ref}`);
  }
  const dependencies = context.dependsOnResultIds ?? [];
  if (dependencies.length > 0) {
    lines.push(`Earlier results to rely on: ${dependencies.join(', ')}`);
  }
  return lines.join('\n');
}