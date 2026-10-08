"use client";

import { mcScriptLine, type McScript } from "@/features/schedules/mc-script";
import { useEffect, useState } from "react";
import { AlertTriangle, CalendarPlus, CheckCircle2, MapPin, Navigation, Phone, WifiOff } from "lucide-react";
import { doc, getDoc } from "firebase/firestore";
import { Actions, Button, Card, Main, Note, PoweredBy } from "@/components/kit/kit";
import { CrewClientBrief } from "@/components/crew/client-brief";
import { useWorkspace } from "@/features/auth/workspace-context";
import { normalizePhone } from "@/features/contacts/schema";
import { mockCrewSchedule } from "@/features/crew/mock-crew";
import { scheduleZoneLabel } from "@/features/schedules/item-clock";
import { itemIncludesCrew } from "@/features/schedules/item-crew";
import { downloadAssignmentCalendar } from "@/lib/crew/calendar-file";
import { crewPublicError } from "@/lib/crew/public-error";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import {
  assignmentPlace,
  crewCommand,
  CrewLoadState,
  dayLabel,
  endsAt,
  jobName,
  list,
  number,
  projectFor,
  record,
  text,
  timeLabel,
  useAssignmentParam,
  useCrewData,
  type CrewData,
  type Value,
} from "@/components/crew/kit/crew-data";
import { StudioMessage } from "@/components/crew/kit/crew-parts";
import { InfoHint } from "@/components/ui/info-hint";

type CachedCrewBrief = {
  /** Absent on copies saved before the client's brief was kept offline. */
  projectId?: string;
  /** The planner's timeline is the real one for this wedding. */
  plannerLed?: boolean;
  projectName: string;
  role: string;
  arrivalAt: string;
  departureAt: string;
  locations: Array<{ name: string; address: string | null }>;
  responsibilities: string[];
  scheduleId: string;
  scheduleVersion: number;
  timezone: string;
  items: Array<Record<string, unknown>>;
  /** Every id this person is known by, to mark their segments offline. Absent on older copies. */
  crewIdentities?: string[];
  cachedAt: string;
};

/**
 * Every id a run of show may have used for this person.
 *
 * Segments name their crew by profile id (features/schedules/item-crew.ts),
 * but older ones used whatever the writer had — an assignment, a user id.
 */
function crewIdentities(assignment: Value, userId: string | null | undefined): string[] {
  return [assignment.id, text(assignment.crewProfileId), text(assignment.userId), userId ?? ""].filter(Boolean);
}

const directions = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/** On a planner-run wedding, this brief is the studio's plan, not the day's. */
function PlannerLedNote() {
  return (
    <Note icon={AlertTriangle}>
      The planner keeps the timeline for this event. If the day runs differently, follow the planner and tell the
      studio.
    </Note>
  );
}

/**
 * The wedding-day screen (M6 of docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * What's now and next, where to go, who to ring, who not to photograph, the
 * must-have groups, and the running order, all in the event's own time zone.
 * It used to read times in the phone's zone ("Aug 19, 10:00 AM", wrapping),
 * stacked its actions on the tab bar, and had no shot list. A copy is saved
 * on the phone, because a barn venue has no signal.
 */
