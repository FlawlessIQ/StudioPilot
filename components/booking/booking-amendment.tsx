"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AMENDABLE_STATES, shiftInZone } from "@/features/booking/amendable";
import { CalendarClock, LoaderCircle, PackagePlus } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { isCataloguePackage } from "@/features/packages/one-off";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { ContractDocumentView } from "@/components/contracts/contract-document-view";
import { contractDocumentSchema } from "@/features/contracts/document";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendBookingCommand } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import { InfoHint } from "@/components/ui/info-hint";
import { JobAddOnsEditor, type JobAddOnLine } from "@/components/proposals/job-add-ons-editor";
import { OneOffPackageForm } from "@/components/proposals/one-off-package-form";
import { oneOffFormValuesFrom, type OneOffPackageInput } from "@/features/packages/one-off-form";

/**
 * "Change the booking": new packages and/or a new date on a job the couple
 * already signed, written up as an amendment they sign.
 *
 * The server does the work (functions/src/contracts/amendments.ts): it prices
 * the change, keeps what has been paid, writes the amended agreement, and —
 * once signed — applies it without moving the job's stage
 * (functions/src/booking/amendment-apply.ts). This panel is the studio's
 * side: choose, read, sign and send, or record a signature taken elsewhere.
 */


export { AMENDABLE_STATES };

type Rec = Record<string, unknown> & { id: string };
const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : 0);
const money = (cents: unknown, currency = "USD") =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: num(cents) % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(num(cents) / 100);

const DAY = 86_400_000;
const daysFrom = (from: string, to: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)
    ? Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY)
    : 0;
/** As it reads mid-sentence: "Move the Zoom call…", "Move the meeting…". */
const callLabel = (mode: unknown) =>
  mode === "zoom" ? "Zoom call" : mode === "phone" ? "phone call" : mode === "in_person" ? "meeting" : "consultation";
/** "Tue, Jun 8 · 3:00 PM" in the call's own timezone. */
function callWhen(iso: string, timezone: string) {
  const at = new Date(iso);
  if (Number.isNaN(at.valueOf())) return iso;
  let zone = "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    zone = timezone;
  } catch {
    // An unknown zone reads in UTC rather than failing the form.
  }
  return `${at.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: zone })} · ${at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: zone })}`;
}
/** Calls this close to the wedding usually belong to it; earlier ones don't. */
const CLOSE_TO_WEDDING_DAYS = 56;

/** The extras a package carries, as the editor and the command both take them. */
function linesOf(value: unknown): JobAddOnLine[] {
  return (Array.isArray(value) ? (value as Array<Record<string, unknown>>) : []).map((line) => ({
    // A one-off kept on an earlier snapshot is carried as a one-off again.
    addOnId: str(line.addOnId) && !str(line.addOnId).startsWith("custom_") ? str(line.addOnId) : null,
    name: str(line.name) || "Extra",
    unitPriceCents: num(line.unitPriceCents),
    taxable: line.taxable !== false,
    quantity: Math.max(1, num(line.quantity) || 1),
  }));
}

/** "Engagement shoot, Parent albums ×2 · $1,100". */
function extrasSummary(lines: JobAddOnLine[], currency: string) {
  if (!lines.length) return "No extras";
  const names = lines.map((line) => `${line.name}${line.quantity > 1 ? ` ×${line.quantity}` : ""}`).join(", ");
  return `${names} · ${money(lines.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0), currency)}`;
}

/** The package's own suggested extras, offered first. */
const suggestionsOf = (record: Rec | undefined): Rec[] =>
  (Array.isArray(record?.addOns) ? (record.addOns as Rec[]) : []).filter((item) => item && item.active !== false && str(item.id));

function run(type: string, input: Record<string, unknown>) {
  return sendBookingCommand({ type, idempotencyKey: `${type}_${crypto.randomUUID()}`, input });
}

