"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Award, Clock3, LoaderCircle, Plus, Printer, Send, Users, Wallet } from "lucide-react";
import { SheetDialog } from "@/components/ui/sheet-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { useVendorTeam, type TeamRecord } from "@/components/vendors/use-vendor-team";
import { VendorTeamSheet } from "@/components/vendors/vendor-team-sheet";
import { useWorkspace } from "@/features/auth/workspace-context";
import { spokenClock } from "@/features/schedules/day-clock";
import { tradeProfile } from "@/features/trades/trades";
import { jobKindOf, vocab } from "@/features/job-kinds/job-kinds";
import {
  VENDOR_TEAM_STATUS_LABELS,
  VENDOR_TIMELINE_LABELS,
  budgetLine,
  sharesByVendor,
  timelineStateFor,
  timelineSummary,
  vendorCategoryLabel,
  vendorTeamProgress,
  vendorTeamVisibility,
  type VendorTeamStatus,
  type VendorTimelineState,
} from "@/features/vendors/team";
import { coupleVendorAnswer, coupleVendorsNeedStudio, type CoupleVendorTeamRecord } from "@/features/vendors/couple-team";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPlanningCommand } from "@/lib/planning/command-client";

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const STATUS_TONE: Record<VendorTeamStatus, "success" | "info" | "warning" | "neutral"> = {
  booked: "success",
  considering: "info",
  needed: "warning",
  declined: "neutral",
};
const TIMELINE_TONE: Record<VendorTimelineState, "success" | "info" | "warning" | "neutral"> = {
  confirmed: "success",
  viewed: "info",
  sent: "info",
  older: "warning",
  not_sent: "neutral",
};
const PHONE_ROWS = 4;
/** After the day: when a planner's vendor credits can go to the couple (vendor-team.ts sendVendorCredits). */
const AFTER_THE_DAY = new Set(["EVENT_COMPLETE", "POST_PRODUCTION", "DELIVERED", "REVIEW_REQUESTED", "CLOSED"]);

function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const sync = () => setPhone(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return phone;
}

/** Who the client is, in the job's own words: "the couple", "the family", "the client". */
export function clientWord(project: Record<string, unknown> | null | undefined): string {
  return vocab(jobKindOf(project ?? {})).clientFallback;
}
const capitalized = (value: string) => `${value.charAt(0).toUpperCase()}${value.slice(1)}`;

/** "Arrives 2:00 PM", "Loads in 3:00 PM", or nothing. */
function arrivalWords(entry: TeamRecord): string | null {
  const arrival = text(entry.arrivalTime);
  const loadIn = text(entry.loadInTime);
  if (arrival) return `Arrives ${spokenClock(arrival)}`;
  if (loadIn) return `Loads in ${spokenClock(loadIn)}`;
  return null;
}

/**
 * The job's vendor team (docs/planner-journey-plan.md, N1 and N2).
 *
 * Who the wedding's other vendors are, where each stands, when they arrive,
 * whether they have the current timeline — and one press that sends it to
 * every booked vendor. A compact row each, edited in a sheet, on every
 * width (mobile queues are compact rows, never expanded cards).
 *
 * Quiet for every trade today: until a vendor is on the job, a booked job
 * shows only a small "Add a vendor", and an inquiry or a finished job shows
 * nothing (features/vendors/team.ts vendorTeamVisibility).
 */
