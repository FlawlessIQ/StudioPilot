/**
 * What, if anything, the library should say about an unfinished import.
 *
 * Extracted from the component because this is where the reported bug
 * lived: a studio was told "10 approved import drafts are waiting to be
 * activated" long after its packages were in the library, with no way to
 * disagree. The branching has three outcomes and reads five collections;
 * it is a decision, not a render, and it belongs somewhere it can be
 * tested against the exact state that caused the complaint.
 *
 * Note what this function deliberately does *not* try to do: guess whether
 * a hand-made package corresponds to some extracted draft. Matching by name
 * would be a heuristic that is wrong sometimes and silent when it is. The
 * honest answer to "I already handled this another way" is to let the
 * person say so — see `sessionId`, which the banner offers as a dismissal.
 */
export type PendingImportRecord = Record<string, unknown> & { id: string };

export type PendingImportNotice = {
  kind: "pending" | "repair";
  title: string;
  detail: string;
  label: string;
  href: string;
  /**
   * The session a dismissal would close, or null when there is nothing to
   * close. An activated session is null on purpose: its content is live,
   * the cancel command refuses it, and syncing is the only real remedy.
   */
  sessionId: string | null;
};

export type PendingImportDestination = "library" | "packages" | "questionnaires";

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** Firestore timestamps arrive as strings here, but not always. */
export function timeValue(value: unknown): number {
  if (typeof value === "string") return Date.parse(value) || 0;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate: unknown }).toDate === "function"
  ) {
    return (value as { toDate: () => Date }).toDate().valueOf();
  }
  return 0;
}

export function pendingImportNotice(input: {
  sessions: PendingImportRecord[] | null;
  versions: PendingImportRecord[] | null;
  packages: PendingImportRecord[] | null;
  questionnaireTemplates: PendingImportRecord[] | null;
  destination: PendingImportDestination;
}): PendingImportNotice | null {
  const { destination, packages, questionnaireTemplates, sessions, versions } =
    input;
  if (!sessions || !versions) return null;

  const sortedSessions = [...sessions].sort(
    (left, right) => timeValue(right.updatedAt) - timeValue(left.updatedAt),
  );

  // "cancelled" is how a studio says it handled the import elsewhere. It is
  // terminal here even though the drafts survive in Firestore — the point
  // of cancelling is to stop the reminder, not to destroy the extraction.
  const unfinished = sortedSessions.find(
    (session) => !["activated", "cancelled"].includes(text(session.status)),
  );

  if (unfinished) {
    const sessionVersions = versions.filter(
      (version) => version.importSessionId === unfinished.id,
    );
    const approved = sessionVersions.filter(
      (version) =>
        version.reviewDecision === "approved" && version.status === "draft",
    ).length;
    const pending = sessionVersions.filter(
      (version) =>
        version.reviewDecision === "pending" && version.status === "draft",
    ).length;
    return {
      kind: "pending",
      title: approved
        ? `${approved} approved import draft${approved === 1 ? " is" : "s are"} waiting to be activated`
        : "An AI import still needs your review",
      detail: approved
        ? pending
          ? `Your work is saved. Resolve ${pending} remaining draft${pending === 1 ? "" : "s"}, then activate the approved content.`
          : "Your approvals are saved, but they are not in the live library until you activate them."
        : "Your extracted drafts are saved in their original import session and have not been lost.",
      label: approved ? "Finish and activate" : "Resume import",
      href: `/studio/import?session=${encodeURIComponent(unfinished.id)}`,
      sessionId: unfinished.id,
    };
  }

  const nativePackageVersions = new Set(
    (packages ?? []).map((item) => text(item.sourceStudioAssetVersionId)),
  );
  const nativeQuestionnaireVersions = new Set(
    (questionnaireTemplates ?? []).map((item) =>
      text(item.sourceStudioAssetVersionId),
    ),
  );
  const activatedNeedingSync = sortedSessions.find((session) => {
    if (session.status !== "activated") return false;
    return versions.some((version) => {
      if (version.importSessionId !== session.id || version.status !== "active")
        return false;
      if (
        destination !== "questionnaires" &&
        version.assetType === "package" &&
        !nativePackageVersions.has(version.id)
      )
        return true;
      return (
        destination !== "packages" &&
        version.assetType === "questionnaire" &&
        !nativeQuestionnaireVersions.has(version.id)
      );
    });
  });
  if (!activatedNeedingSync) return null;

  return {
    kind: "repair",
    title: "An activated import needs to be synced to this library",
    detail:
      "Your approvals still exist. Open the original import and use Sync to library—there is no need to upload or review the file again.",
    label: "Repair library",
    href: `/studio/import?session=${encodeURIComponent(activatedNeedingSync.id)}`,
    sessionId: null,
  };
}
