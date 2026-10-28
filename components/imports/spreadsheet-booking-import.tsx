"use client";

import { useWorkspace } from "@/features/auth/workspace-context";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  PencilLine,
} from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { ExistingBookingForm, formValuesFromBooking } from "@/components/imports/existing-booking-form";
import { tradeProfile, tradeVocab } from "@/features/trades/trades";
import { journeyProfile, variantFieldFor } from "@/features/job-kinds/job-kinds";
import {
  assessExistingBooking,
  defaultBookingName,
  deliveryImportStates,
  importedCrewRoleLabels,
  importStateLabels,
  pastImportStates,
  type ExistingBooking,
  type ImportableBookingState,
  type ImportedCoverageRole,
} from "@/features/imports/existing-booking";
import {
  bookingFromSpreadsheetRow,
  detectColumns,
  detectCrewColumns,
  parseCsv,
  parseSpreadsheetDate,
  spreadsheetFieldLabel,
  spreadsheetFields,
  spreadsheetTemplateFor,
  unusedColumns,
  type CrewColumn,
  type SpreadsheetField,
  type SpreadsheetInquiry,
} from "@/features/imports/spreadsheet";
import {
  applyImportAnswers,
  applyImportUpdate,
  importQuestions,
  planImportUpdate,
  type ImportAnswers,
  type ImportCandidate,
  type ImportConfirmation,
  type ImportQuestion,
  type ImportUpdatePlan,
} from "@/features/imports/import-questions";
import { cellKind, importCrewRoles, type CrewRole } from "@/features/imports/sheet-columns";
import { readXlsx } from "@/features/imports/xlsx";
import {
  applyQuickBooksPayments,
  type QuickBooksClientHistory,
} from "@/features/imports/quickbooks-prefill";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand } from "@/lib/crm/command-client";
import {
  holdImportRows,
  importExistingBooking,
  lookupQuickBooksPayments,
  previewExistingBookings,
  resolveImportDraft,
  updateImportedBooking,
  type ExistingBookingPreview,
} from "@/lib/booking/command-client";

/**
 * Importing a whole spreadsheet of bookings, reviewed before anything lands.
 *
 * Read in the browser, checked by the server row by row with the same check
 * the one-at-a-time form uses, and imported only for the rows the studio
 * ticks. Each row's import is idempotent on the batch and the booking, so a
 * dropped connection halfway through a sixty-row sheet is fixed by pressing
 * the button again — nothing already imported is imported twice.
 *
 * Where a row disagrees with itself — its notes say no payment was confirmed
 * beside an amount paid, its package is photo only beside a videographer —
 * the review asks (features/imports/import-questions.ts), and the row waits
 * until it's answered. Rows nobody has answered yet can wait on Today
 * (importDrafts). A row with no signing date can come in as an inquiry, and a
 * job already here can be filled in from the sheet (2026-10-26).
 */

const MAX_ROWS = 200;

/** What happened to a row once the studio acted on it. */
type RowResult =
  | { kind: "importing" }
  | { kind: "imported"; projectId: string; name: string; as: "booking" | "inquiry" }
  | { kind: "updated"; projectId: string; name: string; updated: string[] }
  | { kind: "held" }
  | { kind: "left_out" }
  | { kind: "failed"; message: string };

type Row = {
  row: number;
  /** The sheet's batch: a held row keeps the one it was read in. */
  batchId: string;
  label: string;
  candidate: ImportCandidate | null;
  problems: string[];
  answers: ImportAnswers;
  notes: string[];
  /** Which column each part came from, for the row's details. */
  sources: Partial<Record<string, string>>;
  preview: ExistingBookingPreview | null;
  /** An inquiry whose client already has a job that day. */
  inquiryExisting: { projectId: string; name: string } | null;
  result: RowResult | null;
  /** Null until the studio ticks or unticks it: ticked when it's ready. */
  selected: boolean | null;
  /** The held row this came from (importDrafts), resolved once acted on. */
  draftId: string | null;
};

/** What a row is now, from its candidate, its answers and the server's check. */
type RowView =
  | RowResult
  | { kind: "problems"; messages: string[] }
  | { kind: "questions"; questions: ImportQuestion[] }
  | { kind: "skip" }
  | { kind: "blocked"; messages: string[] }
  | { kind: "duplicate"; projectId: string; name: string; plan: ImportUpdatePlan | null; booking: ExistingBooking | null }
  | { kind: "ready"; booking: ExistingBooking; warnings: string[] }
  | { kind: "inquiry"; inquiry: SpreadsheetInquiry; confirmations: ImportConfirmation[] };

/** "2 photographers (Gabe), 2 videographers": a booking's crew as a line. */
function crewLine(booking: ExistingBooking): string {
  return (booking.crew ?? [])
    .map((line) => {
      const label = importedCrewRoleLabels[line.role].toLowerCase();
      const word = line.count === 1 ? label : `${label}s`;
      return `${line.count} ${word}${line.names.length ? ` (${line.names.join(", ")})` : ""}`;
    })
    .join(", ");
}

/** Today in the browser's calendar: what counts as passed in the sheet. */
const localToday = () => new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const paidOf = (booking: ExistingBooking) => booking.payments.reduce((sum, payment) => sum + payment.amountCents, 0);

/** Questions whose answer isn't the same for every row: each names its own person. */
const ANSWERED_ONE_BY_ONE = new Set(["honoree"]);

/**
 * What a later sheet can change on a job already here (planImportUpdate):
 * its crew and who it celebrates. Money and the signature never change that
 * way, so a row already here doesn't ask about them.
 */
const UPDATE_QUESTIONS = new Set(["video", "honoree"]);

/** Questions with the same options are the same question on another row. */
const questionKey = (question: ImportQuestion) => `${question.id}:${question.options.map((option) => option.id).join(",")}`;

