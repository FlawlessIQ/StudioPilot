"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CalendarDays,
  CalendarX2,
  Camera,
  CheckCircle2,
  Clock3,
  FileCheck2,
  LoaderCircle,
  MapPin,
  ShieldCheck,
} from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { AssignmentActions } from "@/components/crew/assignment-actions";
import { CrewDocumentUpload } from "@/components/crew/document-upload";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  initials,
  useWorkspace,
} from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { dataIsLive } from "@/lib/runtime-mode";

type Value = Record<string, unknown> & { id: string };
type CrewData = {
  assignments: Value[];
  projects: Record<string, Value>;
  profile: Value | null;
  availability: Value[];
  loading: boolean;
  error: string | null;
};

const text = (value: unknown, fallback = "Pending") =>
  typeof value === "string" && value ? value : fallback;
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const dateTime = (value: unknown) => {
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf())
    ? "Time pending"
    : parsed.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};
const money = (cents: unknown, currency: unknown) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: text(currency, "USD"),
  }).format(number(cents) / 100);

function useCrewData(): CrewData {
  const workspace = useWorkspace();
  const [state, setState] = useState<CrewData>({
    assignments: [],
    projects: {},
    profile: null,
    availability: [],
    loading: dataIsLive,
    error: null,
  });
  useEffect(() => {
    if (!dataIsLive || workspace.loading) return;
    if (!workspace.tenantId || !workspace.userId) {
      queueMicrotask(() =>
        setState((current) => ({
          ...current,
          loading: false,
          error: "No active crew membership was found.",
        })),
      );
      return;
    }
    let active = true;
    const { firestore } = getFirebaseClient();
    void Promise.all([
      getDocs(
        query(
          collection(firestore, "crewAssignments"),
          where("tenantId", "==", workspace.tenantId),
          where("userId", "==", workspace.userId),
          limit(100),
        ),
      ),
      getDocs(
        query(
          collection(firestore, "crewProfiles"),
          where("tenantId", "==", workspace.tenantId),
          where("userId", "==", workspace.userId),
          limit(1),
        ),
      ),
      getDocs(
        query(
          collection(firestore, "crewAvailability"),
          where("tenantId", "==", workspace.tenantId),
          where("userId", "==", workspace.userId),
          limit(100),
        ),
      ),
    ])
      .then(async ([assignmentsSnapshot, profileSnapshot, availabilitySnapshot]) => {
        const assignments = assignmentsSnapshot.docs.map(
          (document) =>
            ({ id: document.id, ...document.data() }) as Value,
        );
        const projectIds = Array.from(
          new Set(
            assignments
              .map((assignment) => assignment.projectId)
              .filter((projectId): projectId is string => typeof projectId === "string"),
          ),
        );
        const projectDocuments = await Promise.all(
          projectIds.map((projectId) =>
            getDoc(doc(firestore, "projects", projectId)),
          ),
        );
        if (!active) return;
        setState({
          assignments,
          projects: Object.fromEntries(
            projectDocuments
              .filter((project) => project.exists())
              .map((project) => [
                project.id,
                { id: project.id, ...project.data() } as Value,
              ]),
          ),
          profile: profileSnapshot.docs[0]
            ? ({
                id: profileSnapshot.docs[0].id,
                ...profileSnapshot.docs[0].data(),
              } as Value)
            : null,
          availability: availabilitySnapshot.docs.map(
            (document) =>
              ({ id: document.id, ...document.data() }) as Value,
          ),
          loading: false,
          error: null,
        });
      })
      .catch((caught: unknown) => {
        if (active)
          setState((current) => ({
            ...current,
            loading: false,
            error:
              caught instanceof Error
                ? caught.message
                : "Crew workspace data could not be loaded.",
          }));
      });
    return () => {
      active = false;
    };
  }, [
    workspace.loading,
    workspace.tenantId,
    workspace.userId,
  ]);
  return state;
}

