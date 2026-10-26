import { journeyProfile, variantLabel } from "@/features/job-kinds/job-kinds";
import { importedCoverage, importedCrewRoleLabels, pastImportStates, type ExistingBooking, type ImportedCoverageRole } from "./existing-booking";
import type { SpreadsheetInquiry } from "./spreadsheet";

/**
 * What an import asks the studio before a row goes in.
 *
 * Built after GR's own sheet (2026-10-26): eight rows listed a retainer as
 * paid beside notes saying "no payment confirmation in contract", one said
 * $3,000 paid where its notes said the retainer was $1,000, a photo-only
 * wedding had a videographer, and a phone number had nine digits. Every one
 * would have imported as fact. The reader can't know which side is right, and
 * guessing either way is wrong for someone, so it asks.
 *
 * Fixed rules, so every question can say why it was asked: the sheet against
 * its own notes, a value that can't be right, crew the package doesn't
 * include. An answer only ever picks between what the row already says. It
 * never invents a figure, and the server still checks the result as it
 * checks any import (assessExistingBooking).
 *
 * Questions are worked out again from the row whenever they're needed, so a
 * row held for later (importDrafts) stores only the row and its answers.
 *
 * Pure.
 */

export type ImportCandidate =
  | { kind: "booking"; booking: ExistingBooking }
  | { kind: "inquiry"; inquiry: SpreadsheetInquiry };

export type ImportOption = { id: string; label: string };

export type ImportQuestion = {
  /** The same kind of question on every row shares an id: "payment", "phone". */
  id: string;
  prompt: string;
  options: ImportOption[];
};

/** Answer ids by question id. */
export type ImportAnswers = Record<string, string>;

export type ImportConfirmation = { question: string; answer: string };

export type ImportOutcome =
  /** Questions still to answer. */
  | { kind: "open"; questions: ImportQuestion[] }
  | { kind: "skip" }
  | { kind: "booking"; booking: ExistingBooking }
  | { kind: "inquiry"; inquiry: SpreadsheetInquiry; confirmations: ImportConfirmation[] };

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);

const UNCONFIRMED =
  /no payment confirm|payment (?:is )?not (?:yet )?confirmed|not (?:yet )?(?:been )?paid|\bunpaid\b|no (?:retainer|deposit|payment)s? (?:has been |was )?(?:received|yet|paid|made)|awaiting (?:the )?(?:retainer|deposit|payment)|(?:retainer|deposit) (?:is )?(?:still )?(?:due|outstanding|pending|owed)/i;

const UNSIGNED = /\bunsigned\b|\bnot (?:yet )?signed\b|signature (?:blocks?|lines?) (?:are |is )?blank/i;

/** "$3000 retainer", "retainer stated as $1000": the first retainer the notes name. */
export function retainerInNotes(notes: string): number | null {
  const amount = "\\$\\s?(\\d[\\d,]*(?:\\.\\d{2})?)";
  const before = new RegExp(`${amount}\\s+(?:retainer|deposit)\\b`, "i").exec(notes);
  const after = new RegExp(`\\b(?:retainer|deposit)\\b[^$;\\n]{0,30}${amount}`, "i").exec(notes);
  const first = [before, after].filter((match): match is RegExpExecArray => match !== null).sort((a, b) => a.index - b.index)[0];
  if (!first) return null;
  const cents = Math.round(Number(first[1]!.replace(/,/g, "")) * 100);
  return cents > 0 ? cents : null;
}

/** Whether the notes say the payment hasn't been confirmed. */
export function paymentUnconfirmed(notes: string): boolean {
  return UNCONFIRMED.test(notes);
}

/** A US number has ten digits, or eleven after a 1; one written with + is someone else's. */
export function phoneLooksWrong(raw: string | null | undefined): boolean {
  const value = (raw ?? "").trim();
  if (!value || value.startsWith("+")) return false;
  const digits = value.replace(/\D/g, "");
  return !(digits.length === 10 || (digits.length === 11 && digits.startsWith("1")));
}

