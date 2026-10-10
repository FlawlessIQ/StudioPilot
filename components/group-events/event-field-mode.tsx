"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, LoaderCircle, QrCode, Search, X } from "lucide-react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { KitRoot } from "@/components/kit/kit";
import { QrImage, eventSignupUrl } from "@/components/group-events/event-signup-panel";
import { chosenMethodLabel, recordedMethodFor } from "@/components/group-events/participant-roster";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  PAYMENT_METHOD_LABEL,
  rosterOrder,
  rosterSummary,
  type Participant,
  type ParticipantPaymentMethod,
} from "@/features/group-events/participants";
import { normaliseEventSignup, signupState } from "@/features/group-events/signup";
import { friendlyError } from "@/lib/ai/friendly-error";
import { getFirebaseClient } from "@/lib/firebase/client";
import { formatCentsExact } from "@/lib/format/money";
import { recordParticipantPayment } from "@/lib/group-events/commands";
import { dataIsLive } from "@/lib/runtime-mode";

/**
 * Field mode: the phone or tablet at the event (docs/group-event-signup-plan-2026-10-10.md, Phase 3).
 *
 * The QR for walk-ups, full screen; the roster, live, so a parent who just
 * scanned is on it a moment later; and payments in two taps — the way they
 * paid, then confirm — because a payment recorded can't be taken back here.
 * Totals for the day by method, and what's still to take.
 *
 * The studio opens it from the job; the crew assigned to the event open it
 * from their job (crmCommand lets them record a payment and nothing else).
 */

type Filter = "to_pay" | "paid" | "all";

/** "$45 in cash", "$45 by Venmo": the way it was paid, as a sentence says it. */
const PAID_HOW: Record<ParticipantPaymentMethod, string> = {
  cash: "in cash",
  check: "by check",
  venmo: "by Venmo",
  zelle: "by Zelle",
  card: "by card",
  online: "online",
  other: "",
};

/** The ways a payment can be recorded at the field, the parent's own choice first. */
function quickMethods(chosen: string | null | undefined, offered: readonly string[]): ParticipantPaymentMethod[] {
  const fromEvent = offered.map((method) => recordedMethodFor(method));
  const order: ParticipantPaymentMethod[] = [recordedMethodFor(chosen), ...fromEvent, "cash", "check"];
  return [...new Set(order)].slice(0, 4);
}

const sameDay = (iso: string | undefined, now: Date) => {
  if (!iso) return false;
  const date = new Date(iso);
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
};

