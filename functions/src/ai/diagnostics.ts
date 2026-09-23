import { createHash } from "node:crypto";

/**
 * Why a Cue turn came out the way it did.
 *
 * On 2026-09-22 Cue answered "OK. Let's get Marco Silva added as the
 * videographer." and showed nothing to press. Working out whether the model had
 * failed to ask for a flow, or our own code had thrown one away, took an hour
 * of bisecting — because `aiInteractions` stored only the *resolved*
 * `flowDirective`, and `null` there is produced by both. The cause turned out
 * to be ours: the project matcher required the whole stored job name inside the
 * operator's sentence.
 *
 * An hour is the cheap version. The expensive version is a studio reporting
 * "Cue did something odd yesterday" with nothing on file to tell the two apart.
 *
 * So each turn records what the model actually asked for beside what the system
 * did with it, plus which records reached the model. Three questions become
 * answerable from the record alone:
 *
 *  - did the model ask for a flow?                     `flowRequested`
 *  - did the system honour it, and if not why?         `flowResolution`
 *  - did the right records reach the model at all?     `tools`, `referencedProjectIds`
 *
 * That last one separates retrieval failures from judgement failures, which are
 * the two things most easily confused when an answer is wrong.
 *
 * Nothing here is shown to the operator. It carries no record content — ids,
 * names of tools and lengths only — so it stays small and adds no new place for
 * a client's words to sit.
 */

export type FlowResolution =
  /** The model asked for no flow. Anything missing downstream is the model. */
  | "not_requested"
  /** Asked for, and launched. */
  | "resolved"
  /** Asked for, but the project could not be identified — ours to fix. */
  | "dropped_unresolved_project";

export type CopilotDiagnostics = {
  /** What the model asked for, before any of our resolution. */
  flowRequested: { type: string; hasProjectId: boolean; subject: string | null; role: string | null } | null;
  flowResolution: FlowResolution;
  /** The project the flow was aimed at, after resolution. */
  flowProjectId: string | null;
  /** Read tools the model called, in order, with the arguments that scope them. */
  tools: Array<{ name: string; projectId: string | null }>;
  /** Every project any tool touched — what the model could actually see. */
  referencedProjectIds: string[];
  /** Counts only. Enough to spot "the model said a lot and did nothing". */
  answerChars: number;
  /**
   * Contact details stripped from the answer before it was sent.
   *
   * Empty on every healthy turn — the prompt forbids writing them and the
   * tools do not supply them. A non-empty list means one of those two stopped
   * being true, which is worth knowing the same day.
   */
  redactions: ("email" | "phone")[];
  factCount: number;
  citationCount: number;
  proposalCount: number;
  actionProposalCount: number;
  /**
   * Which prompt produced this. The system instruction is the least-tested,
   * highest-leverage artifact in Cue; without a fingerprint on every turn there
   * is no way to say "answers got worse after we changed the wording".
   */
  promptFingerprint: string;
  model: string;
};

/** Short, stable, and not reversible into the prompt text. */
export function promptFingerprint(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 12);
}
