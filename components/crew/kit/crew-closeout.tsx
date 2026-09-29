"use client";

import { useState } from "react";
import { CheckCircle2, Minus, Plus, ReceiptText, Trash2 } from "lucide-react";
import { Actions, Button, Card, Field, List, Main, Note, PoweredBy, Row, TextArea } from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import { crewAttention } from "@/features/crew/attention";
import { crewCloseoutIsSubmitted } from "@/features/crew/closeout-moment";
import { workWindow } from "@/features/crew/work-window";
import { statusLabel } from "@/features/format/status-label";
import { crewPublicError } from "@/lib/crew/public-error";
import {
  crewCommand,
  CrewLoadState,
  dayLabel,
  jobName,
  list,
  money,
  number,
  record,
  text,
  useAssignmentParam,
  useCrewData,
  type CrewData,
  type Value,
} from "@/components/crew/kit/crew-data";
import { StudioMessage } from "@/components/crew/kit/crew-parts";

/** "HH:MM" on this phone's clock, for a time input. */
function clock(iso: unknown): string {
  const date = new Date(String(iso));
  if (Number.isNaN(date.valueOf())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const duration = (minutes: number) =>
  `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}`;

/**
 * Hours and expenses (M6 of docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * Start and finish are clock times prefilled from the job, with the total
 * shown; extra time is a stepper; expenses and links are lists you add to.
 * It was two `datetime-local` pickers and room for one expense.
 */
export function CrewCloseout() {
  const data = useCrewData();
  const named = useAssignmentParam(data);
  const [now] = useState(() => new Date());
  if (data.loading || data.error) return <CrewLoadState data={data} title="Hours and expenses" />;
  // Work already done comes first: defaulting to a wedding three days away
  // once meant submitting hours for an event that hadn't happened.
  const owed = crewAttention(data.assignments, now).closeoutsDue.map((entry) => entry.assignment);
  const past = data.assignments
    .filter((item) => ["accepted", "completed"].includes(String(item.status)) && String(item.arrivalAt) < now.toISOString())
    .sort((a, b) => String(b.arrivalAt).localeCompare(String(a.arrivalAt)));
  const assignment = named ?? owed[0] ?? past[0] ?? null;
  if (!assignment)
    return (
      <Main label="Hours and expenses">
        <h1 className="kit-title">Hours and expenses</h1>
        <Card>
          <p className="kit-body" role="status">
            After a job, you send your hours and expenses here, and your studio pays from them.
          </p>
        </Card>
        <PoweredBy />
      </Main>
    );
  return <CloseoutDetail assignment={assignment} data={data} key={assignment.id} />;
}

function CloseoutDetail({ data, assignment }: { data: CrewData; assignment: Value }) {
  const workspace = useWorkspace();
  const closeout = record(assignment.closeout);
  const payment = record(assignment.payment);
  const [status, setStatus] = useState(text(closeout.status));
  const [start, setStart] = useState(clock(closeout.actualStartsAt ?? assignment.arrivalAt));
  const [end, setEnd] = useState(clock(closeout.actualEndsAt ?? assignment.departureAt));
  const [extra, setExtra] = useState(number(closeout.extraMinutes));
  const [expenses, setExpenses] = useState<Array<{ description: string; amount: string }>>(
    list(closeout.expenses).map(record).map((item) => ({
      description: text(item.description),
      amount: number(item.amountCents) ? (number(item.amountCents) / 100).toFixed(2) : "",
    })),
  );
  const [links, setLinks] = useState<string[]>(list(closeout.deliverables).map(String));
  const [notes, setNotes] = useState(text(closeout.notes));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = jobName(data, assignment);
  const submitted = crewCloseoutIsSubmitted(status);
  const worked = workWindow(text(assignment.arrivalAt), start, end);
  const minutes = worked ? Math.round((worked.endsAt.valueOf() - worked.startsAt.valueOf()) / 60_000) : 0;

  async function submit() {
    if (!worked) return setError("Add the time you started and finished.");
    const cleanExpenses = expenses
      .filter((item) => item.description.trim() || item.amount.trim())
      .map((item) => ({ description: item.description.trim(), amountCents: Math.round(Number(item.amount || 0) * 100) }));
    if (cleanExpenses.some((item) => !item.description || Number.isNaN(item.amountCents)))
      return setError("Each expense needs what it was for and an amount.");
    const cleanLinks = links.map((link) => link.trim()).filter(Boolean);
    if (cleanLinks.some((link) => !/^https?:\/\/\S+$/.test(link)))
      return setError("Links need to start with https://");
    setBusy(true);
    setError(null);
    try {
      await crewCommand("submitAssignmentCloseout", {
        projectId: text(assignment.projectId),
        assignmentId: assignment.id,
        actualStartsAt: worked.startsAt.toISOString(),
        actualEndsAt: worked.endsAt.toISOString(),
        extraMinutes: extra,
        expenses: cleanExpenses,
        deliverables: cleanLinks,
        notes: notes.trim() || null,
      });
      setStatus("submitted");
      window.scrollTo({ top: 0 });
      data.refresh();
    } catch (caught: unknown) {
      setError(crewPublicError(caught, "Your hours couldn't be sent. Try again.", "CREW_CLOSEOUT_SUBMIT_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Main label="Hours and expenses">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Hours and expenses</p>
          <h1 className="kit-title">{name}</h1>
          <p className="kit-body">{dayLabel(assignment.arrivalAt)}</p>
        </div>

        <List label="Where it stands">
          <Row
            subtitle={text(assignment.compensationType) ? `${text(assignment.compensationType)} rate` : "Agreed fee"}
            title={assignment.compensationVisibleToCrew ? money(assignment.compensationCents, assignment.currency) : "Fee: ask the studio"}
          />
          <Row subtitle="Your record" title={submitted ? statusLabel(status) : status === "needs_changes" ? "Changes asked" : "Not sent yet"} />
          <Row
            subtitle={
              payment.paidAt
                ? `Paid ${dayLabel(payment.paidAt)}`
                : payment.expectedAt
                  ? `Expected ${dayLabel(payment.expectedAt)}`
                  : "Scheduled once your studio reviews your record"
            }
            title={statusLabel(payment.status) || "Payment not scheduled"}
          />
        </List>

        {status === "needs_changes" ? (
          <Note tone="danger">{text(closeout.reviewerNote, "The studio asked for changes. Check your record and send it again.")}</Note>
        ) : null}

        {submitted ? (
          <Note icon={CheckCircle2} tone="accent">
            Received. Your studio reviews it and schedules payment; you won&rsquo;t need to send it again.
          </Note>
        ) : (
          <>
            <section aria-label="Your hours" className="kit-stack-tight">
              <h2 className="kit-subsection">Your hours</h2>
              <div className="kit-field-pair">
                <Field label="Started" onChange={(event) => setStart(event.target.value)} type="time" value={start} />
                <Field label="Finished" onChange={(event) => setEnd(event.target.value)} type="time" value={end} />
              </div>
              {worked ? <p className="kit-caption">{`${duration(minutes)} on site${worked.endsAt.getDate() !== worked.startsAt.getDate() ? ", past midnight" : ""}.`}</p> : null}
              <div className="kit-stepper">
                <span className="kit-stack-tight">
                  <strong>Extra time</strong>
                  <span className="kit-caption">Beyond the agreed wrap. Travel and setup only if the studio said so.</span>
                </span>
                <span className="kit-stepper-control">
                  <button aria-label="15 minutes less" disabled={extra <= 0} onClick={() => setExtra((value) => Math.max(0, value - 15))} type="button">
                    <Minus aria-hidden size={18} />
                  </button>
                  <output aria-live="polite">{extra ? duration(extra) : "None"}</output>
                  <button aria-label="15 minutes more" disabled={extra >= 1440} onClick={() => setExtra((value) => Math.min(1440, value + 15))} type="button">
                    <Plus aria-hidden size={18} />
                  </button>
                </span>
              </div>
            </section>

            <section aria-label="Expenses" className="kit-stack-tight">
              <h2 className="kit-subsection">Expenses</h2>
              {expenses.map((expense, index) => (
                <div className="kit-repeat" key={index}>
                  <Field
                    label="What for"
                    maxLength={240}
                    onChange={(event) =>
                      setExpenses((current) => current.map((item, at) => (at === index ? { ...item, description: event.target.value } : item)))
                    }
                    placeholder="Parking, tolls…"
                    value={expense.description}
                  />
                  <Field
                    inputMode="decimal"
                    label="Amount ($)"
                    onChange={(event) =>
                      setExpenses((current) => current.map((item, at) => (at === index ? { ...item, amount: event.target.value } : item)))
                    }
                    placeholder="0.00"
                    value={expense.amount}
                  />
                  <button
                    aria-label="Remove this expense"
                    className="kit-icon-button"
                    onClick={() => setExpenses((current) => current.filter((_, at) => at !== index))}
                    type="button"
                  >
                    <Trash2 aria-hidden size={18} />
                  </button>
                </div>
              ))}
              {expenses.length < 25 ? (
                <Button icon={Plus} onClick={() => setExpenses((current) => [...current, { description: "", amount: "" }])} variant="soft">
                  Add an expense
                </Button>
              ) : null}
            </section>

            <section aria-label="Links" className="kit-stack-tight">
              <h2 className="kit-subsection">Links to your files</h2>
              {links.map((link, index) => (
                <div className="kit-repeat" key={index}>
                  <Field
                    inputMode="url"
                    label={`Link ${index + 1}`}
                    onChange={(event) => setLinks((current) => current.map((item, at) => (at === index ? event.target.value : item)))}
                    placeholder="https://"
                    type="url"
                    value={link}
                  />
                  <button
                    aria-label="Remove this link"
                    className="kit-icon-button"
                    onClick={() => setLinks((current) => current.filter((_, at) => at !== index))}
                    type="button"
                  >
                    <Trash2 aria-hidden size={18} />
                  </button>
                </div>
              ))}
              {links.length < 25 ? (
                <Button icon={Plus} onClick={() => setLinks((current) => [...current, ""])} variant="soft">
                  Add a link
                </Button>
              ) : null}
            </section>

            <TextArea label="Notes for the studio (optional)" maxLength={4000} onChange={(event) => setNotes(event.target.value)} rows={3} value={notes} />
          </>
        )}

        <StudioMessage assignment={assignment} jobName={name} studioColor={workspace.tenantBrand?.primaryColor ?? null} />
        <PoweredBy />
      </Main>

      {!submitted ? (
        <Actions>
          {error ? (
            <p className="kit-error" role="alert">
              {error}
            </p>
          ) : null}
          <Button disabled={busy} icon={ReceiptText} onClick={() => void submit()}>
            {busy ? "Sending…" : "Send to the studio"}
          </Button>
        </Actions>
      ) : null}
    </>
  );
}
