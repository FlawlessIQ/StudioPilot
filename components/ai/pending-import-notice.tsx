"use client";

import Link from "next/link";
import { ArrowRight, History, PackageCheck } from "lucide-react";
import { useMemo } from "react";
import { useTenantDocuments } from "@/components/live/tenant-records";

function timeValue(value: unknown): number {
  if (typeof value === "string") return Date.parse(value) || 0;
  if (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof value.toDate === "function"
  ) {
    return value.toDate().valueOf();
  }
  return 0;
}

export function PendingImportNotice({
  destination = "library",
}: {
  destination?: "library" | "packages" | "questionnaires";
}) {
  const { records: sessions } = useTenantDocuments("studioImportSessions");
  const { records: versions } = useTenantDocuments("studioAssetVersions");
  const { records: packages } = useTenantDocuments("packages", {
    enabled: destination !== "questionnaires",
  });
  const { records: questionnaireTemplates } = useTenantDocuments(
    "questionnaireTemplates",
    { enabled: destination !== "packages" },
  );

  const notice = useMemo(() => {
    if (!sessions || !versions) return null;
    const sortedSessions = [...sessions].sort(
      (left, right) =>
        timeValue(right.updatedAt) - timeValue(left.updatedAt),
    );
    const unfinished = sortedSessions.find(
      (session) => !["activated", "cancelled"].includes(String(session.status)),
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
        icon: History,
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
        tone: "pending",
      };
    }

    const nativePackageVersions = new Set(
      (packages ?? []).map((item) => String(item.sourceStudioAssetVersionId ?? "")),
    );
    const nativeQuestionnaireVersions = new Set(
      (questionnaireTemplates ?? []).map((item) =>
        String(item.sourceStudioAssetVersionId ?? ""),
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
      icon: PackageCheck,
      title: "An activated import needs to be synced to this library",
      detail:
        "Your approvals still exist. Open the original import and use Sync to library—there is no need to upload or review the file again.",
      label: "Repair library",
      href: `/studio/import?session=${encodeURIComponent(activatedNeedingSync.id)}`,
      tone: "repair",
    };
  }, [packages, questionnaireTemplates, sessions, versions, destination]);

  if (!notice) return null;
  const Icon = notice.icon;
  return (
    <aside className={`pending-import-notice is-${notice.tone}`} role="status">
      <span><Icon size={20} /></span>
      <div>
        <strong>{notice.title}</strong>
        <p>{notice.detail}</p>
      </div>
      <Link href={notice.href}>
        {notice.label} <ArrowRight size={16} />
      </Link>
    </aside>
  );
}
