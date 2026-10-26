"use client";

import { useState } from "react";
import { JOB_KIND_LABELS, JOB_KINDS } from "@/features/job-kinds/job-kinds";
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
import { useWorkspace } from "@/features/auth/workspace-context";
import { tradeOf, tradeProfile, tradeVocab } from "@/features/trades/trades";
import {
  deliveryImportStates,
  existingBookingSchema,
  importableBookingStates,
  importedCrewRoleLabels,
  importStateLabels,
  type ExistingBooking,
  type ImportableBookingState,
  type ImportedCoverageRole,
} from "@/features/imports/existing-booking";
import { importCrewRoles } from "@/features/imports/sheet-columns";
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
  /** One of JOB_KIND_LABELS; the server reads the kind from it (job-kinds.ts). */
  eventType: string;
  eventDate: string;
  venueName: string;
  city: string;
  /** Where the job is now: before the event, or after it (2026-10-26). */
  state: ImportableBookingState;
  /** "HH:MM", when the day starts. */
  startTime: string;
  /** A delivered or finished job's gallery, and when it went out. */
  galleryUrl: string;
  deliveredOn: string;
  packageName: string;
  total: string;
  tax: string;
  coverageHours: string;
  /**
   * Who the studio sends, line by line: a role, how many, and who if the
   * studio says ("Kim, Tara, Joy"). Replaces the two fixed counts, which had
   * no room for a DJ's assistant or a stylist's three (2026-10-26).
   */
  crew: Array<{ role: ImportedCoverageRole; count: string; names: string }>;
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
  startTime: "",
  galleryUrl: "",
  deliveredOn: "",
  packageName: "",
  total: "",
  tax: "0",
  coverageHours: "8",
  crew: [],
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

/** Where a job is, as the form offers it. */
const STATE_CHOICES: Record<ImportableBookingState, string> = {
  BOOKED: "Booked — planning hasn’t started",
  PLANNING: "Planning is under way",
  EVENT_COMPLETE: `${importStateLabels.EVENT_COMPLETE} — nothing left but closing it`,
  POST_PRODUCTION: `${importStateLabels.POST_PRODUCTION} — not delivered yet`,
  DELIVERED: `${importStateLabels.DELIVERED} — follow-ups still open`,
  CLOSED: `${importStateLabels.CLOSED} — nothing left to do`,
};

/** A day's usual hours, by what the studio does, when nothing says otherwise. */
const USUAL_HOURS: Record<string, string> = { photographer: "8", dj: "5", makeup: "2", hair: "2", planner: "10" };

/** "Kim, Tara & Joy" → ["Kim", "Tara", "Joy"]. */
const splitNames = (value: string) =>
  value
    .split(/\s*(?:,|&|\/|;|\band\b)\s*/i)
    .map((name) => name.trim())
    .filter(Boolean);

/** A booking read from a sheet or a contract, as the form's values, to fix by hand. */
export function formValuesFromBooking(booking: ExistingBooking): Partial<ExistingBookingFormValues> {
  const [primary, partner] = booking.clients;
  return {
    firstName: primary?.firstName ?? "",
    lastName: primary?.lastName ?? "",
    email: primary?.email ?? "",
    phone: primary?.phone ?? "",
    partnerFirstName: partner?.firstName ?? "",
    partnerLastName: partner?.lastName ?? "",
    partnerEmail: partner?.email ?? "",
    eventType: booking.eventType,
    eventDate: booking.eventDate,
    venueName: booking.venueName ?? "",
    city: booking.city ?? "",
    state: booking.state,
    startTime: booking.startTime ?? "",
    galleryUrl: booking.galleryUrl ?? "",
    deliveredOn: booking.deliveredOn ?? "",
    packageName: booking.packageName,
    total: (booking.totalCents / 100).toFixed(2),
    tax: (booking.taxCents / 100).toFixed(2),
    coverageHours: String(booking.coverageMinutes / 60),
    crew: (booking.crew ?? []).map((line) => ({ role: line.role, count: String(line.count), names: line.names.join(", ") })),
    signedOn: booking.signedOn,
    signerName: booking.signerName,
    payments: booking.payments.map((payment) => ({
      amount: (payment.amountCents / 100).toFixed(2),
      paidOn: payment.paidOn,
      method: payment.method,
    })),
    notes: booking.notes ?? "",
  };
}

