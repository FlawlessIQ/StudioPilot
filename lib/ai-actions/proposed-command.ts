/**
 * Pure logic for copilot-proposed non-email commands, with no client or Firebase
 * imports so it can be unit-tested directly. The runner (proposed-command-runner)
 * adds the actual command execution on top of this.
 */
export type StudioCommand = {
  domain: string;
  op: string;
  input: Record<string, unknown>;
};

export type StudioCommandOutput = {
  kind?: string;
  label?: string;
  outward?: boolean;
  sendsTo?: string | null;
  command?: StudioCommand;
};

// The only (domain, op) pairs a proposed card may execute. A card whose command
// is missing or not on this list is never run — a guard against an unexpected or
// tampered action document reaching the executor. Every commandType the server
// can propose must map to an entry here, or its card would be inert.
export const PROPOSED_COMMAND_ALLOWLIST = new Set([
  "workflow:createTask",
  "planning:setInsuranceRequirement",
  "planning:assignQuestionnaire",
  "proposal:create_draft",
]);

/** The runnable command on a studio-command action, or null if not allowed. */
export function commandOf(structuredOutput: unknown): StudioCommand | null {
  const output = (structuredOutput ?? null) as StudioCommandOutput | null;
  if (!output || output.kind !== "studio_command") return null;
  const command = output.command;
  if (
    !command ||
    typeof command.domain !== "string" ||
    typeof command.op !== "string" ||
    !PROPOSED_COMMAND_ALLOWLIST.has(`${command.domain}:${command.op}`)
  ) {
    return null;
  }
  return command;
}

/** Whether this action is a runnable copilot-proposed studio command. */
export function isProposedStudioCommand(structuredOutput: unknown): boolean {
  return commandOf(structuredOutput) !== null;
}
