"use client";

import { runWorkflowCommand } from "@/lib/workflows/command-client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { runProposalCommand } from "@/lib/proposals/command-client";
import type { ProposalCommandType } from "@/lib/proposals/command-client";
import {
  commandOf,
  isProposedStudioCommand,
  type StudioCommandOutput,
} from "@/lib/ai-actions/proposed-command";

/**
 * Running a copilot-proposed non-email action on approval.
 *
 * The copilot proposes a reversible studio command; the server resolves it into
 * an approval card whose `structuredOutput.command` is the exact, id-resolved
 * payload. When the owner approves, this runs that command through the normal
 * command endpoint — which enforces its own authorization server-side — so the
 * AI never executes anything; it only prepares the card the owner approves.
 * The allowlist and command shape live in `proposed-command.ts` (pure, tested).
 */
export { isProposedStudioCommand };

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
  } else if (command.domain === "proposal") {
    result = (await runProposalCommand(command.op as ProposalCommandType, command.input))
      .result;
  } else {
    throw new Error("Unknown command domain.");
  }
  const asString = (value: unknown): string | null =>
    typeof value === "string" && value.length > 0 ? value : null;
  const commandId =
    asString(result.taskId) ??
    asString(result.proposalId) ??
    asString(result.id) ??
    asString(result.projectId) ??
    asString(result.reference) ??
    "done";
  return {
    commandId,
    summary: output.label ? `${output.label}.` : "Ran the proposed action.",
  };
}