function CrewState({
  data,
  empty,
}: {
  data: CrewData;
  empty?: string;
}) {
  if (data.loading)
    return (
      <section className="panel team-state">
        <LoaderCircle className="spin" />
        <span>
          <strong>Loading your assignments…</strong>
          <small>Only project-scoped crew records are being read.</small>
        </span>
      </section>
    );
  if (data.error)
    return (
      <section className="panel team-state">
        <ShieldCheck />
        <span>
          <strong>Crew workspace unavailable</strong>
          <small>{data.error}</small>
        </span>
      </section>
    );
  if (empty)
    return (
      <section className="panel team-state">
        <CalendarDays />
        <span>
          <strong>No records yet</strong>
          <small>{empty}</small>
        </span>
      </section>
    );
  return null;
}

function projectFor(data: CrewData, assignment: Value) {
  return data.projects[text(assignment.projectId, "")];
}

function assignmentLocation(assignment: Value) {
  const locations = Array.isArray(assignment.locations)
    ? (assignment.locations as Array<Record<string, unknown>>)
    : [];
  return locations[0] ?? null;
}

export function LiveCrewHome() {
  const workspace = useWorkspace();
  const data = useCrewData();
  if (data.loading || data.error)
    return <CrewState data={data} />;
  const pending = data.assignments.filter((assignment) =>
    ["invited", "viewed"].includes(String(assignment.status)),
  );
  const accepted = data.assignments.filter(
    (assignment) => assignment.status === "accepted",
  );
  const acknowledgementDue = accepted.find(
    (assignment) =>
      number(assignment.currentScheduleVersion) > 0 &&
      number(assignment.acknowledgedScheduleVersion) !==
        number(assignment.currentScheduleVersion),
  );
  const next = [...accepted].sort((a, b) =>
    String(a.arrivalAt).localeCompare(String(b.arrivalAt)),
  )[0];
  const project = next ? projectFor(data, next) : null;
  return (
    <div className="crew-mobile-page">
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">Crew workspace</p>
          <h1>Welcome, {workspace.userName.split(" ")[0]}.</h1>
          <p>
            {pending.length} invitation{pending.length === 1 ? "" : "s"} and{" "}
            {acknowledgementDue ? "one schedule acknowledgement" : "no schedule acknowledgements"} need attention.
          </p>
        </div>
        <StatusBadge tone={data.profile?.active ? "success" : "warning"}>
          {data.profile?.active ? "Profile active" : "Profile review"}
        </StatusBadge>
      </header>
      {acknowledgementDue ? (
        <section className="crew-next-action">
          <AlertTriangle />
          <span>
            <small>Readiness blocker</small>
            <strong>
              Acknowledge {text(projectFor(data, acknowledgementDue)?.name)}’s
              current schedule
            </strong>
          </span>
          <Link className="button button-dark" href="/crew/schedule">
            Review schedule <ArrowRight />
          </Link>
        </section>
      ) : null}
      {next && project ? (
        <section className="panel crew-upcoming-card">
          <div>
            <span>
              <p className="eyebrow">Next accepted job</p>
              <h2>{text(project.name)}</h2>
            </span>
            <StatusBadge tone="success">Accepted</StatusBadge>
          </div>
          <p>
            <MapPin /> {text(assignmentLocation(next)?.name, "Location pending")}
          </p>
          <dl>
            <div>
              <dt>Arrival</dt>
              <dd>{dateTime(next.arrivalAt)}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{text(next.role)}</dd>
            </div>
          </dl>
          <Link href="/crew/accepted">
            Open job brief <ArrowRight />
          </Link>
        </section>
      ) : (
        <CrewState data={data} empty="Accepted assignments will appear here." />
      )}
    </div>
  );
}

