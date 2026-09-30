"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import {
  refreshTenantRecords,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import { StatusBadge } from "@/components/ui/status-badge";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import { statusLabel } from "@/features/format/status-label";
import { friendlyError } from "@/lib/ai/friendly-error";
import { RecordFinalPayment } from "@/components/booking/record-final-payment";
import { finalBalanceFromSchedule } from "@/features/booking/agreed-final-balance";
import { formatCents } from "@/lib/format/money";
import {
  closeoutPendingNote,
  outstandingCloseoutLabels,
  requirementMayBeAttested,
} from "@/features/post-event/closeout-attestation";
import { previousAlbumStatus } from "@/features/post-event/undo";
import { ActionHint, InfoHint } from "@/components/ui/info-hint";
import { ConfirmStep } from "@/components/ui/confirm-step";
import { useWorkspace } from "@/features/auth/workspace-context";

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
  const { records: invoices } = useTenantDocuments("invoiceReferences");
  const { records: closeouts } = useTenantDocuments("projectCloseouts");
  const { records: reviews } = useTenantDocuments("reviewRequests");
  const { records: proposals } = useTenantDocuments("proposals");
  const { records: packageSnapshots } = useTenantDocuments("packageSnapshots");
  const { records: deliveries } = useTenantDocuments("deliveryRecords");
  const workspace = useWorkspace();
  const [evidenceUrl, setEvidenceUrl] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  /** Which requirement's "how do you know?" form is open, if any. */
  const [attesting, setAttesting] = useState<string | null>(null);
  /** The one confirm step in front of each irreversible or couple-facing act. */
  const [confirming, setConfirming] = useState<"close" | "skip_reviews" | null>(null);
  /**
   * The album whose "Record fulfillment" is waiting on its confirm step. It
   * was one tap: the album reads as done to the couple and to closeout, and
   * its reminders stop (wave 3). It can be stepped back, so the step says so.
   */
  const [confirmingFulfillment, setConfirmingFulfillment] = useState<string | null>(null);

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
      refreshTenantRecords("projectCloseouts");
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
  const reconciledFor = useRef<string | null>(null);
  const projectState = text(
    projects?.find((item) => item.id === projectId)?.state,
  );
  /**
   * Reconcile on arrival instead of behind a button.
   *
   * Closing a job was "Reconcile evidence", read eight rows, "Approve
   * closeout", then "Complete archive handoff" — four decisions to learn that
   * nothing was wrong. The check is read-only, so run it once a delivered job
   * is opened; the studio then sees either one line and one button, or only
   * what is actually open.
   */
  useEffect(() => {
    if (!projectId || reconciledFor.current === projectId) return;
    if (!["DELIVERED", "REVIEW_REQUESTED"].includes(projectState)) return;
    reconciledFor.current = projectId;
    void sendPostEventCommand("prepareCloseout", { projectId })
      .then(() => refreshTenantRecords("projectCloseouts", "projects"))
      .catch(() => undefined);
  }, [projectId, projectState]);
  if (!projectId) return null;
  const project = projects?.find((item) => item.id === projectId);
  const packageSnapshotId = text(project?.packageSnapshotId);
  /**
   * The number the studio is about to vouch for.
   *
   * The form said "the amount comes from the proposal they accepted" and then
   * never said what it was, so a studio recorded a final balance it could not
   * see. Derived here exactly as the server derives it — the accepted
   * proposal's payment schedule, with the package snapshot as the fallback —
   * so the label cannot disagree with what gets written.
   */
  const acceptedProposal = (proposals ?? []).find(
    (item) => item.projectId === projectId && item.status === "accepted",
  );
  const snapshotTotalCents = Number(
    (packageSnapshots ?? []).find((item) => item.id === packageSnapshotId)
      ?.totalCents ?? 0,
  );
  const finalBalanceCents = finalBalanceFromSchedule(
    acceptedProposal?.paymentSchedule,
    Number.isFinite(snapshotTotalCents) ? snapshotTotalCents : 0,
  );
  const balanceLabel = finalBalanceCents > 0 ? formatCents(finalBalanceCents) : null;
  const standingFinal = invoices?.find(
    (invoice) =>
      invoice.projectId === projectId &&
      invoice.kind === "final" &&
      invoice.status !== "paid",
  );
  const finalInvoiceProvider = text(standingFinal?.provider) || null;
  const projectAlbums =
    albums?.filter((album) => album.projectId === projectId) ?? [];
  const closeout = closeouts?.find(
    (candidate) => candidate.projectId === projectId,
  );

  /**
   * The album's steps, including the two the couple usually takes in their
   * portal. A couple who emailed their selections, or approved the design by
   * phone, left the album stuck: the server accepted "selections received"
   * and "approved" from the studio, but no screen offered them, and "Record
   * fulfillment" only appears at `approved` (Wave 2).
   */
  const ALBUM_STEP_COPY: Record<string, { notes: string; done: string }> = {
    selections_received: {
      notes: "Studio recorded the couple's album selections, received outside the portal.",
      done: "Selections recorded. The selection reminders stop.",
    },
    design_sent: {
      notes: "Studio released a human-created album design proof.",
      done: "Human-created design proof released to the client.",
    },
    revision_requested: {
      notes: "Studio recorded the couple's request for changes, made outside the portal.",
      done: "Recorded: they asked for changes.",
    },
    approved: {
      notes: "Studio recorded the couple's approval of the design, given outside the portal.",
      done: "Recorded: they approved the design.",
    },
    fulfilled: {
      notes: "Studio recorded album fulfillment evidence.",
      done: "Album fulfillment recorded.",
    },
  };

  async function updateAlbum(
    albumId: string,
    status: "selections_received" | "design_sent" | "revision_requested" | "approved" | "fulfilled",
  ) {
    setBusy(`${albumId}:${status}`);
    setNotice(null);
    try {
      await sendPostEventCommand("updateAlbumStatus", {
        projectId,
        albumWorkflowId: albumId,
        status,
        evidenceUrl:
          status === "design_sent" || status === "selections_received"
            ? evidenceUrl[albumId] || null
            : null,
        evidenceId:
          status === "fulfilled"
            ? `album_fulfillment_${crypto.randomUUID()}`
            : null,
        notes: ALBUM_STEP_COPY[status]!.notes,
      });
      refreshTenantRecords("albumWorkflows");
      setNotice(ALBUM_STEP_COPY[status]!.done);
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "Album status could not update."),
      );
    } finally {
      setBusy(null);
    }
  }

  /** One step back, for a click made by mistake. Audited server-side. */
  async function revertAlbum(albumId: string, back: string) {
    setBusy(`${albumId}:revert`);
    setNotice(null);
    try {
      await sendPostEventCommand("revertAlbumStatus", {
        projectId,
        albumWorkflowId: albumId,
        notes: null,
      });
      refreshTenantRecords("albumWorkflows");
      setNotice(`Put back to "${statusLabel(back)}".`);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The album could not be put back."));
    } finally {
      setBusy(null);
    }
  }

  async function skipReviews() {
    setBusy("skip_reviews");
    setNotice(null);
    try {
      await sendPostEventCommand("skipReviewRequests", { projectId, reason: null });
      setConfirming(null);
      refreshTenantRecords("reviewRequests", "projects");
      setNotice("Done. StudioCue won't ask this couple for a review.");
      // The closeout's review row settles on the decision; re-read it.
      await runCloseout("prepareCloseout", { quiet: true });
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The review asks could not be stopped."));
    } finally {
      setBusy(null);
    }
  }

  async function runCloseout(
    type: "prepareCloseout" | "closeProject" | "archiveProject",
    options: { quiet?: boolean } = {},
  ): Promise<boolean> {
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
      // The requirements list below reads the stored closeout, so it has to be
      // re-read: reconciling wrote eight requirements and the panel went on
      // showing nothing until the page was reloaded by hand.
      refreshTenantRecords("projectCloseouts", "projects", "deliveryRecords");
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
      if (options.quiet) return true;
      setNotice(
        type === "prepareCloseout"
          ? stillBlocked
            ? `Still outstanding: ${unmet.join(", ")}.`
            : "Closeout evidence is complete and ready for owner approval."
          : type === "closeProject"
            ? "Project closed and the summary was queued."
            : "Archived. The job is closed and its records are kept for the retention review.",
      );
      return true;
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "Closeout action failed."),
      );
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function closeAndArchive() {
    if (await runCloseout("closeProject", { quiet: true })) {
      await runCloseout("archiveProject");
    }
  }

  const requirementRows = list(closeout?.requirements).map((value) => {
    const requirement = record(value);
    const vouched = Boolean(text(record(requirement.attestation).attestedAt));
    return { requirement, met: requirement.complete === true || vouched };
  });
  const openRows = requirementRows.filter((row) => !row.met);
  /**
   * How many of the eight closed on someone's word rather than on evidence.
   * "Everything reconciles … all check out" read as though StudioCue had
   * verified all eight on a job where five were attestations; the panel says
   * "you vouched for this" on every such row and the headline erased it.
   */
  const vouchedCount = requirementRows.filter(
    (row) =>
      row.requirement.complete !== true &&
      Boolean(text(record(row.requirement.attestation).attestedAt)),
  ).length;
  /**
   * What the open rows are waiting on, so the panel can say so rather than
   * offering "Mark as done" as the only move on something not yet due.
   */
  const nextReviewAsk = (reviews ?? [])
    .filter(
      (item) => item.projectId === projectId && item.status === "scheduled",
    )
    .sort((left, right) =>
      text(left.scheduledAt).localeCompare(text(right.scheduledAt)),
    )[0];
  const sentDelivery = (deliveries ?? []).find(
    (item) => item.projectId === projectId && text(item.sentAt),
  );
  const pendingContext = {
    reviewScheduledAt: text(nextReviewAsk?.scheduledAt) || null,
    reviewChannel: text(nextReviewAsk?.channel) || null,
    deliverySentAt: text(sentDelivery?.sentAt) || null,
    albumStatus: text(projectAlbums[0]?.status) || null,
  };
  const projectReviews = (reviews ?? []).filter((item) => item.projectId === projectId);
  const reviewAsksOff = typeof project?.reviewRequestsSkippedAt === "string";
  // Theirs or the studio's: either way there is nothing left to ask.
  const reviewConfirmed = projectReviews.some((item) =>
    ["client_confirmed", "manually_confirmed"].includes(text(item.status)),
  );
  const pendingAsks = projectReviews.filter((item) => item.status === "scheduled").length;
  const closed = text(project?.state) === "CLOSED";
  const archived = Boolean(text(project?.archivedAt));
  /**
   * What the server lets this role do here (functions/src/post-event/
   * commands.ts): closing, archiving and stopping review asks are owner/
   * admin; releasing a proof or recording fulfillment is not for staff
   * photographers. A button the server refuses is a dead end, so a role
   * without it is told who does it instead (wave 3). Display only.
   */
  const mayClose = ["studio_owner", "studio_admin"].includes(workspace.role ?? "");
  const mayDecideAlbum = ["studio_owner", "studio_admin", "studio_coordinator"].includes(workspace.role ?? "");
  const closeable = closeout?.status === "ready" && !closed;
  const readyToClose = closeable && mayClose;

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
                {[
                  "instructions_available",
                  "instructions_viewed",
                  "selections_pending",
                ].includes(String(album.status)) ? (
                  <label>
                    They sent their selections another way? Link (optional)
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
                        className="button button-light"
                        disabled={busy !== null}
                        onClick={() => void updateAlbum(album.id, "selections_received")}
                        type="button"
                      >
                        <CheckCircle2 /> Selections received
                      </button>
                    </span>
                  </label>
                ) : null}
                {mayDecideAlbum &&
                ["selections_received", "revision_requested"].includes(
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
                {album.status === "design_sent" ? (
                  <span className="album-decision-actions">
                    <button
                      className="button button-light"
                      disabled={busy !== null}
                      onClick={() => void updateAlbum(album.id, "approved")}
                      title="The couple approved the design by email, phone or in person"
                      type="button"
                    >
                      <CheckCircle2 /> They approved it
                    </button>
                    <button
                      className="button button-quiet"
                      disabled={busy !== null}
                      onClick={() => void updateAlbum(album.id, "revision_requested")}
                      type="button"
                    >
                      They asked for changes
                    </button>
                  </span>
                ) : null}
                {album.status === "approved" && confirmingFulfillment === album.id ? (
                  <ConfirmStep
                    busy={busy === `${album.id}:fulfilled`}
                    cancelLabel="Not yet"
                    confirmLabel="Yes, it's delivered"
                    label="Record the album as fulfilled?"
                    onCancel={() => setConfirmingFulfillment(null)}
                    onConfirm={() =>
                      void updateAlbum(album.id, "fulfilled").then(() => setConfirmingFulfillment(null))
                    }
                  >
                    Record the album as made and delivered? It counts toward closing the job, and any album
                    reminders stop. Nothing is emailed to the couple. Pressed too soon? &ldquo;Put back to
                    Approved&rdquo; undoes it.
                  </ConfirmStep>
                ) : album.status === "approved" && !mayDecideAlbum ? (
                  <small>An owner, admin or coordinator records the album as fulfilled.</small>
                ) : album.status === "approved" ? (
                  <button
                    className="button button-dark"
                    disabled={busy !== null}
                    onClick={() => setConfirmingFulfillment(album.id)}
                    type="button"
                  >
                    <CheckCircle2 /> Record fulfillment
                  </button>
                ) : null}
                {(() => {
                  const back = previousAlbumStatus(
                    String(album.status),
                    album.statusHistory,
                  );
                  return back ? (
                    <button
                      className="button button-quiet button-sm"
                      disabled={busy !== null}
                      onClick={() => void revertAlbum(album.id, back)}
                      title="Undo the last album step, if it was a mistake. Recorded in the audit log."
                      type="button"
                    >
                      Put back to &ldquo;{statusLabel(back)}&rdquo;
                    </button>
                  ) : null;
                })()}
              </article>
            ))}
          </div>
        </div>
      ) : null}
      <section className="panel closeout-assistant">
        <header className="panel-heading">
          <div>
            <p className="eyebrow">Closing the job</p>
            <h2>
              {archived
                ? "Archived"
                : closed
                  ? "Closed"
                  : readyToClose
                    ? "Everything reconciles"
                    : "Wrap up"}
              <InfoHint term="closeout" />
            </h2>
            <p>
              {archived
                ? "This job is closed and archived."
                : readyToClose
                  ? vouchedCount
                    ? `Everything is accounted for — ${vouchedCount} of ${requirementRows.length} on your word. Close and archive this job?`
                    : "The agreement, balance, gallery, album, review ask, crew and insurance all check out. Close and archive this job?"
                  : closeout && openRows.length
                    ? `${requirementRows.length - openRows.length} of ${requirementRows.length} are settled. What's left is below.`
                    : "StudioCue checks the agreement, balance, gallery, album, review ask, crew and insurance once the gallery is delivered."}
            </p>
          </div>
          <Archive aria-hidden="true" />
        </header>
        {closeout && openRows.length ? (
          <div className="closeout-requirements">
            {openRows.map(({ requirement: requirementValue }) => {
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
                  {!met && closeoutPendingNote(key, pendingContext) ? (
                    <em className="closeout-pending">
                      {closeoutPendingNote(key, pendingContext)}
                    </em>
                  ) : null}
                  {!met && key === "final_balance" && requirement.noAgreedBalance === true ? (
                    <em className="closeout-pending">
                      No price was agreed in StudioCue for this job, so there is no balance to record a
                      payment against. If it&rsquo;s settled, say how you know.
                    </em>
                  ) : null}
                  {!met &&
                  requirementMayBeAttested({
                    key,
                    label: text(requirement.label),
                    complete: false,
                    noAgreedBalance: requirement.noAgreedBalance === true,
                  }) ? (
                    <ActionHint hint="Vouch that this happened outside StudioCue. Your note goes in the audit log, and the job shows it was on your word.">
                      <button
                        className="button button-quiet button-sm closeout-attest"
                        disabled={busy !== null}
                        onClick={() => setAttesting(key)}
                        type="button"
                      >
                        Mark as done
                      </button>
                    </ActionHint>
                  ) : null}
                  {/**
                    * Money is not attestable at closeout — it is recorded.
                    *
                    * "Final QuickBooks balance settled" is deliberately absent
                    * from the attestable list: a job should not be closed by
                    * someone ticking a box next to the money. But the only
                    * thing that could satisfy it was an invoice a scheduler
                    * raises 28 days before the event, so a couple who paid
                    * early left the job permanently unclosable. This records
                    * the payment properly instead — a real invoice record,
                    * `manual_attested`, with the amount read from the accepted
                    * proposal rather than from this screen.
                    */}
                  {!met && key === "final_balance" && packageSnapshotId ? (
                    <RecordFinalPayment
                      onRecorded={(message) => {
                        // The row this control sits in disappears as soon as
                        // the requirement is met, so the workspace holds the
                        // confirmation.
                        setNotice(message);
                        void runCloseout("prepareCloseout");
                      }}
                      balanceLabel={balanceLabel}
                      packageSnapshotId={packageSnapshotId}
                      projectId={projectId}
                      providerLabel={finalInvoiceProvider}
                      standingInvoice={Boolean(finalInvoiceProvider)}
                    />
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
                          placeholder={
                            key === "final_balance"
                              ? "Paid in full by bank transfer before we moved to StudioCue"
                              : "Ada confirmed by text that they have the gallery"
                          }
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
        ) : null}
        {closeout && requirementRows.length > openRows.length ? (
          <details className="closeout-settled">
            <summary>What was checked</summary>
            <ul>
              {requirementRows
                .filter((row) => row.met)
                .map(({ requirement }) => (
                  <li key={text(requirement.key)}>
                    <CheckCircle2 aria-hidden="true" size={14} />
                    {text(requirement.label)}
                    {requirement.complete !== true ? " (you vouched for this)" : ""}
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
        {/*
          "Don't ask this couple for a review" (Wave 2). The only stop was
          "they reviewed us", which records a review that never happened.
          Offered until the job is closed; the server decides who may.
        */}
        {!closed && reviewAsksOff ? (
          <p className="closeout-confirm">
            <small>Review asks are off for this couple.</small>
          </p>
        ) : mayClose && !closed && !reviewConfirmed && ["POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED"].includes(projectState) ? (
          <div className="closeout-confirm">
            {confirming === "skip_reviews" ? (
              <>
                <p>
                  {pendingAsks
                    ? `The ${pendingAsks === 1 ? "review ask that hasn't gone out" : `${pendingAsks} review asks that haven't gone out`} will be cancelled, and none will be scheduled for this couple. Nothing is sent to them.`
                    : "No review asks will be scheduled for this couple. Nothing is sent to them."}
                </p>
                <span>
                  <button
                    className="button button-dark"
                    disabled={busy !== null}
                    onClick={() => void skipReviews()}
                    type="button"
                  >
                    Yes, don&rsquo;t ask them
                  </button>
                  <button
                    className="button button-quiet"
                    disabled={busy !== null}
                    onClick={() => setConfirming(null)}
                    type="button"
                  >
                    Keep the asks
                  </button>
                </span>
              </>
            ) : (
              <button
                className="button button-quiet button-sm"
                disabled={busy !== null}
                onClick={() => setConfirming("skip_reviews")}
                type="button"
              >
                Don&rsquo;t ask this couple for a review
              </button>
            )}
          </div>
        ) : null}
        {/*
          One click used to close and archive with no word of what that does,
          and CLOSED cannot be reopened (Wave 2). Say it, then do it.
        */}
        {readyToClose && confirming === "close" ? (
          <div className="closeout-confirm" role="alertdialog" aria-label="Close and archive this job?">
            <p>
              Closing stops anything still due to the couple — review and album reminders — and the job leaves your
              active list for the archive. A closed job can&rsquo;t be reopened yet.
            </p>
          </div>
        ) : null}
        <footer>
          {readyToClose && confirming === "close" ? (
            <>
              <button
                className="button button-dark"
                disabled={busy !== null}
                onClick={() => {
                  setConfirming(null);
                  void closeAndArchive();
                }}
                type="button"
              >
                <Archive /> Yes, close and archive
              </button>
              <button
                className="button button-quiet"
                disabled={busy !== null}
                onClick={() => setConfirming(null)}
                type="button"
              >
                Not yet
              </button>
            </>
          ) : readyToClose ? (
            <button
              className="button button-dark"
              disabled={busy !== null}
              onClick={() => setConfirming("close")}
              type="button"
            >
              <Archive /> Close and archive
            </button>
          ) : closeable ? (
            <small>Everything is in. An owner or admin closes the job.</small>
          ) : null}
          {!closed ? (
            <button
              className="button button-light"
              disabled={busy !== null}
              onClick={() => void runCloseout("prepareCloseout")}
              type="button"
            >
              <RefreshCw /> Check again
            </button>
          ) : null}
          {closeout?.status === "completed" && closed && !archived ? (
            <button
              className="button button-dark"
              disabled={busy !== null}
              onClick={() => void runCloseout("archiveProject")}
              type="button"
            >
              <Archive /> Archive
            </button>
          ) : null}
        </footer>
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      </section>
    </section>
  );
}