/** Whether the package or the notes say there's no video. */
function photoOnly(notes: string, packageName: string): boolean {
  if (/photo[\s-]*only/i.test(`${notes} ${packageName}`)) return true;
  return /\bphoto/i.test(packageName) && !/cinema|video|film/i.test(packageName);
}

/** "Sam Adler", from "mitzvah child is Sam Adler". */
export function honoreeInNotes(notes: string): string | null {
  const match =
    /(?:mitzvah child|honoree|birthday (?:girl|boy)|quincea[ñn]era|celebrant|\bchild|\bson|\bdaughter)(?:'s name)?\s*(?:is|:|-|named)\s+([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)?)/.exec(notes);
  return match ? match[1]! : null;
}

/** An unsigned booking, as the inquiry it really is. */
export function inquiryFromBooking(booking: ExistingBooking): SpreadsheetInquiry {
  return {
    clients: booking.clients,
    eventTypeId: booking.eventTypeId,
    eventType: booking.eventType,
    eventDate: booking.eventDate,
    timezone: booking.timezone,
    venueName: booking.venueName,
    city: booking.city,
    startTime: booking.startTime ?? null,
    honoreeName: booking.honoreeName ?? null,
    kindVariant: booking.kindVariant ?? null,
    packageName: booking.packageName,
    quotedCents: booking.totalCents > 0 ? booking.totalCents : null,
    notes: booking.notes,
  };
}

const paidOf = (booking: ExistingBooking) => booking.payments.reduce((sum, payment) => sum + payment.amountCents, 0);

/** What the candidate is about, whichever kind it is. */
function facts(candidate: ImportCandidate) {
  const record = candidate.kind === "booking" ? candidate.booking : candidate.inquiry;
  return {
    clients: record.clients,
    notes: record.notes ?? "",
    eventTypeId: record.eventTypeId,
    eventType: record.eventType,
    honoreeName: record.honoreeName ?? null,
    kindVariant: record.kindVariant ?? null,
  };
}

/** Whether to ask how it comes in: an unsigned row, or a "signed" one whose notes say it isn't. */
function signedQuestion(candidate: ImportCandidate): ImportQuestion | null {
  if (candidate.kind === "inquiry")
    return {
      id: "signed",
      prompt: "There's no signing date, so this isn't booked yet. Add it as an inquiry?",
      options: [
        { id: "inquiry", label: "Add as an inquiry" },
        { id: "skip", label: "Leave it out" },
      ],
    };
  if (!UNSIGNED.test(candidate.booking.notes ?? "")) return null;
  return {
    id: "signed",
    prompt: "Your notes say the contract isn't signed. How should it come in?",
    options: [
      { id: "booked", label: "Booked · it's signed" },
      { id: "inquiry", label: "As an inquiry" },
      { id: "skip", label: "Leave it out" },
    ],
  };
}

/** The studio's words: a vendor's client pays a deposit (trades.ts `deposit`). */
export type ImportWords = { deposit?: string };

function paymentQuestion(booking: ExistingBooking, deposit: string): ImportQuestion | null {
  const paid = paidOf(booking);
  if (!paid) return null;
  const notes = booking.notes ?? "";
  const stated = retainerInNotes(notes);
  const mismatch = stated !== null && stated !== paid;
  if (!mismatch && !paymentUnconfirmed(notes)) return null;
  // After the event, what's not in is the balance: nothing is "owed" as a retainer.
  const past = pastImportStates.includes(booking.state);
  const owed = mismatch ? stated! : paid;
  const nothing: ImportOption = { id: "owed", label: past ? "Nothing received yet" : `Nothing yet · ${money(owed)} owed` };
  return mismatch
    ? {
        id: "payment",
        prompt: `Your notes say the ${deposit} is ${money(stated!)}, but the sheet says ${money(paid)} paid. What's been received?`,
        options: [
          { id: "received_notes", label: `${money(stated!)} received` },
          { id: "received_sheet", label: `${money(paid)} received` },
          nothing,
        ],
      }
    : {
        id: "payment",
        prompt: `Your notes say there's no payment confirmation. Has the ${money(paid)} been received?`,
        options: [{ id: "received_sheet", label: "Yes, it's been received" }, nothing],
      };
}

function videoQuestion(booking: ExistingBooking): ImportQuestion | null {
  const video = (booking.crew ?? []).filter((line) => line.role === "videographer").reduce((sum, line) => sum + line.count, 0);
  if (!video || !photoOnly(booking.notes ?? "", booking.packageName)) return null;
  const word = video === 1 ? "videographer" : "videographers";
  return {
    id: "video",
    prompt: /photo[\s-]*only/i.test(`${booking.notes ?? ""} ${booking.packageName}`)
      ? `Your notes say photo only, but the sheet has ${video} ${word}.`
      : `The package is ${booking.packageName}, but the sheet has ${video} ${word}.`,
    options: [
      { id: "no_video", label: "No videographer" },
      { id: "keep_video", label: `Keep ${video} ${word}` },
    ],
  };
}

function phoneQuestion(candidate: ImportCandidate): ImportQuestion | null {
  const primary = facts(candidate).clients[0]!;
  // Blank is only an answer when there's an email to reach them by.
  if (!primary.email || !phoneLooksWrong(primary.phone)) return null;
  const digits = (primary.phone ?? "").replace(/\D/g, "").length;
  return {
    id: "phone",
    prompt: `${primary.firstName}'s phone number, ${primary.phone}, has ${digits} digits.`,
    options: [
      { id: "blank", label: "Leave it blank" },
      { id: "keep", label: "Keep it as written" },
    ],
  };
}

function honoreeQuestion(candidate: ImportCandidate): ImportQuestion | null {
  const about = facts(candidate);
  if (about.honoreeName || !journeyProfile(about.eventTypeId).honoree) return null;
  const named = honoreeInNotes(about.notes);
  if (!named) return null;
  const first = named.split(/\s+/)[0]!;
  const event = (variantLabel(about.eventTypeId, about.kindVariant) ?? about.eventType).toLowerCase();
  return {
    id: "honoree",
    prompt: `Your notes name ${named} for the ${event}. Save ${first} as who it celebrates?`,
    options: [
      { id: "yes", label: `Yes, ${first}` },
      { id: "no", label: "Leave it blank" },
    ],
  };
}

/**
 * The questions this row needs answered, given what's answered so far: once
 * it's going in as an inquiry, the booking's money and crew no longer matter.
 */
export function importQuestions(candidate: ImportCandidate, answers: ImportAnswers = {}, words: ImportWords = {}): ImportQuestion[] {
  const signed = signedQuestion(candidate);
  const asInquiry = candidate.kind === "inquiry" || answers.signed === "inquiry";
  const list = [
    signed,
    ...(answers.signed === "skip"
      ? []
      : asInquiry
        ? [phoneQuestion(candidate), honoreeQuestion(candidate)]
        : candidate.kind === "booking"
          ? [paymentQuestion(candidate.booking, words.deposit ?? "retainer"), videoQuestion(candidate.booking), phoneQuestion(candidate), honoreeQuestion(candidate)]
          : []),
  ];
  return list.filter((question): question is ImportQuestion => question !== null);
}

function withClients<T extends { clients: ExistingBooking["clients"] }>(record: T, answers: ImportAnswers): T {
  if (answers.phone !== "blank") return record;
  const [first, ...rest] = record.clients;
  return { ...record, clients: [{ ...first!, phone: null }, ...rest] };
}

function withHonoree<T extends { honoreeName?: string | null; notes: string | null }>(record: T, answers: ImportAnswers): T {
  if (answers.honoree !== "yes") return record;
  const named = honoreeInNotes(record.notes ?? "");
  return named ? { ...record, honoreeName: named.split(/\s+/)[0]! } : record;
}

/**
 * The row as it will be imported, once every question it needs is answered:
 * a booking (carrying what was confirmed), an inquiry, or left out.
 */
export function applyImportAnswers(candidate: ImportCandidate, answers: ImportAnswers, words: ImportWords = {}): ImportOutcome {
  const questions = importQuestions(candidate, answers, words);
  const open = questions.filter((question) => !question.options.some((option) => option.id === answers[question.id]));
  if (open.length) return { kind: "open", questions: open };
  if (answers.signed === "skip") return { kind: "skip" };
  const confirmations = questions.map((question) => ({
    question: question.prompt,
    answer: question.options.find((option) => option.id === answers[question.id])!.label,
  }));

  if (candidate.kind === "inquiry" || answers.signed === "inquiry") {
    const inquiry = candidate.kind === "inquiry" ? candidate.inquiry : inquiryFromBooking(candidate.booking);
    return { kind: "inquiry", inquiry: withHonoree(withClients(inquiry, answers), answers), confirmations };
  }

  let booking = withHonoree(withClients(candidate.booking, answers), answers);
  if (answers.payment === "received_notes") {
    const stated = retainerInNotes(booking.notes ?? "")!;
    booking = { ...booking, payments: booking.payments.slice(0, 1).map((payment) => ({ ...payment, amountCents: stated })) };
  } else if (answers.payment === "owed") {
    const paid = paidOf(booking);
    const stated = retainerInNotes(booking.notes ?? "");
    const past = pastImportStates.includes(booking.state);
    booking = {
      ...booking,
      payments: [],
      ...(past ? {} : { retainerOwedCents: stated !== null && stated !== paid ? stated : paid }),
      assumed: (booking.assumed ?? []).filter((field) => field !== "paidOn"),
    };
  }
  if (answers.video === "no_video") {
    const crew = (booking.crew ?? []).filter((line) => line.role !== "videographer");
    booking = { ...booking, crew: crew.length ? crew : undefined, videographers: 0 };
  }
  return { kind: "booking", booking: confirmations.length ? { ...booking, confirmations } : booking };
}

/* ---------------------------------------------------------------------------
 * "Already here" → Update it.
 *
 * A job imported earlier, and a later sheet with more about it (GR's eleven
 * weddings, imported Oct 23 without their crew). What the job lacks is
 * filled in; where the job and the sheet disagree, the studio picks. Money
 * and the signature are never changed this way: a different total is said,
 * and left for the job's own page.
 * ------------------------------------------------------------------------- */

/** What an imported job already says (functions/src/imports/commands.ts importedJobDetails). */
export type ImportedJob = {
  venueName: string | null;
  city: string | null;
  startTime: string | null;
  honoreeName: string | null;
  kindVariant: string | null;
  notes: string | null;
  coverage: { role: string; count: number }[];
  totalCents: number | null;
};

export type ImportUpdateChanges = {
  venueName?: string;
  city?: string;
  startTime?: string;
  honoreeName?: string;
  kindVariant?: string;
  crew?: ExistingBooking["crew"];
  notes?: string;
};

export type ImportUpdatePlan = {
  /** Filled in because the job had nothing: "venue", "crew". */
  filled: string[];
  changes: ImportUpdateChanges;
  /** Where they disagree, as questions: "sheet" or "job". */
  conflicts: (ImportQuestion & { field: keyof ImportUpdateChanges })[];
  /** A different total, said and not changed. */
  moneyNote: string | null;
};

/** "2 photographers and 1 videographer". */
export function describeCoverage(coverage: readonly { role: string; count: number }[]): string {
  const parts = coverage
    .filter((item) => item.count > 0)
    .map((item) => {
      const label = (importedCrewRoleLabels[item.role as ImportedCoverageRole] ?? item.role).toLowerCase();
      return `${item.count} ${item.count === 1 ? label : `${label}s`}`;
    });
  if (parts.length <= 1) return parts[0] ?? "no crew";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sameCoverage = (a: readonly { role: string; count: number }[], b: readonly { role: string; count: number }[]) => {
  const key = (list: readonly { role: string; count: number }[]) =>
    list.filter((item) => item.count > 0).map((item) => `${item.role}:${item.count}`).sort().join(",");
  return key(a) === key(b);
};

export function planImportUpdate(job: ImportedJob, booking: ExistingBooking, primaryRole: ImportedCoverageRole): ImportUpdatePlan {
  const plan: ImportUpdatePlan = { filled: [], changes: {}, conflicts: [], moneyNote: null };
  const text = (field: "venueName" | "city" | "startTime" | "honoreeName", label: string, sheet: string | null | undefined, current: string | null) => {
    if (!sheet?.trim()) return;
    if (!current) {
      plan.changes[field] = sheet.trim();
      plan.filled.push(label);
    } else if (!sameText(sheet, current))
      plan.conflicts.push({
        id: `job_${field}`,
        field,
        prompt: `The job's ${label} is ${current}; the sheet says ${sheet.trim()}.`,
        options: [
          { id: "sheet", label: `Use ${sheet.trim()}` },
          { id: "job", label: `Keep ${current}` },
        ],
      });
  };
  text("venueName", "venue", booking.venueName, job.venueName);
  text("city", "city", booking.city, job.city);
  text("startTime", "start time", booking.startTime, job.startTime);
  text("honoreeName", "child's name", booking.honoreeName, job.honoreeName);
  if (booking.kindVariant && !job.kindVariant) plan.changes.kindVariant = booking.kindVariant;

  // The crew, when the sheet says it (not the one the reader assumed).
  if (booking.crew?.length && !(booking.assumed ?? []).includes("crew")) {
    const sheet = importedCoverage(booking, primaryRole);
    const named = booking.crew.some((line) => line.names.length);
    if (!job.coverage.length) {
      plan.changes.crew = booking.crew;
      plan.filled.push("crew");
    } else if (!sameCoverage(sheet, job.coverage))
      plan.conflicts.push({
        id: "job_crew",
        field: "crew",
        prompt: `The job has ${describeCoverage(job.coverage)}; the sheet says ${describeCoverage(sheet)}.`,
        options: [
          { id: "sheet", label: "Use the sheet's crew" },
          { id: "job", label: "Keep the job's" },
        ],
      });
    else if (named) {
      // The same counts, and now the names: book the people.
      plan.changes.crew = booking.crew;
      plan.filled.push("who's on the crew");
    }
  }
  if (booking.notes && !(job.notes ?? "").includes(booking.notes.trim())) {
    plan.changes.notes = booking.notes;
    plan.filled.push("notes");
  }
  if (job.totalCents !== null && job.totalCents !== booking.totalCents)
    plan.moneyNote = `The job's total is ${money(job.totalCents)} and the sheet says ${money(booking.totalCents)}. Money isn't changed here: change it on the job if the sheet is right.`;
  return plan;
}

/** The update to send once every disagreement is answered, or the ones still open. */
export function applyImportUpdate(
  plan: ImportUpdatePlan,
  booking: ExistingBooking,
  answers: ImportAnswers,
): { open: ImportQuestion[] } | { changes: ImportUpdateChanges; confirmations: ImportConfirmation[] } {
  const open = plan.conflicts.filter((question) => !question.options.some((option) => option.id === answers[question.id]));
  if (open.length) return { open };
  const changes: ImportUpdateChanges = { ...plan.changes };
  for (const question of plan.conflicts) {
    if (answers[question.id] !== "sheet") continue;
    if (question.field === "crew") changes.crew = booking.crew;
    else if (question.field === "venueName" || question.field === "city" || question.field === "startTime" || question.field === "honoreeName")
      changes[question.field] = String(booking[question.field] ?? "").trim();
  }
  return {
    changes,
    confirmations: plan.conflicts.map((question) => ({
      question: question.prompt,
      answer: question.options.find((option) => option.id === answers[question.id])!.label,
    })),
  };
}