export function SpreadsheetBookingImport() {
  // The studio's trade names the crew columns (a DJ's "DJs") and says whether
  // there is a second one (spreadsheet.ts, spreadsheetFieldLabel).
  const workspace = useWorkspace();
  const trade = workspace.tenantTrade;
  const words = { deposit: tradeVocab(trade).deposit };
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [cells, setCells] = useState<string[][]>([]);
  const [tooMany, setTooMany] = useState(0);
  const [columns, setColumns] = useState<Partial<Record<SpreadsheetField, number>>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [phase, setPhase] = useState<"empty" | "mapping" | "checking" | "reviewing" | "importing" | "finished">("empty");
  const [problem, setProblem] = useState("");
  const [batchId, setBatchId] = useState("");
  const [useQuickBooks, setUseQuickBooks] = useState(false);
  // Crew columns, read from their cells (2026-10-26), and what to do with the
  // columns nothing reads and with jobs whose date has passed.
  const [crewColumns, setCrewColumns] = useState<CrewColumn[]>([]);
  const [keepUnused, setKeepUnused] = useState(true);
  const [pastState, setPastState] = useState<ImportableBookingState>("CLOSED");
  const [fixing, setFixing] = useState<Row | null>(null);
  const [crewBooked, setCrewBooked] = useState<{ assigned: number; added: string[] }>({ assigned: 0, added: [] });
  // The answer just given, so its row can offer it to the rows like it.
  const [lastAnswer, setLastAnswer] = useState<{ row: number; key: string; option: string } | null>(null);
  const [busyRow, setBusyRow] = useState<number | null>(null);
  const roles = importCrewRoles(trade);
  const primaryRole = roles[0]! as ImportedCoverageRole;
  const delivers = tradeProfile(trade).delivery;
  const owner = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  // Rows kept for later, and what an unsigned row's inquiry is checked against.
  const drafts = (useTenantDocuments("importDrafts", { enabled: owner }).records ?? []).filter(
    (draft) => draft.status === "held",
  );
  const contacts = useTenantDocuments("contacts").records ?? [];
  const projects = useTenantDocuments("projects").records ?? [];

  const templateHref = useMemo(
    () => `data:text/csv;charset=utf-8,${encodeURIComponent(spreadsheetTemplateFor(trade))}`,
    [trade],
  );
  const unused = unusedColumns(headers, columns, crewColumns);
  const today = localToday();
  // Rows whose date has passed, when the sheet has no status to say where they are.
  const passedRows =
    columns.status === undefined && columns.eventDate !== undefined
      ? cells.filter((rowCells) => {
          const date = parseSpreadsheetDate(String(rowCells[columns.eventDate!] ?? ""));
          return date !== null && date < today;
        }).length
      : 0;

  /** A booking already in StudioCue: only what an update would use is asked. */
  const alreadyHere = (row: Row) => (row.candidate?.kind === "booking" ? row.preview?.alreadyImported ?? null : null);

  /** The questions a row shows, given what's answered and whether it's already here. */
  function questionsShown(row: Row): ImportQuestion[] {
    if (!row.candidate || row.result) return [];
    if (row.candidate.kind === "inquiry" && row.inquiryExisting) return [];
    const all = importQuestions(row.candidate, row.answers, words);
    return alreadyHere(row) ? all.filter((question) => UPDATE_QUESTIONS.has(question.id)) : all;
  }

  function viewOf(row: Row): RowView {
    if (row.result) return row.result;
    if (!row.candidate) return { kind: "problems", messages: row.problems };
    if (row.candidate.kind === "inquiry" && row.inquiryExisting)
      return { kind: "duplicate", ...row.inquiryExisting, plan: null, booking: null };
    const already = alreadyHere(row);
    if (already && row.candidate.kind === "booking") {
      const open = questionsShown(row).filter((question) => row.answers[question.id] === undefined);
      if (open.length) return { kind: "questions", questions: open };
      // The rest are moot here: settled as the sheet says, and not sent.
      const settled = { ...row.answers };
      for (let pass = 0; pass < 2; pass += 1)
        for (const question of importQuestions(row.candidate, settled, words))
          if (settled[question.id] === undefined) settled[question.id] = question.id === "signed" ? "booked" : question.options[0]!.id;
      const outcome = applyImportAnswers(row.candidate, settled, words);
      const booking = outcome.kind === "booking" ? outcome.booking : row.candidate.booking;
      return {
        kind: "duplicate",
        projectId: already.projectId,
        name: already.name,
        plan: already.current ? planImportUpdate(already.current, booking, primaryRole) : null,
        booking,
      };
    }
    const outcome = applyImportAnswers(row.candidate, row.answers, words);
    if (outcome.kind === "open") return { kind: "questions", questions: outcome.questions };
    if (outcome.kind === "skip") return { kind: "skip" };
    if (outcome.kind === "inquiry")
      return row.inquiryExisting
        ? { kind: "duplicate", ...row.inquiryExisting, plan: null, booking: null }
        : { kind: "inquiry", inquiry: outcome.inquiry, confirmations: outcome.confirmations };
    const booking = outcome.booking;
    // The answered booking, checked as the server will check it.
    const issues = assessExistingBooking(booking, today, { delivers });
    const errors = issues.filter((issue) => issue.severity === "error");
    if (errors.length) return { kind: "blocked", messages: errors.map((issue) => issue.message) };
    const sameDay = row.preview?.sameDayBookings ?? [];
    return {
      kind: "ready",
      booking,
      warnings: [
        ...issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message),
        ...(sameDay.length ? [`You already have ${sameDay.map((job) => job.name).join(" and ")} that day.`] : []),
      ],
    };
  }

  const selectedOf = (row: Row, view: RowView) =>
    row.selected ?? (view.kind === "ready" || view.kind === "inquiry");

  async function load(file: File | undefined) {
    if (!file) return;
    setProblem("");
    let parsed: string[][];
    try {
      // Excel and Google Sheets downloads, not only CSV (2026-10-26).
      parsed = /\.xlsx$/i.test(file.name) ? await readXlsx(file) : parseCsv(await file.text());
    } catch {
      setProblem("That file couldn't be read. Save it as .xlsx or .csv and try again.");
      return;
    }
    if (parsed.length < 2) {
      setProblem("That file has no rows under its header. Export again, or start from the template.");
      return;
    }
    const [head, ...body] = parsed;
    setFileName(file.name);
    setHeaders(head!);
    setCells(body.slice(0, MAX_ROWS));
    setTooMany(Math.max(0, body.length - MAX_ROWS));
    setColumns(detectColumns(head!, trade));
    setCrewColumns(detectCrewColumns(head!, trade, body.slice(0, MAX_ROWS)));
    setBatchId(crypto.randomUUID());
    setRows([]);
    setPhase("mapping");
  }

  function readRows(): Row[] {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return cells.map((rowCells, index) => {
      const result = bookingFromSpreadsheetRow({
        row: index + 2,
        cells: rowCells,
        columns,
        timezone,
        trade,
        crewColumns,
        headers,
        keepInNotes: keepUnused ? unused : [],
        pastState,
        today,
      });
      const base = { row: result.row, batchId, answers: {}, preview: null, inquiryExisting: null, result: null, selected: null, draftId: null };
      if ("problems" in result) {
        const name =
          [rowCells[columns.firstName ?? -1], rowCells[columns.lastName ?? -1]].filter(Boolean).join(" ") ||
          rowCells[columns.clientName ?? -1] ||
          `Row ${result.row}`;
        return { ...base, label: name, candidate: null, problems: result.problems, notes: [], sources: {} };
      }
      const candidate: ImportCandidate =
        "booking" in result ? { kind: "booking", booking: result.booking } : { kind: "inquiry", inquiry: result.inquiry };
      const record = candidate.kind === "booking" ? candidate.booking : candidate.inquiry;
      return {
        ...base,
        // The name the job will have: "Ivy Northwalk & Sam Reed", never
        // "Ivy & Sam Northwalk" when they don't share a surname (2026-10-27).
        label: `${("projectName" in record && record.projectName) || defaultBookingName(record.clients)} · ${record.eventDate}`,
        candidate,
        problems: [],
        notes: result.notes,
        sources: result.sources,
      };
    });
  }

  /**
   * Swap each row's paid figure for the payments QuickBooks recorded, before
   * the server checks anything — so the check judges what will actually be
   * imported. If QuickBooks can't be reached the sheet's figures stand and the
   * studio is told, rather than the whole check failing.
   */
  async function withQuickBooks(read: Row[]): Promise<Row[]> {
    const bookingOf = (row: Row) => (row.candidate?.kind === "booking" ? row.candidate.booking : null);
    const emails = [
      ...new Set(read.flatMap((row) => (bookingOf(row)?.clients ?? []).map((client) => client.email ?? "").filter(Boolean))),
    ];
    if (!emails.length) return read;
    const histories: QuickBooksClientHistory[] = [];
    try {
      for (let start = 0; start < emails.length; start += 20) {
        const lookup = await lookupQuickBooksPayments(emails.slice(start, start + 20));
        if (!lookup) return read;
        histories.push(...lookup.clients);
      }
    } catch (caught: unknown) {
      setProblem(
        `${friendlyError(caught, "QuickBooks couldn't be reached.")} What's been paid comes from the sheet instead.`,
      );
      return read;
    }
    return read.map((row) => {
      const booking = bookingOf(row);
      if (!booking) return row;
      const applied = applyQuickBooksPayments(booking, histories);
      return { ...row, candidate: { kind: "booking", booking: applied.booking }, notes: [...applied.notes, ...row.notes] };
    });
  }

  /** An inquiry's client, already in StudioCue with a job that day. */
  function inquiryAlreadyHere(inquiry: SpreadsheetInquiry): { projectId: string; name: string } | null {
    const email = inquiry.clients[0]?.email ?? "";
    if (!email) return null;
    const contact = contacts.find((record) => !record.archivedAt && String(record.normalizedEmail ?? "") === email);
    if (!contact) return null;
    const job = projects.find(
      (project) =>
        !project.archivedAt &&
        project.eventDate === inquiry.eventDate &&
        Array.isArray(project.clientContactIds) &&
        (project.clientContactIds as unknown[]).includes(contact.id),
    );
    return job ? { projectId: String(job.id), name: String(job.name ?? job.id) } : null;
  }

  /** The server's check of every booking row; an inquiry is checked against the studio's jobs. */
  async function checkRows(read: Row[]): Promise<Row[] | null> {
    const toCheck = read.filter((row) => row.candidate?.kind === "booking" && !row.result);
    const previews = new Map<number, ExistingBookingPreview>();
    for (let start = 0; start < toCheck.length; start += 50) {
      const chunk = toCheck.slice(start, start + 50);
      const preview = await previewExistingBookings(
        chunk.map((row) => (row.candidate as { booking: ExistingBooking }).booking),
      );
      if (!preview) return null;
      chunk.forEach((row, index) => previews.set(row.row, preview.bookings[index]!));
    }
    const checked = read.map((row) => ({
      ...row,
      preview: previews.get(row.row) ?? row.preview,
      inquiryExisting: row.candidate?.kind === "inquiry" ? inquiryAlreadyHere(row.candidate.inquiry) : null,
    }));
    // Rows with a question first, so nothing waiting is under the rows that aren't.
    const asks = (row: Row) => questionsShown(row).length > 0;
    return [...checked].sort((a, b) => Number(asks(b)) - Number(asks(a)) || a.row - b.row);
  }

  async function check() {
    setProblem("");
    let read = readRows();
    setRows(read);
    setPhase("checking");
    if (useQuickBooks) {
      read = await withQuickBooks(read);
      setRows(read);
    }
    try {
      const checked = await checkRows(read);
      if (!checked) {
        setProblem("Development preview: bookings can't be imported here.");
        setPhase("mapping");
        return;
      }
      setRows(checked);
      setPhase("reviewing");
    } catch (caught: unknown) {
      setProblem(friendlyError(caught, "The spreadsheet couldn't be checked."));
      setPhase("mapping");
    }
  }

  /** Rows kept for later, read back into the review. */
  async function resumeDrafts() {
    setProblem("");
    setFileName(String(drafts[0]?.fileName ?? "") || "Rows kept for later");
    const read: Row[] = drafts
      .sort((a, b) => Number(a.row ?? 0) - Number(b.row ?? 0))
      .map((draft) => {
        const candidate = draft.candidate as ImportCandidate;
        const record = candidate.kind === "booking" ? candidate.booking : candidate.inquiry;
        return {
          row: Number(draft.row ?? 0),
          batchId: String(draft.batchId ?? ""),
          label: String(draft.label ?? `${record.clients[0]?.firstName ?? ""} ${record.clients[0]?.lastName ?? ""}`),
          candidate,
          problems: [],
          answers: (draft.answers ?? {}) as ImportAnswers,
          notes: [],
          sources: {},
          preview: null,
          inquiryExisting: null,
          result: null,
          selected: null,
          draftId: String(draft.id),
        };
      });
    setRows(read);
    setPhase("checking");
    try {
      const checked = await checkRows(read);
      if (!checked) {
        setProblem("Development preview: bookings can't be imported here.");
        setPhase("empty");
        return;
      }
      setRows(checked);
      setPhase("reviewing");
    } catch (caught: unknown) {
      setProblem(friendlyError(caught, "The rows couldn't be checked."));
      setPhase("empty");
    }
  }

  function answer(rowNumber: number, question: ImportQuestion, option: string) {
    setRows((prior) =>
      prior.map((row) => (row.row === rowNumber ? { ...row, answers: { ...row.answers, [question.id]: option }, selected: null } : row)),
    );
    setLastAnswer(ANSWERED_ONE_BY_ONE.has(question.id) ? null : { row: rowNumber, key: questionKey(question), option });
  }

  /** Rows still asking the same question, which the answer just given would settle. */
  function rowsLike(key: string, except: number): Row[] {
    return rows.filter(
      (row) =>
        row.row !== except &&
        !row.result &&
        row.candidate !== null &&
        questionsShown(row).some(
          (question) => questionKey(question) === key && row.answers[question.id] === undefined,
        ),
    );
  }

  function answerAllLike(key: string, option: string, except: number) {
    const targets = new Set(rowsLike(key, except).map((row) => row.row));
    const id = key.split(":")[0]!;
    setRows((prior) =>
      prior.map((row) => (targets.has(row.row) ? { ...row, answers: { ...row.answers, [id]: option }, selected: null } : row)),
    );
    setLastAnswer(null);
  }

  /** An unsigned row, as the inquiry the studio said it is. */
  async function createInquiry(row: Row, inquiry: SpreadsheetInquiry, confirmations: ImportConfirmation[]) {
    const contactIds: string[] = [];
    for (const [index, client] of inquiry.clients.entries()) {
      const known = client.email
        ? contacts.find((record) => !record.archivedAt && String(record.normalizedEmail ?? "") === client.email)
        : undefined;
      if (known) {
        contactIds.push(String(known.id));
        continue;
      }
      const created = await runCrmCommand(
        "createContact",
        {
          firstName: client.firstName,
          lastName: client.lastName,
          email: client.email,
          phone: client.phone,
          company: null,
          contactTypes: ["client"],
        },
        { idempotencyKey: `sheet-contact-${row.batchId}-${row.row}-${index}` },
      );
      if (!created.persisted) return null;
      contactIds.push(String(created.result.contactId ?? ""));
    }
    const celebrates = journeyProfile(inquiry.eventTypeId).honoree;
    const variantField = variantFieldFor(inquiry.eventTypeId);
    const text = [
      `From your spreadsheet${fileName ? ` (${fileName}, row ${row.row})` : ""}: not signed yet.`,
      [inquiry.packageName, inquiry.quotedCents ? `${money(inquiry.quotedCents)} quoted` : ""].filter(Boolean).join(", "),
      confirmations.map((confirmation) => `${confirmation.question} ${confirmation.answer}.`).join("\n"),
      inquiry.notes ?? "",
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0, 8000);
    const name = defaultBookingName(inquiry.clients);
    const created = await runCrmCommand(
      "createProject",
      {
        name,
        eventType: inquiry.eventType,
        eventKind: inquiry.eventTypeId,
        eventTypeKey: null,
        eventTypeId: inquiry.eventTypeId,
        ...(celebrates
          ? {
              honoreeName: inquiry.honoreeName ?? null,
              ...(variantField ? { [variantField]: inquiry.kindVariant ?? null } : {}),
            }
          : {}),
        eventDate: inquiry.eventDate,
        timezone: inquiry.timezone,
        clientContactIds: contactIds,
        leadPhotographerId: null,
        leadId: null,
        venueName: inquiry.venueName,
        city: inquiry.city,
        venue: null,
        sourceMessage: { text, summary: null, occasion: null },
      },
      { idempotencyKey: `sheet-inquiry-${row.batchId}-${row.row}` },
    );
    if (!created.persisted) return null;
    return { projectId: String(created.result.projectId ?? ""), name };
  }

  async function importSelected() {
    setPhase("importing");
    setProblem("");
    // A failed row stays ticked, so pressing the button again retries it.
    const set = (rowNumber: number, result: RowResult) =>
      setRows((prior) =>
        prior.map((row) => (row.row === rowNumber ? { ...row, result, selected: result.kind === "failed" ? null : false } : row)),
      );
    // Held rows the studio chose to leave out stop waiting.
    for (const row of rows) {
      if (!row.result && row.draftId && viewOf(row).kind === "skip") {
        await resolveImportDraft(row.draftId, "skipped").catch(() => null);
        set(row.row, { kind: "left_out" });
      }
    }
    const chosen = rows.filter((row) => {
      const view = row.result?.kind === "failed" ? viewOf({ ...row, result: null }) : viewOf(row);
      return (view.kind === "ready" || view.kind === "inquiry") && (row.result?.kind === "failed" ? row.selected !== false : selectedOf(row, view));
    });
    for (const target of chosen) {
      const view = viewOf({ ...target, result: null });
      set(target.row, { kind: "importing" });
      try {
        if (view.kind === "inquiry") {
          const created = await createInquiry(target, view.inquiry, view.confirmations);
          set(target.row, created ? { kind: "imported", ...created, as: "inquiry" } : { kind: "failed", message: "Development preview: nothing was imported." });
        } else if (view.kind === "ready") {
          const imported = await importExistingBooking({
            booking: view.booking,
            source: "spreadsheet",
            batchId: target.batchId,
            signedCopy: null,
            // Stable for this sheet and this booking, so pressing Import again
            // after a failure never imports the same wedding twice.
            idempotencyKey: `sheet-${target.batchId}-${target.row}`,
          });
          if (imported.mode === "live" && imported.result.crew?.assigned) {
            const crew = imported.result.crew;
            setCrewBooked((prior) => ({
              assigned: prior.assigned + crew.assigned,
              added: [...prior.added, ...crew.addedToRoster.map((person) => person.name).filter((name) => !prior.added.includes(name))],
            }));
          }
          set(
            target.row,
            imported.mode === "live"
              ? { kind: "imported", projectId: imported.result.projectId, name: imported.result.name, as: "booking" }
              : { kind: "failed", message: "Development preview: nothing was imported." },
          );
        }
        if (target.draftId) await resolveImportDraft(target.draftId, "imported").catch(() => null);
      } catch (caught: unknown) {
        set(target.row, { kind: "failed", message: friendlyError(caught, "This booking couldn't be imported.") });
      }
    }
    refreshTenantRecords("projects", "crewProfiles", "contacts", "importDrafts");
    setPhase("finished");
  }

  /** "Already here" → Update it: fill in the job from the sheet. */
  async function updateJob(row: Row, view: Extract<RowView, { kind: "duplicate" }>) {
    if (!view.plan || !view.booking) return;
    const settled = applyImportUpdate(view.plan, view.booking, row.answers);
    if ("open" in settled) return;
    setBusyRow(row.row);
    setProblem("");
    try {
      const sent = await updateImportedBooking({
        projectId: view.projectId,
        changes: settled.changes,
        confirmations: settled.confirmations,
        idempotencyKey: `sheet-update-${row.batchId}-${row.row}`,
      });
      if (sent.mode === "preview") {
        setProblem("Development preview: nothing was changed.");
        return;
      }
      const { result } = sent;
      setRows((prior) =>
        prior.map((candidate) =>
          candidate.row === row.row
            ? { ...candidate, result: { kind: "updated", projectId: result.projectId, name: result.name, updated: result.updated } }
            : candidate,
        ),
      );
      if (result.crew.assigned)
        setCrewBooked((prior) => ({
          assigned: prior.assigned + result.crew.assigned,
          added: [...prior.added, ...result.crew.addedToRoster.map((person) => person.name).filter((name) => !prior.added.includes(name))],
        }));
      if (row.draftId) await resolveImportDraft(row.draftId, "imported").catch(() => null);
      refreshTenantRecords("projects", "packageSnapshots", "crewProfiles", "crewAssignments");
    } catch (caught: unknown) {
      setProblem(friendlyError(caught, `${view.name} couldn't be updated.`));
    } finally {
      setBusyRow(null);
    }
  }

  /** Keep the rows still asking, so they wait on Today. */
  async function keepForLater() {
    const waiting = rows.filter((row) => viewOf(row).kind === "questions");
    if (!waiting.length) return;
    setProblem("");
    try {
      // Grouped by the batch each was read in, so a held row keeps its own.
      const batches = new Map<string, Row[]>();
      for (const row of waiting) batches.set(row.batchId, [...(batches.get(row.batchId) ?? []), row]);
      for (const [id, group] of batches) {
        const held = await holdImportRows({
          batchId: id,
          fileName: fileName.slice(0, 200),
          rows: group.map((row) => ({
            row: row.row,
            label: row.label.slice(0, 200),
            candidate: row.candidate as unknown as Record<string, unknown>,
            answers: row.answers,
          })),
        });
        if (held.mode === "preview") {
          setProblem("Development preview: nothing was kept.");
          return;
        }
      }
      const kept = new Set(waiting.map((row) => row.row));
      setRows((prior) => prior.map((row) => (kept.has(row.row) ? { ...row, result: { kind: "held" } } : row)));
      refreshTenantRecords("importDrafts");
    } catch (caught: unknown) {
      setProblem(friendlyError(caught, "Those rows couldn't be kept for later."));
    }
  }

  const views = rows.map((row) => ({ row, view: viewOf(row) }));
  const counts = views.reduce(
    (tally, { view }) => {
      tally[view.kind] = (tally[view.kind] ?? 0) + 1;
      return tally;
    },
    {} as Record<string, number>,
  );
  const chosen = views.filter(({ row, view }) =>
    view.kind === "failed" ? row.selected !== false : (view.kind === "ready" || view.kind === "inquiry") && selectedOf(row, view),
  );
  // A failed row is what it was before it failed.
  const chosenKind = ({ row, view }: { row: Row; view: RowView }) => (view.kind === "failed" ? viewOf({ ...row, result: null }).kind : view.kind);
  const selectedCount = chosen.length;
  const chosenBookings = chosen.filter((entry) => chosenKind(entry) === "ready").length;
  const chosenInquiries = chosen.filter((entry) => chosenKind(entry) === "inquiry").length;
  const retries = chosen.filter(({ view }) => view.kind === "failed").length;
  const waitingCount = counts.questions ?? 0;
  const mapped = spreadsheetFields.filter((field) => columns[field] !== undefined).length;
  const importedRows = views.filter(({ view }) => view.kind === "imported");
  const importedJobs = importedRows.filter(({ view }) => view.kind === "imported" && view.as === "booking").length;
  const importedInquiries = importedRows.length - importedJobs;
  const owedOnImport = importedRows.filter(({ row }) => {
    const view = viewOf({ ...row, result: null });
    return view.kind === "ready" && (view.booking.retainerOwedCents ?? 0) > 0;
  }).length;

  const importLabel = (() => {
    if (retries) return `Try ${selectedCount} again`;
    const parts = [
      chosenBookings ? `${chosenBookings} booking${chosenBookings === 1 ? "" : "s"}` : "",
      chosenInquiries ? `${chosenInquiries} inquir${chosenInquiries === 1 ? "y" : "ies"}` : "",
    ].filter(Boolean);
    return `Import ${parts.join(" and ")}`;
  })();

  return (
    <section className="panel booking-import-panel">
      <header>
        <h2>A spreadsheet of bookings</h2>
        <p>
          Export your clients from HoneyBook, Dubsado, Studio Ninja or wherever you keep them, as
          Excel or CSV — upcoming jobs and past ones. Nothing is imported until you&rsquo;ve reviewed
          every row.
        </p>
      </header>

      {/* Rows kept for later wait here, and on Today, until they're answered. */}
      {phase === "empty" && drafts.length ? (
        <div className="sheet-import-held" id="held-rows">
          <Clock size={15} aria-hidden="true" />
          <span>
            <strong>
              {`${drafts.length} row${drafts.length === 1 ? " is" : "s are"} waiting for your answer`}
            </strong>
            <small>{drafts.map((draft) => String(draft.label ?? "")).filter(Boolean).slice(0, 4).join(" · ")}</small>
          </span>
          <button className="button button-dark button-sm" onClick={() => void resumeDrafts()} type="button">
            Answer them
          </button>
        </div>
      ) : null}

      <div className="sheet-import-pick">
        <label className="button button-light">
          <FileSpreadsheet size={15} aria-hidden="true" />
          {fileName ? "Choose a different file" : "Choose a spreadsheet"}
          <input
            accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sheet-import-file"
            disabled={phase === "checking" || phase === "importing"}
            onChange={(event) => {
              void load(event.target.files?.[0]);
              event.target.value = "";
            }}
            type="file"
          />
        </label>
        <a className="sheet-import-template" download="studiocue-bookings-template.csv" href={templateHref}>
          <Download size={14} aria-hidden="true" /> Download a template
        </a>
        {fileName && cells.length ? <small>{fileName} · {cells.length} row{cells.length === 1 ? "" : "s"}</small> : null}
      </div>
      {tooMany ? (
        <p className="booking-import-issue">
          <CircleAlert size={14} aria-hidden="true" />
          <span>
            Only the first {MAX_ROWS} rows are read. Import these, then split the remaining {tooMany}{" "} into
            another file.
          </span>
        </p>
      ) : null}

      {(phase === "mapping" || phase === "checking") && cells.length ? (
        <div className="sheet-import-mapping">
          <p className="booking-import-summary">
            StudioCue matched {mapped} column{mapped === 1 ? "" : "s"}. Check them — change any that
            are wrong, and leave out what the sheet doesn&rsquo;t have.
          </p>
          <div className="sheet-import-columns">
            {spreadsheetFields.map((field) => (
              <label key={field}>
                {spreadsheetFieldLabel(field, trade)}
                <select
                  onChange={(event) =>
                    setColumns((prior) => {
                      const next = { ...prior };
                      if (event.target.value === "") delete next[field];
                      else next[field] = Number(event.target.value);
                      return next;
                    })
                  }
                  value={columns[field] ?? ""}
                >
                  <option value="">Not in the sheet</option>
                  {headers.map((header, index) => (
                    <option key={`${header}-${index}`} value={index}>
                      {header || `Column ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {/* The crew, read by role from each column's header and by its cells:
              names say who worked, a number how many, Yes one (2026-10-26). */}
          <div className="sheet-import-crew">
            <strong>Crew</strong>
            {crewColumns.length ? (
              <ul>
                {crewColumns.map((column) => (
                  <li key={column.index}>
                    <span>
                      {headers[column.index] || `Column ${column.index + 1}`}
                      <small>
                        {column.kind === "names"
                          ? "names: who worked each job"
                          : column.kind === "flag"
                            ? "yes/no: one when yes"
                            : column.kind === "count"
                              ? "a number: how many"
                              : column.kind === "empty"
                                ? "empty"
                                : "names or numbers"}
                        {column.extra ? ", added to the count" : ""}
                      </small>
                    </span>
                    <select
                      aria-label={`What ${headers[column.index] || "this column"} is`}
                      onChange={(event) =>
                        setCrewColumns((prior) =>
                          event.target.value === ""
                            ? prior.filter((candidate) => candidate.index !== column.index)
                            : prior.map((candidate) =>
                                candidate.index === column.index ? { ...candidate, role: event.target.value as CrewRole } : candidate,
                              ),
                        )
                      }
                      value={column.role}
                    >
                      {roles.map((role) => (
                        <option key={role} value={role}>
                          {importedCrewRoleLabels[role]}
                        </option>
                      ))}
                      <option value="">Not crew</option>
                    </select>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No crew columns found, so each job gets one {importedCrewRoleLabels[roles[0]!].toLowerCase()} unless the team size says more.</p>
            )}
            {unused.length ? (
              <label>
                Also crew:
                <select
                  onChange={(event) => {
                    const index = Number(event.target.value);
                    if (Number.isNaN(index) || event.target.value === "") return;
                    // A column the headers didn't name as crew: the studio's own role,
                    // read by what its cells hold. The role can be changed above.
                    setCrewColumns((prior) => [
                      ...prior,
                      { index, role: roles[0]!, extra: false, kind: cellKind(cells.map((rowCells) => String(rowCells[index] ?? ""))) },
                    ]);
                  }}
                  value=""
                >
                  <option value="">Pick a column…</option>
                  {unused.map((index) => (
                    <option key={index} value={index}>
                      {headers[index] || `Column ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {unused.length ? (
            <label className="sheet-import-quickbooks">
              <input checked={keepUnused} onChange={(event) => setKeepUnused(event.target.checked)} type="checkbox" />
              <span>
                Keep the other columns in each job&rsquo;s notes
                <small>{unused.map((index) => headers[index]).join(", ")}</small>
              </span>
            </label>
          ) : null}
          {passedRows ? (
            <label className="sheet-import-past">
              {`${passedRows} job${passedRows === 1 ? "'s" : "s'"} date has passed, and the sheet doesn't say where ${passedRows === 1 ? "it is" : "they are"}. They're:`}
              <select onChange={(event) => setPastState(event.target.value as ImportableBookingState)} value={pastState}>
                {pastImportStates
                  .filter((state) => delivers || !deliveryImportStates.includes(state))
                  .map((state) => (
                    <option key={state} value={state}>
                      {importStateLabels[state]}
                    </option>
                  ))}
              </select>
            </label>
          ) : null}
          <label className="sheet-import-quickbooks">
            <input
              checked={useQuickBooks}
              onChange={(event) => setUseQuickBooks(event.target.checked)}
              type="checkbox"
            />
            <span>
              Take what&rsquo;s been paid from QuickBooks instead of the sheet
              <small>Matched by each client&rsquo;s email. Read only — nothing is changed in QuickBooks.</small>
            </span>
          </label>
          <button className="button button-dark" disabled={phase === "checking"} onClick={() => void check()} type="button">
            {phase === "checking" ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}
            {phase === "checking" ? "Checking…" : `Check ${cells.length} booking${cells.length === 1 ? "" : "s"}`}
          </button>
        </div>
      ) : null}

      {phase === "checking" && !cells.length ? (
        <p className="booking-import-summary">
          <LoaderCircle className="spin" size={15} aria-hidden="true" /> Checking…
        </p>
      ) : null}

      {rows.length && (phase === "reviewing" || phase === "importing" || phase === "finished") ? (
        <div className="sheet-import-review">
          <p className="booking-import-summary">
            {[
              waitingCount ? `${waitingCount} need${waitingCount === 1 ? "s" : ""} an answer` : "",
              counts.ready ? `${counts.ready} ready` : "",
              counts.inquiry ? `${counts.inquiry} to add as inquir${counts.inquiry === 1 ? "y" : "ies"}` : "",
              counts.imported ? `${counts.imported} imported` : "",
              counts.updated ? `${counts.updated} updated` : "",
              counts.duplicate ? `${counts.duplicate} already in StudioCue` : "",
              (counts.problems ?? 0) + (counts.blocked ?? 0)
                ? `${(counts.problems ?? 0) + (counts.blocked ?? 0)} need fixing in the sheet`
                : "",
              counts.held ? `${counts.held} kept for later` : "",
              (counts.skip ?? 0) + (counts.left_out ?? 0) ? `${(counts.skip ?? 0) + (counts.left_out ?? 0)} left out` : "",
              counts.failed ? `${counts.failed} failed` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <ul className="sheet-import-rows">
            {views.map(({ row, view }) => {
              const selectable = view.kind === "ready" || view.kind === "inquiry" || view.kind === "failed";
              const checked = view.kind === "failed" ? row.selected !== false : selectable && selectedOf(row, view);
              const questions = questionsShown(row);
              // The booking as answered, once it is: "$3,000 owed", not the sheet's "paid".
              const answered = row.candidate ? applyImportAnswers(row.candidate, row.answers, words) : null;
              const showing =
                answered?.kind === "booking" ? answered.booking : row.candidate?.kind === "booking" ? row.candidate.booking : null;
              return (
                <li className={`sheet-import-row is-${view.kind}`} key={row.row}>
                  <label className="sheet-import-row-main">
                    <input
                      aria-label={`Import ${row.label}`}
                      checked={checked}
                      disabled={!selectable || phase === "importing"}
                      onChange={(event) =>
                        setRows((prior) =>
                          prior.map((candidate) =>
                            candidate.row === row.row ? { ...candidate, selected: event.target.checked } : candidate,
                          ),
                        )
                      }
                      type="checkbox"
                    />
                    <span>
                      <strong>{row.label}</strong>
                      {showing ? (
                        <small>
                          {importStateLabels[showing.state]} · {crewLine(showing)} · {money(showing.totalCents)} · paid {money(paidOf(showing))}
                          {showing.retainerOwedCents ? ` · ${money(showing.retainerOwedCents)} owed` : ""} · row {row.row}
                        </small>
                      ) : row.candidate?.kind === "inquiry" ? (
                        <small>
                          Not signed yet{row.candidate.inquiry.quotedCents ? ` · ${money(row.candidate.inquiry.quotedCents)} quoted` : ""} · row {row.row}
                        </small>
                      ) : (
                        <small>row {row.row}</small>
                      )}
                    </span>
                    <em>
                      {view.kind === "importing" ? <LoaderCircle className="spin" size={13} aria-hidden="true" /> : null}
                      {
                        {
                          ready: "Ready",
                          inquiry: "Inquiry",
                          questions: "Needs an answer",
                          imported: "Imported",
                          updated: "Updated",
                          duplicate: "Already here",
                          importing: "Importing",
                          failed: "Failed",
                          held: "Kept for later",
                          skip: "Left out",
                          left_out: "Left out",
                          blocked: "Needs fixing",
                          problems: "Needs fixing",
                        }[view.kind]
                      }
                    </em>
                  </label>

                  {/* What the row says against itself, as questions. Answered
                      ones stay, so an answer can be changed before import. */}
                  {questions.length ? (
                    <div className="sheet-import-questions">
                      {questions.map((question) => {
                        const key = questionKey(question);
                        const offer =
                          lastAnswer?.row === row.row && lastAnswer.key === key ? rowsLike(key, row.row) : [];
                        return (
                          <fieldset className="sheet-import-question" key={question.id}>
                            <legend>{question.prompt}</legend>
                            <div className="sheet-import-answers">
                              {question.options.map((option) => (
                                <button
                                  aria-pressed={row.answers[question.id] === option.id}
                                  className={`button button-sm ${row.answers[question.id] === option.id ? "button-dark" : "button-light"}`}
                                  disabled={phase === "importing"}
                                  key={option.id}
                                  onClick={() => answer(row.row, question, option.id)}
                                  type="button"
                                >
                                  {option.label}
                                </button>
                              ))}
                            </div>
                            {offer.length ? (
                              <button
                                className="sheet-import-same"
                                onClick={() => answerAllLike(key, lastAnswer!.option, row.row)}
                                type="button"
                              >
                                {`Same answer for the ${offer.length} other${offer.length === 1 ? "" : "s"} like this`}
                              </button>
                            ) : null}
                          </fieldset>
                        );
                      })}
                    </div>
                  ) : null}

                  {view.kind === "problems" || view.kind === "blocked" ? (
                    <ul className="sheet-import-detail">
                      {view.messages.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  ) : null}
                  {/* Everything this row will import, where it came from, and
                      what was filled in because the sheet didn't say. */}
                  {row.candidate && !row.result && view.kind !== "duplicate" && view.kind !== "skip" ? (
                    <details className="sheet-import-detail sheet-import-read">
                      <summary>What StudioCue read</summary>
                      <dl>
                        {readFacts(row, view).map((fact) => (
                          <div key={fact.label}>
                            <dt>{fact.label}</dt>
                            <dd>
                              {fact.value}
                              {fact.assumed ? <em> assumed</em> : fact.source ? <small> from {fact.source}</small> : null}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {phase !== "importing" && row.candidate.kind === "booking" ? (
                        <button className="button button-light button-sm" onClick={() => setFixing(row)} type="button">
                          <PencilLine size={14} aria-hidden="true" /> Fix and import this one
                        </button>
                      ) : null}
                    </details>
                  ) : null}
                  {view.kind === "ready" && (view.warnings.length || row.notes.length) ? (
                    <details className="sheet-import-detail">
                      <summary>
                        {`${view.warnings.length + notesFor(row, view).length} ${view.warnings.length + notesFor(row, view).length === 1 ? "thing" : "things"} to know`}
                      </summary>
                      <ul>
                        {[...view.warnings, ...notesFor(row, view)].map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {view.kind === "duplicate" ? (
                    <UpdateFromSheet
                      busy={busyRow === row.row}
                      onAnswer={(question, option) => answer(row.row, question, option)}
                      onUpdate={() => void updateJob(row, view)}
                      row={row}
                      view={view}
                    />
                  ) : null}
                  {view.kind === "imported" || view.kind === "updated" ? (
                    <p className="sheet-import-detail">
                      <Link href={`/studio/projects/${view.projectId}`}>Open {view.name}</Link>
                      {view.kind === "imported" && view.as === "inquiry" ? " · added as an inquiry" : ""}
                      {view.kind === "updated" ? (view.updated.length ? ` · added ${view.updated.join(", ")}` : " · nothing new to add") : ""}
                    </p>
                  ) : null}
                  {view.kind === "held" ? (
                    <p className="sheet-import-detail">Waiting on Today until you answer.</p>
                  ) : null}
                  {view.kind === "failed" ? <p className="sheet-import-detail">{view.message}</p> : null}
                </li>
              );
            })}
          </ul>
          <div className="booking-import-actions">
            {/* Nothing left to bring in: no button, rather than "Import 0
                bookings" under the rows just imported (prod walk, 2026-10-23). */}
            {phase === "importing" || selectedCount > 0 ? (
              <button
                className="button button-dark"
                disabled={phase === "importing"}
                onClick={() => void importSelected()}
                type="button"
              >
                {phase === "importing" ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}
                {phase === "importing" ? "Importing…" : importLabel}
              </button>
            ) : null}
            {waitingCount && phase !== "importing" ? (
              <button className="button button-light" onClick={() => void keepForLater()} type="button">
                {`Keep ${waitingCount} for later`}
              </button>
            ) : null}
            {phase !== "importing" && cells.length ? (
              <button className="button button-light" onClick={() => setPhase("mapping")} type="button">
                Change columns
              </button>
            ) : null}
          </div>
          {waitingCount && phase !== "importing" ? (
            <p className="booking-import-note">
              <Clock size={14} aria-hidden="true" />
              {`The ${waitingCount} row${waitingCount === 1 ? "" : "s"} still asking a question stay${waitingCount === 1 ? "s" : ""} out until you answer. ${selectedCount ? "Import the rest now, and keep" : "Keep"} ${waitingCount === 1 ? "it" : "them"} for later: ${waitingCount === 1 ? "it waits" : "they wait"} on Today.`}
            </p>
          ) : null}
          {phase === "finished" && importedRows.length ? (
            <p className="booking-import-note">
              <CircleCheck size={14} aria-hidden="true" />
              {[
                importedJobs
                  ? `${importedJobs} job${importedJobs === 1 ? " is" : "s are"} in StudioCue, all quiet: nothing has gone to any client or crew member. Bring each in from its job when you're ready.`
                  : "",
                importedInquiries
                  ? `${importedInquiries} ${importedInquiries === 1 ? "is" : "are"} on Inquiries, not signed yet. Nothing was sent to ${importedInquiries === 1 ? "them" : "any of them"}.`
                  : "",
                owedOnImport
                  ? `${owedOnImport} ${owedOnImport === 1 ? "has its" : "have their"} ${words.deposit} still owed: the job shows it as due, and you record it when it's paid.`
                  : "",
                crewBooked.assigned ? `${crewBooked.assigned} crew booked on their jobs.` : "",
                crewBooked.added.length
                  ? `${crewBooked.added.join(", ")} ${crewBooked.added.length === 1 ? "was" : "were"} added to your crew list without an invite; add an email to invite them.`
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {problem ? (
        <p className="form-error" role="alert">
          {problem}
        </p>
      ) : null}

      <SheetDialog label="Fix and import this job" onClose={() => setFixing(null)} open={fixing !== null} width="default">
        {fixing?.candidate?.kind === "booking"
          ? (() => {
              // The answered booking when its questions are settled: the
              // form carries what it has no field for (an owed retainer).
              const answered = applyImportAnswers(fixing.candidate, fixing.answers, words);
              const booking = answered.kind === "booking" ? answered.booking : fixing.candidate.booking;
              return (
                <ExistingBookingForm
                  carry={{
                    retainerOwedCents: booking.retainerOwedCents,
                    honoreeName: booking.honoreeName,
                    kindVariant: booking.kindVariant,
                    confirmations: booking.confirmations,
                  }}
                  compact
                  initial={formValuesFromBooking(booking)}
                  onImported={(result) => {
                    setRows((prior) =>
                      prior.map((row) =>
                        row.row === fixing.row
                          ? { ...row, result: { kind: "imported", projectId: result.projectId, name: result.name, as: "booking" }, selected: false }
                          : row,
                      ),
                    );
                    if (fixing.draftId) void resolveImportDraft(fixing.draftId, "imported").catch(() => null);
                    setCrewBooked((prior) => ({
                      assigned: prior.assigned + (result.crew?.assigned ?? 0),
                      added: [...prior.added, ...(result.crew?.addedToRoster ?? []).map((person) => person.name)],
                    }));
                  }}
                  source="spreadsheet"
                />
              );
            })()
          : null}
      </SheetDialog>
    </section>
  );
}

/** "Already here": what the sheet would add to the job, and Update it. */
function UpdateFromSheet({
  row,
  view,
  busy,
  onAnswer,
  onUpdate,
}: {
  row: Row;
  view: Extract<RowView, { kind: "duplicate" }>;
  busy: boolean;
  onAnswer: (question: ImportQuestion, option: string) => void;
  onUpdate: () => void;
}) {
  const plan = view.plan;
  const adds = plan && (plan.filled.length || plan.conflicts.length);
  const open = plan && view.booking ? "open" in applyImportUpdate(plan, view.booking, row.answers) : true;
  return (
    <div className="sheet-import-detail sheet-import-update">
      <p>
        Already in StudioCue: <Link href={`/studio/projects/${view.projectId}`}>open {view.name}</Link>
        {plan && !adds ? ". The sheet has nothing to add to it." : "."}
      </p>
      {adds ? (
        <>
          {plan!.filled.length ? <p>{`The sheet has the ${plan!.filled.join(", ")} this job doesn't.`}</p> : null}
          {plan!.conflicts.map((question) => (
            <fieldset className="sheet-import-question" key={question.id}>
              <legend>{question.prompt}</legend>
              <div className="sheet-import-answers">
                {question.options.map((option) => (
                  <button
                    aria-pressed={row.answers[question.id] === option.id}
                    className={`button button-sm ${row.answers[question.id] === option.id ? "button-dark" : "button-light"}`}
                    key={option.id}
                    onClick={() => onAnswer(question, option.id)}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <button className="button button-light button-sm" disabled={open || busy} onClick={onUpdate} type="button">
            {busy ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
            {`Update ${view.name}`}
          </button>
        </>
      ) : null}
      {plan?.moneyNote ? <p>{plan.moneyNote}</p> : null}
    </div>
  );
}

/** The row's notes, less any an answer has made untrue. */
function notesFor(row: Row, view: Extract<RowView, { kind: "ready" }>): string[] {
  return view.booking.payments.length ? row.notes : row.notes.filter((note) => !note.startsWith("No payment date in the sheet"));
}

type ReadFact = { label: string; value: string; source?: string; assumed?: boolean };

/** A row as the facts a studio checks, with where each came from. */
function readFacts(row: Row, view: RowView): ReadFact[] {
  if (row.candidate?.kind === "inquiry" || view.kind === "inquiry") {
    const inquiry = view.kind === "inquiry" ? view.inquiry : (row.candidate as { inquiry: SpreadsheetInquiry }).inquiry;
    return [
      { label: "Client", value: inquiry.clients.map((client) => `${client.firstName} ${client.lastName}${client.email ? ` · ${client.email}` : client.phone ? ` · ${client.phone}` : ""}`).join(" & "), source: row.sources.client },
      { label: "Kind of job", value: inquiry.eventType },
      ...(inquiry.honoreeName ? [{ label: "Celebrating", value: inquiry.honoreeName, source: row.sources.honoree }] : []),
      { label: "Date", value: inquiry.eventDate },
      { label: "Venue", value: [inquiry.venueName, inquiry.city].filter(Boolean).join(", ") || "Not in the sheet" },
      ...(inquiry.packageName ? [{ label: "Package", value: inquiry.packageName }] : []),
      ...(inquiry.quotedCents ? [{ label: "Quoted", value: money(inquiry.quotedCents) }] : []),
      ...(inquiry.notes ? [{ label: "Notes", value: inquiry.notes.replace(/\n+/g, " · ") }] : []),
    ];
  }
  const booking = view.kind === "ready" ? view.booking : (row.candidate as { booking: ExistingBooking }).booking;
  const assumed = new Set(booking.assumed ?? []);
  const paid = paidOf(booking);
  return [
    { label: "Client", value: booking.clients.map((client) => `${client.firstName} ${client.lastName}${client.email ? ` · ${client.email}` : client.phone ? ` · ${client.phone}` : ""}`).join(" & "), source: row.sources.client },
    { label: "Where it is", value: importStateLabels[booking.state], source: row.sources.status, assumed: assumed.has("state") },
    // The kind of job on its own line, so "assumed" is clearly about it and
    // not the date or start time beside it (prod walk, 2026-10-26).
    { label: "Kind of job", value: booking.eventType, assumed: assumed.has("eventType") },
    ...(booking.honoreeName ? [{ label: "Celebrating", value: booking.honoreeName, source: row.sources.honoree }] : []),
    { label: "Date", value: `${booking.eventDate}${booking.startTime ? ` · starts ${booking.startTime}` : ""}` },
    { label: "Crew", value: crewLine(booking), source: row.sources.crew, assumed: assumed.has("crew") },
    { label: "Hours", value: String(booking.coverageMinutes / 60), source: row.sources.hours, assumed: assumed.has("coverageMinutes") },
    { label: "Package", value: booking.packageName, assumed: assumed.has("packageName") },
    { label: "Venue", value: [booking.venueName, booking.city].filter(Boolean).join(", ") || "Not in the sheet" },
    {
      label: "Money",
      value: `${money(booking.totalCents)} total · ${money(paid)} paid${booking.retainerOwedCents ? ` · ${money(booking.retainerOwedCents)} still owed` : ""}`,
    },
    ...(booking.payments[0]
      ? [{ label: "Paid on", value: assumed.has("paidOn") ? `${booking.payments[0].paidOn} (the signing date)` : booking.payments[0].paidOn, assumed: assumed.has("paidOn") }]
      : []),
    ...(booking.galleryUrl ? [{ label: "Delivery link", value: booking.galleryUrl }] : []),
    ...(booking.notes ? [{ label: "Notes", value: booking.notes.replace(/\n+/g, " · ") }] : []),
  ];
}
