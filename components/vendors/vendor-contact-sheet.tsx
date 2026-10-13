"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { useVendorTeam, type TeamRecord } from "@/components/vendors/use-vendor-team";
import { useWorkspace } from "@/features/auth/workspace-context";
import { spokenClock } from "@/features/schedules/day-clock";
import { displayPhone, vendorCategoryLabel, vendorTeamProgress } from "@/features/vendors/team";

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2, minimumFractionDigits: 0 });
const money = (value: unknown) => (typeof value === "number" && value > 0 ? dollars.format(value / 100) : "");
const clock = (value: unknown) => (/^\d{2}:\d{2}$/.test(text(value)) ? spokenClock(text(value)) : "");

function dayOf(value: unknown): string {
  const date = text(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/**
 * The job's vendors on one printable page: who, how to reach them, when they
 * arrive, and what to hand each of them on the day — the balance the couple
 * still owes and the tip. Only the sheet prints; the app around it doesn't.
 */
export function VendorContactSheet({ projectId }: { projectId: string }) {
  const workspace = useWorkspace();
  const team = useVendorTeam(projectId);
  if (team.loading) return <p className="form-notice">Loading the vendor team…</p>;
  if (team.error) return <p className="form-error">{team.error}</p>;
  const booked = team.entries
    .filter((entry) => entry.status === "booked" && !entry.archivedAt)
    .sort((left, right) =>
      (text(left.arrivalTime) || text(left.loadInTime) || "99:99").localeCompare(text(right.arrivalTime) || text(right.loadInTime) || "99:99"),
    );
  const progress = vendorTeamProgress(team.entries, team.shares, team.currentVersion);
  const name = text(team.project?.name);
  const when = dayOf(team.project?.eventDate);
  const venue = text(team.project?.venueName);
  const facts = (entry: TeamRecord) =>
    [
      ["Contact", text(entry.contactName)],
      ["Phone", displayPhone(entry.phone)],
      ["Email", text(entry.email)],
      ["Arrives", clock(entry.arrivalTime)],
      ["Load-in", clock(entry.loadInTime)],
      ["Strike", clock(entry.strikeTime)],
      ["Balance due", money(entry.balanceDueCents)],
      ["Tip", money(entry.tipCents)],
    ].filter(([, value]) => value) as Array<[string, string]>;

  return (
    <div className="vendor-sheet-page">
      <div className="vendor-sheet-actions">
        <Link className="button button-light" href={`/studio/projects/${encodeURIComponent(projectId)}`}>
          <ArrowLeft aria-hidden size={15} /> Back to the job
        </Link>
        <button className="button button-dark" onClick={() => window.print()} type="button">
          <Printer aria-hidden size={15} /> Print
        </button>
      </div>
      <article className="vendor-sheet">
        <header>
          <p className="vendor-sheet-studio">{workspace.tenantName}</p>
          <h1>Vendor contacts</h1>
          <p>{[name, when, venue].filter(Boolean).join(" · ")}</p>
        </header>
        {booked.length ? (
          <ol className="vendor-sheet-list">
            {booked.map((entry) => (
              <li key={entry.id}>
                <h2>
                  {text(entry.company) || vendorCategoryLabel(entry.category)}
                  <small>
                    {vendorCategoryLabel(entry.category)}
                    {text(entry.roleLabel) ? ` · ${text(entry.roleLabel)}` : ""}
                  </small>
                </h2>
                <dl>
                  {facts(entry).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ol>
        ) : (
          <p className="form-notice">No vendors are booked on this job yet.</p>
        )}
        {progress.balanceDueCents || progress.tipCents ? (
          <p className="vendor-sheet-total">
            {[
              progress.balanceDueCents ? `Balances to hand over: ${money(progress.balanceDueCents)}` : "",
              progress.tipCents ? `Tips: ${money(progress.tipCents)}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </article>
    </div>
  );
}
