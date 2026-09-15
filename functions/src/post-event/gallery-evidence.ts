/**
 * What a gallery provider's "your gallery is ready" email proves.
 *
 * A photographer's post-production is nine ticks, and four of them were pure
 * bookkeeping: nobody uploads a gallery to Pixieset before culling and editing
 * the photographs in it. When that email reaches the job's gallery inbox, those
 * four are already true, so they are recorded with the email as evidence
 * instead of waiting for the studio to say so.
 *
 * Backup is deliberately not among them. A published gallery says nothing
 * about whether the originals are safe on two drives, and the delivery gate
 * asks for backup precisely because it is the step that gets skipped. It stays
 * the studio's one tick.
 *
 * Pure, no I/O.
 */

export const GALLERY_EVIDENCED_STEPS = [
  "cull_complete",
  "editing_started",
  "editing_complete",
  "gallery_ready",
] as const;

export const GALLERY_EVIDENCE_ACTOR = "gallery-inbound-email";

type Steps = Record<string, { complete?: boolean } | undefined> | undefined;

const ORDER = [
  "backup_complete",
  "cull_complete",
  "editing_started",
  "editing_complete",
  "gallery_ready",
  "album_proof_ready",
  "delivery_sent",
  "client_downloaded",
  "project_archived",
];

/**
 * The step updates a gallery email justifies, as Firestore field paths, and the
 * rung the record should point at afterwards. Steps already complete keep the
 * studio's own record of them.
 */
export function galleryEvidenceUpdates(input: {
  steps: Steps;
  evidenceId: string;
  receivedAt: string;
}): { updates: Record<string, unknown>; marked: string[]; currentStep: string } {
  const steps = input.steps ?? {};
  const marked = GALLERY_EVIDENCED_STEPS.filter((key) => steps[key]?.complete !== true);
  const updates: Record<string, unknown> = {};
  for (const key of marked) {
    updates[`steps.${key}`] = {
      complete: true,
      completedAt: input.receivedAt,
      completedBy: GALLERY_EVIDENCE_ACTOR,
      evidenceId: input.evidenceId,
      notes: "Your gallery provider's email showed the gallery was published.",
    };
  }
  const done = (key: string) =>
    steps[key]?.complete === true || (marked as readonly string[]).includes(key);
  const currentStep = ORDER.find((key) => !done(key)) ?? ORDER[ORDER.length - 1]!;
  return { updates, marked: [...marked], currentStep };
}