export function BookingAmendmentPanel({
  projectId,
  onDone,
  prefill,
}: {
  projectId: string;
  onDone?: (message: string) => void;
  /** What the couple asked for in their portal, as the starting point. */
  prefill?: { eventDate?: string | null; addPackageIds?: string[] };
}) {
  const workspace = useWorkspace();
  const ownerOrAdmin = ["studio_owner", "studio_admin"].includes(String(workspace.role ?? ""));
  const { records: projects } = useTenantDocuments("projects");
  const { records: snapshots } = useTenantDocuments("packageSnapshots");
  const { records: packages } = useTenantDocuments("packages");
  const { records: amendments } = useTenantDocuments("bookingAmendments");
  const { records: consultationRecords } = useTenantDocuments("consultations");
  const project = (projects as Rec[] | null)?.find((item) => item.id === projectId) ?? null;
  const onJobIds = useMemo(
    () =>
      project
        ? [str(project.packageSnapshotId), ...(Array.isArray(project.additionalPackageSnapshotIds) ? (project.additionalPackageSnapshotIds as unknown[]).map(String) : [])].filter(Boolean)
        : [],
    [project],
  );
  const onJob = ((snapshots as Rec[] | null) ?? []).filter((snapshot) => onJobIds.includes(snapshot.id));
  const pending =
    ((amendments as Rec[] | null) ?? []).find(
      (item) => item.id === str(project?.pendingAmendmentId) && ["draft", "sent"].includes(str(item.status)),
    ) ?? null;
  // Signed, and the job hasn't taken it: the apply runs straight after the
  // signature, so this is either a moment old or stuck. It used to show
  // nothing at all — the form offered a new change as if none were signed.
  const signedNotApplied =
    ((amendments as Rec[] | null) ?? []).find(
      (item) => item.id === str(project?.pendingAmendmentId) && str(item.status) === "signed" && !item.appliedAt,
    ) ?? null;

  const [date, setDate] = useState<string | null>(prefill?.eventDate ?? null);
  const [keep, setKeep] = useState<string[] | null>(null);
  const [add, setAdd] = useState<string[]>(prefill?.addPackageIds ?? []);
  const [note, setNote] = useState("");
  const [allowClash, setAllowClash] = useState(false);
  const [clash, setClash] = useState<string | null>(null);
  const [signer, setSigner] = useState(workspace.userName && /\s/.test(workspace.userName) ? workspace.userName : "");
  const [consent, setConsent] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordName, setRecordName] = useState("");
  const [recordDate, setRecordDate] = useState(new Date().toISOString().slice(0, 10));
  const [recordMethod, setRecordMethod] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Withdrawing and recording a signature each ask once more, saying what
  // follows; both used to act on the first tap.
  const [confirming, setConfirming] = useState<"withdraw" | "record" | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  // Back to the choices from a draft; writing it up again replaces the draft.
  const [editing, setEditing] = useState(false);
  // Which upcoming calls move with the date; null until the studio touches one.
  const [moveCalls, setMoveCalls] = useState<string[] | null>(null);
  // "Upcoming" as of opening the form, not re-read on every render.
  const [openedAt] = useState(() => Date.now());
  // Extras the studio set on a package, by `s:<snapshot>` (on the job) or
  // `p:<package>` (being added). A package not here keeps what it has.
  const [extras, setExtras] = useState<Record<string, JobAddOnLine[]>>({});
  const [extrasOpen, setExtrasOpen] = useState<string | null>(null);
  // A one-off package written for this couple, added by the change.
  const [oneOff, setOneOff] = useState<OneOffPackageInput | null>(null);
  const [writingOneOff, setWritingOneOff] = useState(false);

  if (!project) return <p className="cue-action-note">Loading the job…</p>;
  if (!AMENDABLE_STATES.includes(str(project.state)))
    return (
      <p className="form-notice" role="status">
        This is for a booking the couple has already signed. Before that, change the packages on the proposal and the date with Edit job.
      </p>
    );

  const keptIds = keep ?? onJobIds;
  const addable = ((packages as Rec[] | null) ?? []).filter(
    (item) =>
      item.active === true &&
      // Never another couple's one-off (features/packages/one-off.ts).
      isCataloguePackage(item, { projectId }) &&
      !onJob.some((snapshot) => str(snapshot.packageId) === item.id && keptIds.includes(snapshot.id)),
  );
  const newDate = date ?? str(project.eventDate);
  const shiftDays = daysFrom(str(project.eventDate), newDate);
  const upcomingCalls = ((consultationRecords as Rec[] | null) ?? [])
    .filter(
      (call) => call.projectId === projectId && call.status === "scheduled" && Date.parse(str(call.startsAt)) > openedAt,
    )
    .sort((a, b) => str(a.startsAt).localeCompare(str(b.startsAt)));
  const eventAt = Date.parse(`${str(project.eventDate)}T12:00:00Z`);
  const movingCalls =
    moveCalls ??
    upcomingCalls
      .filter((call) => (eventAt - Date.parse(str(call.startsAt))) / DAY <= CLOSE_TO_WEDDING_DAYS)
      .map((call) => call.id);

  async function draft() {
    setBusy(true);
    setError(null);
    setClash(null);
    try {
      await run("draftAmendment", {
        projectId,
        eventDate: newDate !== str(project!.eventDate) ? newDate : null,
        keepPackageSnapshotIds: keptIds,
        addPackageIds: add,
        allowDateClash: allowClash,
        moveConsultationIds: shiftDays ? movingCalls.filter((id) => upcomingCalls.some((call) => call.id === id)) : [],
        // Only for packages the booking will have; the server prices them.
        extras: Object.entries(extras)
          .filter(([key]) => (key.startsWith("s:") ? keptIds.includes(key.slice(2)) : add.includes(key.slice(2))))
          .map(([key, lines]) => ({
            ...(key.startsWith("s:") ? { packageSnapshotId: key.slice(2) } : { packageId: key.slice(2) }),
            addOns: lines.map((line) => ({
              addOnId: line.addOnId,
              name: line.name,
              unitPriceCents: line.unitPriceCents,
              taxable: line.taxable,
              quantity: line.quantity,
            })),
          })),
        oneOffPackage: oneOff
          ? {
              name: oneOff.name,
              basePriceCents: oneOff.basePriceCents,
              included: oneOff.included,
              ...(oneOff.includedCoverage ? { includedCoverage: oneOff.includedCoverage } : {}),
              ...(oneOff.includedCoverageMinutes ? { includedCoverageMinutes: oneOff.includedCoverageMinutes } : {}),
            }
          : null,
        note: note.trim() || null,
      });
      refreshTenantRecords("bookingAmendments", "projects", "proposals", "packageSnapshots", "packages");
      setEditing(false);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      if (message.startsWith("DATE_TAKEN")) setClash(message.split(":").slice(1).join(":") || "another job");
      else setError(friendlyError(caught, "The change couldn't be written up."));
    } finally {
      setBusy(false);
    }
  }

  /** `stay`: the panel keeps showing the change, with the result as a notice. */
  async function act(type: string, input: Record<string, unknown>, done: string, stay = false) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await run(type, input);
      refreshTenantRecords("bookingAmendments", "projects", "proposals", "contracts", "invoiceReferences", "tasks");
      setConfirming(null);
      if (stay) setNotice(done);
      else onDone?.(done);
    } catch (caught) {
      setError(friendlyError(caught, "That couldn't be done."));
    } finally {
      setBusy(false);
    }
  }

  if (signedNotApplied) {
    const signedAt = Date.parse(str(signedNotApplied.signedAt) || str(signedNotApplied.updatedAt));
    // A few minutes is a moment; past that the apply has failed.
    const stuck = !Number.isFinite(signedAt) || openedAt - signedAt > 5 * 60_000;
    return (
      <div className="amendment-panel">
        <p className="eyebrow">Signed</p>
        <ul className="amendment-changes">
          {(Array.isArray(signedNotApplied.changes) ? (signedNotApplied.changes as unknown[]).map(String) : []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="form-notice" role="status">
          {stuck
            ? "The couple signed this change, but the booking hasn't taken it yet — putting it through didn't finish. Apply it again; nothing is done twice."
            : "The couple signed this change. The booking is taking it now — refresh in a moment."}
        </p>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        {stuck ? (
          ownerOrAdmin ? (
            <footer className="amendment-actions">
              <button
                className="button button-dark"
                disabled={busy}
                onClick={() =>
                  void act("retryAmendmentApply", { amendmentId: signedNotApplied.id }, "Applied. The booking now has the change.")
                }
                type="button"
              >
                {busy ? "Applying…" : "Apply it again"}
              </button>
            </footer>
          ) : (
            <p className="amendment-hint">An owner or admin can apply it again.</p>
          )
        ) : null}
      </div>
    );
  }

  // A change written up, or out with the couple.
  if (pending && !(editing && pending.status === "draft")) {
    const moneyInfo = (pending.money ?? {}) as Record<string, unknown>;
    const currency = str(pending.currency) || "USD";
    const parsed = contractDocumentSchema.safeParse(pending.document);
    const sent = pending.status === "sent";
    const recordOnly = pending.signingMode !== "studiocue";
    return (
      <div className="amendment-panel">
        <p className="eyebrow">{sent ? "Waiting for the couple" : "The change"}</p>
        <ul className="amendment-changes">
          {(Array.isArray(pending.changes) ? (pending.changes as unknown[]).map(String) : []).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {(Array.isArray(pending.consultationMoves) ? (pending.consultationMoves as Array<Record<string, unknown>>) : [])
          .filter((move) => str(move.clash))
          .map((move) => (
            <p className="form-notice" key={str(move.consultationId)} role="status">
              {`${str(move.label).charAt(0).toUpperCase()}${str(move.label).slice(1)} ${callWhen(str(move.toStartsAt), str(move.timezone) || "UTC")}: ${str(move.clash)} Change it, or move the call yourself after they sign.`}
            </p>
          ))}
        <p className="amendment-money">
          {`New total ${money(moneyInfo.newTotalCents, currency)} · paid ${money(moneyInfo.paidCents, currency)} · `}
          {num(moneyInfo.refundCents) > 0
            ? `refund due ${money(moneyInfo.refundCents, currency)}`
            : `still to pay ${money(moneyInfo.outstandingCents, currency)}`}
        </p>
        {sent ? (
          <p className="form-notice" role="status">
            {`Sent to the couple to sign. Their current agreement stands until they do; when they sign, the job takes the change.${
              pending.lastResentAt
                ? ` Sent again ${callWhen(str(pending.lastResentAt), Intl.DateTimeFormat().resolvedOptions().timeZone)}.`
                : ""
            }`}
          </p>
        ) : null}
        {sent && !ownerOrAdmin ? (
          <p className="amendment-hint">An owner or admin can send it to the couple again, or record a signature taken another way.</p>
        ) : null}
        {!sent && parsed.success ? (
          <details className="amendment-document">
            <summary>Read the amended agreement</summary>
            <div className="contract-sheet">
              <ContractDocumentView document={parsed.data} />
            </div>
          </details>
        ) : null}
        {!sent && !recordOnly ? (
          ownerOrAdmin ? (
            <div className="record-sheet-fields">
              <label className="is-wide">
                Your name, as your signature for the studio
                <input autoComplete="name" onChange={(event) => setSigner(event.target.value)} placeholder="Your full name" value={signer} />
              </label>
              <label className="is-wide amendment-consent">
                <input checked={consent} onChange={(event) => setConsent(event.target.checked)} type="checkbox" />
                I&apos;m signing this change for the studio, electronically, and my typed name is my signature.
              </label>
            </div>
          ) : (
            <p className="form-notice">An owner or admin signs the change for the studio and sends it.</p>
          )
        ) : null}
        {recording ? (
          <div className="record-sheet-fields">
            <label>
              Who signed
              <input onChange={(event) => setRecordName(event.target.value)} value={recordName} />
            </label>
            <label>
              Signed on
              <input onChange={(event) => setRecordDate(event.target.value)} type="date" value={recordDate} />
            </label>
            <label className="is-wide">
              How
              <input onChange={(event) => setRecordMethod(event.target.value)} placeholder="Signed a paper copy at the studio" value={recordMethod} />
            </label>
          </div>
        ) : null}
        {confirming === "withdraw" ? (
          <div className="amendment-confirm" role="group" aria-label="Withdraw the change">
            <p className="form-notice">
              {sent
                ? "Withdraw this change? The couple can no longer sign it, and they're emailed that it was withdrawn and their booking stands as it was."
                : "Withdraw this change? It was never sent, so the couple hears nothing. The booking stays as it is."}
            </p>
            <label className="is-wide">
              Why (optional — for the job&apos;s history; the couple doesn&apos;t see it)
              <input maxLength={500} onChange={(event) => setWithdrawReason(event.target.value)} value={withdrawReason} />
            </label>
            <footer className="amendment-actions">
              <button className="button button-light" disabled={busy} onClick={() => setConfirming(null)} type="button">
                Keep it
              </button>
              <button
                className="button button-dark"
                disabled={busy}
                onClick={() =>
                  void act(
                    "cancelAmendment",
                    { amendmentId: pending.id, reason: withdrawReason.trim() || null },
                    sent
                      ? "The change is withdrawn, and the couple is being emailed that their booking stands as it was."
                      : "The change is withdrawn. Nothing about the booking changed.",
                  )
                }
                type="button"
              >
                {busy ? "Withdrawing…" : "Withdraw the change"}
              </button>
            </footer>
          </div>
        ) : null}
        {confirming === "record" ? (
          <div className="amendment-confirm" role="group" aria-label="Record their signature">
            <p className="form-notice">
              {`Record ${recordName.trim() || "their"} signature? The booking takes the change now, and it can't be undone — a further change is a new one.`}
            </p>
            <ul className="amendment-changes">
              {num(pending.dateShiftDays) !== 0 ? (
                <li>
                  The wedding date moves. Crew who said yes are asked to confirm the new day, and calendar events, due dates and the
                  calls you ticked move with it.
                </li>
              ) : null}
              <li>Unpaid invoices written for the old total or date are replaced with new ones.</li>
              {num(moneyInfo.refundCents) > 0 ? (
                <li>{`A task is added to refund the couple ${money(moneyInfo.refundCents, currency)}.`}</li>
              ) : null}
              <li>The couple is emailed that the change is confirmed.</li>
            </ul>
            <footer className="amendment-actions">
              <button className="button button-light" disabled={busy} onClick={() => setConfirming(null)} type="button">
                Not yet
              </button>
              <button
                className="button button-dark"
                disabled={busy}
                onClick={() =>
                  void act(
                    "recordAmendmentSigned",
                    { amendmentId: pending.id, signerName: recordName.trim(), signedAt: recordDate, method: recordMethod.trim(), attestation: true },
                    "Recorded. The booking now has the change.",
                  )
                }
                type="button"
              >
                {busy ? "Saving…" : "Record it and apply the change"}
              </button>
            </footer>
          </div>
        ) : null}
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="amendment-actions" hidden={confirming !== null}>
          {!sent ? (
            <button className="button button-light" disabled={busy} onClick={() => setEditing(true)} type="button">
              Change it
            </button>
          ) : null}
          <button className="button button-light" disabled={busy} onClick={() => setConfirming("withdraw")} type="button">
            Withdraw the change
          </button>
          {/* The 3- and 7-day reminders are the contract's; a change had no
              way to reach the couple twice. */}
          {sent && ownerOrAdmin && !recording ? (
            <button
              className="button button-light"
              disabled={busy}
              onClick={() =>
                void act("resendAmendment", { amendmentId: pending.id }, "Sent to the couple again.", true)
              }
              type="button"
            >
              {busy ? "Sending…" : "Send it again"}
            </button>
          ) : null}
          {ownerOrAdmin ? (
            recording ? (
              <button
                className="button button-dark"
                disabled={busy || recordName.trim().length < 2 || recordMethod.trim().length < 2}
                onClick={() => setConfirming("record")}
                type="button"
              >
                Record their signature
              </button>
            ) : (
              <button className="button button-light" onClick={() => setRecording(true)} type="button">
                They signed it another way
              </button>
            )
          ) : null}
          {!sent && !recordOnly && ownerOrAdmin && !recording ? (
            <button
              className="button button-dark"
              disabled={busy || !consent || signer.trim().length < 2}
              onClick={() =>
                void act(
                  "sendAmendment",
                  { amendmentId: pending.id, documentHash: pending.documentHash, studioSignerName: signer.trim(), consent: true },
                  "Signed for the studio and sent to the couple.",
                )
              }
              type="button"
            >
              {busy ? "Sending…" : "Sign & send to the couple"}
            </button>
          ) : null}
        </footer>
      </div>
    );
  }

  return (
    <div className="amendment-panel">
      <div className="record-sheet-fields">
        <label>
          <span>Wedding date</span>
          <input onChange={(event) => setDate(event.target.value)} type="date" value={newDate} />
        </label>
        <fieldset className="is-wide amendment-packages">
          <legend>Packages</legend>
          {onJob.map((snapshot) => {
            const key = `s:${snapshot.id}`;
            const currency = str(snapshot.currency) || "USD";
            const lines = extras[key] ?? linesOf(snapshot.addOns);
            const behind = ((packages as Rec[] | null) ?? []).find((item) => item.id === str(snapshot.packageId));
            return (
              <div className="amendment-package" key={snapshot.id}>
                <label className="amendment-check">
                  <input
                    checked={keptIds.includes(snapshot.id)}
                    onChange={(event) =>
                      setKeep(event.target.checked ? [...keptIds, snapshot.id] : keptIds.filter((id) => id !== snapshot.id))
                    }
                    type="checkbox"
                  />
                  {`${str(snapshot.packageName) || "Package"} · ${money(snapshot.totalCents, currency)} (as agreed)`}
                </label>
                {keptIds.includes(snapshot.id) ? (
                  <ExtrasRow
                    changed={key in extras}
                    currency={currency}
                    lines={lines}
                    onEdit={() => setExtrasOpen(extrasOpen === key ? null : key)}
                    open={extrasOpen === key}
                  >
                    <JobAddOnsEditor
                      allowLibrarySave={false}
                      busy={false}
                      currency={currency}
                      onCancel={() => setExtrasOpen(null)}
                      onSave={(next) => {
                        setExtras({ ...extras, [key]: next });
                        setExtrasOpen(null);
                      }}
                      saveLabel="Use these extras"
                      snapshot={{ ...snapshot, addOns: lines }}
                      suggested={suggestionsOf(behind)}
                    />
                  </ExtrasRow>
                ) : null}
              </div>
            );
          })}
          {addable.map((item) => {
            const key = `p:${item.id}`;
            const currency = str(item.currency) || "USD";
            const lines = extras[key] ?? [];
            return (
              <div className="amendment-package" key={item.id}>
                <label className="amendment-check">
                  <input
                    checked={add.includes(item.id)}
                    onChange={(event) => setAdd(event.target.checked ? [...add, item.id] : add.filter((id) => id !== item.id))}
                    type="checkbox"
                  />
                  <PackagePlus aria-hidden size={13} /> {`Add ${str(item.name)} · ${money(item.basePriceCents, currency)}`}
                </label>
                {add.includes(item.id) ? (
                  <ExtrasRow
                    changed={lines.length > 0}
                    currency={currency}
                    lines={lines}
                    onEdit={() => setExtrasOpen(extrasOpen === key ? null : key)}
                    open={extrasOpen === key}
                  >
                    <JobAddOnsEditor
                      allowLibrarySave={false}
                      busy={false}
                      currency={currency}
                      onCancel={() => setExtrasOpen(null)}
                      onSave={(next) => {
                        setExtras({ ...extras, [key]: next });
                        setExtrasOpen(null);
                      }}
                      saveLabel="Use these extras"
                      snapshot={{ id: item.id, packageName: str(item.name), addOns: lines }}
                      suggested={suggestionsOf(item)}
                    />
                  </ExtrasRow>
                ) : null}
              </div>
            );
          })}
          {oneOff && !writingOneOff ? (
            <div className="amendment-package">
              <label className="amendment-check">
                <input checked onChange={() => setOneOff(null)} type="checkbox" />
                <PackagePlus aria-hidden size={13} />{" "}
                {`Add ${oneOff.name} (one-off) · ${money(oneOff.basePriceCents, str(onJob[0]?.currency) || "USD")}`}
              </label>
              <p className="amendment-hint">
                <button className="button button-quiet button-sm" onClick={() => setWritingOneOff(true)} type="button">
                  Edit it
                </button>
              </p>
            </div>
          ) : null}
          {writingOneOff ? (
            <OneOffPackageForm
              busy={false}
              currency={str(onJob[0]?.currency) || "USD"}
              defaultHours={num(onJob[0]?.includedCoverageMinutes) ? num(onJob[0]?.includedCoverageMinutes) / 60 : null}
              forBookingChange
              hasPackage={false}
              initial={
                oneOff
                  ? oneOffFormValuesFrom({
                      name: oneOff.name,
                      basePriceCents: oneOff.basePriceCents,
                      includedDeliverables: oneOff.included,
                      includedCoverage: oneOff.includedCoverage,
                      includedCoverageMinutes: oneOff.includedCoverageMinutes,
                    })
                  : undefined
              }
              initialMode="add"
              onCancel={() => setWritingOneOff(false)}
              onSubmit={(input) => {
                setOneOff(input);
                setWritingOneOff(false);
              }}
            />
          ) : !oneOff && ownerOrAdmin ? (
            // Writing a price is an owner's or admin's call (the server says so too).
            <button className="button button-light button-sm amendment-one-off" onClick={() => setWritingOneOff(true)} type="button">
              <PackagePlus aria-hidden size={13} /> Write a one-off package
            </button>
          ) : null}
        </fieldset>
        {shiftDays && upcomingCalls.length ? (
          <fieldset className="is-wide amendment-packages">
            <legend>Calls with the couple</legend>
            {upcomingCalls.map((call) => {
              const timezone = str(call.timezone) || "UTC";
              const to = String(shiftInZone(str(call.startsAt), shiftDays, timezone));
              return (
                <label className="amendment-check" key={call.id}>
                  <input
                    checked={movingCalls.includes(call.id)}
                    onChange={(event) =>
                      setMoveCalls(
                        event.target.checked ? [...movingCalls, call.id] : movingCalls.filter((id) => id !== call.id),
                      )
                    }
                    type="checkbox"
                  />
                  {`Move the ${callLabel(call.mode)} ${callWhen(str(call.startsAt), timezone)} → ${callWhen(to, timezone)}`}
                </label>
              );
            })}
            <p className="amendment-hint">Ticked calls move when the couple signs; their invitation updates.</p>
          </fieldset>
        ) : null}
        <label className="is-wide">
          A note for the couple (optional)
          <textarea onChange={(event) => setNote(event.target.value)} rows={2} value={note} />
        </label>
      </div>
      {clash ? (
        <div className="form-notice" role="status">
          {`${clash} is already booked that day.`}
          <label className="amendment-check">
            <input checked={allowClash} onChange={(event) => setAllowClash(event.target.checked)} type="checkbox" />
            We can cover both
          </label>
        </div>
      ) : null}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <footer className="amendment-actions">
        <button
          className="button button-dark"
          disabled={busy || (!keptIds.length && !add.length && !oneOff) || (Boolean(clash) && !allowClash) || writingOneOff || extrasOpen !== null}
          onClick={() => void draft()}
          type="button"
        >
          {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
          {busy ? "Writing it up…" : "Write up the change"}
        </button>
      </footer>
      <p className="amendment-hint">
        Nothing changes yet. You&apos;ll see the new total and the amended agreement, then sign and send it. The couple&apos;s
        current agreement stands until they sign.
      </p>
    </div>
  );
}

/**
 * A package's extras in the change sheet: what it will carry, and the editor
 * (JobAddOnsEditor, as on the proposal) when the studio opens it.
 */
function ExtrasRow({
  lines,
  currency,
  changed,
  open,
  onEdit,
  children,
}: {
  lines: JobAddOnLine[];
  currency: string;
  /** The studio set these in this change, rather than the ones agreed. */
  changed: boolean;
  open: boolean;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="amendment-extras">
      <p className="amendment-hint">
        {`Extras: ${extrasSummary(lines, currency)}${changed ? " (in this change)" : ""} `}
        {open ? null : (
          <button className="button button-quiet button-sm" onClick={onEdit} type="button">
            {lines.length ? "Change extras" : "Add extras"}
          </button>
        )}
      </p>
      {open ? children : null}
    </div>
  );
}

/**
 * The job-page button beside Edit job.
 *
 * Optionally opened from outside: Edit job points a signed booking's date
 * here, and its link has to open this sheet rather than describe it.
 */
export function BookingAmendment({
  projectId,
  state,
  open: openFromOutside,
  onOpenChange,
}: {
  projectId: string;
  state: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openFromOutside ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const [notice, setNotice] = useState<string | null>(null);
  if (!AMENDABLE_STATES.includes(state)) return null;
  return (
    <>
      <button className="project-title-action" onClick={() => setOpen(true)} type="button">
        <CalendarClock aria-hidden size={14} /> Change the booking
      </button>
      {notice ? (
        <span className="form-notice" role="status">
          {notice}
        </span>
      ) : null}
      <SheetDialog label="Change the booking" onClose={() => setOpen(false)} open={open}>
        <div className="record-sheet">
          <header>
            <p className="eyebrow">The booking</p>
            <h3>
              Change the booking <InfoHint term="booking-change" />
            </h3>
            <p>
              A new date, a package added or removed, extras, or a one-off package for this couple. The couple signs the
              change; the job keeps its stage.
            </p>
          </header>
          <BookingAmendmentPanel
            onDone={(message) => {
              setNotice(message);
              setOpen(false);
            }}
            projectId={projectId}
          />
        </div>
      </SheetDialog>
    </>
  );
}
