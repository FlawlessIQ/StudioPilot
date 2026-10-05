"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { LoaderCircle, UserPlus } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import {
  PARTICIPANT_LIMITS,
  PARTICIPANT_PAYMENT_METHODS,
  PARTICIPANT_STATUS_LABEL,
  PAYMENT_METHOD_LABEL,
  rosterEnabled,
  rosterOffered,
  rosterOrder,
  rosterSummary,
  type Participant,
  type ParticipantPaymentMethod,
} from "@/features/group-events/participants";
import { friendlyError } from "@/lib/ai/friendly-error";
import { getFirebaseClient } from "@/lib/firebase/client";
import { formatCentsExact } from "@/lib/format/money";
import {
  addParticipant,
  cancelParticipant,
  recordParticipantPayment,
  setGroupEvent,
  updateParticipant,
  type ParticipantInput,
} from "@/lib/group-events/commands";
import { dataIsLive } from "@/lib/runtime-mode";

/**
 * The roster for an event where each parent pays (group events, Phase 1 —
 * docs/group-events-design-2026-10-04.md).
 *
 * Offered on sports jobs, where GR Productions' parent-paid cheer days are,
 * and kept on any job that has turned it on. It replaces recording a day's
 * takings by hand against the organiser: every parent is a row, with what
 * they owe, whether they've paid and how, and a receipt by email.
 *
 * Compact rows on every screen (never expanded cards on a phone): the
 * athlete, the parent, the status and the amount, with the one action that
 * matters — Take payment — on the row.
 */
