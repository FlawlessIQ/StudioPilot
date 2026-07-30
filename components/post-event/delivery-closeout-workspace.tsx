"use client";

import { useState } from "react";
import {
  Archive,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { StatusBadge } from "@/components/ui/status-badge";
import { sendPostEventCommand } from "@/lib/post-event/command-client";

const text = (value: unknown) =>
  typeof value === "string" ? value : "";
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export function DeliveryCloseoutWorkspace({
  projectId,
}: {
  projectId?: string;
}) {
  const { records: projects } = useTenantDocuments("projects");
  const { records: albums } = useTenantDocuments("albumWorkflows");
  const { records: closeouts } = useTenantDocuments("projectCloseouts");
  const [evidenceUrl, setEvidenceUrl] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  if (!projectId) return null;
  const project = projects?.find((item) => item.id === projectId);
  const projectAlbums =
    albums?.filter((album) => album.projectId === projectId) ?? [];
  const closeout = closeouts?.find(
    (candidate) => candidate.projectId === projectId,
  );

  async function updateAlbum(
    albumId: string,
    status: "design_sent" | "fulfilled",
  ) {
    setBusy(`${albumId}:${status}`);
    setNotice(null);
    try {
      await sendPostEventCommand("updateAlbumStatus", {
        projectId,
        albumWorkflowId: albumId,
        status,
        evidenceUrl:
          status === "design_sent" ? evidenceUrl[albumId] || null : null,
        evidenceId:
          status === "fulfilled"
            ? `album_fulfillment_${crypto.randomUUID()}`
            : null,
        notes:
          status === "design_sent"
            ? "Studio released a human-created album design proof."
            : "Studio recorded album fulfillment evidence.",
      });
      setNotice(
        status === "design_sent"
          ? "Human-created design proof released to the client."
          : "Album fulfillment recorded.",
      );
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Album status could not update.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function runCloseout(
    type: "prepareCloseout" | "closeProject" | "archiveProject",
  ) {
    setBusy(type);
    setNotice(null);
    try {
      const input =
        type === "prepareCloseout"
          ? { projectId }
          : {
              projectId,
              closeoutId: closeout?.id ?? `closeout_${projectId}`,
            };
      const result = await sendPostEventCommand(type, input);
      const payload = record(result.result);
      setNotice(
        type === "prepareCloseout"
          ? list(payload.blockers).length
            ? `Closeout still has ${list(payload.blockers).length} authoritative blockers.`
            : "Closeout evidence is complete and ready for owner approval."
          : type === "closeProject"
            ? "Project closed and the summary was queued."
            : "Archive handoff completed with retention review preserved.",
      );
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Closeout action failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="delivery-closeout-workspace">
      {projectAlbums.length ? (
        <div>
          <header className="section-heading-row">
            <div>
              <p className="eyebrow">Creative workflow</p>
              <h2>Album milestones</h2>
              <p>
                AI may coordinate status and reminders. Album design stays with
                the photographer.
              </p>
            </div>
            <PackageCheck aria-hidden="true" />
          </header>
          <div className="studio-album-list">
            {projectAlbums.map((album) => (
              <article className="panel" key={album.id}>
                <header>
                  <span>
                    <strong>Client album</strong>
                    <small>{text(project?.name)}</small>
                  </span>
                  <StatusBadge
                    tone={album.status === "fulfilled" ? "success" : "warning"}
                  >
                    {text(album.status).replaceAll("_", " ")}
                  </StatusBadge>
                </header>
                <div className="studio-album-authority">
                  <ShieldCheck />
                  <span>
                    <strong>Human creative authority</strong>
                    <small>
                      StudioCue cannot generate, approve, or fulfill the album
                      design.
                    </small>
                  </span>
                </div>
                {["selections_received", "revision_requested"].includes(
                  String(album.status),
                ) ? (
                  <label>
                    Human-created design proof URL
                    <span>
                      <input
                        onChange={(event) =>
                          setEvidenceUrl((current) => ({
                            ...current,
                            [album.id]: event.target.value,
                          }))
                        }
                        type="url"
                        value={evidenceUrl[album.id] ?? ""}
                      />
                      <button
                        className="button button-dark"
                        disabled={
                          busy !== null || !evidenceUrl[album.id]?.startsWith("https://")
                        }
                        onClick={() => void updateAlbum(album.id, "design_sent")}
                        type="button"
                      >
                        <ExternalLink /> Release proof
                      </button>
                    </span>
                  </label>
                ) : null}
                {album.status === "approved" ? (
                  <button
                    className="button button-dark"
                    disabled={busy !== null}
                    onClick={() => void updateAlbum(album.id, "fulfilled")}
                    type="button"
                  >
                    <CheckCircle2 /> Record fulfillment
                  </button>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
      <section className="panel closeout-assistant">
        <header className="panel-heading">
          <div>
            <p className="eyebrow">Deterministic closeout</p>
            <h2>Closeout assistant</h2>
            <p>
              Reconcile contract, QuickBooks balance, final schedule, delivery,
              album, review ask, crew, and insurance before closing.
            </p>
          </div>
          <Archive aria-hidden="true" />
        </header>
        {closeout ? (
          <div className="closeout-requirements">
            {list(closeout.requirements).map((requirementValue) => {
              const requirement = record(requirementValue);
              return (
                <span
                  className={requirement.complete === true ? "is-complete" : ""}
                  key={text(requirement.key)}
                >
                  {requirement.complete === true ? (
                    <CheckCircle2 />
                  ) : (
                    <CircleAlert />
                  )}
                  <strong>{text(requirement.label)}</strong>
                </span>
              );
            })}
          </div>
        ) : (
          <p className="closeout-empty">
            Run the evidence check when delivery and final provider updates are
            recorded.
          </p>
        )}
        <footer>
          <button
            className="button button-light"
            disabled={busy !== null}
            onClick={() => void runCloseout("prepareCloseout")}
            type="button"
          >
            <RefreshCw /> Reconcile evidence
          </button>
          {closeout?.status === "ready" &&
          !["CLOSED"].includes(text(project?.state)) ? (
            <button
              className="button button-dark"
              disabled={busy !== null}
              onClick={() => void runCloseout("closeProject")}
              type="button"
            >
              <CheckCircle2 /> Approve closeout
            </button>
          ) : null}
          {closeout?.status === "completed" && project?.state === "CLOSED" ? (
            <button
              className="button button-dark"
              disabled={busy !== null}
              onClick={() => void runCloseout("archiveProject")}
              type="button"
            >
              <Archive /> Complete archive handoff
            </button>
          ) : null}
        </footer>
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      </section>
    </section>
  );
}
