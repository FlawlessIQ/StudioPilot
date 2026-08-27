/**
 * The post-production ladder, as a photographer works it.
 *
 * `completePostProductionStep` has existed for a long time and **nothing ever
 * called it.** The walk of 2026-08-26 found the consequence: `recordDelivery`
 * refuses until backup, editing and gallery-ready are ticked, no screen could
 * tick them, and so a finished wedding could not be delivered at all.
 *
 * Two rules shape what this offers.
 *
 * **One writer per fact.** The last three rungs are not the studio's to
 * declare: `delivery_sent` is what releasing the gallery means,
 * `client_downloaded` is the couple opening it, and `project_archived` is the
 * archive handoff. Offering a tick beside those would give each fact two
 * writers and let a studio claim the couple downloaded photographs they have
 * not seen. They are shown, because knowing where the job stands is the point
 * of a checklist, and they are not actionable here.
 *
 * **Only the next rung.** The command enforces the order and refuses with
 * POST_PRODUCTION_DEPENDENCY_INCOMPLETE. Rather than let a photographer press a
 * button that will be refused, only the step whose dependency is satisfied is
 * offered.
 *
 * Pure functions, no I/O.
 */

export type PostProductionStepKey =
  | "backup_complete"
  | "cull_complete"
  | "editing_started"
  | "editing_complete"
  | "gallery_ready"
  | "album_proof_ready"
  | "delivery_sent"
  | "client_downloaded"
  | "project_archived";

/** The order the command enforces. Do not reorder without changing it too. */
export const POST_PRODUCTION_ORDER: readonly PostProductionStepKey[] = [
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

/** Written by another flow, so never offered as a tick here. */
export const NOT_STUDIO_DECLARED: readonly PostProductionStepKey[] = [
  "delivery_sent",
  "client_downloaded",
  "project_archived",
];

type Meta = { label: string; detail: string; owner: string };

export const POST_PRODUCTION_META: Record<PostProductionStepKey, Meta> = {
  backup_complete: {
    label: "Cards backed up",
    detail: "Both copies off the cards and verified.",
    owner: "You",
  },
  cull_complete: {
    label: "Cull finished",
    detail: "The keepers chosen, the rest set aside.",
    owner: "You",
  },
  editing_started: {
    label: "Editing started",
    detail: "So the couple's brief shows work in progress.",
    owner: "You",
  },
  editing_complete: {
    label: "Editing finished",
    detail: "Every keeper edited and exported.",
    owner: "You",
  },
  gallery_ready: {
    label: "Gallery ready",
    detail:
      "Uploaded and ready to release. StudioCue opens a private address so your gallery provider's email files itself against this job.",
    owner: "You",
  },
  album_proof_ready: {
    label: "Album proof ready",
    detail: "Only if an album is included. Follows editing.",
    owner: "You",
  },
  delivery_sent: {
    label: "Gallery released",
    detail: "Set when you record and release the delivery below.",
    owner: "Recording the delivery",
  },
  client_downloaded: {
    label: "Couple opened it",
    detail: "Set when the couple actually visits the gallery.",
    owner: "The couple",
  },
  project_archived: {
    label: "Archived",
    detail: "Set by the archive handoff after closeout.",
    owner: "Archive handoff",
  },
};

/** The dependency the command requires for a step, or null for the first. */
export function dependencyOf(
  step: PostProductionStepKey,
): PostProductionStepKey | null {
  // An album proof follows the edit, not the gallery — a studio may prepare it
  // before or after uploading.
  if (step === "album_proof_ready") return "editing_complete";
  const index = POST_PRODUCTION_ORDER.indexOf(step);
  return index > 0 ? (POST_PRODUCTION_ORDER[index - 1] ?? null) : null;
}

export type PostProductionRow = {
  key: PostProductionStepKey;
  label: string;
  detail: string;
  owner: string;
  complete: boolean;
  /** True when this is the studio's to tick and its dependency is satisfied. */
  actionable: boolean;
  /** What has to happen first, when it has not. */
  waitingOn: string | null;
};

const isComplete = (
  steps: Record<string, { complete?: boolean } | undefined>,
  key: PostProductionStepKey,
): boolean => steps[key]?.complete === true;

export function postProductionRows(
  steps: Record<string, { complete?: boolean } | undefined>,
): PostProductionRow[] {
  return POST_PRODUCTION_ORDER.map((key) => {
    const complete = isComplete(steps, key);
    const studios = !NOT_STUDIO_DECLARED.includes(key);
    const dependency = dependencyOf(key);
    const ready = !dependency || isComplete(steps, dependency);
    return {
      key,
      ...POST_PRODUCTION_META[key],
      complete,
      actionable: studios && !complete && ready,
      waitingOn:
        !complete && studios && !ready && dependency
          ? POST_PRODUCTION_META[dependency].label
          : null,
    };
  });
}

/** The three the delivery gate insists on, for a plain-English summary. */
export const DELIVERY_GATE_STEPS: readonly PostProductionStepKey[] = [
  "backup_complete",
  "editing_complete",
  "gallery_ready",
];

export function deliveryGateCleared(
  steps: Record<string, { complete?: boolean } | undefined>,
): boolean {
  return DELIVERY_GATE_STEPS.every((key) => isComplete(steps, key));
}
