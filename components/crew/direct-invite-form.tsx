"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { todayLocalIso } from "@/lib/format/event-date";
import { CalendarCheck, CheckCircle2, ChevronDown, Send, UserRoundCheck } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { crewPublicError } from "@/lib/crew/public-error";
import { useReturnToJob } from "@/lib/projects/return-to-job";
import { useWorkspace } from "@/features/auth/workspace-context";
import { crewRequirementsFor, type CrewRequirementSettings } from "@/features/crew/requirements";
import { directOfferDefaults, offerResponsibilities } from "@/features/crew/direct-offer";
import { jobCoverage, jobPackageSnapshotIds, ownerShootsJob } from "@/features/crew/staffing-plan";
import { lapsedOnJob, spokenForOnJob } from "@/features/crew/offer-again";

const text = (value: unknown) => (typeof value === "string" ? value : "");
const localDateTime = (value: Date) => {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.valueOf() - offset).toISOString().slice(0, 16);
};


/**
 * One named person, one job, no ranking.
 *
 * The cascade is the right default when the question is "who is free and
 * qualified" — it ranks the directory and offers to one candidate at a
 * time. It is the wrong shape when the answer is already known: putting
 * "Jordan, this Saturday" through candidate ranking is ceremony around a
 * decision that has been made.
 *
 * `inviteAssignment` has always done exactly this on the server — creates
 * the assignment, mints the invite token, queues the email — and had no
 * caller. This is the caller.
 */
