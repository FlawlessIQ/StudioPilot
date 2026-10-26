"use client";

import { useWorkspace } from "@/features/auth/workspace-context";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CircleAlert,
  CircleCheck,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  PencilLine,
} from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { ExistingBookingForm, formValuesFromBooking } from "@/components/imports/existing-booking-form";
import { tradeProfile } from "@/features/trades/trades";
import {
  deliveryImportStates,
  importedCrewRoleLabels,
  importStateLabels,
  pastImportStates,
  type ExistingBooking,
  type ImportableBookingState,
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
} from "@/features/imports/spreadsheet";
import { cellKind, importCrewRoles, type CrewRole } from "@/features/imports/sheet-columns";
import { readXlsx } from "@/features/imports/xlsx";
import {
  applyQuickBooksPayments,
  type QuickBooksClientHistory,
} from "@/features/imports/quickbooks-prefill";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  importExistingBooking,
  lookupQuickBooksPayments,
  previewExistingBookings,
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
 */

const MAX_ROWS = 200;

type RowStatus =
  | { kind: "problems"; messages: string[] }
  | { kind: "duplicate"; projectId: string; name: string }
  | { kind: "blocked"; messages: string[] }
  | { kind: "ready"; warnings: string[] }
  | { kind: "importing" }
  | { kind: "imported"; projectId: string; name: string }
  | { kind: "failed"; message: string };

type Row = {
  row: number;
  label: string;
  booking: ExistingBooking | null;
  notes: string[];
  /** Which column each part came from, for the row's details. */
  sources: Partial<Record<string, string>>;
  status: RowStatus | null;
  selected: boolean;
};

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

function statusFromPreview(preview: ExistingBookingPreview): RowStatus {
  if (preview.alreadyImported)
    return {
      kind: "duplicate",
      projectId: preview.alreadyImported.projectId,
      name: preview.alreadyImported.name,
    };
  const errors = preview.issues.filter((issue) => issue.severity === "error");
  if (errors.length) return { kind: "blocked", messages: errors.map((issue) => issue.message) };
  return {
    kind: "ready",
    warnings: [
      ...preview.issues.filter((issue) => issue.severity === "warning").map((issue) => issue.message),
      ...(preview.sameDayBookings.length
        ? [`You already have ${preview.sameDayBookings.map((job) => job.name).join(" and ")} that day.`]
        : []),
    ],
  };
}

