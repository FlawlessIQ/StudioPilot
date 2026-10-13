"use client";

import { useMemo, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { PARTNER_TYPE_LABELS } from "@/features/console/partner-payouts";
import {
  PARTNER_IMPORT_CHUNK,
  PARTNER_IMPORT_MAX,
  partnerImportFieldLabels,
  partnerImportTemplateCsv,
  planPartnerImport,
  type ExistingPartner,
  type PartnerImportField,
} from "@/features/console/partner-import";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runConsoleCommand } from "@/lib/console/command-client";
import { downloadCsv } from "@/lib/console/studio-display";
import { Drawer } from "../overlay";
import { Button, Notice, Pill, Tag } from "../ui";

/**
 * Partner codes from a spreadsheet (features/console/partner-import.ts):
 * pick the CSV, see every row's code before anything is made, make them all,
 * then download the file back with each partner's signup link.
 */

type Result = { index: number; partnerId?: string; code?: string; skipped?: string; error?: string };

export function PartnerImportDrawer({ existing, onClose, onDownload }: { existing: ExistingPartner[]; onClose: () => void; onDownload: (codes: string[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [finished, setFinished] = useState<{ made: string[]; already: string[]; failed: Array<{ label: string; error: string }> } | null>(null);
  // Existing partners are read once, when the file is picked: the codes this run makes must not make the plan think they were already there.
  const [known, setKnown] = useState<ExistingPartner[]>(existing);
  const plan = useMemo(() => (file ? planPartnerImport(file.text, known) : null), [file, known]);
  const ready = plan?.rows.flatMap((row) => (row.status === "ready" ? [{ line: row.line, partner: row.partner }] : [])) ?? [];
  const exists = plan?.rows.filter((row) => row.status === "exists") ?? [];
  const problems = plan?.rows.filter((row) => row.status === "problem") ?? [];
  const noName = plan && plan.columns.name === undefined && plan.columns.firstName === undefined && plan.columns.business === undefined;

  const pick = async (picked: File | undefined) => {
    if (!picked) return;
    setFinished(null);
    setKnown(existing);
    setFile({ name: picked.name, text: await picked.text() });
  };

  const make = async () => {
    const made: string[] = [];
    const already = exists.flatMap((row) => (row.status === "exists" ? [row.code] : []));
    const failed: Array<{ label: string; error: string }> = [];
    setRunning({ done: 0, total: ready.length });
    for (let start = 0; start < ready.length; start += PARTNER_IMPORT_CHUNK) {
      const chunk = ready.slice(start, start + PARTNER_IMPORT_CHUNK);
      try {
        const { results } = await runConsoleCommand<{ results: Result[] }>("createPartners", { partners: chunk.map((row) => row.partner) });
        for (const result of results) {
          const row = chunk[result.index]!;
          if (result.partnerId && result.code) made.push(result.code);
          else if (result.skipped && result.code) already.push(result.code);
          else failed.push({ label: `Row ${row.line}: ${row.partner.business || row.partner.name} (${row.partner.code})`, error: friendlyError(new Error(result.error ?? "FAILED"), "Not made.") });
        }
      } catch (caught) {
        for (const row of chunk) failed.push({ label: `Row ${row.line}: ${row.partner.business || row.partner.name}`, error: friendlyError(caught, "Not made.") });
      }
      setRunning({ done: Math.min(start + chunk.length, ready.length), total: ready.length });
    }
    setRunning(null);
    setFinished({ made, already, failed });
  };

  const detected = plan
    ? (Object.entries(plan.columns) as Array<[PartnerImportField, number]>).map(([field, index]) => `${partnerImportFieldLabels[field]} ← "${plan.header[index]}"`).join(" · ")
    : "";

  return (
    <Drawer
      footer={
        finished ? (
          <>
            <Button disabled={!finished.made.length && !finished.already.length} onClick={() => onDownload([...finished.made, ...finished.already])} variant="primary">
              <Download size={13} /> Download the file
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : !ready.length && exists.length ? (
          <Button onClick={() => onDownload(exists.flatMap((row) => (row.status === "exists" ? [row.code] : [])))} variant="primary">
            <Download size={13} /> {`Download these ${exists.length}`}
          </Button>
        ) : (
          <Button busy={Boolean(running)} disabled={!ready.length || plan?.tooMany || Boolean(noName)} onClick={() => void make()} variant="primary">
            {running ? `Making codes… ${running.done} of ${running.total}` : `Make ${ready.length} ${ready.length === 1 ? "code" : "codes"}`}
          </Button>
        )
      }
      onClose={running ? () => undefined : onClose}
      open
      title="Import partners"
      wide
    >
      <div className="cx-form">
        {finished ? (
          <>
            <Notice title={`${finished.made.length} ${finished.made.length === 1 ? "code" : "codes"} made`} tone={finished.failed.length ? "warn" : "ok"}>
              {`Download the file to get every partner with their code and signup link${finished.already.length ? `, including the ${finished.already.length} who were already partners` : ""}. It's ready to hand to Muse or any agent writing to them.`}
            </Notice>
            {finished.failed.length ? (
              <Notice title={`${finished.failed.length} not made`} tone="bad">
                <ul className="cx-stack">
                  {finished.failed.map((item) => (
                    <li key={item.label}>{`${item.label}: ${item.error}`}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
          </>
        ) : (
          <>
            <p className="cx-hint">
              {`A CSV with a row per partner. Excel or Google Sheets: File → Download → CSV. Columns are matched by name: Name (or First and Last name), Business, Email, Phone, Type, Code, How you pay them, Notes. Leave Code blank and one is made from the business or name. Anyone already a partner (same email or code) is skipped, so the same sheet can go in again. Up to ${PARTNER_IMPORT_MAX} at a time.`}
            </p>
            <div className="cx-inline">
              <Button onClick={() => input.current?.click()}>
                <Upload size={13} /> {file ? "Choose another file" : "Choose the CSV"}
              </Button>
              <input accept=".csv,text/csv" aria-label="Partner spreadsheet (CSV)" hidden onChange={(event) => {
                  void pick(event.target.files?.[0]);
                  event.target.value = "";
                }} ref={input} type="file" />
              <Button onClick={() => downloadCsv("studiocue-partner-template.csv", partnerImportTemplateCsv)} variant="ghost">
                <Download size={13} /> Template
              </Button>
              {file ? <span className="cx-sub">{file.name}</span> : null}
            </div>
          </>
        )}

        {plan && !finished ? (
          <>
            {detected ? <p className="cx-hint">{`Reading: ${detected}`}</p> : null}
            {noName ? <Notice tone="bad">{"No Name or Business column found. Name the first row's headers, e.g. Name, Business, Email."}</Notice> : null}
            {plan.tooMany ? <Notice tone="bad">{`That's more than ${PARTNER_IMPORT_MAX} new partners. Split the sheet and import it in parts.`}</Notice> : null}
            <p className="cx-inline">
              <Pill tone="ok">{`${ready.length} to make`}</Pill>
              {exists.length ? <Pill tone="neutral">{`${exists.length} already partners`}</Pill> : null}
              {problems.length ? <Pill tone="warn">{`${problems.length} to fix`}</Pill> : null}
            </p>
            {problems.length ? (
              <Notice title="These rows will be left out" tone="warn">
                <ul className="cx-stack">
                  {problems.map((row) => (row.status === "problem" ? <li key={row.line}>{`Row ${row.line}, ${row.label}: ${row.problems.join("; ")}`}</li> : null))}
                </ul>
              </Notice>
            ) : null}
            {ready.length ? (
              <div aria-label="Partners to make" className="cx-timeline" role="list">
                {ready.map(({ line, partner }) => (
                  <div className="cx-item" key={line} role="listitem">
                    <span className="cx-item-title">{partner.business || partner.name}</span>
                    <span className="cx-item-time">
                      <Tag code>{partner.code}</Tag>
                    </span>
                    <span className="cx-item-snippet">
                      {[PARTNER_TYPE_LABELS[partner.type], partner.business ? partner.name : null, partner.email, partner.codeMade ? "code made for them" : "code from the sheet"].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