export function EventFieldMode({ projectId, backHref }: { projectId: string; backHref: string }) {
  const workspace = useWorkspace();
  const tenantId = workspace.tenantId;
  const [project, setProject] = useState<{ name?: unknown; groupEvent?: unknown } | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loaded, setLoaded] = useState(!dataIsLive);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("to_pay");
  const [search, setSearch] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [pending, setPending] = useState<{ id: string; method: ParticipantPaymentMethod } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!dataIsLive || !tenantId) return;
    const { firestore } = getFirebaseClient();
    const stopProject = onSnapshot(
      doc(firestore, "projects", projectId),
      (snapshot) => setProject(snapshot.exists() ? (snapshot.data() as typeof project) : null),
      () => setLoadError("This event couldn't be loaded. You may not be on it any more."),
    );
    const stopRoster = onSnapshot(
      // The rules check the reader's assignment from the job named here.
      query(collection(firestore, "eventParticipants"), where("tenantId", "==", tenantId), where("projectId", "==", projectId)),
      (snapshot) => {
        setParticipants(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Participant));
        setLoaded(true);
      },
      () => {
        setLoaded(true);
        setLoadError("The roster couldn't be loaded. Check your connection and refresh.");
      },
    );
    return () => {
      stopProject();
      stopRoster();
    };
  }, [projectId, tenantId]);

  const config = useMemo(() => normaliseEventSignup(project?.groupEvent), [project?.groupEvent]);
  const name = typeof project?.name === "string" && project.name.trim() ? project.name.trim() : "The event";
  const summary = useMemo(() => rosterSummary(participants), [participants]);
  const today = useMemo(() => {
    const now = new Date();
    const byMethod = new Map<ParticipantPaymentMethod, number>();
    let total = 0;
    for (const participant of participants) {
      if (participant.status !== "paid" || !participant.payment || !sameDay(participant.payment.paidAt, now)) continue;
      total += participant.payment.amountCents;
      byMethod.set(participant.payment.method, (byMethod.get(participant.payment.method) ?? 0) + participant.payment.amountCents);
    }
    return { total, byMethod: [...byMethod.entries()].sort((left, right) => right[1] - left[1]) };
  }, [participants]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rosterOrder(participants).filter((participant) => {
      if (filter === "to_pay" && participant.status !== "unpaid" && participant.status !== "pay_on_day") return false;
      if (filter === "paid" && participant.status !== "paid") return false;
      if (filter === "all" && participant.status === "cancelled" && !term) return false;
      if (!term) return true;
      return [participant.athleteName, participant.parentName, participant.team, participant.confirmationCode]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [filter, participants, search]);

  const url = config.token ? eventSignupUrl(config.token) : null;
  const open = signupState(config, new Date().toISOString(), summary.total) === "open";

  async function confirm(participant: Participant, method: ParticipantPaymentMethod) {
    setBusy(true);
    setError(null);
    try {
      await recordParticipantPayment(projectId, participant.id, {
        amountCents: participant.amountCents,
        method,
        sendReceipt: Boolean(participant.email),
      });
      setPending(null);
      setDone(
        `${participant.athleteName}: ${[formatCentsExact(participant.amountCents), PAID_HOW[method]].filter(Boolean).join(" ")}${participant.email ? ", receipt emailed" : ""}.`,
      );
    } catch (caught) {
      setError(friendlyError(caught, "That payment didn't save. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <KitRoot className="event-field">
      <header className="event-field-head">
        <Link aria-label="Back to the job" className="kit-icon-button" href={backHref}>
          <ArrowLeft aria-hidden size={22} />
        </Link>
        <span className="event-field-title">
          <small>Field mode</small>
          <strong>{name}</strong>
        </span>
        {url ? (
          <button className="kit-button" data-size="compact" onClick={() => setShowQr(true)} type="button">
            <QrCode aria-hidden size={18} /> QR
          </button>
        ) : (
          <span />
        )}
      </header>

      <section aria-label="Today" className="event-field-totals">
        <div>
          <small>Taken today</small>
          <strong>{formatCentsExact(today.total)}</strong>
          <span>
            {today.byMethod.length
              ? today.byMethod.map(([method, cents]) => `${PAYMENT_METHOD_LABEL[method]} ${formatCentsExact(cents)}`).join(" · ")
              : "Nothing yet"}
          </span>
        </div>
        <div>
          <small>Still to take</small>
          <strong>{formatCentsExact(summary.outstandingCents)}</strong>
          <span>
            {summary.unpaid + summary.payOnDay} of {summary.total} {summary.total === 1 ? "athlete" : "athletes"}
          </span>
        </div>
      </section>

      <div className="event-field-tools">
        <label className="kit-input-wrap event-field-search" data-icon="">
          <span className="kit-input-icon">
            <Search aria-hidden size={18} />
          </span>
          <input
            aria-label="Search by athlete, parent or confirmation number"
            className="kit-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Athlete, parent or code"
            value={search}
          />
        </label>
        <div className="kit-chip-list" role="group" aria-label="Show">
          {(
            [
              ["to_pay", `To pay (${summary.unpaid + summary.payOnDay})`],
              ["paid", `Paid (${summary.paid})`],
              ["all", "Everyone"],
            ] as const
          ).map(([value, label]) => (
            <button aria-pressed={filter === value} className="kit-chip" key={value} onClick={() => setFilter(value)} type="button">
              {label}
            </button>
          ))}
        </div>
      </div>

      {done ? (
        <p className="kit-note" data-tone="accent" role="status">
          <CheckCircle2 aria-hidden size={18} />
          <span>{done}</span>
        </p>
      ) : null}
      {error || loadError ? (
        <p className="kit-note" data-tone="danger" role="alert">
          <span>{error ?? loadError}</span>
        </p>
      ) : null}

      {!loaded ? (
        <p className="event-signup-loading" role="status">
          <LoaderCircle aria-hidden className="spin" size={18} /> Loading the roster…
        </p>
      ) : visible.length ? (
        <ul className="event-field-list">
          {visible.map((participant) => {
            const owing = participant.status === "unpaid" || participant.status === "pay_on_day";
            const confirming = pending?.id === participant.id ? pending.method : null;
            return (
              <li data-status={participant.status} key={participant.id}>
                <div className="event-field-row">
                  <span className="event-field-who">
                    <strong>{participant.athleteName}</strong>
                    <small>
                      {[participant.parentName, participant.team, participant.packageName].filter(Boolean).join(" · ")}
                    </small>
                    {participant.confirmationCode || participant.chosenMethod ? (
                      <small>
                        {[participant.confirmationCode, owing && participant.chosenMethod ? chosenMethodLabel(participant.chosenMethod) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    ) : null}
                  </span>
                  <span className="event-field-amount">
                    <strong>{formatCentsExact(participant.payment?.amountCents ?? participant.amountCents)}</strong>
                    <small>
                      {participant.status === "paid" && participant.payment
                        ? `Paid · ${PAYMENT_METHOD_LABEL[participant.payment.method]}`
                        : participant.status === "cancelled"
                          ? "Canceled"
                          : "To pay"}
                    </small>
                  </span>
                </div>
                {owing && participant.amountCents > 0 ? (
                  confirming ? (
                    <div className="event-field-confirm">
                      <span>
                        {`Record ${[formatCentsExact(participant.amountCents), PAID_HOW[confirming]].filter(Boolean).join(" ")}?`}
                      </span>
                      <button className="kit-button" data-size="compact" data-variant="secondary" onClick={() => setPending(null)} type="button">
                        Back
                      </button>
                      <button
                        className="kit-button"
                        data-size="compact"
                        disabled={busy}
                        onClick={() => void confirm(participant, confirming)}
                        type="button"
                      >
                        {busy ? <LoaderCircle aria-hidden className="spin" size={16} /> : null}
                        Paid
                      </button>
                    </div>
                  ) : (
                    <div className="event-field-pay" role="group" aria-label={`Paid by — ${participant.athleteName}`}>
                      {quickMethods(participant.chosenMethod, config.methods).map((method) => (
                        <button
                          className="kit-chip"
                          key={method}
                          onClick={() => {
                            setDone(null);
                            setPending({ id: participant.id, method });
                          }}
                          type="button"
                        >
                          {PAYMENT_METHOD_LABEL[method]}
                        </button>
                      ))}
                    </div>
                  )
                ) : owing ? (
                  <small className="event-field-hint">No amount set. Add one on the job&rsquo;s roster.</small>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="kit-note">
          <span>
            {search
              ? "Nobody matches that search."
              : filter === "to_pay"
                ? "Everyone has paid."
                : filter === "paid"
                  ? "Nobody has paid yet."
                  : "Nobody has signed up yet. Show the QR code to parents."}
          </span>
        </p>
      )}

      {showQr && url ? (
        <div aria-label="Scan to sign up" aria-modal="true" className="event-field-qr" role="dialog">
          <button aria-label="Close" className="kit-icon-button event-field-qr-close" onClick={() => setShowQr(false)} type="button">
            <X aria-hidden size={26} />
          </button>
          <p className="event-field-qr-studio">{workspace.tenantName}</p>
          <h2>Scan to sign up</h2>
          <p>{name}</p>
          <QrImage label={`QR code for ${url}`} url={url} />
          {open ? <p>Point your phone camera at the code.</p> : <p className="event-field-qr-closed">Sign-up is closed right now.</p>}
        </div>
      ) : null}
    </KitRoot>
  );
}
