"use client";

import { runWorkflowCommand } from "@/lib/workflows/command-client";
import { sendPlanningCommand } from "@/lib/planning/command-client";

/**
 * Running a copilot-proposed non-email action on approval.
 *
 * The copilot proposes a reversible studio command; the server resolves it into
 * an approval card whose `structuredOutput.command` is the exact, id-resolved
 * payload. When the owner approves, this runs that command through the normal
 * command endpoint — which enforces its own authorization server-side — so the
 * AI never executes anything; it only prepares the card the owner approves.
 */
type StudioCommand = {
  domain: string;
  op: string;
  input: Record<string, unknown>;
};

type StudioCommandOutput = {
  kind?: string;
  label?: string;
  command?: StudioCommand;
};

// The only (domain, op) pairs a proposed card may execute. A card whose command
// is missing or not on this list is never run — a guard against an unexpected or
// tampered action document reaching the executor.
const ALLOWED = new Set(["workflow:createTask", "planning:setInsuranceRequirement"]);

function commandOf(structuredOutput: unknown): StudioCommand | null {
  const output = (structuredOutput ?? null) as StudioCommandOutput | null;
  if (!output || output.kind !== "studio_command") return null;
  const command = output.command;
  if (!command || !ALLOWED.has(`${command.domain}:${command.op}`)) return null;
  return command;
}

/** Whether this action is a runnable copilot-proposed studio command. */
export function isProposedStudioCommand(structuredOutput: unknown): boolean {
  return commandOf(structuredOutput) !== null;
}

/** Runs the proposed command and returns the created entity id + a summary. */
export async function runProposedStudioCommand(
  structuredOutput: unknown,
): Promise<{ commandId: string; summary: string }> {
  const command = commandOf(structuredOutput);
  if (!command) throw new Error("This action can't be run automatically.");
  const output = structuredOutput as StudioCommandOutput;
  let result: Record<string, unknown>;
  if (command.domain === "workflow") {
    result = (await runWorkflowCommand(command.op, command.input)).result;
  } else if (command.domain === "planning") {
    result = (await sendPlanningCommand(command.op, command.input)).result;
  } else {
    throw new Error("Unknown command domain.");
  }
  const asString = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  const commandId =
    asString(result.taskId) ??
    asString(result.id) ??
    asString(result.projectId) ??
    asString(result.reference) ??
    "done";
  return {
    commandId,
    summary: output.label ? `${output.label}.` : "Ran the proposed action.",
  };
}
