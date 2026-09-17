"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CircleAlert,
  CircleCheck,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import {
  existingBookingSchema,
  type ExistingBooking,
} from "@/features/imports/existing-booking";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  findQuickBooksHistory,
  quickBooksPaymentNotes,
} from "@/features/imports/quickbooks-prefill";
import {
  importExistingBooking,
  lookupQuickBooksPayments,
  previewExistingBookings,
  type ExistingBookingPreview,
  type ImportedBookingResult,
} from "@/lib/booking/command-client";

/**
 * Adding a booking a studio already has, one at a time.
 *
 * Two steps on purpose. "Check" asks the server what the import would find —
 * problems with the booking, clients StudioCue already knows, the same wedding
 * already here, other jobs that day — and writes nothing. "Import" is then a
 * decision made with that in front of the studio, not a form submit that
 * discovers it afterwards.
 *
 * Shared by the Jobs import page and Cue, which prefills it from a signed
 * contract it has read and hands over the PDF it already holds.
 */

export type ExistingBookingFormValues = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  partnerFirstName: string;
  partnerLastName: string;
  partnerEmail: string;
  eventType: "Wedding" | "Corporate" | "Sports";
  eventDate: string;
  venueName: string;
  city: string;
  state: "BOOKED" | "PLANNING";
  packageName: string;
  total: string;
  tax: string;
  coverageHours: string;
  photographers: string;
  signedOn: string;
  signerName: string;
  payments: Array<{ amount: string; paidOn: string; method: string }>;
  notes: string;
};

const blank: ExistingBookingFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  partnerFirstName: "",
  partnerLastName: "",
  partnerEmail: "",
  eventType: "Wedding",
  eventDate: "",
  venueName: "",
  city: "",
  state: "BOOKED",
  packageName: "",
  total: "",
  tax: "0",
  coverageHours: "8",
  photographers: "1",
  signedOn: "",
  signerName: "",
  payments: [{ amount: "", paidOn: "", method: "Retainer" }],
  notes: "",
};

const cents = (value: string) => {
  const parsed = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : Number.NaN;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value / 100,
  );

/** The form's plain text, as the booking the server will check. */
export function bookingFromForm(
  values: ExistingBookingFormValues,
  hasSignedCopy: boolean,
): { booking: ExistingBooking } | { problem: string } {
  const clients = [
    {
      firstName: values.firstName,
      lastName: values.lastName,
      email: values.email.trim() || null,
      phone: values.phone.trim() || null,
    },
  ];
  if (values.partnerFirstName.trim() || values.partnerLastName.trim())
    clients.push({
      firstName: values.partnerFirstName,
      lastName: values.partnerLastName || values.lastName,
      email: values.partnerEmail.trim() || null,
      phone: null,
    });
  const parsed = existingBookingSchema.safeParse({
    clients,
    projectName: null,
    eventTypeId: values.eventType.toLowerCase(),
    eventType: values.eventType,
    eventDate: values.eventDate,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    venueName: values.venueName.trim() || null,
    city: values.city.trim() || null,
    state: values.state,
    packageName: values.packageName.trim() || "Wedding photography",
    coverageMinutes: Math.round(Number(values.coverageHours) * 60),
    photographers: Math.round(Number(values.photographers)),
    currency: "USD",
    totalCents: cents(values.total),
    taxCents: cents(values.tax || "0"),
    signedOn: values.signedOn,
    signerName:
      values.signerName.trim() || `${values.firstName} ${values.lastName}`.trim(),
    hasSignedCopy,
    payments: values.payments
      .filter((payment) => payment.amount.trim() || payment.paidOn)
      .map((payment) => ({
        amountCents: cents(payment.amount),
        paidOn: payment.paidOn,
        method: payment.method.trim() || "Payment",
      })),
    notes: values.notes.trim() || null,
  });
  if (parsed.success) return { booking: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".") ?? "";
  const labels: Array<[RegExp, string]> = [
    [/^clients\.0\.firstName/, "Add the client's first name."],
    [/^clients\.0\.lastName/, "Add the client's last name."],
    [/^clients\.0\.email/, "That email address doesn't look right."],
    [/^clients\.1\./, "Check the partner's name and email."],
    [/^eventDate/, "Add the event date."],
    [/^signedOn/, "Add the date the contract was signed."],
    [/^totalCents/, "Add the contract total as an amount, like 6499."],
    [/^taxCents/, "Tax should be an amount, or 0."],
    [/^coverageMinutes/, "Coverage should be a number of hours."],
    [/^photographers/, "Photographers should be a whole number."],
    [/^payments\.\d+\.amountCents/, "Each payment needs an amount above zero."],
    [/^payments\.\d+\.paidOn/, "Each payment needs the date it was received."],
  ];
  return {
    problem:
      labels.find(([pattern]) => pattern.test(field))?.[1] ??
      "Check the highlighted details and try again.",
  };
}