export function LiveCrewPending() {
  const data = useCrewData();
  if (data.loading || data.error) return <CrewState data={data} />;
  const pending = data.assignments.filter((assignment) =>
    ["invited", "viewed"].includes(String(assignment.status)),
  );
  return (
    <div className="crew-mobile-page">
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">Invitation queue</p>
          <h1>Pending jobs</h1>
          <p>Review responsibilities and visible compensation before responding.</p>
        </div>
      </header>
      {pending.length ? (
        pending.map((assignment) => {
          const project = projectFor(data, assignment);
          const location = assignmentLocation(assignment);
          return (
            <article className="panel crew-invitation-card" key={assignment.id}>
              <div>
                <span>
                  <p className="eyebrow">{text(assignment.role)}</p>
                  <h2>{text(project?.name)}</h2>
                </span>
                <StatusBadge tone="warning">Response requested</StatusBadge>
              </div>
              <p>
                <MapPin /> {text(location?.name, "Location pending")}
              </p>
              <div className="crew-invite-facts">
                <span>
                  <small>Arrival</small>
                  <strong>{dateTime(assignment.arrivalAt)}</strong>
                </span>
                <span>
                  <small>Departure</small>
                  <strong>{dateTime(assignment.departureAt)}</strong>
                </span>
                <span>
                  <small>Compensation</small>
                  <strong>
                    {assignment.compensationVisibleToCrew
                      ? money(assignment.compensationCents, assignment.currency)
                      : "Discuss with studio"}
                  </strong>
                </span>
              </div>
              <AssignmentActions
                assignmentId={assignment.id}
                projectId={text(assignment.projectId)}
                initialStatus={assignment.status === "viewed" ? "viewed" : "invited"}
                startsAt={text(assignment.arrivalAt)}
                endsAt={text(assignment.departureAt)}
                projectName={text(project?.name)}
                role={text(assignment.role)}
                location={text(location?.name)}
              />
            </article>
          );
        })
      ) : (
        <CrewState data={data} empty="You have no pending job invitations." />
      )}
    </div>
  );
}

export function LiveCrewAccepted() {
  const data = useCrewData();
  if (data.loading || data.error) return <CrewState data={data} />;
  const accepted = data.assignments.filter(
    (assignment) => assignment.status === "accepted",
  );
  return (
    <div className="crew-mobile-page">
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">Accepted work</p>
          <h1>Job briefs</h1>
          <p>Only assigned logistics, responsibilities, and contacts appear here.</p>
        </div>
      </header>
      {accepted.length ? (
        accepted.map((assignment) => {
          const project = projectFor(data, assignment);
          const locations = Array.isArray(assignment.locations)
            ? (assignment.locations as Array<Record<string, unknown>>)
            : [];
          return (
            <section className="panel crew-job-brief" key={assignment.id}>
              <div className="crew-job-brief-hero">
                <span>
                  <small>{text(project?.name)}</small>
                  <strong>{text(assignment.role)}</strong>
                </span>
                <span>
                  <small>Call time</small>
                  <strong>{dateTime(assignment.arrivalAt)}</strong>
                </span>
                <span>
                  <small>Wrap</small>
                  <strong>{dateTime(assignment.departureAt)}</strong>
                </span>
              </div>
              <div className="crew-contact-sheet">
                {locations.map((location) => (
                  <article key={text(location.name)}>
                    <MapPin />
                    <span>
                      <strong>{text(location.name)}</strong>
                      <small>{text(location.address, "Address pending")}</small>
                    </span>
                  </article>
                ))}
              </div>
              <div className="crew-scope-note">
                <ShieldCheck />
                <span>
                  <strong>Privacy boundary active</strong>
                  <small>Client invoices and unrelated project data remain hidden.</small>
                </span>
              </div>
              <AssignmentActions
                assignmentId={assignment.id}
                projectId={text(assignment.projectId)}
                initialStatus="accepted"
                currentScheduleId={
                  typeof assignment.currentScheduleId === "string"
                    ? assignment.currentScheduleId
                    : undefined
                }
                currentScheduleVersion={number(assignment.currentScheduleVersion)}
                startsAt={text(assignment.arrivalAt)}
                endsAt={text(assignment.departureAt)}
                projectName={text(project?.name)}
                role={text(assignment.role)}
                location={text(locations[0]?.name)}
              />
            </section>
          );
        })
      ) : (
        <CrewState data={data} empty="Accepted assignments will appear here." />
      )}
    </div>
  );
}

