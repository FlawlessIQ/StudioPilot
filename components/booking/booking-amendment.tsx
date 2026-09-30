"use client";

import { useMemo, useState } from "react";
import { AMENDABLE_STATES } from "@/features/booking/amendable";
import { CalendarClock, LoaderCircle, PackagePlus } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { ContractDocumentView } from "@/components/contracts/contract-document-view";
import { contractDocumentSchema } from "@/features/contracts/document";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendBookingCommand } from "@/lib/booking/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

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
  // Back to the choices from a draft; writing it up again replaces the draft.
  const [editing, setEditing] = useState(false);

  if (!project) return <p className="cue-action-note">Loading the job…</p>;
  if (!AMENDABLE_STATES.includes(str(project.state)))
    return (
      <p className="form-notice" role="status">
        This is for a booking the couple has already signed. Before that, change the packages on the proposal and the date with Edit job.
      </p>
    );

  const keptIds = keep ?? onJobIds;
  const addable = ((packages as Rec[] | null) ?? []).filter(
    (item) => item.active === true && !onJob.some((snapshot) => str(snapshot.packageId) === item.id && keptIds.includes(snapshot.id)),
  );
  const newDate = date ?? str(project.eventDate);

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
        note: note.trim() || null,
      });
      refreshTenantRecords("bookingAmendments", "projects", "proposals", "packageSnapshots");
      setEditing(false);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "";
      if (message.startsWith("DATE_TAKEN")) setClash(message.split(":").slice(1).join(":") || "another job");
      else setError(friendlyError(caught, "The change couldn't be written up."));
    } finally {
      setBusy(false);
    }
  }

  async function act(type: string, input: Record<string, unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await run(type, input);
      refreshTenantRecords("bookingAmendments", "projects", "proposals", "contracts", "invoiceReferences", "tasks");
      onDone?.(done);
    } catch (caught) {
      setError(friendlyError(caught, "That couldn't be done."));
    } finally {
      setBusy(false);
    }
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
        <p className="amendment-money">
          {`New total ${money(moneyInfo.newTotalCents, currency)} · paid ${money(moneyInfo.paidCents, currency)} · `}
          {num(moneyInfo.refundCents) > 0
            ? `refund due ${money(moneyInfo.refundCents, currency)}`
            : `still to pay ${money(moneyInfo.outstandingCents, currency)}`}
        </p>
        {sent ? (
          <p className="form-notice" role="status">
            Sent to the couple to sign. Their current agreement stands until they do; when they sign, the job takes the change.
          </p>
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
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer className="amendment-actions">
          {!sent ? (
            <button className="button button-light" disabled={busy} onClick={() => setEditing(true)} type="button">
              Change it
            </button>
          ) : null}
          <button
            className="button button-light"
            disabled={busy}
            onClick={() => void act("cancelAmendment", { amendmentId: pending.id, reason: null }, "The change is withdrawn. Nothing about the booking changed.")}
            type="button"
          >
            Withdraw the change
          </button>
          {ownerOrAdmin ? (
            recording ? (
              <button
                className="button button-dark"
                disabled={busy || recordName.trim().length < 2 || recordMethod.trim().length < 2}
                onClick={() =>
                  void act(
                    "recordAmendmentSigned",
                    { amendmentId: pending.id, signerName: recordName.trim(), signedAt: recordDate, method: recordMethod.trim(), attestation: true },
                    "Recorded. The booking now has the change.",
                  )
                }
                type="button"
              >
                {busy ? "Saving…" : "Record their signature"}
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
          {onJob.map((snapshot) => (
            <label className="amendment-check" key={snapshot.id}>
              <input
                checked={keptIds.includes(snapshot.id)}
                onChange={(event) =>
                  setKeep(event.target.checked ? [...keptIds, snapshot.id] : keptIds.filter((id) => id !== snapshot.id))
                }
                type="checkbox"
              />
              {`${str(snapshot.packageName) || "Package"} · ${money(snapshot.totalCents, str(snapshot.currency) || "USD")} (as agreed)`}
            </label>
          ))}
          {addable.map((item) => (
            <label className="amendment-check" key={item.id}>
              <input
                checked={add.includes(item.id)}
                onChange={(event) => setAdd(event.target.checked ? [...add, item.id] : add.filter((id) => id !== item.id))}
                type="checkbox"
              />
              <PackagePlus aria-hidden size={13} /> {`Add ${str(item.name)} · ${money(item.basePriceCents, str(item.currency) || "USD")}`}
            </label>
          ))}
        </fieldset>
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
          disabled={busy || (!keptIds.length && !add.length) || (Boolean(clash) && !allowClash)}
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

/** The job-page button beside Edit job. */
export function BookingAmendment({ projectId, state }: { projectId: string; state: string }) {
  const [open, setOpen] = useState(false);
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
            <h3>Change the booking</h3>
            <p>A new date, a package added or removed. The couple signs the change; the job keeps its stage.</p>
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