export function VendorTeamPanel({
  projectId,
  state,
  alwaysShow = false,
}: {
  projectId: string;
  /** The job's state, for when the quiet entry shows. */
  state: string;
  /** Show the whole panel even before a vendor is added (Cue's card). */
  alwaysShow?: boolean;
}) {
  const workspace = useWorkspace();
  const team = useVendorTeam(projectId);
  const { records: vendors } = useTenantDocuments("vendors");
  const phone = usePhone();
  const [editing, setEditing] = useState<TeamRecord | "new" | null>(null);
  const [budgetOpen, setBudgetOpen] = useState(false);
  // Sent here from a publish ("?vendors=send"): the send is open and waiting.
  // Read once, as the panel first renders; it shows nothing until the team loads.
  const [sending, setSending] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("vendors") === "send",
  );
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [crediting, setCrediting] = useState(false);

  const entries = team.entries;
  const progress = useMemo(
    () => vendorTeamProgress(entries, team.shares, team.currentVersion),
    [entries, team.currentVersion, team.shares],
  );
  const byVendor = useMemo(() => sharesByVendor(team.shares), [team.shares]);
  const teamVendorIds = useMemo(
    () => new Set(entries.map((entry) => text(entry.vendorId)).filter(Boolean)),
    [entries],
  );
  const canWork = ["studio_owner", "studio_admin", "studio_coordinator"].includes(String(workspace.role ?? ""));
  // What the client said about their other vendors (features/vendors/couple-team.ts).
  const { records: answers } = useTenantDocuments("clientVendorTeams");
  const answerRecord = ((answers ?? []) as CoupleVendorTeamRecord[]).find((row) => row.projectId === projectId || row.id === projectId) ?? null;
  const fresh = coupleVendorsNeedStudio(answerRecord);
  // Opening the team is seeing the list: it comes off Today.
  useEffect(() => {
    if (!fresh || !canWork) return;
    void sendPlanningCommand("markCoupleVendorsSeen", { projectId })
      .then(() => refreshTenantRecords("clientVendorTeams"))
      .catch(() => undefined);
  }, [fresh, canWork, projectId]);
  if (!canWork || team.loading) return null;
  const visibility = alwaysShow
    ? "panel"
    : vendorTeamVisibility({ mode: tradeProfile(workspace.tenantTrade).vendorTeam, entryCount: entries.length, state });
  // A refused read leaves the team empty, so a quiet trade's job looks as it
  // always did; only an open panel says the team couldn't be loaded.
  if (visibility === "hidden") return null;

  const sheet =
    editing !== null ? (
      <VendorTeamSheet
        client={clientWord(team.project)}
        directory={(vendors ?? []) as TeamRecord[]}
        entry={editing === "new" ? null : editing}
        key={editing === "new" ? "new" : editing.id}
        onClose={() => setEditing(null)}
        onSaved={(message) => {
          setNotice(message);
          team.refresh();
        }}
        open
        projectId={projectId}
        teamVendorIds={teamVendorIds}
      />
    ) : null;

  const byPlanner = team.project?.vendorTeamByPlanner === true;
  const answer = coupleVendorAnswer(answerRecord);

  async function setByPlanner(next: boolean) {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await sendPlanningCommand("setVendorTeamByPlanner", { projectId, byPlanner: next });
      setNotice(
        !outcome.persisted
          ? "Preview mode — nothing was saved."
          : next
            ? "The planner runs the vendors on this one, so the client isn't asked to list them."
            : "The client is asked to list their other vendors again.",
      );
      if (outcome.persisted) {
        refreshTenantRecords("projects");
        team.refresh();
      }
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That couldn't be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (visibility === "quiet") {
    return (
      <div className="vendor-team-quiet">
        <button className="vendor-team-quiet-button" onClick={() => setEditing("new")} type="button">
          <Plus aria-hidden size={14} /> Add a vendor
        </button>
        <small>
          {byPlanner
            ? "The planner runs the vendors on this one."
            : answer === "none"
              ? "The client said there are no other vendors."
              : "The client lists their other vendors in their portal before the final schedule goes out."}
        </small>
        {notice ? <small role="status">{notice}</small> : null}
        {sheet}
      </div>
    );
  }

  // Who the send reaches, said before it goes.
  const booked = entries.filter((entry) => entry.status === "booked" && text(entry.vendorId) && !entry.archivedAt);
  const stateOf = (entry: TeamRecord) => timelineStateFor(byVendor.get(text(entry.vendorId)), team.currentVersion);
  const emailed = (entry: TeamRecord) => text(entry.email).includes("@");
  const firstTime = booked.filter((entry) => stateOf(entry) === "not_sent" && emailed(entry));
  const updates = booked.filter((entry) => stateOf(entry) === "older" && emailed(entry));
  const noEmail = booked.filter((entry) => ["not_sent", "older"].includes(stateOf(entry)) && !emailed(entry));
  const names = (list: TeamRecord[]) => list.map((entry) => text(entry.company) || vendorCategoryLabel(entry.category)).join(", ");
  const reach = firstTime.length + updates.length;
  // Every booked vendor who needs it: a first link, or the newer version.
  const vendorsWord = reach === 1 ? "1 vendor" : `${reach} vendors`;
  const sendLabel = firstTime.length ? `Send the timeline to ${vendorsWord}` : `Send the update to ${vendorsWord}`;
  const budgetCents = typeof team.project?.budgetCents === "number" ? team.project.budgetCents : null;
  const rows = phone && !showAll ? entries.slice(0, PHONE_ROWS) : entries;
  // "the couple", "the family", "the client": the job's own word (job-kinds.ts).
  const client = clientWord(team.project);

  // A planner's vendor credits, after the day (trades.ts `journey.vendorSteps`).
  const creditsOffered = tradeProfile(workspace.tenantTrade).journey.vendorSteps && AFTER_THE_DAY.has(state) && booked.length > 0;
  const creditsSentAt = text(team.project?.vendorCreditsSentAt);

  async function sendCredits() {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await sendPlanningCommand("sendVendorCredits", { projectId });
      if (!outcome.persisted) setNotice("Preview mode — nothing was sent.");
      else {
        const result = outcome.result as { alreadySent?: boolean; count?: number };
        setNotice(result.alreadySent ? `The vendor credits already went to ${client}.` : `Sent ${client} the credits for ${result.count ?? booked.length + 1} vendors.`);
      }
      setCrediting(false);
      team.refresh();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The vendor credits couldn't be sent. Try again."));
    } finally {
      setBusy(false);
    }
  }

  async function sendTimeline() {
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await sendPlanningCommand("sendTimelineToVendorTeam", { projectId, message: note.trim() });
      if (!outcome.persisted) {
        setNotice("Preview mode — nothing was sent.");
      } else {
        const result = outcome.result as {
          sent?: Array<{ company?: string; update?: boolean }>;
          noEmail?: string[];
          alreadyCurrent?: string[];
        };
        const sent = (result.sent ?? []).map((item) => item.company || "A vendor");
        setNotice(
          [
            sent.length ? `Sent to ${sent.join(", ")}.` : "Nobody needed it — every booked vendor already has this version.",
            result.noEmail?.length ? `No email address for ${result.noEmail.join(", ")}: add one to send it.` : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
        refreshTenantRecords("scheduleShares");
      }
      setSending(false);
      setNote("");
      team.refresh();
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "The timeline couldn't be sent. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Vendor team" className="panel vendor-team-panel" id="vendor-team">
      <header className="vendor-team-head">
        <span className="vendor-team-heading">
          <p className="eyebrow">Vendors</p>
          <h2>Vendor team</h2>
        </span>
        <button className="button button-sm button-light" onClick={() => setEditing("new")} type="button">
          <Plus aria-hidden size={14} /> Add a vendor
        </button>
      </header>
      {team.error ? (
        <p className="form-error" role="alert">
          {team.error}
        </p>
      ) : null}
      <div className="vendor-team-summary">
        <p className="vendor-team-line">
          <Wallet aria-hidden size={15} />
          <span>
            {budgetLine(progress.bookedCostCents, budgetCents)}{" "}
            <button className="vendor-team-link" onClick={() => setBudgetOpen(true)} type="button">
              {budgetCents ? "Change the budget" : "Set the budget"}
            </button>
          </span>
        </p>
        {progress.needed || progress.considering ? (
          <p className="vendor-team-line">
            <span>
              {[
                progress.booked ? `${progress.booked} booked` : "",
                progress.considering ? `${progress.considering} being considered` : "",
                progress.needed ? `${progress.needed} still needed` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </p>
        ) : null}
        <p className="vendor-team-line">
          <Users aria-hidden size={15} />
          <span>
            {byPlanner
              ? "The planner runs the vendors on this one, so the client isn't asked."
              : answer === "listed"
                ? `${capitalized(client)} listed ${answerRecord?.count === 1 ? "1 vendor" : `${answerRecord?.count ?? 0} vendors`} in their portal.`
                : answer === "none"
                  ? `${capitalized(client)} said there are no other vendors.`
                  : `${capitalized(client)} is asked to list their other vendors in their portal, due when the details lock.`}{" "}
            <button className="vendor-team-link" disabled={busy} onClick={() => void setByPlanner(!byPlanner)} type="button">
              {byPlanner ? `Ask ${client} after all` : "The planner handles vendors"}
            </button>
          </span>
        </p>
        <p className="vendor-team-line">
          <Send aria-hidden size={15} />
          <span>
            {team.currentVersion === null
              ? "Publish the run of show, then send it to every booked vendor in one go."
              : (timelineSummary(progress) ?? "No vendor has the timeline yet.")}{" "}
            {team.currentVersion === null ? (
              <Link className="vendor-team-link" href={`/studio/schedules/new?project=${encodeURIComponent(projectId)}`}>
                Open the run of show
              </Link>
            ) : null}
          </span>
        </p>
        {team.currentVersion !== null && reach > 0 && !sending ? (
          <button className="button button-dark vendor-team-send" onClick={() => setSending(true)} type="button">
            <Send aria-hidden size={15} /> {sendLabel}
          </button>
        ) : null}
        {team.currentVersion !== null && reach === 0 && noEmail.length ? (
          <p className="vendor-team-line vendor-team-quiet-note">
            <span>{`No email address for ${names(noEmail)}. Add one to send them the timeline.`}</span>
          </p>
        ) : null}
        {sending && reach > 0 && team.currentVersion !== null ? (
          <div className="vendor-team-send-confirm" role="group" aria-label="Send the timeline">
            {firstTime.length ? <p>{`Gets their link: ${names(firstTime)}.`}</p> : null}
            {updates.length ? <p>{`Gets version ${team.currentVersion}: ${names(updates)}.`}</p> : null}
            {noEmail.length ? <p>{`No email address, so not sent: ${names(noEmail)}.`}</p> : null}
            <label>
              A note with it (optional)
              <textarea
                maxLength={4000}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Dinner moved to 6:30, so everything after it shifts half an hour."
                rows={2}
                value={note}
              />
            </label>
            <div className="vendor-team-send-actions">
              <button className="button button-dark" disabled={busy} onClick={() => void sendTimeline()} type="button">
                {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : <Send aria-hidden size={14} />}
                {busy ? "Sending…" : "Send"}
              </button>
              <button className="button button-light" disabled={busy} onClick={() => setSending(false)} type="button">
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {creditsOffered ? (
          creditsSentAt ? (
            <p className="vendor-team-line">
              <Award aria-hidden size={15} />
              <span>{`Vendor credits sent to ${client}.`}</span>
            </p>
          ) : crediting ? (
            <div className="vendor-team-send-confirm" role="group" aria-label="Send vendor credits">
              <p>{`${capitalized(client)} get every booked vendor's name and website, yours first, to tag when they share the day. It goes once.`}</p>
              <div className="vendor-team-send-actions">
                <button className="button button-dark" disabled={busy} onClick={() => void sendCredits()} type="button">
                  {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : <Award aria-hidden size={14} />}
                  {busy ? "Sending…" : "Send"}
                </button>
                <button className="button button-light" disabled={busy} onClick={() => setCrediting(false)} type="button">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button className="button button-light vendor-team-send" onClick={() => setCrediting(true)} type="button">
              <Award aria-hidden size={15} /> Send vendor credits
            </button>
          )
        ) : null}
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
      {entries.length ? (
        <ul className="vendor-team-rows">
          {rows.map((entry) => {
            const status = (VENDOR_TEAM_STATUS_LABELS as Record<string, string>)[text(entry.status)] ? (text(entry.status) as VendorTeamStatus) : "needed";
            const timeline = status === "booked" && text(entry.vendorId) ? stateOf(entry) : null;
            const when = arrivalWords(entry);
            return (
              <li key={entry.id}>
                <button className="vendor-team-row" onClick={() => setEditing(entry)} type="button">
                  <span className="vendor-team-row-name">
                    <strong>{text(entry.company) || "Nobody chosen yet"}</strong>
                    <small>
                      {vendorCategoryLabel(entry.category)}
                      {text(entry.roleLabel) ? ` · ${text(entry.roleLabel)}` : ""}
                      {entry.source === "couple" ? ` · Added by ${client}` : ""}
                    </small>
                  </span>
                  <span className="vendor-team-row-facts">
                    <StatusBadge tone={STATUS_TONE[status]}>{VENDOR_TEAM_STATUS_LABELS[status]}</StatusBadge>
                    {when ? (
                      <span className="vendor-team-row-time">
                        <Clock3 aria-hidden size={13} /> {when}
                      </span>
                    ) : null}
                    {timeline ? <StatusBadge tone={TIMELINE_TONE[timeline]}>{VENDOR_TIMELINE_LABELS[timeline]}</StatusBadge> : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="form-notice vendor-team-empty">
          {`No vendors yet. Add the ones ${client} has booked, or the ones still needed.`}
        </p>
      )}
      {phone && entries.length > PHONE_ROWS ? (
        <button className="vendor-team-link vendor-team-more" onClick={() => setShowAll((value) => !value)} type="button">
          {showAll ? "Show fewer" : `Show ${entries.length - PHONE_ROWS} more`}
        </button>
      ) : null}
      {entries.length ? (
        <footer className="vendor-team-foot">
          <Link className="vendor-team-link" href={`/studio/projects/${encodeURIComponent(projectId)}/vendors/print`}>
            <Printer aria-hidden size={14} /> Contact sheet
          </Link>
        </footer>
      ) : null}
      {sheet}
      {budgetOpen ? (
        <BudgetSheet
          budgetCents={budgetCents}
          client={client}
          onClose={() => setBudgetOpen(false)}
          onSaved={(message) => {
            setNotice(message);
            team.refresh();
          }}
          projectId={projectId}
        />
      ) : null}
    </section>
  );
}

/** The client's budget, for the line above the team. Blank clears it. */
function BudgetSheet({
  projectId,
  budgetCents,
  client,
  onClose,
  onSaved,
}: {
  projectId: string;
  budgetCents: number | null;
  /** "the couple", "the family": whose budget it is (clientWord). */
  client: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const Client = capitalized(client);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(form: FormData) {
    const raw = String(form.get("budget") ?? "").replace(/[$,\s]/g, "");
    const amount = raw ? Number(raw) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      setError("Write the budget in dollars, like 35,000.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const outcome = await sendPlanningCommand("setProjectBudget", {
        projectId,
        budgetCents: amount === null ? null : Math.round(amount * 100),
      });
      onSaved(outcome.persisted ? (amount === null ? "The budget is cleared." : "The budget is saved.") : "Preview mode — nothing was saved.");
      if (outcome.persisted) refreshTenantRecords("projects");
      onClose();
    } catch (caught: unknown) {
      setError(friendlyError(caught, "The budget couldn't be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <SheetDialog label={`${Client}'s budget`} onClose={onClose} open>
      <form
        className="record-sheet"
        onSubmit={(event) => {
          event.preventDefault();
          void save(new FormData(event.currentTarget));
        }}
      >
        <header>
          <p className="eyebrow">Vendor team</p>
          <h3>{`${Client}'s budget`}</h3>
          <p>Booked vendors&rsquo; totals are counted against it. Leave it blank for no budget.</p>
        </header>
        <div className="record-sheet-fields">
          <label className="is-wide">
            Budget
            <input
              defaultValue={budgetCents ? String(Math.round(budgetCents) / 100) : ""}
              inputMode="decimal"
              name="budget"
              placeholder="$"
            />
          </label>
        </div>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <footer>
          <button className="button button-light" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="button button-dark" disabled={busy} type="submit">
            {busy ? <LoaderCircle aria-hidden className="spin" size={14} /> : null}
            {busy ? "Saving…" : "Save the budget"}
          </button>
        </footer>
      </form>
    </SheetDialog>
  );
}