export function LiveCrewSchedule() {
  const data = useCrewData();
  const assignment = data.assignments.find(
    (item) => item.status === "accepted" && item.currentScheduleId,
  );
  const [schedule, setSchedule] = useState<Value | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  useEffect(() => {
    if (!assignment?.currentScheduleId) return;
    let active = true;
    void getDoc(
      doc(
        getFirebaseClient().firestore,
        "schedules",
        String(assignment.currentScheduleId),
      ),
    )
      .then((value) => {
        if (active && value.exists())
          setSchedule({ id: value.id, ...value.data() } as Value);
      })
      .catch((caught: unknown) => {
        if (active)
          setScheduleError(
            caught instanceof Error ? caught.message : "Schedule could not load.",
          );
      });
    return () => {
      active = false;
    };
  }, [assignment?.currentScheduleId]);
  if (data.loading || data.error) return <CrewState data={data} />;
  if (!assignment || !schedule)
    return (
      <CrewState
        data={{ ...data, error: scheduleError }}
        empty="No published schedule is assigned to an accepted job."
      />
    );
  const allowedIds = Array.isArray(assignment.scheduleItemIds)
    ? new Set(assignment.scheduleItemIds.map(String))
    : new Set<string>();
  const items = Array.isArray(schedule.items)
    ? (schedule.items as Array<Record<string, unknown>>).filter(
        (item) =>
          ["crew", "shared"].includes(text(item.visibility, "crew")) &&
          (allowedIds.size === 0 || allowedIds.has(text(item.id))),
      )
    : [];
  const project = projectFor(data, assignment);
  const acknowledged =
    number(assignment.acknowledgedScheduleVersion) === number(schedule.version);
  return (
    <div className="crew-mobile-page crew-event-day">
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">
            Version {number(schedule.version)} · {text(schedule.timezone)}
          </p>
          <h1>Event-day schedule</h1>
          <p>{text(project?.name)} · Your assigned segments only</p>
        </div>
        <StatusBadge tone={acknowledged ? "success" : "warning"}>
          {acknowledged ? "Acknowledged" : "Acknowledgement due"}
        </StatusBadge>
      </header>
      <section className="crew-event-timeline">
        {items.map((item) => (
          <article key={text(item.id)}>
            <time>
              <strong>{dateTime(item.startAt)}</strong>
              <small>{dateTime(item.endAt)}</small>
            </time>
            <i />
            <div>
              <h2>{text(item.title)}</h2>
              <p>
                <MapPin /> {text(item.location, "Location pending")}
              </p>
              <small>{text(item.description, "See assignment brief")}</small>
            </div>
          </article>
        ))}
      </section>
      <div className="crew-mobile-action-bar">
        <AssignmentActions
          assignmentId={assignment.id}
          projectId={text(assignment.projectId)}
          initialStatus="accepted"
          currentScheduleId={schedule.id}
          currentScheduleVersion={number(schedule.version)}
          startsAt={text(assignment.arrivalAt)}
          endsAt={text(assignment.departureAt)}
          projectName={text(project?.name)}
          role={text(assignment.role)}
          location={text(assignmentLocation(assignment)?.name)}
        />
      </div>
    </div>
  );
}