export function ExistingBookingForm({
  initial,
  signedCopy,
  source,
  compact = false,
}: {
  initial?: Partial<ExistingBookingFormValues>;
  /** Supplied by Cue, which already holds the file. */
  signedCopy?: File | null;
  source: "form" | "cue";
  compact?: boolean;
}) {
  const [values, setValues] = useState<ExistingBookingFormValues>({
    ...blank,
    ...initial,
    payments: initial?.payments?.length ? initial.payments : blank.payments,
  });
  const [partner, setPartner] = useState(
    Boolean(initial?.partnerFirstName || initial?.partnerLastName),
  );
  const [file, setFile] = useState<File | null>(signedCopy ?? null);
  const [phase, setPhase] = useState<"editing" | "checking" | "reviewing" | "importing" | "done">("editing");
  const [problem, setProblem] = useState("");
  const [review, setReview] = useState<{ booking: ExistingBooking; preview: ExistingBookingPreview } | null>(null);
  const [done, setDone] = useState<{ result: ImportedBookingResult; signedCopyAttached: boolean } | null>(null);
  const [quickBooks, setQuickBooks] = useState<{ busy: boolean; notes: string[] }>({
    busy: false,
    notes: [],
  });
  // One key per checked booking: a retry of the same import is the same import.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  const set = <K extends keyof ExistingBookingFormValues>(key: K, value: ExistingBookingFormValues[K]) => {
    setValues((prior) => ({ ...prior, [key]: value }));
    if (phase === "reviewing") setPhase("editing");
  };
  const setPayment = (index: number, key: "amount" | "paidOn" | "method", value: string) => {
    setValues((prior) => ({
      ...prior,
      payments: prior.payments.map((payment, at) =>
        at === index ? { ...payment, [key]: value } : payment,
      ),
    }));
    if (phase === "reviewing") setPhase("editing");
  };

  /**
   * Replace the payment rows with what QuickBooks recorded for this couple.
   * Their rows, not a merge: typed amounts and QuickBooks amounts for the same
   * payment would otherwise both count.
   */
  async function fillFromQuickBooks() {
    const emails = [values.email, partner ? values.partnerEmail : ""]
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    if (!emails.length) {
      setQuickBooks({ busy: false, notes: ["Add the client's email first — that's how QuickBooks finds them."] });
      return;
    }
    setQuickBooks({ busy: true, notes: [] });
    try {
      const lookup = await lookupQuickBooksPayments(emails);
      if (!lookup) {
        setQuickBooks({ busy: false, notes: ["Development preview: QuickBooks isn't available here."] });
        return;
      }
      const history = findQuickBooksHistory(emails, lookup.clients);
      if (history?.customer && history.payments.length) {
        setValues((prior) => ({
          ...prior,
          payments: history.payments.map((payment) => ({
            amount: (payment.amountCents / 100).toFixed(2),
            paidOn: payment.paidOn,
            method: "QuickBooks payment",
          })),
        }));
        if (phase === "reviewing") setPhase("editing");
      }
      setQuickBooks({ busy: false, notes: quickBooksPaymentNotes(history) });
    } catch (caught: unknown) {
      setQuickBooks({
        busy: false,
        notes: [friendlyError(caught, "QuickBooks couldn't be reached. Enter the payments yourself.")],
      });
    }
  }

  async function check() {
    setProblem("");
    const built = bookingFromForm(
      partner ? values : { ...values, partnerFirstName: "", partnerLastName: "", partnerEmail: "" },
      Boolean(file),
    );
    if ("problem" in built) {
      setProblem(built.problem);
      return;
    }
    setPhase("checking");
    try {
      const preview = await previewExistingBookings([built.booking]);
      if (!preview) {
        setProblem("Development preview: bookings can't be imported here.");
        setPhase("editing");
        return;
      }
      setReview({ booking: built.booking, preview: preview.bookings[0]! });
      setIdempotencyKey(crypto.randomUUID());
      setPhase("reviewing");
    } catch (caught: unknown) {
      setProblem(friendlyError(caught, "That booking couldn't be checked."));
      setPhase("editing");
    }
  }

  async function confirm() {
    if (!review) return;
    setPhase("importing");
    setProblem("");
    try {
      const imported = await importExistingBooking({
        booking: review.booking,
        source,
        batchId: null,
        signedCopy: file,
        idempotencyKey,
      });
      if (imported.mode === "preview") {
        setProblem("Development preview: nothing was imported.");
        setPhase("reviewing");
        return;
      }
      refreshTenantRecords("projects");
      setDone({ result: imported.result, signedCopyAttached: imported.signedCopyAttached });
      setPhase("done");
    } catch (caught: unknown) {
      setProblem(friendlyError(caught, "That booking couldn't be imported."));
      setPhase("reviewing");
    }
  }

  if (phase === "done" && done) {
    const { result } = done;
    return (
      <section className="booking-import-done" aria-live="polite">
        <p className="booking-import-done-title">
          <CircleCheck size={18} aria-hidden="true" /> {result.name} is in StudioCue.
        </p>
        <ul>
          <li>
            It&rsquo;s quiet: nothing has been sent to the couple, and nothing will be
            until you bring them in from the job.
          </li>
          <li>
            {result.contactsMatched
              ? `Matched ${result.contactsMatched} client${result.contactsMatched === 1 ? "" : "s"} you already had`
              : "Added the couple as clients"}
            {result.contactsCreated && result.contactsMatched
              ? `, and added ${result.contactsCreated} new`
              : ""}
            .
          </li>
          <li>
            {result.paidCents
              ? `${money(result.paidCents)} recorded as paid before StudioCue.`
              : "No payments recorded yet."}
          </li>
          {result.workflow.started ? (
            <li>
              Workflow started, with anything that was due before today marked as done
              before StudioCue.
            </li>
          ) : null}
          {file ? (
            <li>
              {done.signedCopyAttached
                ? "Signed contract attached."
                : "The booking is in, but the signed copy didn't upload. Attach it from the job."}
            </li>
          ) : null}
        </ul>
        <Link className="button button-dark button-sm" href={`/studio/projects/${result.projectId}`}>
          Open {result.name}
        </Link>
      </section>
    );
  }

  const blockingIssues = review?.preview.issues.filter((issue) => issue.severity === "error") ?? [];
  const warnings = review?.preview.issues.filter((issue) => issue.severity === "warning") ?? [];
  const canImport =
    phase === "reviewing" &&
    review !== null &&
    blockingIssues.length === 0 &&
    review.preview.alreadyImported === null;
  const busy = phase === "checking" || phase === "importing";

  return (
    <form
      className={compact ? "booking-import is-compact" : "booking-import"}
      onSubmit={(event) => {
        event.preventDefault();
        void (canImport ? confirm() : check());
      }}
    >
      <fieldset>
        <legend>The couple</legend>
        <label>
          First name
          <input onChange={(e) => set("firstName", e.target.value)} required value={values.firstName} />
        </label>
        <label>
          Last name
          <input onChange={(e) => set("lastName", e.target.value)} required value={values.lastName} />
        </label>
        <label>
          Email
          <input onChange={(e) => set("email", e.target.value)} required type="email" value={values.email} />
        </label>
        <label>
          Phone <small>optional</small>
          <input onChange={(e) => set("phone", e.target.value)} type="tel" value={values.phone} />
        </label>
        {partner ? (
          <>
            <label>
              Partner&rsquo;s first name
              <input onChange={(e) => set("partnerFirstName", e.target.value)} value={values.partnerFirstName} />
            </label>
            <label>
              Partner&rsquo;s last name
              <input onChange={(e) => set("partnerLastName", e.target.value)} placeholder={values.lastName} value={values.partnerLastName} />
            </label>
            <label className="booking-import-span">
              Partner&rsquo;s email <small>optional</small>
              <input onChange={(e) => set("partnerEmail", e.target.value)} type="email" value={values.partnerEmail} />
            </label>
          </>
        ) : (
          <button className="button button-light button-sm booking-import-span" onClick={() => setPartner(true)} type="button">
            <Plus size={14} aria-hidden="true" /> Add a partner
          </button>
        )}
      </fieldset>

      <fieldset>
        <legend>The event</legend>
        <label>
          Type
          <select onChange={(e) => set("eventType", e.target.value as ExistingBookingFormValues["eventType"])} value={values.eventType}>
            <option>Wedding</option>
            <option>Corporate</option>
            <option>Sports</option>
          </select>
        </label>
        <label>
          Date
          <input onChange={(e) => set("eventDate", e.target.value)} required type="date" value={values.eventDate} />
        </label>
        <label>
          Venue <small>optional</small>
          <input onChange={(e) => set("venueName", e.target.value)} value={values.venueName} />
        </label>
        <label>
          City <small>optional</small>
          <input onChange={(e) => set("city", e.target.value)} value={values.city} />
        </label>
        <label className="booking-import-span">
          Where it&rsquo;s at
          <select onChange={(e) => set("state", e.target.value as "BOOKED" | "PLANNING")} value={values.state}>
            <option value="BOOKED">Booked — planning hasn&rsquo;t started</option>
            <option value="PLANNING">Planning is under way</option>
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>The contract</legend>
        <label>
          Package <small>as the contract names it</small>
          <input onChange={(e) => set("packageName", e.target.value)} placeholder="Signature Collection" value={values.packageName} />
        </label>
        <label>
          Signed on
          <input onChange={(e) => set("signedOn", e.target.value)} required type="date" value={values.signedOn} />
        </label>
        <label>
          Contract total <small>tax included</small>
          <input inputMode="decimal" onChange={(e) => set("total", e.target.value)} placeholder="6499" required value={values.total} />
        </label>
        <label>
          Of which tax
          <input inputMode="decimal" onChange={(e) => set("tax", e.target.value)} value={values.tax} />
        </label>
        <label>
          Coverage hours
          <input inputMode="decimal" onChange={(e) => set("coverageHours", e.target.value)} required value={values.coverageHours} />
        </label>
        <label>
          Photographers
          <input inputMode="numeric" onChange={(e) => set("photographers", e.target.value)} required value={values.photographers} />
        </label>
        <label className="booking-import-span">
          Signed by <small>defaults to the client</small>
          <input onChange={(e) => set("signerName", e.target.value)} placeholder={`${values.firstName} ${values.lastName}`.trim()} value={values.signerName} />
        </label>
        {signedCopy ? (
          <p className="booking-import-note booking-import-span">
            <ShieldCheck size={14} aria-hidden="true" /> The signed contract you gave Cue
            will be attached.
          </p>
        ) : (
          <label className="booking-import-span">
            Signed copy <small>optional — PDF or photo</small>
            <input accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0] ?? null)} type="file" />
          </label>
        )}
      </fieldset>

      <fieldset>
        <legend>Paid so far</legend>
        <div className="booking-import-span booking-import-quickbooks">
          <button
            className="button button-light button-sm"
            disabled={quickBooks.busy || busy}
            onClick={() => void fillFromQuickBooks()}
            type="button"
          >
            {quickBooks.busy ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
            Fill from QuickBooks
          </button>
          {quickBooks.notes.map((note) => (
            <p className="booking-import-note" key={note}>
              <CircleAlert size={14} aria-hidden="true" /> {note}
            </p>
          ))}
        </div>
        {values.payments.map((payment, index) => (
          <div className="booking-import-payment booking-import-span" key={index}>
            <label>
              Amount
              <input inputMode="decimal" onChange={(e) => setPayment(index, "amount", e.target.value)} placeholder="2000" value={payment.amount} />
            </label>
            <label>
              Received
              <input onChange={(e) => setPayment(index, "paidOn", e.target.value)} type="date" value={payment.paidOn} />
            </label>
            <label>
              For
              <input onChange={(e) => setPayment(index, "method", e.target.value)} value={payment.method} />
            </label>
            <button
              aria-label="Remove this payment"
              className="booking-import-remove"
              onClick={() =>
                setValues((prior) => ({
                  ...prior,
                  payments: prior.payments.filter((_, at) => at !== index),
                }))
              }
              type="button"
            >
              <Trash2 size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          className="button button-light button-sm booking-import-span"
          onClick={() =>
            setValues((prior) => ({
              ...prior,
              payments: [...prior.payments, { amount: "", paidOn: "", method: "Payment" }],
            }))
          }
          type="button"
        >
          <Plus size={14} aria-hidden="true" /> Add a payment
        </button>
        {compact ? null : (
          <label className="booking-import-span">
            Notes <small>optional, only you see these</small>
            <textarea maxLength={2000} onChange={(e) => set("notes", e.target.value)} rows={2} value={values.notes} />
          </label>
        )}
      </fieldset>

      {phase === "reviewing" && review ? (
        <section className="booking-import-review" aria-live="polite">
          {review.preview.alreadyImported ? (
            <p className="booking-import-issue is-error">
              <CircleAlert size={14} aria-hidden="true" />
              <span>
                This booking is already in StudioCue:{" "}
                <Link href={`/studio/projects/${review.preview.alreadyImported.projectId}`}>
                  {review.preview.alreadyImported.name}
                </Link>
                .
              </span>
            </p>
          ) : null}
          {blockingIssues.map((issue) => (
            <p className="booking-import-issue is-error" key={issue.code}>
              <CircleAlert size={14} aria-hidden="true" /> <span>{issue.message}</span>
            </p>
          ))}
          {warnings.map((issue) => (
            <p className="booking-import-issue" key={issue.code}>
              <CircleAlert size={14} aria-hidden="true" /> <span>{issue.message}</span>
            </p>
          ))}
          {review.preview.sameDayBookings.length ? (
            <p className="booking-import-issue">
              <CircleAlert size={14} aria-hidden="true" />
              <span>
                You already have {review.preview.sameDayBookings.map((job) => job.name).join(" and ")} on
                this date.
              </span>
            </p>
          ) : null}
          {review.preview.knownClients.some(Boolean) ? (
            <p className="booking-import-note">
              <CircleCheck size={14} aria-hidden="true" />
              {review.preview.knownClients
                .filter(Boolean)
                .map((client) => client!.displayName)
                .join(" and ")}{" "}
              {review.preview.knownClients.filter(Boolean).length === 1 ? "is" : "are"} already in
              your clients, and will be linked rather than added twice.
            </p>
          ) : null}
          {canImport ? (
            <p className="booking-import-summary">
              {money(review.booking.totalCents)} contract,{" "}
              {money(review.booking.payments.reduce((sum, payment) => sum + payment.amountCents, 0))} paid
              before StudioCue. Importing records this as your word that the booking predates
              StudioCue, and keeps it quiet until you bring the couple in.
            </p>
          ) : null}
        </section>
      ) : null}

      {problem ? (
        <p className="form-error" role="alert">
          {problem}
        </p>
      ) : null}

      <div className="booking-import-actions">
        <button className="button button-dark" disabled={busy} type="submit">
          {busy ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}
          {phase === "importing"
            ? "Importing…"
            : phase === "checking"
              ? "Checking…"
              : canImport
                ? "Import booking"
                : "Check booking"}
        </button>
        {phase === "reviewing" ? (
          <button className="button button-light" disabled={busy} onClick={() => setPhase("editing")} type="button">
            Edit details
          </button>
        ) : null}
      </div>
    </form>
  );
}
