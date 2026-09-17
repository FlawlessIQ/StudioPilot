"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  CircleAlert,
  CircleCheck,
  Download,
  FileSpreadsheet,
  LoaderCircle,
} from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import type { ExistingBooking } from "@/features/imports/existing-booking";
import {
  bookingFromSpreadsheetRow,
  detectColumns,
  parseCsv,
  spreadsheetFieldLabels,
  spreadsheetFields,
  spreadsheetTemplateCsv,
  type SpreadsheetField,
} from "@/features/imports/spreadsheet";
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
  status: RowStatus | null;
  selected: boolean;
};

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

  const templateHref = useMemo(
    () => `data:text/csv;charset=utf-8,${encodeURIComponent(spreadsheetTemplateCsv)}`,
    [],
  );

  async function load(file: File | undefined) {
    if (!file) return;
    setProblem("");
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      setProblem("That file has no rows under its header. Export again, or start from the template.");
      return;
    }
    const [head, ...body] = parsed;
    setFileName(file.name);
    setHeaders(head!);
    setCells(body.slice(0, MAX_ROWS));
    setTooMany(Math.max(0, body.length - MAX_ROWS));
    setColumns(detectColumns(head!));
    setBatchId(crypto.randomUUID());
    setRows([]);
    setPhase("mapping");
  }

  function readRows(): Row[] {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return cells.map((rowCells, index) => {
      const result = bookingFromSpreadsheetRow({ row: index + 2, cells: rowCells, columns, timezone });
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
          Export your booked clients from HoneyBook, Dubsado, Studio Ninja or wherever
          you keep them, as CSV. Nothing is imported until you&rsquo;ve reviewed every row.
        </p>
      </header>

      <div className="sheet-import-pick">
        <label className="button button-light">
          <FileSpreadsheet size={15} aria-hidden="true" />
          {fileName ? "Choose a different file" : "Choose a CSV file"}
          <input
            accept=".csv,text/csv"
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
            Only the first {MAX_ROWS} rows are read. Import these, then split the remaining {tooMany} into
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
                {spreadsheetFieldLabels[field]}
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
                          {money(row.booking.totalCents)} · paid{" "}
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
                  {status?.kind === "ready" && (status.warnings.length || row.notes.length) ? (
                    <details className="sheet-import-detail">
                      <summary>
                        {status.warnings.length + row.notes.length} thing
                        {status.warnings.length + row.notes.length === 1 ? "" : "s"} to know
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
            <button
              className="button button-dark"
              disabled={phase === "importing" || selectedCount === 0}
              onClick={() => void importSelected()}
              type="button"
            >
              {phase === "importing" ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : null}
              {phase === "importing"
                ? "Importing…"
                : failedRetryable && selectedCount
                  ? `Try ${selectedCount} again`
                  : `Import ${selectedCount} booking${selectedCount === 1 ? "" : "s"}`}
            </button>
            {phase !== "importing" ? (
              <button className="button button-light" onClick={() => setPhase("mapping")} type="button">
                Change columns
              </button>
            ) : null}
          </div>
          {phase === "finished" && counts.imported ? (
            <p className="booking-import-note">
              <CircleCheck size={14} aria-hidden="true" />
              {counts.imported} booking{counts.imported === 1 ? " is" : "s are"} in StudioCue, all quiet —
              nothing has gone to any couple. Bring each in from its job when you&rsquo;re ready.
            </p>
          ) : null}
        </div>
      ) : null}

      {problem ? (
        <p className="form-error" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