export function LiveCrewRequirements() {
  const data = useCrewData();
  if (data.loading || data.error) return <CrewState data={data} />;
  const assignment =
    data.assignments.find((item) => item.status === "accepted") ??
    data.assignments.find((item) => item.status === "viewed");
  if (!assignment)
    return <CrewState data={data} empty="Requirements appear after you open an assignment." />;
  const requirements = Array.isArray(assignment.requirements)
    ? (assignment.requirements as Array<Record<string, unknown>>)
    : [];
  const complete = requirements.filter((item) =>
    ["complete", "waived"].includes(String(item.status)),
  ).length;
  return (
    <div className="crew-mobile-page">
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">Assignment evidence</p>
          <h1>Requirements</h1>
          <p>These deterministic gates control assignment readiness.</p>
        </div>
      </header>
      <div className="crew-requirements-summary">
        <ShieldCheck />
        <span>
          <strong>
            {complete} of {requirements.length} complete
          </strong>
          <small>Provider and studio evidence remain authoritative.</small>
        </span>
        <StatusBadge tone={complete === requirements.length ? "success" : "warning"}>
          {complete === requirements.length ? "Ready" : "Not ready"}
        </StatusBadge>
      </div>
      <section className="panel crew-requirements-mobile">
        {requirements.map((item) => {
          const done = ["complete", "waived"].includes(String(item.status));
          return (
            <article key={text(item.id)}>
              {done ? <CheckCircle2 /> : <AlertTriangle className="crew-warning-icon" />}
              <span>
                <strong>{text(item.name)}</strong>
                <small>{text(item.kind)}</small>
              </span>
              <StatusBadge tone={done ? "success" : "warning"}>
                {text(item.status).replaceAll("_", " ")}
              </StatusBadge>
            </article>
          );
        })}
      </section>
    </div>
  );
}

export function LiveCrewDocuments() {
  const data = useCrewData();
  if (data.loading || data.error) return <CrewState data={data} />;
  const assignment = data.assignments.find((item) =>
    ["accepted", "viewed"].includes(String(item.status)),
  );
  if (!assignment)
    return <CrewState data={data} empty="Document requirements appear with an assignment." />;
  const requirements = Array.isArray(assignment.requirements)
    ? (assignment.requirements as Array<Record<string, unknown>>)
    : [];
  const upload = requirements.find(
    (item) =>
      item.required === true &&
      !["complete", "waived"].includes(String(item.status)) &&
      ["w9", "insurance", "file"].includes(String(item.kind)),
  );
  return (
    <div className="crew-mobile-page">
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">Secure files</p>
          <h1>Documents</h1>
          <p>Only requirements attached to your assigned job appear here.</p>
        </div>
      </header>
      <div className="crew-scope-note">
        <ShieldCheck />
        <span>
          <strong>Private by default</strong>
          <small>Client contracts, invoices, and galleries are never exposed.</small>
        </span>
      </div>
      <section className="panel crew-document-list">
        {requirements.map((item) => (
          <article key={text(item.id)}>
            <FileCheck2 />
            <span>
              <strong>{text(item.name)}</strong>
              <small>{text(item.kind)}</small>
            </span>
            <StatusBadge
              tone={["complete", "waived"].includes(String(item.status)) ? "success" : "warning"}
            >
              {text(item.status).replaceAll("_", " ")}
            </StatusBadge>
          </article>
        ))}
      </section>
      {upload ? (
        <CrewDocumentUpload
          projectId={text(assignment.projectId)}
          assignmentId={assignment.id}
          requirementId={text(upload.id)}
          requirementName={text(upload.name)}
        />
      ) : null}
    </div>
  );
}