export function DirectInviteForm({ projectId }: { projectId: string }) {
  const returnToJob = useReturnToJob(projectId);
  /**
   * Open when linked to.
   *
   * The staffing header offers "I know who I want", which points here. A
   * closed disclosure that stays closed when you click straight at it is a
   * dead link as far as the studio is concerned.
   */
  const [openFromHash, setOpenFromHash] = useState(false);
  useEffect(() => {
    const sync = () => {
      if (window.location.hash === "#crew-direct-invite") setOpenFromHash(true);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const { records: projects } = useTenantDocuments("projects");
  const { records: profiles } = useTenantDocuments("crewProfiles");
  const { records: assignments } = useTenantDocuments("crewAssignments");
  // The same obligations a cascade offer carries, from the same setting. This
  // list used to be written out here with liability insurance always
  // required, so a direct offer demanded a certificate the studio had
  // switched off in Studio settings → Crew offers.
  const workspace = useWorkspace();
  const { records: tenants } = useTenantDocuments("tenants");
  const crewSettings = (tenants ?? []).find((entry) => entry.id === workspace.tenantId)?.crewOffers as
    | CrewRequirementSettings
    | undefined;
  const { records: schedules } = useTenantDocuments("schedules");
  const { records: packageSnapshots } = useTenantDocuments("packageSnapshots");

  const project = projects?.find((item) => item.id === projectId);
  const eventDate =
    text(project?.eventDate) || todayLocalIso();

  // Someone with a live offer or booking on this job is not a candidate for a
  // second offer on it. The server would happily write a duplicate. An offer
  // that ran out of time is over, though — leaving it in here is what kept a
  // studio from re-offering a second shooter who missed the window
  // (features/crew/offer-again.ts).
  const spokenFor = useMemo(
    () => spokenForOnJob(assignments ?? [], projectId),
    [assignments, projectId],
  );
  const lapsed = useMemo(
    () => lapsedOnJob(assignments ?? [], projectId),
    [assignments, projectId],
  );

  // Owners and admins can also just book someone: staff who take the work
  // they're given, or no time to wait for a yes (crew/commands.ts
  // assignDirectly). Anyone not already booked on the job can be, including
  // someone whose offer is still waiting — booking them answers it.
  const mayBook = ["studio_owner", "studio_admin"].includes(workspace.role ?? "");
  const [mode, setMode] = useState<"offer" | "book">("offer");
  const booking = mayBook && mode === "book";
  const [notify, setNotify] = useState(true);
  const bookedOnJob = useMemo(
    () =>
      new Set(
        (assignments ?? [])
          .filter((item) => item.projectId === projectId && item.status === "accepted")
          .map((item) => text(item.crewProfileId)),
      ),
    [assignments, projectId],
  );
  const offerOut = useMemo(
    () =>
      new Set(
        (assignments ?? [])
          .filter((item) => item.projectId === projectId && ["invited", "viewed"].includes(text(item.status)))
          .map((item) => text(item.crewProfileId)),
      ),
    [assignments, projectId],
  );
  const available = (profiles ?? []).filter(
    (profile) => profile.active === true && (booking ? !bookedOnJob.has(profile.id) : !spokenFor.has(profile.id)),
  );

  const latestSchedule = (schedules ?? [])
    .filter((item) => item.projectId === projectId)
    .sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0];

  // The role the job is still short of, not a photography constant
  // (features/crew/direct-offer.ts). Derived like the times below: the job
  // and its packages load after the first render.
  const defaults = useMemo(() => {
    const snapshotIds = jobPackageSnapshotIds(project);
    return directOfferDefaults({
      coverage: jobCoverage(
        (packageSnapshots ?? []).filter((snapshot) => snapshotIds.includes(snapshot.id)),
      ),
      assignments: (assignments ?? []).filter((item) => item.projectId === projectId),
      ownerCovers: ownerShootsJob(project),
    });
  }, [assignments, packageSnapshots, project, projectId]);

  const [crewProfileId, setCrewProfileId] = useState("");
  const [roleEdit, setRoleEdit] = useState<string | null>(null);
  const role = roleEdit ?? defaults.role;
  // Derived, not stored. State initialises on the first render, when the
  // job is still loading and `eventDate` has fallen back to today — a
  // stored default would strand the offer on today's date for a wedding
  // months out. An override is only recorded once someone types one.
  const [startsAtEdit, setStartsAtEdit] = useState<string | null>(null);
  const [endsAtEdit, setEndsAtEdit] = useState<string | null>(null);
  const startsAt =
    startsAtEdit ?? localDateTime(new Date(`${eventDate}T12:00:00`));
  const endsAt = endsAtEdit ?? localDateTime(new Date(`${eventDate}T20:00:00`));
  // Follows the role until someone types their own.
  const [responsibilitiesEdit, setResponsibilitiesEdit] = useState<string | null>(null);
  const responsibilities = responsibilitiesEdit ?? offerResponsibilities(role);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState<{ name: string; booked: boolean; notified: boolean } | null>(null);

  const chosen = available.find((profile) => profile.id === crewProfileId);
  // The direct path knows who it is offering to, so it can open at that
  // person's own rate instead of a house default.
  const theirRate = chosen
    ? String(Math.round(Number(chosen.rateCents ?? 0) / 100))
    : "";
  const [rateOverride, setRateOverride] = useState<string | null>(null);
  const rateDollars = rateOverride ?? theirRate;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen) return;
    const element = event.currentTarget;
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendCrewCommand(booking ? "assignDirectly" : "inviteAssignment", {
        ...(booking ? { notify } : {}),
        projectId,
        crewProfileId: chosen.id,
        userId: text(chosen.userId) || null,
        role,
        compensationCents: Math.round(Number(rateDollars || 0) * 100),
        compensationType:
          text(chosen.rateType) === "hourly" ? "hourly" : "event",
        currency: "USD",
        compensationVisibleToCrew: true,
        arrivalAt: new Date(startsAt).toISOString(),
        departureAt: new Date(endsAt).toISOString(),
        locations: [
          {
            name: text(project?.venueName) || "Event location",
            address: text(project?.venueAddress) || null,
          },
        ],
        responsibilities: responsibilities
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        scheduleItemIds: [],
        currentScheduleId: latestSchedule?.id ?? null,
        currentScheduleVersion: Number(latestSchedule?.version ?? 0),
        requirements: crewRequirementsFor(crewSettings),
      });
      if (response.persisted) {
        returnToJob({ delayMs: 1600 });
        setSent({ name: text(chosen.name) || "They", booked: booking, notified: booking ? notify && Boolean(text(chosen.email)) : true });
        setCrewProfileId("");
        setRateOverride(null);
        setStartsAtEdit(null);
        setEndsAtEdit(null);
        setRoleEdit(null);
        setResponsibilitiesEdit(null);
        element.reset();
      } else {
        setNotice(
          booking
            ? "Development preview: the booking was validated but nothing was saved."
            : "Development preview: the offer was validated but nothing was sent.",
        );
      }
    } catch (caught: unknown) {
      setNotice(
        crewPublicError(
          caught,
          booking ? "The booking couldn't be saved." : "The offer could not be sent.",
          booking ? "CREW_DIRECT_BOOKING_FAILED" : "CREW_DIRECT_INVITE_FAILED",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <section className="panel crew-direct-sent">
        <CheckCircle2 aria-hidden="true" />
        <div>
          <strong>{sent.booked ? `${sent.name} is booked` : `Offer sent to ${sent.name}`}</strong>
          <p>
            {sent.booked
              ? sent.notified
                ? "They're on the job now, and they have an email with the date, the role and the details. There's nothing for them to accept."
                : "They're on the job now. No email went, so let them know yourself."
              : "They have an email with the date, the role, the rate and a link to accept. It expires in seven days. You will see the answer under Assignments — nothing is booked until they accept."}
          </p>
        </div>
        <span className="crew-direct-sent-actions">
          <button
            className="button button-light"
            onClick={() => setSent(null)}
            type="button"
          >
            {sent.booked ? "Book or offer someone else" : "Offer this job to someone else"}
          </button>
        </span>
      </section>
    );

  return (
    <details className="crew-direct-invite" id="crew-direct-invite" open={openFromHash}>
      {/* Conor (2026-10-10): a well-used path that read as a grey footnote
          under the ranking. It's the first thing on the page now, as a card. */}
      <summary>
        <span className="crew-direct-invite-icon">
          <UserRoundCheck aria-hidden="true" size={20} />
        </span>
        <span className="crew-direct-invite-copy">
          <strong>{mayBook ? "Already know who's working it?" : "Already know who you want?"}</strong>
          <small>
            {mayBook
              ? "Book your staff on it right away, or offer it to one person. No ranking, no waiting on a list."
              : "Offer this job to one person. No ranking, no waiting on a list."}
          </small>
        </span>
        <span className="crew-direct-invite-cta">
          Choose who
          <ChevronDown aria-hidden="true" size={16} />
        </span>
      </summary>
      <form
        className="panel crew-direct-invite-form"
        onSubmit={(event) => void submit(event)}
      >
        {mayBook ? (
          <fieldset className="crew-direct-mode">
            <legend>How</legend>
            <label>
              <input checked={mode === "offer"} name="crew-direct-mode" onChange={() => setMode("offer")} type="radio" />
              <span>
                <strong>Send an offer</strong>
                <small>They accept or decline. Nothing is booked until they say yes.</small>
              </span>
            </label>
            <label>
              <input checked={mode === "book"} name="crew-direct-mode" onChange={() => setMode("book")} type="radio" />
              <span>
                <strong>Book them now</strong>
                <small>For your staff, or when you can&rsquo;t wait for an answer. They&rsquo;re on the job right away.</small>
              </span>
            </label>
          </fieldset>
        ) : null}
        <div className="crew-cascade-config">
          <label className="form-span">
            Who
            <select
              onChange={(event) => {
                setCrewProfileId(event.target.value);
                setRateOverride(null);
              }}
              required
              value={crewProfileId}
            >
              <option value="">Choose from your directory…</option>
              {available.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {text(profile.name) || "Crew member"}
                  {booking && offerOut.has(profile.id)
                    ? " — offer waiting, book them now"
                    : lapsed.has(profile.id)
                      ? " — last offer ran out of time"
                      : ""}
                </option>
              ))}
            </select>
          </label>
          <label>
            Role
            <input
              onChange={(event) => setRoleEdit(event.target.value)}
              required
              value={role}
            />
          </label>
          <label>
            Arrival
            <input
              onChange={(event) => setStartsAtEdit(event.target.value)}
              required
              type="datetime-local"
              value={startsAt}
            />
          </label>
          <label>
            Departure
            <input
              onChange={(event) => setEndsAtEdit(event.target.value)}
              required
              type="datetime-local"
              value={endsAt}
            />
          </label>
          <label>
            Rate (USD)
            <input
              min="0"
              onChange={(event) => setRateOverride(event.target.value)}
              required
              step="0.01"
              type="number"
              value={rateDollars}
            />
          </label>
          <label className="form-span">
            What they are covering, one per line
            <textarea
              onChange={(event) => setResponsibilitiesEdit(event.target.value)}
              value={responsibilities}
            />
          </label>
        </div>
        {booking ? (
          <>
            <label className="crew-direct-notify">
              <input checked={notify} onChange={(event) => setNotify(event.target.checked)} type="checkbox" />
              <span>Email them that they&rsquo;re booked</span>
            </label>
            <p className="crew-direct-invite-note">
              {`${chosen ? text(chosen.name) : "They"} will be on this job right away, with the brief, the timeline and the checklist, just as if they had accepted. Any offer still waiting for this role is closed, and whoever it was waiting on is told it's filled.`}
            </p>
          </>
        ) : (
          <p className="crew-direct-invite-note">
            This skips candidate ranking and offers the job to{" "}
            {chosen ? <strong>{text(chosen.name)}</strong> : "one person"}{" "} only.
            They get an email with a link to accept, and the offer expires in
            seven days.
          </p>
        )}
        <button
          className="button button-dark"
          disabled={busy || !chosen}
          type="submit"
        >
          {booking ? <CalendarCheck size={15} /> : <Send size={15} />}
          {busy ? (booking ? "Booking…" : "Sending…") : booking ? `Book ${chosen ? text(chosen.name) : "them"}` : "Send offer"}
        </button>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
        {!available.length && profiles ? (
          <p className="form-notice" role="status">
            {booking
              ? "Everyone in your directory is already booked on this job. Add a crew member to book someone new."
              : "Everyone in your directory is already offered or booked on this job. Add a crew member to offer it to someone new."}
          </p>
        ) : null}
      </form>
    </details>
  );
}
