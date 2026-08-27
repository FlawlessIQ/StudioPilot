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
import { statusLabel } from "@/features/format/status-label";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  outstandingCloseoutLabels,
  requirementIsAttestable,
} from "@/features/post-event/closeout-attestation";

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
  /** Which requirement's "how do you know?" form is open, if any. */
  const [attesting, setAttesting] = useState<string | null>(null);

  async function attestRequirement(requirementKey: string, note: string) {
    setBusy("attest");
    setNotice(null);
    try {
      await sendPostEventCommand("attestCloseoutRequirement", {
        projectId,
        closeoutId: closeout?.id ?? `closeout_${projectId}`,
        requirementKey,
        note,
      });
      setAttesting(null);
      // The reconciler is what decides whether the job can now close, so ask
      // it rather than guessing from here.
      await runCloseout("prepareCloseout");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That could not be recorded."));
    } finally {
      setBusy(null);
    }
  }
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
        friendlyError(caught, "Album status could not update."),
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
      /**
       * Name them, do not count them — and read them from the record.
       *
       * Two faults here. The message said "Closeout still has 6 authoritative
       * blockers" while the record it had just written held all eight
       * requirements with labels written for a human: "Final QuickBooks
       * balance settled", "Review request sent", "Crew assignments closed".
       * The reconciler knew exactly what was outstanding and the one screen
       * whose job is reconciliation printed a number.
       *
       * Worse, it read the blockers from the command's response, and a second
       * run returns none — so reconciling twice reported "complete and ready
       * for owner approval" on a closeout whose stored status was `blocked`
       * with six requirements unmet, and the Approve button (which needs
       * `ready`) stayed hidden with nothing explaining the contradiction.
       *
       * The stored requirements are the authority, so they are what is read.
       */
      const unmet = outstandingCloseoutLabels(
        list(payload.requirements ?? closeout?.requirements).map(
          (requirement) => {
            const entry = record(requirement);
            const attestation = record(entry.attestation);
            return {
              key: text(entry.key),
              label:
                text(entry.label) || text(entry.key).replaceAll("_", " "),
              complete: entry.complete === true,
              attestation: text(attestation.attestedAt)
                ? {
                    attestedBy: text(attestation.attestedBy),
                    attestedAt: text(attestation.attestedAt),
                    note: text(attestation.note),
                  }
                : null,
            };
          },
        ),
      );
      const stillBlocked = unmet.length > 0;
      setNotice(
        type === "prepareCloseout"
          ? stillBlocked
            ? `Still outstanding: ${unmet.join(", ")}.`
            : "Closeout evidence is complete and ready for owner approval."
          : type === "closeProject"
            ? "Project closed and the summary was queued."
            : "Archive handoff completed with retention review preserved.",
      );
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "Closeout action failed."),
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
                    {statusLabel(album.status)}
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
            <p className="eyebrow">Closing the job</p>
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
              const key = text(requirement.key);
              const attestation = record(requirement.attestation);
              const vouched = Boolean(text(attestation.attestedAt));
              const met = requirement.complete === true || vouched;
              return (
                <span className={met ? "is-complete" : ""} key={key}>
                  {met ? <CheckCircle2 /> : <CircleAlert />}
                  <strong>{text(requirement.label)}</strong>
                  {/* Vouched for, not proven — said on the row rather than
                      hidden, because how a job closed matters later. */}
                  {vouched && requirement.complete !== true ? (
                    <em className="closeout-vouched">
                      You vouched for this{" "}
                      {text(attestation.note) ? `— ${text(attestation.note)}` : ""}
                    </em>
                  ) : null}
                  {/*
                    The way through when the last requirement is not the
                    studio's to satisfy: a couple who never opens the gallery, a
                    second shooter who never files a closeout, a COI emailed to
                    the venue from the photographer's own account. Money and the
                    signed agreement are absent from this list on purpose.
                  */}
                  {!met && requirementIsAttestable(key) ? (
                    <button
                      className="closeout-attest"
                      disabled={busy !== null}
                      onClick={() => setAttesting(key)}
                      type="button"
                    >
                      Mark as done
                    </button>
                  ) : null}
                  {attesting === key ? (
                    <form
                      className="closeout-attest-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const note = String(
                          new FormData(event.currentTarget).get("note") ?? "",
                        );
                        void attestRequirement(key, note);
                      }}
                    >
                      <label>
                        How do you know?
                        <input
                          maxLength={500}
                          minLength={8}
                          name="note"
                          placeholder="Ada confirmed by text that they have the gallery"
                          required
                        />
                      </label>
                      <small>
                        Recorded against your name in the audit log, and the job
                        will show that you vouched for it rather than that
                        StudioCue saw it.
                      </small>
                      <div>
                        <button className="button" type="submit">
                          Record it
                        </button>
                        <button
                          className="button button-quiet"
                          onClick={() => setAttesting(null)}
                          type="button"
                        >
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : null}
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
