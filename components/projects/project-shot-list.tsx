"use client";

import { useState } from "react";
import { Camera, Download, LoaderCircle } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { resolvePlanningTimeline } from "@/features/planning/planning-timeline";
import {
  fileSizeLabel,
  shotListNeedsStudio,
  shotListStatus,
  type ShotListFile,
  type ShotListRecord,
} from "@/features/planning/shot-list";
import { friendlyError } from "@/lib/ai/friendly-error";
import { resolveFile } from "@/lib/documents/resolve-file";
import { sendPlanningCommand } from "@/lib/planning/command-client";

/**
 * The couple's own shot list, on the job (features/planning/shot-list.ts).
 *
 * Says where it stands — not asked yet (and when it will be), asked (and when
 * it's due), or sent — and when sent, the files and their note. Opening a file
 * (or "Got it") marks it seen, which takes it off Today and tells the couple. "Ask now"
 * sends the request early, for a couple who wants to get it done.
 */

const BOOKED = ["BOOKED", "PLANNING", "READY"];

const day = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function ProjectShotList({
  projectId,
  projectState,
  eventDate,
  eligible,
}: {
  projectId: string;
  projectState: string;
  eventDate: string | null;
  /** A wedding at a photo studio (trades.ts `shotList`): the jobs it's asked for. */
  eligible: boolean;
}) {
  const workspace = useWorkspace();
  const canAct = ["studio_owner", "studio_admin", "studio_coordinator"].includes(String(workspace.role ?? ""));
  const { records } = useTenantDocuments("clientShotLists");
  const { records: tenants } = useTenantDocuments("tenants");
  const record = (records ?? []).find((row) => row.id === projectId || row.projectId === projectId) as ShotListRecord | undefined;
  const timeline = resolvePlanningTimeline(tenants?.find((tenant) => tenant.id === workspace.tenantId)?.planningTimeline);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);

  const status = shotListStatus(record);
  const fresh = shotListNeedsStudio(record) && !seen;
  const files: ShotListFile[] = Array.isArray(record?.files) ? record.files : [];
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = Boolean(eventDate && eventDate.slice(0, 10) > today);

  // Marked seen as the studio opens a file, so a list read here doesn't sit on Today too.
  async function markSeen() {
    if (!fresh || !canAct) return;
    setSeen(true);
    try {
      await sendPlanningCommand("markShotListSeen", { projectId });
      refreshTenantRecords("clientShotLists");
    } catch {
      setSeen(false);
    }
  }

  async function open(file: ShotListFile) {
    setBusy(file.storagePath);
    setNotice(null);
    const resolved = await resolveFile({ kind: "storage", path: file.storagePath, label: file.name, contentType: file.contentType }, workspace.tenantId);
    setBusy(null);
    if (resolved.status !== "ready") return setNotice(resolved.message);
    window.open(resolved.url, "_blank", "noopener");
    void markSeen();
  }

  async function askNow() {
    setBusy("ask");
    setNotice(null);
    try {
      const outcome = await sendPlanningCommand("requestShotList", { projectId });
      if (!outcome.persisted) setNotice("Development preview — nothing was sent.");
      else refreshTenantRecords("clientShotLists");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That couldn't be sent. Try again."));
    } finally {
      setBusy(null);
    }
  }

  if (!record && (!eligible || !BOOKED.includes(projectState) || !upcoming)) return null;

  const asksOn = eventDate && timeline.shotListUpload ? addDays(eventDate, -timeline.shotListUploadDaysBefore) : null;

  return (
    <aside className="job-rail-card project-shot-list" id="shot-list">
      <p className="eyebrow">
        <Camera aria-hidden size={13} /> Their shot list
      </p>
      {status === "received" ? (
        <>
          <strong className="project-shot-list-status">
            {`Sent ${day(record?.receivedAt)}`}
            {fresh ? <em className="plan-area-flag is-now">New</em> : null}
          </strong>
          {files.length ? (
            <ul className="project-shot-list-files">
              {files.map((file) => (
                <li key={file.storagePath}>
                  <button disabled={busy !== null} onClick={() => void open(file)} type="button">
                    {busy === file.storagePath ? <LoaderCircle aria-hidden size={14} /> : <Download aria-hidden size={14} />}
                    <span>{file.name}</span>
                    <small>{fileSizeLabel(file.sizeBytes)}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {record?.note ? <p className="project-shot-list-note">{`“${record.note}”`}</p> : null}
          {fresh && canAct ? (
            <button className="button button-light" onClick={() => void markSeen()} type="button">
              Got it
            </button>
          ) : null}
        </>
      ) : status === "requested" ? (
        <>
          <strong className="project-shot-list-status">{`Asked ${day(record?.requestedAt)}`}</strong>
          <small>
            {record?.dueDate ? `Due ${day(record.dueDate)}. ` : ""}
            Nothing yet. It shows up here and on Today when they send it.
          </small>
        </>
      ) : (
        <>
          <strong className="project-shot-list-status">Not asked yet</strong>
          <small>
            {asksOn && asksOn > today
              ? `They're asked for their must-take photos on ${day(asksOn)}.`
              : "They can send their must-take photos from their portal any time."}
          </small>
          {canAct ? (
            <button className="button button-light" disabled={busy !== null} onClick={() => void askNow()} type="button">
              {busy === "ask" ? "Sending…" : "Ask now"}
            </button>
          ) : null}
        </>
      )}
      {notice ? <small role="status">{notice}</small> : null}
    </aside>
  );
}
