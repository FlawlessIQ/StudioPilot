"use client";

import { ClipboardCheck } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { formatDueDate } from "@/lib/format/event-date";

type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Row) : {};
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * The couple's final details on the job: what they confirmed at the lock, and
 * every change agreed since (functions/src/planning/final-details.ts,
 * detail-changes.ts). Before the lock it says when that is; nothing to show
 * for a job that has neither.
 *
 * A makeup artist's or hair stylist's client confirms the final headcount
 * instead (`kind: "headcount"`): who, how many, and when they tapped yes.
 */
export function FinalDetailsPanel({ projectId }: { projectId: string }) {
  const { records: signoffs } = useTenantDocuments("detailSignoffs");
  const { records: requests } = useTenantDocuments("detailChangeRequests");
  const signoff = signoffs?.find((entry) => entry.projectId === projectId) ?? null;
  const pending = (requests ?? []).filter((entry) => entry.projectId === projectId && entry.status === "pending");
  if (!signoff) return null;
  if (signoff.kind === "headcount") return <FinalHeadcountPanel signoff={signoff} />;
  const snapshot = record(signoff.snapshot);
  const rows = (Array.isArray(snapshot.rows) ? snapshot.rows : []).map(record);
  const timeline = (Array.isArray(snapshot.timeline) ? snapshot.timeline : []).map(record);
  const changes = (Array.isArray(signoff.changes) ? signoff.changes : []).map(record);
  const confirmedBy = record(signoff.confirmedBy);
  const confirmed = signoff.status === "confirmed";
  return (
    <section className="panel wedding-brief" aria-labelledby="final-details-title">
      <div className="email-branding-heading">
        <span className="data-control-icon">
          <ClipboardCheck aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">Final details</p>
          <h2 id="final-details-title">
            {confirmed
              ? `Confirmed by ${text(confirmedBy.typedName) || "the couple"}${text(signoff.confirmedAt) ? ` on ${formatDueDate(text(signoff.confirmedAt).slice(0, 10))}` : ""}`
              : "Waiting for the couple to confirm"}
          </h2>
          <p>
            {`Locked ${text(signoff.lockOn) ? formatDueDate(text(signoff.lockOn)) : ""}. Changes to locations or times come to you as requests on Today.`}
            {pending.length ? ` ${pending.length} waiting now.` : ""}
          </p>
        </div>
      </div>
      <div className="wedding-brief-grid">
        <div className="wedding-brief-block">
          <h3>Where and when</h3>
          <dl className="wedding-brief-facts">
            {rows.map((row) => (
              <div key={`${text(row.label)}-${text(row.value)}`}>
                <dt>{text(row.label)}</dt>
                <dd>{text(row.value)}</dd>
              </div>
            ))}
          </dl>
        </div>
        {timeline.length ? (
          <div className="wedding-brief-block">
            <h3>{`The timeline they ${confirmed ? "confirmed" : "were shown"}`}</h3>
            <ol className="wedding-brief-timeline">
              {timeline.map((item, index) => (
                <li key={`${index}-${text(item.title)}`}>
                  <time>{text(item.time)}</time>
                  <span>
                    <strong>{text(item.title)}</strong>
                    {text(item.location) ? <small>{text(item.location)}</small> : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
      {changes.length ? (
        <div className="wedding-brief-block">
          <h3>Changed since, by agreement</h3>
          <dl className="wedding-brief-facts">
            {changes.map((change) => (
              <div key={`${text(change.at)}-${text(change.label)}`}>
                <dt>{`${text(change.label)} · ${formatDueDate(text(change.at).slice(0, 10))}`}</dt>
                <dd>{`${text(change.from)} → ${text(change.to)}`}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}

/** The final headcount on the job: asked at the lock, confirmed in one tap. */
function FinalHeadcountPanel({ signoff }: { signoff: Row }) {
  const confirmed = signoff.status === "confirmed";
  const confirmedBy = record(signoff.confirmedBy);
  const asked = typeof signoff.headcount === "number" ? signoff.headcount : null;
  const count = typeof signoff.confirmedHeadcount === "number" ? signoff.confirmedHeadcount : null;
  const people = (Array.isArray(signoff.confirmedPeople) ? signoff.confirmedPeople : Array.isArray(record(signoff.snapshot).people) ? (record(signoff.snapshot).people as unknown[]) : [])
    .map(text)
    .filter(Boolean);
  const who = text(confirmedBy.typedName) || text(confirmedBy.email) || "the client";
  return (
    <section className="panel wedding-brief" aria-labelledby="final-headcount-title">
      <div className="email-branding-heading">
        <span className="data-control-icon">
          <ClipboardCheck aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">Final headcount</p>
          <h2 id="final-headcount-title">
            {confirmed
              ? `${count ?? people.length} confirmed by ${who}${text(signoff.confirmedAt) ? ` on ${formatDueDate(text(signoff.confirmedAt).slice(0, 10))}` : ""}`
              : `Waiting for them to confirm${asked !== null ? ` ${asked}` : ""}`}
          </h2>
          <p>
            {`Asked ${text(signoff.lockOn) ? formatDueDate(text(signoff.lockOn)) : "when the details locked"}, in one tap. People can be added from here, not taken off.`}
          </p>
        </div>
      </div>
      {people.length ? (
        <div className="wedding-brief-block">
          <h3>{confirmed ? "Who they confirmed" : "On their party list at the lock"}</h3>
          <ol className="wedding-brief-timeline">
            {people.map((name, index) => (
              <li key={`${index}-${name}`}>
                <span>
                  <strong>{name}</strong>
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