export function SpreadsheetBookingImport() {
  // The studio's trade names the crew columns (a DJ's "DJs") and says whether
  // there is a second one (spreadsheet.ts, spreadsheetFieldLabel).
  const trade = useWorkspace().tenantTrade;
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
  const roles = importCrewRoles(trade);
  const delivers = tradeProfile(trade).delivery;

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
      if ("problems" in result) {
        const name =
          [rowCells[columns.firstName ?? -1], rowCells[columns.lastName ?? -1]].filter(Boolean).join(" ") ||
          rowCells[columns.clientName ?? -1] ||
          `Row ${result.row}`;
        return {
          row: result.row,
          label: name,
          booking: null,
          notes: [],
          sources: {},
          status: { kind: "problems", messages: result.problems },
          selected: false,
        };
      }
      const booking = result.booking;
      return {
        row: result.row,
        label: `${booking.clients.map((client) => client.firstName).join(" & ")} ${booking.clients[0]!.lastName} · ${booking.eventDate}`,
        booking,
        notes: result.notes,
        sources: result.sources,
        status: null,
        selected: false,
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
    const emails = [
      ...new Set(
        read.flatMap((row) =>
          (row.booking?.clients ?? []).map((client) => client.email ?? "").filter(Boolean),
        ),
      ),
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
      if (!row.booking) return row;
      const applied = applyQuickBooksPayments(row.booking, histories);
      return { ...row, booking: applied.booking, notes: [...applied.notes, ...row.notes] };
    });
  }

  async function check() {
    setProblem("");
    let read = readRows();
    setRows(read);
    if (useQuickBooks) {
      setPhase("checking");
      read = await withQuickBooks(read);
      setRows(read);
    }
    const toCheck = read.filter((row) => row.booking);
    if (!toCheck.length) {
      setPhase("reviewing");
      return;
    }
    setPhase("checking");
    try {
      const statuses = new Map<number, RowStatus>();
      for (let start = 0; start < toCheck.length; start += 50) {
        const chunk = toCheck.slice(start, start + 50);
        const preview = await previewExistingBookings(chunk.map((row) => row.booking!));
        if (!preview) {
          setProblem("Development preview: bookings can't be imported here.");
          setPhase("mapping");
          return;
        }
        chunk.forEach((row, index) => statuses.set(row.row, statusFromPreview(preview.bookings[index]!)));
      }
      setRows(
        read.map((row) => {
          const status = statuses.get(row.row);
          return status ? { ...row, status, selected: status.kind === "ready" } : row;
        }),
      );
      setPhase("reviewing");
    } catch (caught: unknown) {
      setProblem(friendlyError(caught, "The spreadsheet couldn't be checked."));
      setPhase("mapping");
    }
  }

  async function importSelected() {
    setPhase("importing");
    setProblem("");
    const chosen = rows.filter((row) => row.selected && row.booking);
    for (const target of chosen) {
      setRows((prior) => prior.map((row) => (row.row === target.row ? { ...row, status: { kind: "importing" } } : row)));
      try {
        const imported = await importExistingBooking({
          booking: target.booking!,
          source: "spreadsheet",
          batchId,
          signedCopy: null,
          // Stable for this sheet and this booking, so pressing Import again
          // after a failure never imports the same wedding twice.
          idempotencyKey: `sheet-${batchId}-${target.row}`,
        });
        const status: RowStatus =
          imported.mode === "live"
            ? { kind: "imported", projectId: imported.result.projectId, name: imported.result.name }
            : { kind: "failed", message: "Development preview: nothing was imported." };
        if (imported.mode === "live" && imported.result.crew?.assigned) {
          const crew = imported.result.crew;
          setCrewBooked((prior) => ({
            assigned: prior.assigned + crew.assigned,
            added: [...prior.added, ...crew.addedToRoster.map((person) => person.name).filter((name) => !prior.added.includes(name))],
          }));
        }
        setRows((prior) =>
          prior.map((row) => (row.row === target.row ? { ...row, status, selected: false } : row)),
        );
      } catch (caught: unknown) {
        const message = friendlyError(caught, "This booking couldn't be imported.");
        setRows((prior) =>
          prior.map((row) =>
            row.row === target.row ? { ...row, status: { kind: "failed", message } } : row,
          ),
        );
      }
    }
    refreshTenantRecords("projects");
    refreshTenantRecords("crewProfiles");
    setPhase("finished");
  }

  const counts = rows.reduce(
    (tally, row) => {
      const kind = row.status?.kind ?? "problems";
      tally[kind] = (tally[kind] ?? 0) + 1;
      return tally;
    },
    {} as Record<string, number>,
  );
  const selectedCount = rows.filter((row) => row.selected).length;
  const failedRetryable = rows.filter((row) => row.status?.kind === "failed").length;
  const mapped = spreadsheetFields.filter((field) => columns[field] !== undefined).length;

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
        {fileName ? <small>{fileName} · {cells.length} row{cells.length === 1 ? "" : "s"}</small> : null}
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

      {phase === "mapping" || phase === "checking" ? (
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

      {rows.length && (phase === "reviewing" || phase === "importing" || phase === "finished") ? (
        <div className="sheet-import-review">
          <p className="booking-import-summary">
            {[
              counts.ready ? `${counts.ready} ready` : "",
              counts.imported ? `${counts.imported} imported` : "",
              counts.duplicate ? `${counts.duplicate} already in StudioCue` : "",
              (counts.problems ?? 0) + (counts.blocked ?? 0)
                ? `${(counts.problems ?? 0) + (counts.blocked ?? 0)} need fixing in the sheet`
                : "",
              counts.failed ? `${counts.failed} failed` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <ul className="sheet-import-rows">
            {rows.map((row) => {
              const status = row.status;
              const selectable = status?.kind === "ready" || status?.kind === "failed";
              return (
                <li className={`sheet-import-row is-${status?.kind ?? "problems"}`} key={row.row}>
                  <label className="sheet-import-row-main">
                    <input
                      aria-label={`Import ${row.label}`}
                      checked={row.selected}
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
                      {row.booking ? (
                        <small>
                          {importStateLabels[row.booking.state]} · {crewLine(row.booking)} · {money(row.booking.totalCents)} · paid{" "}
                          {money(row.booking.payments.reduce((sum, payment) => sum + payment.amountCents, 0))} · row {row.row}
                        </small>
                      ) : (
                        <small>row {row.row}</small>
                      )}
                    </span>
                    <em>
                      {status?.kind === "importing" ? (
                        <LoaderCircle className="spin" size={13} aria-hidden="true" />
                      ) : null}
                      {status?.kind === "ready"
                        ? "Ready"
                        : status?.kind === "imported"
                          ? "Imported"
                          : status?.kind === "duplicate"
                            ? "Already here"
                            : status?.kind === "importing"
                              ? "Importing"
                              : status?.kind === "failed"
                                ? "Failed"
                                : "Needs fixing"}
                    </em>
                  </label>
                  {status?.kind === "problems" || status?.kind === "blocked" ? (
                    <ul className="sheet-import-detail">
                      {status.messages.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                  ) : null}
                  {/* Everything this row will import, where it came from, and
                      what was filled in because the sheet didn't say. */}
                  {row.booking && status?.kind !== "imported" && status?.kind !== "duplicate" ? (
                    <details className="sheet-import-detail sheet-import-read">
                      <summary>What StudioCue read</summary>
                      <dl>
                        {readFacts(row).map((fact) => (
                          <div key={fact.label}>
                            <dt>{fact.label}</dt>
                            <dd>
                              {fact.value}
                              {fact.assumed ? <em> assumed</em> : fact.source ? <small> from {fact.source}</small> : null}
                            </dd>
                          </div>
                        ))}
                      </dl>
                      {phase !== "importing" ? (
                        <button className="button button-light button-sm" onClick={() => setFixing(row)} type="button">
                          <PencilLine size={14} aria-hidden="true" /> Fix and import this one
                        </button>
                      ) : null}
                    </details>
                  ) : null}
                  {status?.kind === "ready" && (status.warnings.length || row.notes.length) ? (
                    <details className="sheet-import-detail">
                      <summary>
                        {`${status.warnings.length + row.notes.length} ${status.warnings.length + row.notes.length === 1 ? "thing" : "things"} to know`}
                      </summary>
                      <ul>
                        {[...status.warnings, ...row.notes].map((message) => (
                          <li key={message}>{message}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {status?.kind === "duplicate" || status?.kind === "imported" ? (
                    <p className="sheet-import-detail">
                      <Link href={`/studio/projects/${status.projectId}`}>Open {status.name}</Link>
                    </p>
                  ) : null}
                  {status?.kind === "failed" ? <p className="sheet-import-detail">{status.message}</p> : null}
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
                {phase === "importing"
                  ? "Importing…"
                  : failedRetryable
                    ? `Try ${selectedCount} again`
                    : `Import ${selectedCount} booking${selectedCount === 1 ? "" : "s"}`}
              </button>
            ) : null}
            {phase !== "importing" ? (
              <button className="button button-light" onClick={() => setPhase("mapping")} type="button">
                Change columns
              </button>
            ) : null}
          </div>
          {phase === "finished" && counts.imported ? (
            <p className="booking-import-note">
              <CircleCheck size={14} aria-hidden="true" />
              {[
                `${counts.imported} job${counts.imported === 1 ? " is" : "s are"} in StudioCue, all quiet: nothing has gone to any client or crew member. Bring each in from its job when you're ready.`,
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
        {fixing?.booking ? (
          <ExistingBookingForm
            compact
            initial={formValuesFromBooking(fixing.booking)}
            onImported={(result) => {
              setRows((prior) =>
                prior.map((row) =>
                  row.row === fixing.row
                    ? { ...row, status: { kind: "imported", projectId: result.projectId, name: result.name }, selected: false }
                    : row,
                ),
              );
              setCrewBooked((prior) => ({
                assigned: prior.assigned + (result.crew?.assigned ?? 0),
                added: [...prior.added, ...(result.crew?.addedToRoster ?? []).map((person) => person.name)],
              }));
            }}
            source="spreadsheet"
          />
        ) : null}
      </SheetDialog>
    </section>
  );
}

type ReadFact = { label: string; value: string; source?: string; assumed?: boolean };

/** A row's booking as the facts a studio checks, with where each came from. */
function readFacts(row: Row): ReadFact[] {
  const booking = row.booking!;
  const assumed = new Set(booking.assumed ?? []);
  const paid = booking.payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  return [
    { label: "Client", value: booking.clients.map((client) => `${client.firstName} ${client.lastName}${client.email ? ` · ${client.email}` : client.phone ? ` · ${client.phone}` : ""}`).join(" & "), source: row.sources.client },
    { label: "Where it is", value: importStateLabels[booking.state], source: row.sources.status, assumed: assumed.has("state") },
    { label: "Event", value: `${booking.eventType} · ${booking.eventDate}${booking.startTime ? ` · starts ${booking.startTime}` : ""}`, assumed: assumed.has("eventType") },
    { label: "Crew", value: crewLine(booking), source: row.sources.crew, assumed: assumed.has("crew") },
    { label: "Hours", value: String(booking.coverageMinutes / 60), source: row.sources.hours, assumed: assumed.has("coverageMinutes") },
    { label: "Package", value: booking.packageName, assumed: assumed.has("packageName") },
    { label: "Venue", value: [booking.venueName, booking.city].filter(Boolean).join(", ") || "Not in the sheet" },
    { label: "Money", value: `${money(booking.totalCents)} total · ${money(paid)} paid${booking.payments[0] ? ` on ${booking.payments[0].paidOn}` : ""}`, assumed: assumed.has("paidOn") },
    ...(booking.galleryUrl ? [{ label: "Delivery link", value: booking.galleryUrl }] : []),
    ...(booking.notes ? [{ label: "Notes", value: booking.notes.replace(/\n+/g, " · ") }] : []),
  ];
}