/**
 * The form's plain text, as the booking the server will check. `trade` is the
 * studio's (trades.ts): its words name the package when the contract didn't,
 * and the counts in the refusals. A photographer's read as they always did.
 */
export function bookingFromForm(
  values: ExistingBookingFormValues,
  hasSignedCopy: boolean,
  trade?: unknown,
): { booking: ExistingBooking } | { problem: string } {
  const photo = tradeProfile(trade).family === "photo";
  const delivered = values.state === "DELIVERED" || values.state === "CLOSED";
  const crew = values.crew
    .map((line) => {
      const names = splitNames(line.names);
      const count = Math.max(Math.round(Number(line.count) || 0), names.length);
      return { role: line.role, count, names };
    })
    .filter((line) => line.count > 0);
  // Nothing is assumed for the crew (2026-10-26): say who the studio sends.
  if (!crew.length) return { problem: "Add who your studio sends: a role and how many." };
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
    // The kind of job and what the studio does: "Family & portraits photography", "Wedding hair".
    packageName: values.packageName.trim() || `${values.eventType} ${tradeVocab(trade).service}`,
    coverageMinutes: Math.round(Number(values.coverageHours) * 60),
    photographers: crew.find((line) => line.role === "photographer")?.count ?? 0,
    crew,
    startTime: values.startTime || null,
    galleryUrl: delivered && values.galleryUrl.trim() ? values.galleryUrl.trim() : null,
    deliveredOn: delivered && values.deliveredOn ? values.deliveredOn : null,
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
    [/^coverageMinutes/, photo ? "Coverage should be a number of hours." : "Hours should be a number."],
    [/^crew/, "Each crew line needs how many, or their names."],
    [/^galleryUrl/, "The delivery link should be a web address, starting https://."],
    [/^deliveredOn/, "Add the date it was delivered, or leave it blank."],
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
  onImported,
  carry,
}: {
  initial?: Partial<ExistingBookingFormValues>;
  /**
   * What a spreadsheet row's answers settled that the form has no field for
   * (2026-10-26): a retainer still owed, who it celebrates, what was
   * confirmed. Carried onto the booking unchanged.
   */
  carry?: Pick<ExistingBooking, "retainerOwedCents" | "honoreeName" | "kindVariant" | "confirmations">;
  /** Supplied by Cue, which already holds the file. */
  signedCopy?: File | null;
  source: "form" | "cue" | "spreadsheet";
  compact?: boolean;
  /** A spreadsheet row fixed here: told when it's in, so the sheet marks it. */
  onImported?: (result: ImportedBookingResult) => void;
}) {
  const trade = useWorkspace().tenantTrade;
  const roles = importCrewRoles(trade);
  const delivers = tradeProfile(trade).delivery;
  const [values, setValues] = useState<ExistingBookingFormValues>({
    ...blank,
    // The studio's own day and crew until something says otherwise.
    coverageHours: USUAL_HOURS[tradeOf(trade)] ?? blank.coverageHours,
    crew: [{ role: roles[0]!, count: "1", names: "" }],
    ...initial,
    payments: initial?.payments?.length ? initial.payments : blank.payments,
  });
  const setCrew = (index: number, key: "role" | "count" | "names", value: string) => {
    setValues((prior) => ({
      ...prior,
      crew: prior.crew.map((line, at) => (at === index ? { ...line, [key]: value } : line)),
    }));
    if (phase === "reviewing") setPhase("editing");
  };
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
      trade,
    );
    if ("problem" in built) {
      setProblem(built.problem);
      return;
    }
    if (carry) built.booking = { ...built.booking, ...carry };
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
      if (imported.result.crew?.assigned) refreshTenantRecords("crewProfiles");
      setDone({ result: imported.result, signedCopyAttached: imported.signedCopyAttached });
      setPhase("done");
      onImported?.(imported.result);
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
          <CircleCheck size={18} aria-hidden="true" /> {result.name}{" "} is in StudioCue.
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
          {result.crew?.assigned ? (
            <li>
              {`${result.crew.assigned} crew booked on the job, with nothing sent to them.`}
              {result.crew.addedToRoster.length
                ? ` ${result.crew.addedToRoster.map((person) => person.name).join(", ")} ${result.crew.addedToRoster.length === 1 ? "was" : "were"} added to your crew list without an invite. Add an email to invite them.`
                : ""}
            </li>
          ) : null}
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
        {/* Either is enough (2026-10-26): many beauty and DJ clients are a phone
            number. The portal invite waits for an email. */}
        <label>
          Email <small>or a phone</small>
          <input onChange={(e) => set("email", e.target.value)} type="email" value={values.email} />
        </label>
        <label>
          Phone <small>or an email</small>
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
          <select onChange={(e) => set("eventType", e.target.value)} value={values.eventType}>
            {JOB_KINDS.map((kind) => (
              <option key={kind} value={JOB_KIND_LABELS[kind]}>
                {JOB_KIND_LABELS[kind]}
              </option>
            ))}
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
        <label>
          Starts at <small>optional</small>
          <input onChange={(e) => set("startTime", e.target.value)} type="time" value={values.startTime} />
        </label>
        <label>
          Where it&rsquo;s at
          <select onChange={(e) => set("state", e.target.value as ImportableBookingState)} value={values.state}>
            {importableBookingStates
              .filter((state) => delivers || !deliveryImportStates.includes(state))
              .map((state) => (
                <option key={state} value={state}>
                  {STATE_CHOICES[state]}
                </option>
              ))}
          </select>
        </label>
        {delivers && (values.state === "DELIVERED" || values.state === "CLOSED") ? (
          <>
            <label>
              Delivery link <small>optional, so the client can open it</small>
              <input inputMode="url" onChange={(e) => set("galleryUrl", e.target.value)} placeholder="https://" value={values.galleryUrl} />
            </label>
            <label>
              Delivered on <small>optional</small>
              <input onChange={(e) => set("deliveredOn", e.target.value)} type="date" value={values.deliveredOn} />
            </label>
          </>
        ) : null}
      </fieldset>

      {/* Who the studio sent, line by line: a DJ's assistant, a stylist's three
          assistants with their names. Named people are booked on the job with
          nothing sent; anyone not on the crew list is added to it quietly. */}
      <fieldset>
        <legend>The crew</legend>
        {values.crew.map((line, index) => (
          <div className="booking-import-crew booking-import-span" key={index}>
            <label>
              Role
              <select onChange={(e) => setCrew(index, "role", e.target.value)} value={line.role}>
                {roles.map((role) => (
                  <option key={role} value={role}>
                    {importedCrewRoleLabels[role]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              How many
              <input inputMode="numeric" min="0" onChange={(e) => setCrew(index, "count", e.target.value)} value={line.count} />
            </label>
            <label>
              Who <small>names, if you know them</small>
              <input onChange={(e) => setCrew(index, "names", e.target.value)} placeholder="Kim, Tara" value={line.names} />
            </label>
            <button
              aria-label="Remove this crew line"
              className="booking-import-remove"
              onClick={() => setValues((prior) => ({ ...prior, crew: prior.crew.filter((_, at) => at !== index) }))}
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
              crew: [...prior.crew, { role: roles.find((role) => !prior.crew.some((line) => line.role === role)) ?? roles[0]!, count: "1", names: "" }],
            }))
          }
          type="button"
        >
          <Plus size={14} aria-hidden="true" /> Add a role
        </button>
        <p className="booking-import-note booking-import-span">
          Named people are booked on the job with nothing sent. Anyone not on your crew list is added to it,
          without an invite.
        </p>
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
        {/* In the studio's own words and roles: a hair studio's "Hours on site"
            and "Hair stylists", with no videographers to count (trades.ts). */}
        <label>
          {tradeVocab(trade).hoursLabel}
          <input inputMode="decimal" onChange={(e) => set("coverageHours", e.target.value)} required value={values.coverageHours} />
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
            <textarea maxLength={4000} onChange={(e) => set("notes", e.target.value)} rows={2} value={values.notes} />
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
                You already have {review.preview.sameDayBookings.map((job) => job.name).join(" and ")}{" "} on
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
              {review.preview.knownClients.filter(Boolean).length === 1 ? "is" : "are"}{" "} already in
              your clients, and will be linked rather than added twice.
            </p>
          ) : null}
          {canImport ? (
            <p className="booking-import-summary">
              {money(review.booking.totalCents)} contract,{" "}
              {money(review.booking.payments.reduce((sum, payment) => sum + payment.amountCents, 0))}{" "} paid
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