export function ParticipantRoster({
  projectId,
  tenantId,
  project,
}: {
  projectId: string;
  tenantId: string | null;
  /** The job record as the job page holds it; only its kind and roster flag are read. */
  project: object | null;
}) {
  const job = project as { eventKind?: unknown; groupEvent?: unknown } | null;
  const enabled = rosterEnabled(job);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Participant | "new" | null>(null);
  const [paying, setPaying] = useState<Participant | null>(null);

  // Live, so the day's roster updates on every device as payments are taken.
  useEffect(() => {
    if (!enabled || !dataIsLive || !tenantId) return;
    const roster = query(
      collection(getFirebaseClient().firestore, "eventParticipants"),
      where("tenantId", "==", tenantId),
      // The rules check a coordinator's assignment from the job named here.
      where("projectId", "==", projectId),
    );
    return onSnapshot(
      roster,
      (snapshot) => {
        setParticipants(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Participant));
        setLoaded(true);
      },
      () => {
        setLoaded(true);
        setError("The roster couldn't be loaded. Refresh the page.");
      },
    );
  }, [enabled, projectId, tenantId]);

  const summary = useMemo(() => rosterSummary(participants), [participants]);
  const ordered = useMemo(() => rosterOrder(participants), [participants]);

  if (!rosterOffered(job)) return null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      refreshTenantRecords("projects");
      return true;
    } catch (caught) {
      setError(friendlyError(caught, "That didn't save. Try again."));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <section className="panel participant-roster">
        <header>
          <span>
            <p className="eyebrow">Each parent pays?</p>
            <h2>Keep a roster for this event</h2>
          </span>
        </header>
        <p className="form-notice">
          List every athlete and parent, take each payment on the day or before, and email each parent their own
          receipt. The organizer stays the job&rsquo;s contact.
        </p>
        <div className="participant-roster-actions">
          <button
            className="button button-dark button-sm"
            disabled={busy}
            onClick={() => void run(() => setGroupEvent(projectId, true))}
            type="button"
          >
            {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
            Start a roster
          </button>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="panel participant-roster">
      <header>
        <span>
          <p className="eyebrow">Each parent pays</p>
          <h2>Participants</h2>
        </span>
        <button className="button button-sm button-dark" onClick={() => setEditing("new")} type="button">
          <UserPlus aria-hidden size={14} /> Add a person
        </button>
      </header>
      <p className="participant-roster-summary">
        {`${summary.total} on the roster · ${summary.paid} paid · ${formatCentsExact(summary.collectedCents)} collected`}
        {summary.outstandingCents ? ` · ${formatCentsExact(summary.outstandingCents)} still to take` : ""}
      </p>
      {!loaded && dataIsLive ? (
        <p className="form-notice">Loading the roster…</p>
      ) : ordered.length ? (
        <ul className="participant-roster-list">
          {ordered.map((participant) => {
            const open = participant.status === "unpaid" || participant.status === "pay_on_day";
            const rowClass = participant.status === "cancelled" ? "is-cancelled" : undefined;
            return (
              <li className={rowClass} key={participant.id}>
                <span className="participant-roster-who">
                  <strong>{participant.athleteName}</strong>
                  <small>
                    {participant.parentName}
                    {participant.team ? ` · ${participant.team}` : ""}
                  </small>
                </span>
                <span className="participant-roster-money">
                  <strong>{formatCentsExact(participant.payment?.amountCents ?? participant.amountCents)}</strong>
                  <StatusBadge
                    tone={participant.status === "paid" ? "success" : participant.status === "cancelled" ? "neutral" : "warning"}
                  >
                    {participant.status === "paid" && participant.payment
                      ? `${PARTICIPANT_STATUS_LABEL.paid} · ${PAYMENT_METHOD_LABEL[participant.payment.method]}`
                      : PARTICIPANT_STATUS_LABEL[participant.status]}
                  </StatusBadge>
                </span>
                <span className="participant-roster-row-actions">
                  {open ? (
                    <button className="button button-sm button-dark" onClick={() => setPaying(participant)} type="button">
                      Take payment
                    </button>
                  ) : null}
                  {participant.status === "cancelled" ? (
                    <button
                      className="button button-sm button-light"
                      disabled={busy}
                      onClick={() => void run(() => cancelParticipant(projectId, participant.id, true))}
                      type="button"
                    >
                      Restore
                    </button>
                  ) : (
                    <button className="button button-sm button-light" onClick={() => setEditing(participant)} type="button">
                      Edit
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="form-notice">Nobody on the roster yet. Add each athlete and the parent who pays for them.</p>
      )}
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="participant-roster-actions">
        <button
          className="button button-sm button-light"
          disabled={busy}
          onClick={() => void run(() => setGroupEvent(projectId, false))}
          type="button"
        >
          Turn off the roster
        </button>
        <small>Turning it off hides the roster; nobody on it is deleted.</small>
      </div>

      <ParticipantSheet
        busy={busy}
        onCancelParticipant={(participant) =>
          void run(() => cancelParticipant(projectId, participant.id)).then((ok) => ok && setEditing(null))
        }
        onClose={() => setEditing(null)}
        onSave={(input, participant) =>
          void run(() =>
            participant ? updateParticipant(projectId, participant.id, input) : addParticipant(projectId, input),
          ).then((ok) => ok && setEditing(null))
        }
        participant={editing === "new" ? null : editing}
        open={editing !== null}
      />
      <PaymentSheet
        busy={busy}
        onClose={() => setPaying(null)}
        onSave={(input) =>
          paying &&
          void run(() => recordParticipantPayment(projectId, paying.id, input)).then((ok) => ok && setPaying(null))
        }
        participant={paying}
      />
    </section>
  );
}

const dollarsToCents = (value: FormDataEntryValue | null): number => {
  const number = Number(String(value ?? "").replace(/[$,\s]/g, ""));
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) : Number.NaN;
};

const optional = (value: FormDataEntryValue | null): string | null => {
  const text = String(value ?? "").trim();
  return text ? text : null;
};

function ParticipantSheet({
  open,
  participant,
  busy,
  onClose,
  onSave,
  onCancelParticipant,
}: {
  open: boolean;
  participant: Participant | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: ParticipantInput, participant: Participant | null) => void;
  onCancelParticipant: (participant: Participant) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const paid = participant?.status === "paid";
  return (
    <SheetDialog label={participant ? "Edit a participant" : "Add a participant"} onClose={onClose} open={open}>
      <form
        className="record-sheet"
        key={participant?.id ?? "new"}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const amountCents = paid ? (participant?.amountCents ?? 0) : dollarsToCents(data.get("amount"));
          if (!Number.isFinite(amountCents) || amountCents > PARTICIPANT_LIMITS.maxAmountCents) {
            setProblem("Enter the amount they owe, in dollars.");
            return;
          }
          setProblem(null);
          onSave(
            {
              parentName: String(data.get("parentName") ?? "").trim(),
              email: optional(data.get("email")),
              phone: optional(data.get("phone")),
              athleteName: String(data.get("athleteName") ?? "").trim(),
              team: optional(data.get("team")),
              packageName: optional(data.get("packageName")),
              amountCents,
              status: data.get("payOnDay") === "on" ? "pay_on_day" : "unpaid",
            },
            participant,
          );
        }}
      >
        <header>
          <p className="eyebrow">Participants</p>
          <h3>{participant ? `Edit ${participant.athleteName}` : "Add a person to the roster"}</h3>
          <p>The parent is who you deal with and who gets the receipt. Only the athlete&apos;s name is kept for them.</p>
        </header>
        <div className="record-sheet-fields">
          <label>
            Athlete&apos;s name
            <input defaultValue={participant?.athleteName ?? ""} maxLength={PARTICIPANT_LIMITS.name} name="athleteName" required />
          </label>
          <label>
            <span>
              Team <small>optional</small>
            </span>
            <input defaultValue={participant?.team ?? ""} maxLength={PARTICIPANT_LIMITS.team} name="team" />
          </label>
          <label>
            Parent&apos;s name
            <input defaultValue={participant?.parentName ?? ""} maxLength={PARTICIPANT_LIMITS.name} name="parentName" required />
          </label>
          <label>
            <span>
              Parent&apos;s email <small>for their receipt</small>
            </span>
            <input defaultValue={participant?.email ?? ""} name="email" type="email" />
          </label>
          <label>
            <span>
              Parent&apos;s phone <small>optional</small>
            </span>
            <input defaultValue={participant?.phone ?? ""} maxLength={PARTICIPANT_LIMITS.phone} name="phone" type="tel" />
          </label>
          <label>
            <span>
              Package <small>optional</small>
            </span>
            <input defaultValue={participant?.packageName ?? ""} maxLength={PARTICIPANT_LIMITS.packageName} name="packageName" />
          </label>
          <label>
            Amount owed ($)
            <input
              defaultValue={participant ? (participant.amountCents / 100).toFixed(2) : ""}
              disabled={paid}
              inputMode="decimal"
              name="amount"
              required={!paid}
            />
          </label>
          {paid ? null : (
            <label className="participant-roster-check">
              <input defaultChecked={participant?.status === "pay_on_day"} name="payOnDay" type="checkbox" />
              Pays on the day
            </label>
          )}
        </div>
        {paid ? <p className="form-notice">They&apos;ve paid, so the amount stays as recorded.</p> : null}
        {problem ? (
          <p className="form-error" role="alert">
            {problem}
          </p>
        ) : null}
        <footer>
          {participant && !paid ? (
            <button className="button button-light" disabled={busy} onClick={() => onCancelParticipant(participant)} type="button">
              Cancel their place
            </button>
          ) : null}
          <button className="button button-light" onClick={onClose} type="button">
            Close
          </button>
          <button className="button button-dark" disabled={busy} type="submit">
            {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
            {participant ? "Save" : "Add to the roster"}
          </button>
        </footer>
      </form>
    </SheetDialog>
  );
}

function PaymentSheet({
  participant,
  busy,
  onClose,
  onSave,
}: {
  participant: Participant | null;
  busy: boolean;
  onClose: () => void;
  onSave: (input: { amountCents: number; method: ParticipantPaymentMethod; sendReceipt: boolean }) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const hasEmail = Boolean(participant?.email);
  return (
    <SheetDialog label="Take a payment" onClose={onClose} open={participant !== null}>
      <form
        className="record-sheet"
        key={participant?.id ?? "none"}
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const amountCents = dollarsToCents(data.get("amount"));
          if (!Number.isFinite(amountCents) || amountCents <= 0 || amountCents > PARTICIPANT_LIMITS.maxAmountCents) {
            setProblem("Enter the amount you took, in dollars.");
            return;
          }
          setProblem(null);
          onSave({
            amountCents,
            method: String(data.get("method") ?? "cash") as ParticipantPaymentMethod,
            sendReceipt: hasEmail && data.get("sendReceipt") === "on",
          });
        }}
      >
        <header>
          <p className="eyebrow">Take payment</p>
          <h3>{participant ? `${participant.athleteName} · ${participant.parentName}` : ""}</h3>
          <p>Record money you&apos;ve taken. StudioCue doesn&apos;t charge the card — this is the record and the receipt.</p>
        </header>
        <div className="record-sheet-fields">
          <label>
            Amount taken ($)
            <input
              defaultValue={participant ? (participant.amountCents / 100).toFixed(2) : ""}
              inputMode="decimal"
              name="amount"
              required
            />
          </label>
          <label>
            How they paid
            <select defaultValue="cash" name="method">
              {PARTICIPANT_PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_METHOD_LABEL[method]}
                </option>
              ))}
            </select>
          </label>
          <label className="participant-roster-check">
            <input defaultChecked={hasEmail} disabled={!hasEmail} name="sendReceipt" type="checkbox" />
            {hasEmail ? `Email a receipt to ${participant?.email}` : "No email on file, so no receipt"}
          </label>
        </div>
        {problem ? (
          <p className="form-error" role="alert">
            {problem}
          </p>
        ) : null}
        <footer>
          <button className="button button-light" onClick={onClose} type="button">
            Close
          </button>
          <button className="button button-dark" disabled={busy} type="submit">
            {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
            Record payment
          </button>
        </footer>
      </form>
    </SheetDialog>
  );
}
