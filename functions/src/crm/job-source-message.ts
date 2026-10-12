import { z } from "zod";
import { cleanOccasion } from "../ai/intake-prefill.js";

/**
 * The message a job was made from, kept with the job for the studio.
 *
 * "Tell me about the booking" on New job reads a pasted email or text into
 * the form, and then the message was thrown away. Priya Shah's "hair for her
 * Sangeet tonight … guests arrive at 6:00 PM … hair done by 5:30 PM" became a
 * job with a date and nothing else, so the quote Cue drafted later spoke of
 * "your wedding … styled on the morning" (Jess Styles Bridal, 2026-10-12). An
 * inquiry keeps its message on the lead; a job made by hand has no lead, so
 * it keeps it here:
 *
 *   - Job history shows it first (features/journey/thread.ts);
 *   - "Draft from what they told you" reads it as the inquiry's message
 *     (ai/copilot.ts, proposal_drafting), and the occasion it names.
 *
 * The ready-by time the message gave is not kept here: the studio confirms
 * it on the form as a fact of the job, so it goes on the project
 * (`readyByTime`), where the party list reads it (planning/job-facts.ts).
 *
 * Studio-only: keyed by the job, readable by the owner, an admin and an
 * assigned coordinator (firestore.rules), never written onto the project
 * itself (which crew can read) and never shown in the client portal. Written
 * once, by createProject (crm/commands.ts), in the same transaction.
 */
export const JOB_SOURCE_MESSAGES = "jobSourceMessages";

/** createProject's `sourceMessage`: what the New job form read the job from. */
export const jobSourceMessageInputSchema = z.object({
  text: z.string().trim().min(1).max(8000),
  /** The read's one-line summary of what they asked for. */
  summary: z.string().trim().max(400).nullable().default(null),
  /** "Sangeet": the occasion the job's name carries, when it names one. */
  occasion: z.string().trim().max(80).nullable().default(null),
});

export type JobSourceMessageInput = z.infer<typeof jobSourceMessageInputSchema>;

/** The document createProject writes at `jobSourceMessages/{projectId}`. */
export function jobSourceMessageRecord(input: {
  tenantId: string;
  projectId: string;
  source: JobSourceMessageInput;
  actorId: string;
  timestamp: string;
}) {
  return {
    id: input.projectId,
    tenantId: input.tenantId,
    projectId: input.projectId,
    message: input.source.text,
    summary: input.source.summary || null,
    occasion: cleanOccasion(input.source.occasion),
    /** Where it came from: the New job form's "Tell me about the booking". */
    origin: "new_job_form",
    createdAt: input.timestamp,
    createdBy: input.actorId,
    archivedAt: null,
  };
}

export type JobSourceMessage = {
  message: string;
  summary: string | null;
  occasion: string | null;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The record's facts, only when it is this tenant's and this job's, and not archived. */
export function jobSourceMessageOf(
  data: Record<string, unknown> | null | undefined,
  tenantId: string,
  projectId: string,
): JobSourceMessage | null {
  if (!data || data.tenantId !== tenantId || data.projectId !== projectId || data.archivedAt) return null;
  const message = text(data.message);
  if (!message) return null;
  return {
    message,
    summary: text(data.summary) || null,
    occasion: cleanOccasion(data.occasion),
  };
}