export function CrewDaySheet() {
  const workspace = useWorkspace();
  const data = useCrewData();
  const named = useAssignmentParam(data);
  const [now] = useState(() => Date.now());
  const nowIso = new Date(now).toISOString();
  const accepted = data.assignments.filter((item) => item.status === "accepted");
  const assignment =
    named ??
    accepted.filter((item) => endsAt(item) >= nowIso).sort((a, b) => String(a.arrivalAt).localeCompare(String(b.arrivalAt)))[0] ??
    null;
  const [scheduleState, setScheduleState] = useState<{ key: string | null; value: Value | null; error: string | null }>({
    key: null,
    value: null,
    error: null,
  });
  const [cachedBrief, setCachedBrief] = useState<CachedCrewBrief | null>(null);
  const scheduleViewKey = assignment?.currentScheduleId ? `${String(assignment.currentScheduleId)}_${assignment.id}` : null;
  const schedule = scheduleState.key === scheduleViewKey ? scheduleState.value : null;
  const scheduleError = scheduleState.key === scheduleViewKey ? scheduleState.error : null;
  const cacheKey =
    workspace.userId && assignment
      ? `studiocue:crew-event-brief:${workspace.userId}:${assignment.id}:${number(assignment.currentScheduleVersion)}`
      : null;

  useEffect(() => {
    if (!cacheKey) return;
    const timer = window.setTimeout(() => {
      try {
        const value = window.localStorage.getItem(cacheKey);
        if (value) setCachedBrief(JSON.parse(value) as CachedCrewBrief);
      } catch {
        // A malformed or blocked cache never replaces live data.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cacheKey]);

  // Offline, the job list is empty, so the copy can't be found through it.
  // Find it by the job in the link, else the most recently saved one.
  useEffect(() => {
    if (!data.error || cachedBrief) return;
    try {
      const uid = workspace.userId ?? (dataIsLive ? getFirebaseClient().auth.currentUser?.uid : null);
      if (!uid) return;
      const prefix = `studiocue:crew-event-brief:${uid}:`;
      const wanted = new URLSearchParams(window.location.search).get("assignment");
      const copies = Object.keys(window.localStorage)
        .filter((key) => key.startsWith(prefix) && (!wanted || key.startsWith(`${prefix}${wanted}:`)))
        .map((key) => JSON.parse(window.localStorage.getItem(key) ?? "null") as CachedCrewBrief | null)
        .filter((copy): copy is CachedCrewBrief => Boolean(copy))
        .sort((a, b) => b.cachedAt.localeCompare(a.cachedAt));
      if (copies[0]) queueMicrotask(() => setCachedBrief(copies[0]!));
    } catch {
      // A blocked or malformed copy: the error card stays.
    }
  }, [cachedBrief, data.error, workspace.userId]);

  useEffect(() => {
    if (!scheduleViewKey || !assignment) {
      queueMicrotask(() => setScheduleState({ key: null, value: null, error: null }));
      return;
    }
    let active = true;
    const load: Promise<Value | null> = dataIsLive
      ? getDoc(doc(getFirebaseClient().firestore, "crewScheduleViews", scheduleViewKey)).then((value) =>
          value.exists() ? ({ id: value.id, ...value.data() } as Value) : null,
        )
      : Promise.resolve(mockCrewSchedule(new Date(now)));
    void load
      .then((scheduleValue) => {
        if (!active) return;
        setScheduleState({ key: scheduleViewKey, value: scheduleValue, error: null });
        if (!scheduleValue || !cacheKey) return;
        const allowedIds = new Set(list(assignment.scheduleItemIds).map(String));
        const scopedItems = list(scheduleValue.items)
          .map(record)
          .filter(
            (item) =>
              ["crew", "shared"].includes(text(item.visibility, "crew")) &&
              (allowedIds.size === 0 || allowedIds.has(text(item.id))),
          );
        const project = data.projects[text(assignment.projectId)];
        // The fee is deliberately not in the saved copy.
        const brief: CachedCrewBrief = {
          projectId: text(assignment.projectId, ""),
          plannerLed: project?.timelineAuthority === "planner",
          projectName: jobName(data, assignment),
          role: text(assignment.role),
          arrivalAt: text(assignment.arrivalAt),
          departureAt: text(assignment.departureAt),
          locations: list(assignment.locations).map((location) => ({
            name: text(record(location).name),
            address: text(record(location).address) || null,
          })),
          responsibilities: list(assignment.responsibilities).map(String),
          scheduleId: text(scheduleValue.sourceScheduleId),
          scheduleVersion: number(scheduleValue.version),
          timezone: text(scheduleValue.timezone),
          items: scopedItems,
          crewIdentities: crewIdentities(assignment, workspace.userId),
          cachedAt: new Date().toISOString(),
        };
        try {
          window.localStorage.setItem(cacheKey, JSON.stringify(brief));
        } catch {
          // Storage full or blocked: the live sheet still shows.
        }
        setCachedBrief(brief);
      })
      .catch((caught: unknown) => {
        if (active)
          setScheduleState({
            key: scheduleViewKey,
            value: null,
            error: crewPublicError(caught, "The latest run of show couldn't be loaded.", "CREW_SCHEDULE_LOAD_FAILED"),
          });
      });
    return () => {
      active = false;
    };
    // `data` changes identity each render; the projects map is what's read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignment?.id, cacheKey, data.projects, scheduleViewKey]);

  if (data.loading) return <CrewLoadState data={data} title="Day sheet" />;
  // Offline at the venue: the saved copy, read-only.
  if ((data.error || scheduleError) && cachedBrief) return <OfflineCrewBrief brief={cachedBrief} now={now} />;
  if (data.error) return <CrewLoadState data={data} title="Day sheet" />;
  if (!assignment || !schedule)
    return (
      <Main label="Day sheet">
        <p className="kit-eyebrow">Day sheet</p>
        <h1 className="kit-title">{assignment ? jobName(data, assignment) : "Your day sheet"}</h1>
        <Card>
          <p className="kit-body" role={scheduleError ? "alert" : "status"}>
            {scheduleError ??
              (assignment
                ? "Your studio hasn't shared the run of show for this job yet. Ask them for it if the date is close."
                : "Your next job's day sheet appears here once you've accepted it.")}
          </p>
        </Card>
        {assignment ? (
          <StudioMessage
            assignment={assignment}
            jobName={jobName(data, assignment)}
            studioColor={workspace.tenantBrand?.primaryColor ?? null}
          />
        ) : null}
        <PoweredBy />
      </Main>
    );
  return <LiveDaySheet assignment={assignment} data={data} now={now} schedule={schedule} />;
}

function LiveDaySheet({
  data,
  assignment,
  schedule,
  now,
}: {
  data: CrewData;
  assignment: Value;
  schedule: Value;
  now: number;
}) {
  const workspace = useWorkspace();
  const [acknowledged, setAcknowledged] = useState(
    number(assignment.acknowledgedScheduleVersion) === number(schedule.version),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const project = projectFor(data, assignment);
  const zone = text(schedule.timezone) || undefined;
  const name = jobName(data, assignment);
  const version = number(schedule.version);
  const allowedIds = new Set(list(assignment.scheduleItemIds).map(String));
  const items = list(schedule.items)
    .map(record)
    .filter(
      (item) =>
        ["crew", "shared"].includes(text(item.visibility, "crew")) &&
        (allowedIds.size === 0 || allowedIds.has(text(item.id))),
    )
    .sort((a, b) => text(a.startAt).localeCompare(text(b.startAt)));
  // Acknowledging a run of show for a day already over isn't readiness.
  const past = Date.parse(endsAt(assignment)) <= now;
  const locations = list(assignment.locations).map(record);
  const responsibilities = list(assignment.responsibilities).map(String);
  const contacts = list(assignment.contacts).map(record);
  // Nothing writes `assignment.contacts` yet, so this is the number crew
  // actually get (features/tenants/identity.ts). Explicit empty fallbacks: a
  // "Pending" number once rendered a tel: link that dialled nothing.
  const studioPhone = text(data.studio?.eventDayPhone).trim();
  const studioName = text(data.studio?.brandName) || text(data.studio?.businessName);

  async function acknowledge() {
    setBusy(true);
    setError(null);
    try {
      await crewCommand("acknowledgeSchedule", {
        projectId: text(assignment.projectId),
        assignmentId: assignment.id,
        scheduleId: text(schedule.sourceScheduleId),
        scheduleVersion: version,
      });
      setAcknowledged(true);
      data.refresh();
    } catch (caught: unknown) {
      setError(crewPublicError(caught, "That couldn't be saved. Try again.", "CREW_SCHEDULE_ACKNOWLEDGE_FAILED"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Main label="Day sheet">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">
            {`Day sheet · version ${version}`} <InfoHint term="day-sheet" />
          </p>
          <h1 className="kit-title">{name}</h1>
          <p className="kit-body">
            {`${dayLabel(assignment.arrivalAt, zone)} · ${text(assignment.role, "Crew")}`}
          </p>
          <p className="kit-caption">
            {scheduleZoneLabel(zone) ? `Times in ${scheduleZoneLabel(zone)}, where the event is.` : "Times are local to the venue."}
          </p>
        </div>

        {project?.timelineAuthority === "planner" ? <PlannerLedNote/> : null}

        <NowNext items={items} now={now} zone={zone} />

        {locations.length ? (
          <section aria-label="Where" className="kit-stack-tight">
            <h2 className="kit-subsection">Where</h2>
            <ul className="kit-list">
              {locations.map((location) => (
                <li key={text(location.name)}>
                  <div className="kit-row">
                    <span className="kit-row-icon">
                      <MapPin aria-hidden size={20} />
                    </span>
                    <span className="kit-row-text">
                      <span className="kit-row-title">{text(location.name, "Venue")}</span>
                      <span className="kit-row-subtitle">{text(location.address, "Address to be confirmed")}</span>
                    </span>
                    {text(location.address) ? (
                      <a
                        className="kit-button"
                        data-size="compact"
                        data-variant="soft"
                        href={directions(text(location.address))}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <Navigation aria-hidden size={16} /> Go
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="kit-caption">{assignmentPlace(assignment, project)}</p>
        )}

        <section aria-label="Who to call" className="kit-stack-tight">
          <h2 className="kit-subsection">Who to call</h2>
          {contacts.length || studioPhone ? (
            <ul className="kit-list">
              {(contacts.length
                ? contacts
                : [{ name: studioName || "Your studio", role: "Studio", phone: studioPhone }]
              ).map((contact) => (
                <li key={`${text(contact.name)}-${text(contact.phone)}`}>
                  <div className="kit-row">
                    <span className="kit-row-icon">
                      <Phone aria-hidden size={20} />
                    </span>
                    <span className="kit-row-text">
                      <span className="kit-row-title">{text(contact.name, "Contact")}</span>
                      <span className="kit-row-subtitle">{text(contact.role, "Studio contact")}</span>
                    </span>
                    {text(contact.phone) ? (
                      <a
                        className="kit-button"
                        data-size="compact"
                        data-variant="soft"
                        href={`tel:${normalizePhone(text(contact.phone))}`}
                      >
                        <Phone aria-hidden size={16} /> Call
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="kit-caption">
              Your studio hasn&rsquo;t added a phone number. Ask them to add one in Settings → Studio identity, and
              message them below in the meantime.
            </p>
          )}
        </section>

        <CrewClientBrief projectId={text(assignment.projectId)} />

        {responsibilities.length ? (
          <section aria-label="Your role" className="kit-stack-tight">
            <h2 className="kit-subsection">Your role</h2>
            <ul className="kit-inclusions">
              {responsibilities.map((item) => (
                <li key={item}>
                  <CheckCircle2 aria-hidden size={16} /> {item}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-label="Running order" className="kit-stack-tight">
          <h2 className="kit-subsection">Running order</h2>
          <Timeline identities={crewIdentities(assignment, workspace.userId)} items={items} now={now} zone={zone} />
        </section>

        <StudioMessage
          assignment={assignment}
          eventDay
          jobName={name}
          studioColor={workspace.tenantBrand?.primaryColor ?? null}
        />
        {text(assignment.arrivalAt) && text(assignment.departureAt) && !past ? (
          <Button
            icon={CalendarPlus}
            onClick={() => {
              downloadAssignmentCalendar({
                assignmentId: assignment.id,
                startsAt: text(assignment.arrivalAt),
                endsAt: text(assignment.departureAt),
                projectName: name,
                role: text(assignment.role, "Crew"),
                sequence: typeof assignment.calendarSequence === "number" ? assignment.calendarSequence : 0,
                location: assignmentPlace(assignment, project),
              });
              void crewCommand("acknowledgeCalendar", {
                projectId: text(assignment.projectId),
                assignmentId: assignment.id,
              }).catch(() => undefined);
            }}
            variant="soft"
          >
            Add to my calendar
          </Button>
        ) : null}
        <p className="kit-caption">Saved on this phone, so it opens with no signal. Signing out removes it.</p>
        <PoweredBy />
      </Main>

      {!past ? (
        <Actions note={acknowledged ? undefined : "Your studio sees that you've read this version."}>
          {acknowledged ? (
            <p className="kit-body" role="status" style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center" }}>
              <CheckCircle2 aria-hidden size={18} /> {`You've read version ${version}`}
            </p>
          ) : (
            <Button disabled={busy} icon={CheckCircle2} onClick={() => void acknowledge()}>
              {busy ? "Saving…" : `I've read version ${version}`}
            </Button>
          )}
          {error ? (
            <p className="kit-error" role="alert">
              {error}
            </p>
          ) : null}
        </Actions>
      ) : null}
    </>
  );
}

/** What's happening now and what's next, or the call time before the day. */
function NowNext({ items, now, zone }: { items: Array<Record<string, unknown>>; now: number; zone?: string }) {
  if (!items.length) return null;
  const current = items.find((item) => Date.parse(text(item.startAt)) <= now && Date.parse(text(item.endAt)) > now);
  const next = items.find((item) => Date.parse(text(item.startAt)) > now);
  if (!current && !next) return null;
  const before = !current && next === items[0];
  return (
    <Card tone="accent">
      {current ? (
        <p className="kit-body">
          <span className="kit-eyebrow">Now</span>
          <br />
          <strong>{text(current.title)}</strong>
          {` until ${timeLabel(current.endAt, zone)}`}
        </p>
      ) : null}
      {next ? (
        <p className="kit-body">
          <span className="kit-eyebrow">{before ? "First up" : "Next"}</span>
          <br />
          <strong>{text(next.title)}</strong>
          {` at ${timeLabel(next.startAt, zone)}${text(next.location) ? `, ${text(next.location)}` : ""}`}
        </p>
      ) : null}
    </Card>
  );
}

function Timeline({
  identities,
  items,
  now,
  zone,
}: {
  /** Who is looking, so the segments they are on can say so. */
  identities: readonly string[];
  items: Array<Record<string, unknown>>;
  now: number;
  zone?: string;
}) {
  if (!items.length)
    return <p className="kit-caption">No parts of this run of show are assigned to you. Ask the studio before the day.</p>;
  const nextId = items.find((item) => Date.parse(text(item.endAt)) >= now)?.id;
  // The whole day stays visible — crew work around each other — but a
  // videographer on the speeches and not the formals should see which is which.
  const mine = (item: Record<string, unknown>) => itemIncludesCrew(item, identities);
  return (
    <ol aria-label="Running order" className="kit-timeline">
      {items.map((item) => (
        <li data-next={item.id === nextId || undefined} key={text(item.id)}>
          <span className="kit-timeline-time">
            {timeLabel(item.startAt, zone)}
            {text(item.endAt) ? <small>{`to ${timeLabel(item.endAt, zone)}`}</small> : null}
          </span>
          <span className="kit-timeline-body">
            <span className="kit-timeline-title">{text(item.title, "Detail to be confirmed")}</span>
            {mine(item) ? <span className="kit-timeline-mine">You&rsquo;re on this</span> : null}
            {text(item.location) ? (
              <span className="kit-timeline-place">
                <MapPin aria-hidden size={13} /> {text(item.location)}
              </span>
            ) : null}
            {text(item.description) ? <span className="kit-caption">{text(item.description)}</span> : null}
            {/* The DJ's script for the moment: song, what to say, and how to say the names. */}
            {mcScriptLine(item.mc as Partial<McScript> | undefined) ? (
              <span className="kit-caption">{mcScriptLine(item.mc as Partial<McScript> | undefined)}</span>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function OfflineCrewBrief({ brief, now }: { brief: CachedCrewBrief; now: number }) {
  const zone = brief.timezone || undefined;
  return (
    <Main label="Day sheet">
      <div className="kit-stack-tight">
        <p className="kit-eyebrow">{`Saved copy · version ${brief.scheduleVersion}`}</p>
        <h1 className="kit-title">{brief.projectName}</h1>
        <p className="kit-body">{`${dayLabel(brief.arrivalAt, zone)} · ${brief.role}`}</p>
      </div>
      <Note icon={WifiOff}>
        You&rsquo;re offline, so this is the copy saved on your phone. Reconnect before confirming anything. Your fee
        isn&rsquo;t stored in it.
      </Note>
      {brief.plannerLed ? <PlannerLedNote/> : null}
      <NowNext items={brief.items} now={now} zone={zone} />
      {brief.locations.map((location) => (
        <p className="kit-caption" key={location.name} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <MapPin aria-hidden size={14} /> {[location.name, location.address].filter(Boolean).join(", ")}
        </p>
      ))}
      {brief.projectId ? <CrewClientBrief projectId={brief.projectId} offline/> : null}
      <Timeline identities={brief.crewIdentities ?? []} items={brief.items} now={now} zone={zone} />
      <PoweredBy />
    </Main>
  );
}