export function LiveCrewProfile() {
  const data = useCrewData();
  if (data.loading || data.error || !data.profile)
    return <CrewState data={data} empty={!data.loading && !data.error ? "Your crew profile is not linked yet." : undefined} />;
  const profile = data.profile;
  const specialties = Array.isArray(profile.specialties)
    ? profile.specialties.map(String)
    : [];
  const areas = Array.isArray(profile.serviceAreas)
    ? profile.serviceAreas.map(String)
    : [];
  const equipment = Array.isArray(profile.equipment)
    ? profile.equipment.map(String)
    : [];
  return (
    <div className="crew-mobile-page">
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">Crew profile</p>
          <h1>{text(profile.name)}</h1>
          <p>{specialties.join(", ") || "Photography collaborator"}</p>
        </div>
        <StatusBadge tone={profile.active ? "success" : "warning"}>
          {profile.active ? "Active" : "Inactive"}
        </StatusBadge>
      </header>
      <section className="crew-profile-detail">
        <article className="panel">
          <div className="crew-profile-title">
            <span className="avatar avatar-sand">{initials(text(profile.name))}</span>
            <span>
              <h2>Professional details</h2>
              <small>Visible only to permitted studio operators</small>
            </span>
          </div>
          <dl>
            <div>
              <dt>
                <Camera /> Specialties
              </dt>
              <dd>{specialties.join(", ") || "Not provided"}</dd>
            </div>
            <div>
              <dt>
                <MapPin /> Service area
              </dt>
              <dd>
                {areas.join(", ") || "Not provided"} ·{" "}
                {number(profile.travelRadiusMiles)} miles
              </dd>
            </div>
            <div>
              <dt>
                <ShieldCheck /> Documents
              </dt>
              <dd>
                W-9 {text(profile.w9Status)} · Insurance{" "}
                {text(profile.insuranceStatus)} · Contract{" "}
                {text(profile.contractStatus)}
              </dd>
            </div>
          </dl>
        </article>
        <article className="panel">
          <p className="eyebrow">Equipment</p>
          <h2>Declared event kit</h2>
          {equipment.length ? (
            <ul>
              {equipment.map((item) => (
                <li key={item}>
                  <CheckCircle2 /> {item}
                </li>
              ))}
            </ul>
          ) : (
            <p>No equipment has been recorded.</p>
          )}
          <Link className="button button-light" href="/crew/availability">
            <CalendarDays /> Manage availability
          </Link>
        </article>
      </section>
    </div>
  );
}

export function LiveCrewAvailability() {
  const data = useCrewData();
  const [notice, setNotice] = useState<string | null>(null);
  if (data.loading || data.error || !data.profile)
    return <CrewState data={data} empty={!data.loading && !data.error ? "Link a crew profile before recording availability." : undefined} />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form);
    setNotice(null);
    try {
      await sendCrewCommand("setAvailability", {
        crewProfileId: data.profile?.id,
        startsAt: new Date(String(value.get("startsAt"))).toISOString(),
        endsAt: new Date(String(value.get("endsAt"))).toISOString(),
        status: String(value.get("status")),
        notes: String(value.get("notes")) || null,
      });
      setNotice("Availability saved. Refresh to see the new entry.");
      form.reset();
    } catch (caught: unknown) {
      setNotice(
        caught instanceof Error ? caught.message : "Availability could not be saved.",
      );
    }
  }
  return (
    <div className="crew-mobile-page">
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">Your calendar</p>
          <h1>Availability</h1>
          <p>Availability helps studios plan; accepted assignments remain authoritative.</p>
        </div>
      </header>
      <form className="panel crew-availability-form" onSubmit={(event) => void submit(event)}>
        <label>
          Starts
          <input name="startsAt" type="datetime-local" required />
        </label>
        <label>
          Ends
          <input name="endsAt" type="datetime-local" required />
        </label>
        <label>
          Status
          <select name="status" defaultValue="available">
            <option value="available">Available</option>
            <option value="tentative">Tentative</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <label>
          Notes
          <input name="notes" maxLength={1000} />
        </label>
        <button className="button button-dark" type="submit">
          Save availability
        </button>
      </form>
      <section className="panel crew-availability-list">
        {data.availability
          .sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)))
          .map((item) => {
            const status = text(item.status);
            return (
              <article key={item.id}>
                {status === "available" ? (
                  <CalendarCheck />
                ) : status === "unavailable" ? (
                  <CalendarX2 />
                ) : (
                  <Clock3 />
                )}
                <time>
                  <strong>{dateTime(item.startsAt)}</strong>
                  <small>to {dateTime(item.endsAt)}</small>
                </time>
                <StatusBadge
                  tone={
                    status === "available"
                      ? "success"
                      : status === "unavailable"
                        ? "danger"
                        : "warning"
                  }
                >
                  {status}
                </StatusBadge>
              </article>
            );
          })}
      </section>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </div>
  );
}
