"use client";

import Link from "next/link";
import { ArrowRight, History, LoaderCircle, PackageCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import {
  pendingImportNotice,
  type PendingImportDestination,
} from "@/features/studio-import/pending-notice";
import { cancelStudioImport } from "@/lib/studio-import/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * The unfinished-import banner.
 *
 * The decision about what to say lives in
 * `features/studio-import/pending-notice.ts`; this renders it and offers
 * the two ways forward — finish the import, or say it was handled some
 * other way. The second used to be missing, which is how a studio whose
 * packages were already in the library ended up being told, permanently,
 * that they were not.
 */
export function PendingImportNotice({
  destination = "library",
}: {
  destination?: PendingImportDestination;
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

  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notice = useMemo(
    () =>
      pendingImportNotice({
        sessions,
        versions,
        packages,
        questionnaireTemplates,
        destination,
      }),
    [packages, questionnaireTemplates, sessions, versions, destination],
  );

  async function dismiss(sessionId: string) {
    setBusy(true);
    setError(null);
    try {
      await cancelStudioImport(sessionId);
      // Hidden straight away rather than waiting for the shared document
      // cache to catch up. The reminder is the whole complaint.
      setDismissed(true);
    } catch (caught: unknown) {
      setError(
        friendlyError(caught, "That import could not be closed. Try again."),
      );
      setBusy(false);
    }
  }

  if (!notice || dismissed) return null;
  const Icon = notice.kind === "repair" ? PackageCheck : History;
  return (
    <aside className={`pending-import-notice is-${notice.kind}`} role="status">
      <span>
        <Icon size={20} />
      </span>
      <div>
        <strong>{notice.title}</strong>
        <p>{notice.detail}</p>
        {error ? <p className="pending-import-error">{error}</p> : null}
      </div>
      <div className="pending-import-actions">
        <Link href={notice.href}>
          {notice.label} <ArrowRight size={16} />
        </Link>
        {/* Cancelling keeps every extracted draft — see cancelSession. It
            closes the session so the reminder stops, which is the only
            thing a studio that finished the job elsewhere actually wants. */}
        {notice.sessionId ? (
          <button
            className="pending-import-dismiss"
            disabled={busy}
            onClick={() => void dismiss(notice.sessionId as string)}
            title="Keeps the extracted drafts; stops the reminder"
            type="button"
          >
            {busy ? (
              <LoaderCircle className="pending-import-spin" size={13} />
            ) : (
              <X size={13} />
            )}
            Already handled
          </button>
        ) : null}
      </div>
    </aside>
  );
}
