"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Send, UserRoundCheck } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { crewPublicError } from "@/lib/crew/public-error";
import { useReturnToJob } from "@/lib/projects/return-to-job";

const text = (value: unknown) => (typeof value === "string" ? value : "");
const localDateTime = (value: Date) => {
  const offset = value.getTimezoneOffset() * 60_000;
  return new Date(value.valueOf() - offset).toISOString().slice(0, 16);
};

/** The same obligations a cascade offer carries, so the two paths agree. */
const REQUIREMENTS = [
  {
    id: "w9",
    name: "W-9 on file",
    kind: "w9" as const,
    required: true,
    dueAt: null,
    instructions: "Upload a current signed W-9 for studio review.",
  },
  {
    id: "insurance",
    name: "Liability insurance",
    kind: "insurance" as const,
    required: true,
    dueAt: null,
    instructions: "Upload a current certificate of liability insurance.",
  },
  {
    id: "schedule",
    name: "Current schedule acknowledged",
    kind: "acknowledgement" as const,
    required: true,
    dueAt: null,
    instructions:
      "Review and acknowledge the current schedule before event day.",
  },
];

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
  const { records: projects } = useTenantDocuments("projects");
  const { records: profiles } = useTenantDocuments("crewProfiles");
  const { records: assignments } = useTenantDocuments("crewAssignments");
  const { records: schedules } = useTenantDocuments("schedules");

  const project = projects?.find((item) => item.id === projectId);
  const eventDate =
    text(project?.eventDate) || new Date().toISOString().slice(0, 10);

  // Someone already offered or booked on this job is not a candidate for a
  // second offer on it. The server would happily write a duplicate.
  const spokenFor = useMemo(() => {
    const taken = new Set<string>();
    for (const item of assignments ?? []) {
      if (item.projectId !== projectId) continue;
      if (["declined", "cancelled"].includes(text(item.status))) continue;
      taken.add(text(item.crewProfileId));
    }
    return taken;
  }, [assignments, projectId]);

  const available = (profiles ?? []).filter(
    (profile) => profile.active === true && !spokenFor.has(profile.id),
  );

  const latestSchedule = (schedules ?? [])
    .filter((item) => item.projectId === projectId)
    .sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0))[0];

  const [crewProfileId, setCrewProfileId] = useState("");
  const [role, setRole] = useState("Second photographer");
  // Derived, not stored. State initialises on the first render, when the
  // job is still loading and `eventDate` has fallen back to today — a
  // stored default would strand the offer on today's date for a wedding
  // months out. An override is only recorded once someone types one.
  const [startsAtEdit, setStartsAtEdit] = useState<string | null>(null);
  const [endsAtEdit, setEndsAtEdit] = useState<string | null>(null);
  const startsAt =
    startsAtEdit ?? localDateTime(new Date(`${eventDate}T12:00:00`));
  const endsAt = endsAtEdit ?? localDateTime(new Date(`${eventDate}T20:00:00`));
  const [responsibilities, setResponsibilities] = useState(
    "Ceremony reactions\nCocktail-hour candids",
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

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
      const response = await sendCrewCommand("inviteAssignment", {
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
        requirements: REQUIREMENTS,
      });
      if (response.persisted) {
        returnToJob({ delayMs: 1600 });
        setSent(text(chosen.name) || "They");
        setCrewProfileId("");
        setRateOverride(null);
        setStartsAtEdit(null);
        setEndsAtEdit(null);
        element.reset();
      } else {
        setNotice(
          "Development preview: the offer was validated but nothing was sent.",
        );
      }
    } catch (caught: unknown) {
      setNotice(
        crewPublicError(
          caught,
          "The offer could not be sent.",
          "CREW_DIRECT_INVITE_FAILED",
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
          <strong>Offer sent to {sent}</strong>
          <p>
            They have an email with the date, the role, the rate and a link to
            accept. It expires in seven days. You will see the answer under
            Assignments — nothing is booked until they accept.
          </p>
        </div>
        <span className="crew-direct-sent-actions">
          <button
            className="button button-light"
            onClick={() => setSent(null)}
            type="button"
          >
            Offer this job to someone else
          </button>
        </span>
      </section>
    );

  return (
    <details className="crew-direct-invite">
      <summary>
        <UserRoundCheck aria-hidden="true" size={15} />
        Already know who you want? Offer this job to one person
      </summary>
      <form
        className="panel crew-direct-invite-form"
        onSubmit={(event) => void submit(event)}
      >
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
                </option>
              ))}
            </select>
          </label>
          <label>
            Role
            <input
              onChange={(event) => setRole(event.target.value)}
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
              onChange={(event) => setResponsibilities(event.target.value)}
              value={responsibilities}
            />
          </label>
        </div>
        <p className="crew-direct-invite-note">
          This skips candidate ranking and offers the job to{" "}
          {chosen ? <strong>{text(chosen.name)}</strong> : "one person"} only.
          They get an email with a link to accept, and the offer expires in
          seven days.
        </p>
        <button
          className="button button-dark"
          disabled={busy || !chosen}
          type="submit"
        >
          <Send size={15} />
          {busy ? "Sending…" : "Send offer"}
        </button>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
        {!available.length && profiles ? (
          <p className="form-notice" role="status">
            Everyone in your directory is already offered or booked on this job.
            Add a crew member to offer it to someone new.
          </p>
        ) : null}
      </form>
    </details>
  );
}
