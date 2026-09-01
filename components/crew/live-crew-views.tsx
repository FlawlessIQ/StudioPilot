"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  CalendarCheck,
  CalendarDays,
  CalendarX2,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  FileCheck2,
  LoaderCircle,
  ListChecks,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  ReceiptText,
  RotateCw,
  Send,
  ShieldCheck,
  Trash2,
  UploadCloud,
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
import { splitUpcomingAndPast } from "@/features/ordering/attention";
import {
  offerCanBeAnswered,
  offerLapse,
  offerLapseNotice,
} from "@/features/crew/offer-moment";
import { greetingName } from "@/features/auth/session-failure";
import {
  initials,
  useWorkspace,
} from "@/features/auth/workspace-context";
import { getFirebaseClient } from "@/lib/firebase/client";
import { sendCrewCommand } from "@/lib/crew/command-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { withTimeout } from "@/lib/async/with-timeout";
import { crewPublicError } from "@/lib/crew/public-error";
import { statusLabel } from "@/features/format/status-label";

type Value = Record<string, unknown> & { id: string };
type CrewData = {
  assignments: Value[];
  projects: Record<string, Value>;
  profile: Value | null;
  availability: Value[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
};
type CrewDataState = Omit<CrewData, "refresh">;
type CachedCrewBrief = {
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
  cachedAt: string;
};

const text = (value: unknown, fallback = "Pending") =>
  typeof value === "string" && value ? value : fallback;
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
const dateTimeInput = (value: unknown) => {
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.valueOf())) return "";
  const local = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const money = (cents: unknown, currency: unknown) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: text(currency, "USD"),
  }).format(number(cents) / 100);

function useCrewData(): CrewData {
  const workspace = useWorkspace();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), []);
  const [state, setState] = useState<CrewDataState>({
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
    const assignedProjectIds = workspace.projectIds.slice(0, 100);
    void withTimeout(Promise.all([
      Promise.all(
        assignedProjectIds.map((projectId) =>
          getDocs(
            query(
              collection(firestore, "crewAssignments"),
              where("tenantId", "==", workspace.tenantId),
              where("projectId", "==", projectId),
              where("userId", "==", workspace.userId),
              limit(100),
            ),
          ),
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
    ]), 15_000, "Crew workspace data took too long to load. Try again.")
      .then(async ([assignmentSnapshots, profileSnapshot, availabilitySnapshot]) => {
        const assignments = assignmentSnapshots.flatMap((snapshot) =>
          snapshot.docs.map(
            (document) =>
              ({ id: document.id, ...document.data() }) as Value,
          ),
        );
        const projectIds = Array.from(
          new Set(
            assignments
              .map((assignment) => assignment.projectId)
              .filter((projectId): projectId is string => typeof projectId === "string"),
          ),
        );
        const projectDocuments = await withTimeout(
          Promise.all(
            projectIds.map((projectId) =>
              getDoc(doc(firestore, "projects", projectId)),
            ),
          ),
          10_000,
          "Crew project details took too long to load. Try again.",
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
            error: crewPublicError(
              caught,
              "Your crew workspace could not be loaded. Try again, or ask the studio to confirm your assignment.",
              "CREW_WORKSPACE_LOAD_FAILED",
            ),
          }));
      });
    return () => {
      active = false;
    };
  }, [
    workspace.loading,
    workspace.projectIds,
    workspace.tenantId,
    workspace.userId,
    refreshVersion,
  ]);
  return { ...state, refresh };
}

function CrewState({
  data,
  empty,
}: {
  data: CrewData;
  empty?: string;
}) {
  const workspace = useWorkspace();
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
        <span className="crew-state-actions">
          <button className="button button-light button-sm" onClick={workspace.retry} type="button">
            <RotateCw size={14} /> Try again
          </button>
          <Link className="button button-light button-sm" href="/crew/jobs">
            Return to jobs
          </Link>
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

function CrewPageState({
  eyebrow,
  title,
  description,
  data,
  empty,
}: {
  eyebrow: string;
  title: string;
  description: string;
  data: CrewData;
  empty?: string;
}) {
  return (
    <div className="crew-mobile-page">
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <CrewState data={data} empty={empty} />
      {empty ? (
        <aside className="crew-empty-guide" aria-label="Assignment notifications">
          {/* This asserted "No action is required right now" on every empty crew
              page — including the event-day brief of a second photographer with
              an accepted job four days out and no run of show. That reads as
              reassurance when the absence is itself the problem. True only when
              there is genuinely no accepted work. */}
          {(data.assignments ?? []).some(
            (item) => String(item.status) === "accepted",
          ) ? (
            <span><CalendarCheck /><strong>If a date is close and this is still empty, ask your studio</strong></span>
          ) : (
            <span><CheckCircle2 /><strong>No action is required right now</strong></span>
          )}
          <span><CalendarCheck /><strong>New work and schedule changes appear here</strong></span>
          <span><ShieldCheck /><strong>You only see jobs assigned to you</strong></span>
        </aside>
      ) : null}
    </div>
  );
}

function projectFor(data: CrewData, assignment: Value) {
  return data.projects[text(assignment.projectId, "")];
}

function useSelectedAssignment(
  data: CrewData,
  statuses: string[] = ["accepted", "viewed", "invited", "completed"],
  /**
   * Which end of the list to default to. "upcoming" is right for Schedule &
   * prep — the next job is what you are getting ready for. Closeout is the
   * opposite: it records work already done, and defaulting to a wedding three
   * days away meant submitting hours for an event that had not happened, while
   * the one 27 days overdue needed an extra step to reach.
   */
  prefer: "upcoming" | "past" = "upcoming",
) {
  const statusKey = statuses.join("|");
  const candidates = useMemo(
    () => {
      const allowed = statusKey.split("|");
      // Soonest upcoming first, then the most recent past work. Sorting
      // everything by arrival ascending opened Schedule & prep on a wedding
      // four weeks gone while the one in four days sat below it — the crew
      // portal's version of the same mistake Today made on the studio side.
      const now = new Date().toISOString();
      const withArrival = data.assignments.filter((item) =>
        allowed.includes(String(item.status)),
      );
      const upcoming = withArrival
        .filter((item) => String(item.arrivalAt) >= now)
        .sort((a, b) => String(a.arrivalAt).localeCompare(String(b.arrivalAt)));
      const past = withArrival
        .filter((item) => String(item.arrivalAt) < now)
        .sort((a, b) => String(b.arrivalAt).localeCompare(String(a.arrivalAt)));
      return prefer === "past"
        ? [...past, ...upcoming]
        : [...upcoming, ...past];
    },
    [data.assignments, statusKey, prefer],
  );
  const [selectedId, setSelectedId] = useState(() => {
    if (typeof window === "undefined") return "";
    return (
      new URLSearchParams(window.location.search).get("assignment") ??
      window.localStorage.getItem("studiocue:crew:selected-assignment") ??
      ""
    );
  });
  const select = (id: string) => {
    setSelectedId(id);
    window.localStorage.setItem("studiocue:crew:selected-assignment", id);
    const url = new URL(window.location.href);
    url.searchParams.set("assignment", id);
    window.history.replaceState({}, "", url);
  };
  return {
    candidates,
    selected:
      candidates.find((item) => item.id === selectedId) ?? candidates[0] ?? null,
    select,
  };
}

function AssignmentPicker({
  data,
  assignments,
  selected,
  onSelect,
}: {
  data: CrewData;
  assignments: Value[];
  selected: Value | null;
  onSelect: (id: string) => void;
}) {
  if (assignments.length < 2 || !selected) return null;
  return (
    <label className="crew-assignment-picker">
      <span><BriefcaseBusiness size={16} /> Active job</span>
      <span>
        <select value={selected.id} onChange={(event) => onSelect(event.target.value)}>
          {assignments.map((assignment) => (
            <option key={assignment.id} value={assignment.id}>
              {text(projectFor(data, assignment)?.name)} · {text(assignment.role)} · {dateTime(assignment.arrivalAt)}
            </option>
          ))}
        </select>
        <ChevronDown size={16} aria-hidden />
      </span>
    </label>
  );
}

function RequirementAction({
  data,
  assignment,
  requirement,
}: {
  data: CrewData;
  assignment: Value;
  requirement: Record<string, unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const kind = text(requirement.kind, "file");
  if (["w9", "insurance", "file"].includes(kind)) {
    return <Link className="button button-light button-sm" href={`/crew/documents?assignment=${encodeURIComponent(assignment.id)}`}><UploadCloud size={14}/> Upload document</Link>;
  }
  if (kind === "contract") {
    return <small className="crew-provider-requirement">The studio will send the signing request.</small>;
  }
  if (!["equipment", "acknowledgement"].includes(kind)) return null;
  const complete = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendCrewCommand("completeRequirement", {
        projectId: text(assignment.projectId),
        assignmentId: assignment.id,
        requirementId: text(requirement.id),
        documentId: null,
      });
      if (!response.persisted) {
        setNotice("Development preview only. Nothing was changed.");
        return;
      }
      data.refresh();
    } catch (caught: unknown) {
      setNotice(crewPublicError(caught, "The requirement could not be completed.", "CREW_REQUIREMENT_UPDATE_FAILED"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="crew-requirement-action">
      <button className="button button-light button-sm" type="button" disabled={busy} onClick={() => void complete()}>
        <CheckCircle2 size={14} /> {busy ? "Saving…" : kind === "equipment" ? "Confirm equipment" : "Acknowledge"}
      </button>
      {notice ? <small role="status">{notice}</small> : null}
    </span>
  );
}

function CrewProfileEditor({ data, profile }: { data: CrewData; profile: Value }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const csv = (value: unknown) => list(value).map(String).join(", ");
  const emergency = record(profile.emergencyContact);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const split = (name: string) => String(values.get(name) ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    setBusy(true);
    setNotice(null);
    try {
      const emergencyName = String(values.get("emergencyName") ?? "").trim();
      const emergencyPhone = String(values.get("emergencyPhone") ?? "").trim();
      const emergencyRelationship = String(values.get("emergencyRelationship") ?? "").trim();
      const response = await sendCrewCommand("updateCrewProfile", {
        crewProfileId: profile.id,
        phone: String(values.get("phone") ?? "").trim() || null,
        specialties: split("specialties"),
        serviceAreas: split("serviceAreas"),
        travelRadiusMiles: Number(values.get("travelRadiusMiles") ?? 0),
        equipment: split("equipment"),
        emergencyContact: emergencyName && emergencyPhone && emergencyRelationship
          ? { name: emergencyName, phone: emergencyPhone, relationship: emergencyRelationship }
          : null,
      });
      if (!response.persisted) {
        setNotice("Development preview only. Nothing was changed.");
        return;
      }
      setNotice("Profile updated.");
      setEditing(false);
      data.refresh();
    } catch (caught: unknown) {
      setNotice(crewPublicError(caught, "Your profile could not be updated.", "CREW_PROFILE_UPDATE_FAILED"));
    } finally {
      setBusy(false);
    }
  };
  if (!editing)
    return (
      <div className="crew-profile-edit-control">
        <button className="button button-light" type="button" onClick={() => setEditing(true)}>Edit professional details</button>
        {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      </div>
    );
  return (
    <form className="panel crew-profile-form" onSubmit={(event) => void submit(event)}>
      {/*
        Cancel used to sit in this header, beside the heading. On a phone that
        row wraps, so the first and only control above the fold was Cancel,
        looking like the thing to press — with Save seven fields below it. Both
        actions live together at the end now, in the order they rank, matching
        the availability form.
      */}
      <header><span><p className="eyebrow">Self-service profile</p><h2>Update your working details</h2></span></header>
      <label>Phone<input name="phone" defaultValue={text(profile.phone, "")} /></label>
      <label>Travel radius (miles)<input name="travelRadiusMiles" type="number" min="0" max="500" defaultValue={number(profile.travelRadiusMiles)} /></label>
      <label className="form-span">Specialties, separated by commas<input name="specialties" defaultValue={csv(profile.specialties)} /></label>
      <label className="form-span">Service areas, separated by commas<input name="serviceAreas" defaultValue={csv(profile.serviceAreas)} /></label>
      <label className="form-span">Equipment, separated by commas<textarea name="equipment" defaultValue={csv(profile.equipment)} /></label>
      <label>Emergency contact name<input name="emergencyName" defaultValue={text(emergency.name, "")} /></label>
      <label>Emergency contact phone<input name="emergencyPhone" defaultValue={text(emergency.phone, "")} /></label>
      <label>Relationship<input name="emergencyRelationship" defaultValue={text(emergency.relationship, "")} /></label>
      <div className="form-span crew-profile-editor-actions">
        <button className="button button-dark" disabled={busy} type="submit">{busy ? "Saving…" : "Save profile"}</button>
        <button className="button button-light" disabled={busy} type="button" onClick={() => setEditing(false)}>Cancel</button>
      </div>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </form>
  );
}

function StudioContactForm({ assignment, eventDay = false }: { assignment: Value; eventDay?: boolean }) {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<Value[]>([]);
  const [messageVersion, setMessageVersion] = useState(0);
  useEffect(() => {
    if (!dataIsLive || !workspace.tenantId || !workspace.userId) return;
    let active = true;
    void getDocs(query(
      collection(getFirebaseClient().firestore, "crewMessages"),
      where("tenantId", "==", workspace.tenantId),
      where("userId", "==", workspace.userId),
      where("assignmentId", "==", assignment.id),
      limit(50),
    )).then((snapshot) => {
      if (!active) return;
      setMessages(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Value).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
    }).catch(() => {
      if (active) setMessages([]);
    });
    return () => { active = false; };
  }, [assignment.id, messageVersion, workspace.tenantId, workspace.userId]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendCrewCommand("contactStudio", {
        projectId: text(assignment.projectId),
        assignmentId: assignment.id,
        subject: String(values.get("subject") ?? ""),
        message: String(values.get("message") ?? ""),
        urgency: eventDay ? "event_day" : "normal",
      });
      if (!response.persisted) { setNotice("Development preview only. Message not sent."); return; }
      setNotice("Message sent to the studio team.");
      form.reset();
      setOpen(false);
      setMessageVersion((value) => value + 1);
    } catch (caught: unknown) {
      setNotice(crewPublicError(caught, "Your message could not be sent.", "CREW_MESSAGE_SEND_FAILED"));
    } finally { setBusy(false); }
  };
  return (
    <div className="crew-contact-studio">
      <button className={eventDay ? "button button-dark" : "button button-light"} type="button" onClick={() => setOpen((value) => !value)}>
        <MessageCircle size={16} /> {eventDay ? "Contact studio now" : "Contact studio"}
      </button>
      {open ? (
        <form className="crew-contact-form" onSubmit={(event) => void submit(event)}>
          <label>Subject<input name="subject" required maxLength={160} defaultValue={eventDay ? "Event-day question" : "Assignment question"} /></label>
          <label>Message<textarea name="message" required maxLength={4000} /></label>
          <button className="button button-dark" type="submit" disabled={busy}><Send size={15} /> {busy ? "Sending…" : "Send securely"}</button>
        </form>
      ) : null}
      {messages.length ? <div className="crew-message-thread" aria-label="Assignment messages">{messages.slice(-5).map((message) => <article key={message.id} data-direction={text(message.direction)}><small>{message.direction === "studio_to_crew" ? "Studio" : "You"} · {dateTime(message.createdAt)}</small><strong>{text(message.subject)}</strong><p>{text(message.message)}</p></article>)}</div> : null}
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </div>
  );
}

function assignmentLocation(assignment: Value) {
  const locations = Array.isArray(assignment.locations)
    ? (assignment.locations as Array<Record<string, unknown>>)
    : [];
  return locations[0] ?? null;
}

/**
 * Where to turn up.
 *
 * An assignment only carries its own locations once a run of show pins them,
 * so before that the crew portal said "Location pending" on a wedding whose
 * venue has been on the project since booking. That is the single fact a
 * second shooter needs, and the product already knew it.
 */
function assignmentPlace(
  assignment: Value,
  project: Value | null | undefined,
): string {
  const named = text(assignmentLocation(assignment)?.name);
  if (named) return named;
  const venue = text(project?.venueName) || text(project?.city);
  return venue || "Location pending";
}

export function LiveCrewHome() {
  const workspace = useWorkspace();
  const data = useCrewData();
  if (data.loading || data.error)
    return <CrewPageState eyebrow="Crew workspace" title="Your assignments" description="See invitations, accepted work, and anything that needs your attention." data={data} />;
  const now = new Date();
  /**
   * Offers this person can actually take up.
   *
   * The count used to include every pending assignment, lapsed ones included,
   * so the page opened "You have 1 invitation to answer" for an offer whose
   * deadline had gone 26 days earlier — and then never showed it anywhere.
   */
  const pending = data.assignments.filter((assignment) =>
    offerCanBeAnswered({
      status: String(assignment.status),
      inviteExpiresAt: text(assignment.inviteExpiresAt),
      arrivalAt: text(assignment.arrivalAt),
      now,
    }),
  );
  const accepted = data.assignments.filter(
    (assignment) => assignment.status === "accepted",
  );
  /**
   * A schedule acknowledgement only matters before the day.
   *
   * "Readiness blocker · Acknowledge Maya & Theo Johnson's current schedule"
   * led the page thirteen days after that wedding was shot. Acknowledging a
   * run of show for an event already over is not readiness, and calling it a
   * blocker says something is at risk when nothing is.
   */
  const acknowledgementDue = accepted.find(
    (assignment) =>
      number(assignment.currentScheduleVersion) > 0 &&
      number(assignment.acknowledgedScheduleVersion) !==
        number(assignment.currentScheduleVersion) &&
      Date.parse(text(assignment.departureAt) || text(assignment.arrivalAt)) >
        now.valueOf(),
  );
  // Accepted work whose date has gone by. Not "completed" — the studio marks
  // that — but not upcoming either, which is the only thing Today claimed.
  const behindThem = accepted.filter(
    (assignment) =>
      Date.parse(text(assignment.departureAt) || text(assignment.arrivalAt)) <=
      now.valueOf(),
  );
  // Sorting every accepted assignment by arrival and taking the first put a
  // wedding from four weeks ago under the heading "Next accepted job".
  // What is next is what has not happened yet; if nothing has, say so rather
  // than presenting the most recent past job as upcoming.
  const nowIso = new Date().toISOString();
  const upcoming = accepted
    .filter((assignment) => String(assignment.arrivalAt) >= nowIso)
    .sort((a, b) => String(a.arrivalAt).localeCompare(String(b.arrivalAt)));
  const next = upcoming[0];
  const project = next ? projectFor(data, next) : null;
  return (
    <div className="crew-mobile-page">
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">Crew workspace</p>
          <h1>
            Welcome
            {greetingName(workspace.userName, workspace.tenantName)
              ? `, ${greetingName(workspace.userName, workspace.tenantName)}`
              : ""}
            .
          </h1>
          {/* Was "2 invitations and no schedule acknowledgements need
              attention." — a template that concatenated counts without handling
              zero, and parsed two ways. Only what actually needs him is named. */}
          <p>
            {(() => {
              const parts: string[] = [];
              if (pending.length)
                parts.push(
                  `${pending.length} invitation${pending.length === 1 ? "" : "s"} to answer`,
                );
              if (acknowledgementDue)
                parts.push("a schedule to acknowledge");
              return parts.length
                ? `You have ${parts.join(" and ")}.`
                : "Nothing needs you right now.";
            })()}
          </p>
          {/* The count was stated and then nothing on the page could act on it:
              "invitation" appeared exactly once, in that sentence, and the only
              card was an already-accepted job. */}
          {pending.length || acknowledgementDue ? (
            <Link className="button button-light" href={pending.length ? "/crew/pending" : "/crew/jobs"}>
              {pending.length ? "Answer your invitations" : "Open your jobs"}{" "}
              <ArrowRight size={15} />
            </Link>
          ) : null}
        </div>
        <StatusBadge tone={data.profile?.active ? "success" : "warning"}>
          {data.profile?.active ? "Profile active" : "Profile review"}
        </StatusBadge>
      </header>
      {pending.map((assignment) => {
        // The count was stated in the header and the offer appeared nowhere.
        const invited = projectFor(data, assignment);
        return (
          <section className="crew-next-action" key={assignment.id}>
            <AlertTriangle />
            <span>
              <small>Invitation to answer</small>
              <strong>
                {text(assignment.role) || "Crew role"} ·{" "}
                {text(invited?.name) || "Photography assignment"}
              </strong>
              <small>{dateTime(assignment.arrivalAt)}</small>
            </span>
            <Link className="button button-dark" href="/crew/pending">
              Accept or decline <ArrowRight />
            </Link>
          </section>
        );
      })}
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
          <Link className="button button-dark" href={`/crew/schedule?assignment=${encodeURIComponent(acknowledgementDue.id)}`}>
            Review schedule <ArrowRight />
          </Link>
        </section>
      ) : null}
      {!next && accepted.length ? (
        <section className="panel crew-upcoming-card is-clear">
          <div>
            <span>
              <p className="eyebrow">Nothing booked</p>
              <h2>No upcoming jobs right now</h2>
            </span>
          </div>
          <p>
            {behindThem.length
              ? `You have ${behindThem.length} past ${behindThem.length === 1 ? "assignment" : "assignments"} on file. New offers appear here.`
              : "New offers from your studio appear here."}
          </p>
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
            <MapPin /> {assignmentPlace(next, project)}
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
          <Link href={`/crew/prep?assignment=${encodeURIComponent(next.id)}`}>
            Open job brief <ArrowRight />
          </Link>
        </section>
      ) : accepted.length ? null : (
        // This rendered directly beneath the "Nothing booked" card, so the page
        // said "You have 1 assignment on file" and "No records yet" in sequence.
        <CrewState data={data} empty="Accepted assignments will appear here." />
      )}
    </div>
  );
}

export function LiveCrewJobs() {
  const data = useCrewData();
  if (data.loading || data.error)
    return <CrewPageState eyebrow="Your work" title="Jobs" description="Review offers, prepare accepted work, and keep completed assignments for your records." data={data} />;
  // Was sorted by arrival descending, which put the furthest-future job first
  // and left a wedding shot 27 days ago sitting among live assignments with
  // "Open schedule & prep" beside it. Next job first; finished work after it.
  const listedAt = new Date();
  const split = splitUpcomingAndPast(data.assignments, (a) => a.arrivalAt);
  const assignments = [...split.upcoming, ...split.past];
  const firstPastId = split.past[0]?.id ?? null;
  return (
    <div className="crew-mobile-page">
      <header className="crew-portal-hero"><div><p className="eyebrow">Your work</p><h1>Jobs</h1><p>Every offer and assignment, with one clear status and next step.</p></div><StatusBadge tone="neutral">{assignments.length} total</StatusBadge></header>
      {assignments.length ? assignments.map((assignment) => {
        const project = projectFor(data, assignment);
        const status = statusLabel(assignment.status);
        const pending = ["invited", "viewed"].includes(String(assignment.status));
        const accepted = assignment.status === "accepted";
        const locations = list(assignment.locations).map(record);
        const responsibilities = list(assignment.responsibilities).map(String);
        return (
          <Fragment key={assignment.id}>
          {assignment.id === firstPastId ? (
            <p className="eyebrow crew-past-divider">Finished work</p>
          ) : null}
          <article className="panel crew-job-card-premium" data-status={status}>
            <header><span><p className="eyebrow">{text(assignment.role)}</p><h2>{text(project?.name)}</h2></span><StatusBadge tone={accepted || assignment.status === "completed" ? "success" : pending ? "warning" : "neutral"}>{status}</StatusBadge></header>
            <div className="crew-job-decision-grid">
              <span><Clock3/><small>On site</small><strong>{dateTime(assignment.arrivalAt)} – {dateTime(assignment.departureAt)}</strong></span>
              <span><MapPin/><small>{locations.length > 1 ? `${locations.length} locations` : "Location"}</small><strong>{locations.map((item) => text(item.name)).join(" · ") || assignmentPlace(assignment, project)}</strong></span>
              <span><CircleDollarSign/><small>{text(assignment.compensationType) ? `${text(assignment.compensationType)} rate` : "Fee"}</small><strong>{assignment.compensationVisibleToCrew ? money(assignment.compensationCents, assignment.currency) : "Contact studio"}</strong></span>
              {pending && text(assignment.inviteExpiresAt) ? (
                (() => {
                  // A deadline that has passed was rendered identically to a live
                  // one: "Respond by Aug 19, 10:00 AM" was still shown with Accept
                  // and Decline seven days later, and the studio's matching task
                  // sat in Today's "When you get to it" band for a wedding 22 days
                  // out. Between the two surfaces a wedding goes unstaffed quietly.
                  const expired =
                    new Date(text(assignment.inviteExpiresAt)).valueOf() < Date.now();
                  return (
                    <span data-expired={expired ? "true" : undefined}>
                      <CalendarDays/>
                      <small>{expired ? "Response was due" : "Respond by"}</small>
                      <strong>
                        {dateTime(assignment.inviteExpiresAt)}
                        {expired ? " · overdue" : ""}
                      </strong>
                    </span>
                  );
                })()
              ) : null}
            </div>
            {responsibilities.length ? <section className="crew-responsibilities"><strong>Responsibilities</strong><ul>{responsibilities.map((item) => <li key={item}><CheckCircle2 size={15}/>{item}</li>)}</ul></section> : <p className="crew-missing-detail"><AlertTriangle size={15}/> Responsibilities have not been supplied. Contact the studio before accepting.</p>}
            {pending ? <CrewOfferActions assignment={assignment} locationName={text(locations[0]?.name)} now={listedAt} onChanged={data.refresh} projectName={text(project?.name)} /> : null}
            {accepted ? <div className="crew-job-card-actions"><Link className="button button-dark" href={`/crew/prep?assignment=${encodeURIComponent(assignment.id)}`}>Open schedule & prep <ArrowRight size={15}/></Link><StudioContactForm assignment={assignment}/></div> : null}
            {assignment.status === "completed" ? <Link className="button button-light" href={`/crew/closeout?assignment=${encodeURIComponent(assignment.id)}`}>View closeout and payment <ArrowRight size={15}/></Link> : null}
          </article>
          </Fragment>
        );
      }) : <CrewState data={data} empty="New offers from your studio will appear here with the details you need to decide." />}
    </div>
  );
}

export function LiveCrewPrep() {
  const data = useCrewData();
  const [prepRenderedAt] = useState(() => Date.now());
  const selection = useSelectedAssignment(data, ["accepted"]);
  if (data.loading || data.error)
    return <CrewPageState eyebrow="Schedule & prep" title="Get ready" description="Everything required for your selected assignment." data={data} />;
  const assignment = selection.selected;
  if (!assignment)
    return <CrewPageState eyebrow="Schedule & prep" title="Get ready" description="Everything required for your selected assignment." data={data} empty="Accept a job to unlock its schedule and preparation checklist." />;
  const project = projectFor(data, assignment);
  const requirements = list(assignment.requirements).map(record);
  const incomplete = requirements.filter((item) => item.required === true && !["complete", "waived"].includes(String(item.status)));
  // The header said "Ready" while the row beneath it said "Not published".
  // A second photographer with no run of show four days out is not ready.
  const hasSchedule = number(assignment.currentScheduleVersion) > 0;
  // "Ready" is a claim about preparation for a day still ahead. It sat on this
  // header thirteen days after the wedding it was preparing for.
  const prepIsHistory =
    Date.parse(
      text(assignment.departureAt) || text(assignment.arrivalAt) || "",
    ) <= prepRenderedAt;
  const query = `?assignment=${encodeURIComponent(assignment.id)}`;
  return (
    <div className="crew-mobile-page">
      <AssignmentPicker data={data} assignments={selection.candidates} selected={assignment} onSelect={selection.select}/>
      <header className="crew-portal-hero"><div><p className="eyebrow">Schedule & prep</p><h1>{text(project?.name)}</h1><p>{text(assignment.role)} · {dateTime(assignment.arrivalAt)}</p></div><StatusBadge tone={prepIsHistory ? "neutral" : incomplete.length || !hasSchedule ? "warning" : "success"}>{prepIsHistory ? "The day has passed" : incomplete.length ? `${incomplete.length} actions due` : hasSchedule ? "Ready" : "Waiting on the schedule"}</StatusBadge></header>
      <section className="crew-prep-grid">
        <Link className="panel" href={`/crew/schedule${query}`}><CalendarDays/><span><small>Event schedule</small><strong>{number(assignment.currentScheduleVersion) ? `Version ${number(assignment.currentScheduleVersion)}` : "Not published"}</strong><em>{number(assignment.acknowledgedScheduleVersion) === number(assignment.currentScheduleVersion) && number(assignment.currentScheduleVersion) > 0 ? "Acknowledged" : "Review latest version"}</em></span><ArrowRight/></Link>
        <Link className="panel" href={`/crew/requirements${query}`}><ListChecks/><span><small>Requirements</small><strong>{requirements.length ? `${requirements.length - incomplete.length} of ${requirements.length} complete` : "None requested"}</strong><em>{!requirements.length ? "Nothing to prepare" : incomplete.length ? "Finish preparation" : "All clear"}</em></span><ArrowRight/></Link>
        <Link className="panel" href={`/crew/documents${query}`}><FileCheck2/><span><small>Secure documents</small><strong>{(() => {
          /* This counted every document requirement, complete ones included, so
             the hub said "1 requested" while Documents and Requirements both
             said 2 of 2 complete. Only what is still wanted is "requested". */
          const documents = requirements.filter((item) => ["w9", "insurance", "file"].includes(String(item.kind)));
          const outstanding = documents.filter((item) => incomplete.some((row) => row.id === item.id));
          if (!documents.length) return "None requested";
          return outstanding.length ? `${outstanding.length} still requested` : `All ${documents.length} on file`;
        })()}</strong><em>{requirements.filter((item) => ["w9", "insurance", "file"].includes(String(item.kind))).some((item) => incomplete.some((row) => row.id === item.id)) ? "Upload and track review" : "Nothing to upload"}</em></span><ArrowRight/></Link>
        <Link className="panel" href={`/crew/event-day${query}`}><Camera/><span><small>Event-day brief</small><strong>Timeline, locations & contacts</strong><em>Available offline</em></span><ArrowRight/></Link>
        <Link className="panel" href={`/crew/closeout${query}`}><ReceiptText/><span><small>After the event</small><strong>Hours, expenses & deliverables</strong><em>{text(record(assignment.closeout).status, "Not submitted")}</em></span><ArrowRight/></Link>
      </section>
      <StudioContactForm assignment={assignment}/>
    </div>
  );
}

export function LiveCrewAccount() {
  const data = useCrewData();
  if (data.loading || data.error)
    return <CrewPageState eyebrow="Your account" title="Profile & availability" description="Keep your working details current for this studio." data={data} />;
  return (
    <div className="crew-mobile-page"><header className="crew-portal-hero"><div><p className="eyebrow">Your account</p><h1>Profile & availability</h1><p>Maintain the details studios use to offer and schedule work.</p></div></header><section className="crew-account-grid"><Link className="panel" href="/crew/profile"><Camera/><span><strong>Professional profile</strong><small>Phone, specialties, service area, equipment and emergency contact</small></span><ArrowRight/></Link><Link className="panel" href="/crew/availability"><CalendarCheck/><span><strong>Availability</strong><small>Add, edit or remove the dates this studio can consider</small></span><ArrowRight/></Link></section></div>
  );
}

/**
 * Accept and Decline, or the reason they are gone.
 *
 * Both the Jobs list and the invitation queue rendered `AssignmentActions`
 * for any pending assignment, without asking whether the offer was still
 * live. See features/crew/offer-moment.ts.
 */
function CrewOfferActions({
  assignment,
  projectName,
  locationName,
  now,
  onChanged,
}: {
  assignment: Record<string, unknown> & { id: string };
  projectName: string;
  locationName: string;
  now: Date;
  onChanged: () => void;
}) {
  const lapse = offerLapse({
    status: String(assignment.status),
    inviteExpiresAt: text(assignment.inviteExpiresAt),
    arrivalAt: text(assignment.arrivalAt),
    now,
  });
  if (lapse) {
    const notice = offerLapseNotice(lapse);
    return (
      <div className="crew-action-result" role="status">
        <AlertTriangle size={18} />
        <span>
          <strong>{notice.title}</strong>
          <small>{notice.detail}</small>
        </span>
      </div>
    );
  }
  return (
    <AssignmentActions
      assignmentId={assignment.id}
      endsAt={text(assignment.departureAt)}
      initialStatus={assignment.status === "viewed" ? "viewed" : "invited"}
      location={locationName}
      onAssignmentChanged={onChanged}
      projectId={text(assignment.projectId)}
      projectName={projectName}
      role={text(assignment.role)}
      startsAt={text(assignment.arrivalAt)}
    />
  );
}

export function LiveCrewPending() {
  const data = useCrewData();
  if (data.loading || data.error) return <CrewPageState eyebrow="Invitation queue" title="Pending jobs" description="Review the job details before you accept or decline." data={data} />;
  const now = new Date();
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
                <StatusBadge
                  tone={
                    offerCanBeAnswered({
                      status: String(assignment.status),
                      inviteExpiresAt: text(assignment.inviteExpiresAt),
                      arrivalAt: text(assignment.arrivalAt),
                      now,
                    })
                      ? "warning"
                      : "neutral"
                  }
                >
                  {offerCanBeAnswered({
                    status: String(assignment.status),
                    inviteExpiresAt: text(assignment.inviteExpiresAt),
                    arrivalAt: text(assignment.arrivalAt),
                    now,
                  })
                    ? "Response requested"
                    : "No longer open"}
                </StatusBadge>
              </div>
              <p>
                <MapPin /> {assignmentPlace(assignment, project)}
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
              <CrewOfferActions
                assignment={assignment}
                locationName={text(location?.name)}
                now={now}
                onChanged={data.refresh}
                projectName={text(project?.name)}
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
  if (data.loading || data.error) return <CrewPageState eyebrow="Accepted work" title="Job briefs" description="Your assigned logistics, responsibilities, and contacts." data={data} />;
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
                initialCalendarStatus={text(assignment.calendarStatus, "not_added")}
                initialAcknowledgedScheduleVersion={number(assignment.acknowledgedScheduleVersion) || null}
                onAssignmentChanged={data.refresh}
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

function OfflineCrewBrief({ brief }: { brief: CachedCrewBrief }) {
  return (
    <div className="crew-mobile-page crew-event-day">
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">
            Offline-safe copy · Version {brief.scheduleVersion}
          </p>
          <h1>{brief.projectName}</h1>
          <p>
            {brief.role} · Cached{" "}
            {new Date(brief.cachedAt).toLocaleString()}
          </p>
        </div>
        <StatusBadge tone="warning">Read-only offline</StatusBadge>
      </header>
      <section className="crew-event-timeline">
        {brief.items.map((item) => (
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
      <div className="crew-scope-note">
        <ShieldCheck />
        <span>
          <strong>Role-scoped copy available without a connection</strong>
          <small>
            Reconnect before acknowledging this version or changing any record.
            Compensation and client-private data are not stored in this brief.
          </small>
        </span>
      </div>
    </div>
  );
}

export function LiveCrewSchedule({ context = "schedule" }: { context?: "schedule" | "event-day" } = {}) {
  const workspace = useWorkspace();
  const data = useCrewData();
  const selection = useSelectedAssignment(data, ["accepted"]);
  const assignment = selection.selected;
  const [scheduleState, setScheduleState] = useState<{
    key: string | null;
    value: Value | null;
    error: string | null;
  }>({ key: null, value: null, error: null });
  const [cachedBrief, setCachedBrief] = useState<CachedCrewBrief | null>(null);
  const [renderedAt] = useState(() => Date.now());
  const scheduleViewKey = assignment?.currentScheduleId
    ? `${String(assignment.currentScheduleId)}_${assignment.id}`
    : null;
  const schedule = scheduleState.key === scheduleViewKey ? scheduleState.value : null;
  const scheduleError = scheduleState.key === scheduleViewKey ? scheduleState.error : null;
  const cacheKey = workspace.userId && assignment
    ? `studiocue:crew-event-brief:${workspace.userId}:${assignment.id}:${number(assignment.currentScheduleVersion)}`
    : null;
  useEffect(() => {
    if (!cacheKey) return;
    const timer = window.setTimeout(() => {
      try {
        const value = window.localStorage.getItem(cacheKey);
        if (value) setCachedBrief(JSON.parse(value) as CachedCrewBrief);
      } catch {
        // A malformed or blocked cache never replaces live project data.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [cacheKey]);
  useEffect(() => {
    if (!scheduleViewKey) {
      queueMicrotask(() => {
        setScheduleState({ key: null, value: null, error: null });
      });
      return;
    }
    let active = true;
    void getDoc(
      doc(
        getFirebaseClient().firestore,
        "crewScheduleViews",
        scheduleViewKey,
      ),
    )
      .then((value) => {
        if (active && value.exists()) {
          const scheduleValue = {
            id: value.id,
            ...value.data(),
          } as Value;
          setScheduleState({ key: scheduleViewKey, value: scheduleValue, error: null });
          if (cacheKey && assignment) {
            const allowedIds = new Set(
              list(assignment.scheduleItemIds).map(String),
            );
            const scopedItems = list(scheduleValue.items)
              .map(record)
              .filter(
                (item) =>
                  ["crew", "shared"].includes(
                    text(item.visibility, "crew"),
                  ) &&
                  (allowedIds.size === 0 || allowedIds.has(text(item.id))),
              );
            const project = data.projects[text(assignment.projectId, "")];
            const brief: CachedCrewBrief = {
              projectName: text(project?.name),
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
              cachedAt: new Date().toISOString(),
            };
            window.localStorage.setItem(cacheKey, JSON.stringify(brief));
            setCachedBrief(brief);
          }
        } else if (active) {
          setScheduleState({ key: scheduleViewKey, value: null, error: null });
        }
      })
      .catch((caught: unknown) => {
        if (active)
          setScheduleState({
            key: scheduleViewKey,
            value: null,
            error: crewPublicError(
              caught,
              "The latest schedule could not be loaded. Try again or return to Jobs.",
              "CREW_SCHEDULE_LOAD_FAILED",
            ),
          });
      });
    return () => {
      active = false;
    };
  }, [assignment, cacheKey, data.projects, scheduleViewKey]);
  const emptyTitle = context === "event-day" ? "Event-day brief" : "Schedule";
  if (data.loading)
    return <CrewPageState eyebrow="Event day" title={emptyTitle} description="Your assigned timeline and the version you need to acknowledge." data={data} />;
  if (data.error && cachedBrief) return <OfflineCrewBrief brief={cachedBrief} />;
  if (data.error)
    return <CrewPageState eyebrow="Event day" title={emptyTitle} description="Your assigned timeline and the version you need to acknowledge." data={data} />;
  if (!assignment || !schedule)
    return (
      <CrewPageState
        eyebrow="Event day"
        title={emptyTitle}
        description="Your assigned timeline and the version you need to acknowledge."
        data={{ ...data, error: scheduleError }}
        empty="Your studio has not shared the run of show for this job yet. Ask them for it if the date is close."
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
  /**
   * Whether acknowledging this run of show is still a live obligation.
   *
   * "Acknowledgement due" sat on the brief for a wedding shot thirteen days
   * earlier, next to "Download calendar file again" for a date in the past.
   * After the day, the brief is a record of what happened.
   */
  const dayIsBehindThem =
    Date.parse(
      text(assignment.departureAt) || text(assignment.arrivalAt) || "",
    ) <= renderedAt;
  const locations = list(assignment.locations).map(record);
  const responsibilities = list(assignment.responsibilities).map(String);
  const contacts = list(assignment.contacts).map(record);
  const nextItemId = items.find((item) => Date.parse(text(item.endAt, "")) >= renderedAt)?.id;
  return (
    <div className="crew-mobile-page crew-event-day">
      <AssignmentPicker
        data={data}
        assignments={selection.candidates}
        selected={assignment}
        onSelect={selection.select}
      />
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">
            Version {number(schedule.version)} · {text(schedule.timezone)}
          </p>
          {/* Two routes rendered this page identically, and `context` changed
              only the empty-state title — so /crew/schedule and
              /crew/event-day produced byte-identical output. */}
          <h1>{context === "event-day" ? "Event-day brief" : "Event-day schedule"}</h1>
          <p>{text(project?.name)} · Your assigned segments only</p>
        </div>
        <StatusBadge
          tone={acknowledged ? "success" : dayIsBehindThem ? "neutral" : "warning"}
        >
          {acknowledged
            ? "Acknowledged"
            : dayIsBehindThem
              ? "The day has passed"
              : "Acknowledgement due"}
        </StatusBadge>
      </header>
      <section className="crew-event-brief-grid">
        <article className="panel crew-brief-panel"><p className="eyebrow">Your role</p><h2>{text(assignment.role)}</h2><ul>{responsibilities.length ? responsibilities.map((item) => <li key={item}><CheckCircle2 size={14}/>{item}</li>) : <li><AlertTriangle size={14}/>Confirm responsibilities with the studio.</li>}</ul></article>
        <article className="panel crew-brief-panel"><p className="eyebrow">Locations & access</p>{locations.map((location) => <div className="crew-event-location" key={text(location.name)}><MapPin/><span><strong>{text(location.name)}</strong><small>{text(location.address, "Address pending")}</small>{location.address ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text(location.address))}`} target="_blank" rel="noreferrer">Directions <ExternalLink size={12}/></a> : null}</span></div>)}</article>
        <article className="panel crew-brief-panel"><p className="eyebrow">Event contacts</p>{contacts.length ? contacts.map((contact) => <div className="crew-event-contact" key={`${text(contact.name)}-${text(contact.phone)}`}><Phone/><span><strong>{text(contact.name)}</strong><small>{text(contact.role, "Studio contact")}</small>{contact.phone ? <a href={`tel:${text(contact.phone)}`}>{text(contact.phone)}</a> : null}</span></div>) : <p>No event contact has been shared. Use the secure studio message below.</p>}<StudioContactForm assignment={assignment} eventDay/></article>
      </section>
      <section className="crew-event-timeline">
        {items.length ? items.map((item) => (
          <article key={text(item.id)} className={item.id === nextItemId ? "is-next" : undefined}>
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
        )) : <p className="crew-empty-timeline">The current schedule has no segments assigned to your role. Contact the studio before event day.</p>}
      </section>
      <div className="crew-mobile-action-bar">
        <AssignmentActions
          assignmentId={assignment.id}
          projectId={text(assignment.projectId)}
          initialStatus="accepted"
          currentScheduleId={text(schedule.sourceScheduleId)}
          currentScheduleVersion={number(schedule.version)}
          startsAt={text(assignment.arrivalAt)}
          endsAt={text(assignment.departureAt)}
          projectName={text(project?.name)}
          role={text(assignment.role)}
          location={text(assignmentLocation(assignment)?.name)}
          initialCalendarStatus={text(assignment.calendarStatus, "not_added")}
          initialAcknowledgedScheduleVersion={number(assignment.acknowledgedScheduleVersion) || null}
          onAssignmentChanged={data.refresh}
        />
      </div>
    </div>
  );
}

export function LiveCrewRequirements() {
  const data = useCrewData();
  const [renderedAt] = useState(() => Date.now());
  const selection = useSelectedAssignment(data, ["accepted", "viewed"]);
  if (data.loading || data.error) return <CrewPageState eyebrow="Assignment checklist" title="Requirements" description="Complete the items your studio needs before event day." data={data} />;
  const assignment = selection.selected;
  if (!assignment)
    return <CrewPageState eyebrow="Assignment checklist" title="Requirements" description="Complete the items your studio needs before event day." data={data} empty="Requirements appear after you open an assignment." />;
  const requirements = Array.isArray(assignment.requirements)
    ? (assignment.requirements as Array<Record<string, unknown>>)
    : [];
  const complete = requirements.filter((item) =>
    ["complete", "waived"].includes(String(item.status)),
  ).length;
  // Once the date has gone, these are a record rather than a checklist.
  const requirementsAreHistory =
    Date.parse(
      text(assignment.departureAt) || text(assignment.arrivalAt) || "",
    ) <= renderedAt;
  return (
    <div className="crew-mobile-page">
      <AssignmentPicker data={data} assignments={selection.candidates} selected={assignment} onSelect={selection.select} />
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">Assignment evidence</p>
          <h1>Requirements</h1>
          <p>
            {/* Said "before the assignment is confirmed" on an assignment that
                had been accepted weeks earlier and already shot. */}
            {requirementsAreHistory
              ? "What the studio asked for on this job, and where each one landed."
              : "Every one of these must be in place before the assignment is confirmed."}
          </p>
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
                <small>
                  {statusLabel(item.kind)}
                  {item.dueAt ? ` · Due ${dateTime(item.dueAt)}` : ""}
                </small>
                {item.notes || item.instructions ? (
                  <small>{text(item.instructions ?? item.notes, "")}</small>
                ) : null}
              </span>
              <StatusBadge tone={done ? "success" : "warning"}>
                {statusLabel(item.status)}
              </StatusBadge>
              {!done ? <RequirementAction data={data} assignment={assignment} requirement={item} /> : null}
            </article>
          );
        })}
      </section>
    </div>
  );
}

export function LiveCrewDocuments() {
  const data = useCrewData();
  const selection = useSelectedAssignment(data, ["accepted", "viewed"]);
  if (data.loading || data.error) return <CrewPageState eyebrow="Secure files" title="Documents" description="Upload only the files requested for your assignments." data={data} />;
  const assignment = selection.selected;
  if (!assignment)
    return <CrewPageState eyebrow="Secure files" title="Documents" description="Upload only the files requested for your assignments." data={data} empty="Document requirements appear with an assignment." />;
  const requirements = Array.isArray(assignment.requirements)
    ? (assignment.requirements as Array<Record<string, unknown>>)
    : [];
  const uploads = requirements.filter(
    (item) =>
      item.required === true &&
      ["missing", "expired"].includes(String(item.status)) &&
      ["w9", "insurance", "file"].includes(String(item.kind)),
  );
  return (
    <div className="crew-mobile-page">
      <AssignmentPicker data={data} assignments={selection.candidates} selected={assignment} onSelect={selection.select} />
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
        {requirements.length ? requirements.map((item) => (
          <article key={text(item.id)}>
            <FileCheck2 />
            <span>
              <strong>{text(item.name)}</strong>
              <small>{statusLabel(item.kind)}{item.dueAt ? ` · Due ${dateTime(item.dueAt)}` : ""}</small>
              {item.instructions ? <small>{text(item.instructions, "")}</small> : null}
            </span>
            <StatusBadge
              tone={["complete", "waived"].includes(String(item.status)) ? "success" : "warning"}
            >
              {statusLabel(item.status)}
            </StatusBadge>
          </article>
        )) : <p className="crew-empty-timeline">This job has no document requirements.</p>}
      </section>
      {uploads.map((upload) => (
        <CrewDocumentUpload
          key={text(upload.id)}
          projectId={text(assignment.projectId)}
          assignmentId={assignment.id}
          requirementId={text(upload.id)}
          requirementName={text(upload.name)}
          onSubmitted={data.refresh}
        />
      ))}
    </div>
  );
}

export function LiveCrewCloseout() {
  const data = useCrewData();
  const selection = useSelectedAssignment(
    data,
    ["accepted", "completed"],
    "past",
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  if (data.loading || data.error)
    return <CrewPageState eyebrow="After the event" title="Closeout & payment" description="Submit your work record and follow it through studio review and payment." data={data} />;
  const assignment = selection.selected;
  if (!assignment)
    return <CrewPageState eyebrow="After the event" title="Closeout & payment" description="Submit your work record and follow it through studio review and payment." data={data} empty="Accepted and completed jobs will appear here." />;
  const project = projectFor(data, assignment);
  const closeout = record(assignment.closeout);
  const payment = record(assignment.payment);
  const closeoutStatus = text(closeout.status, "");
  const submitted = ["submitted", "approved", "paid"].includes(closeoutStatus);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    const actualStartsAt = new Date(String(values.get("actualStartsAt")));
    const actualEndsAt = new Date(String(values.get("actualEndsAt")));
    if (Number.isNaN(actualStartsAt.valueOf()) || Number.isNaN(actualEndsAt.valueOf()) || actualEndsAt <= actualStartsAt) {
      setNotice("Choose an actual end time after the start time.");
      return;
    }
    const expenseDescription = String(values.get("expenseDescription") ?? "").trim();
    const expenseAmount = Number(values.get("expenseAmount") ?? 0);
    const deliverables = String(values.get("deliverables") ?? "").split("\n").map((item) => item.trim()).filter(Boolean);
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendCrewCommand("submitAssignmentCloseout", {
        projectId: text(assignment.projectId),
        assignmentId: assignment.id,
        actualStartsAt: actualStartsAt.toISOString(),
        actualEndsAt: actualEndsAt.toISOString(),
        extraMinutes: Number(values.get("extraMinutes") ?? 0),
        expenses: expenseDescription ? [{ description: expenseDescription, amountCents: Math.round(expenseAmount * 100) }] : [],
        deliverables,
        notes: String(values.get("notes") ?? "").trim() || null,
      });
      if (!response.persisted) { setNotice("Development preview only. Closeout not submitted."); return; }
      setNotice("Closeout submitted to the studio for review.");
      data.refresh();
    } catch (caught: unknown) {
      setNotice(crewPublicError(caught, "Your closeout could not be submitted.", "CREW_CLOSEOUT_SUBMIT_FAILED"));
    } finally { setBusy(false); }
  };
  return (
    <div className="crew-mobile-page">
      <AssignmentPicker data={data} assignments={selection.candidates} selected={assignment} onSelect={selection.select}/>
      <header className="crew-portal-hero"><div><p className="eyebrow">After the event</p><h1>Closeout & payment</h1><p>{text(project?.name)} · Preserve your hours, expenses and deliverables in one record.</p></div><StatusBadge tone={payment.status === "paid" ? "success" : submitted ? "info" : "warning"}>{payment.status === "paid" ? "Paid" : submitted ? "Studio review" : "Not submitted"}</StatusBadge></header>
      <section className="crew-payment-summary">
        <article className="panel"><small>Agreed compensation</small><strong>{assignment.compensationVisibleToCrew ? money(assignment.compensationCents, assignment.currency) : "Contact studio"}</strong><span>{text(assignment.compensationType, "event")}</span></article>
        <article className="panel"><small>Closeout</small><strong>{statusLabel(closeout.status) || "Not submitted"}</strong><span>{closeout.reviewerNote ? text(closeout.reviewerNote) : closeout.submittedAt ? `Submitted ${dateTime(closeout.submittedAt)}` : "Hours and expenses due after the event"}</span></article>
        <article className="panel"><small>Payment</small><strong>{statusLabel(payment.status) || "Not scheduled"}</strong><span>{payment.paidAt ? `Paid ${dateTime(payment.paidAt)}` : payment.expectedAt ? `Expected ${dateTime(payment.expectedAt)}` : "The studio will update this after review"}</span></article>
      </section>
      {closeoutStatus === "needs_changes" ? <div className="crew-next-action"><AlertTriangle/><span><strong>The studio requested changes</strong><small>{text(closeout.reviewerNote, "Review your work record and submit it again.")}</small></span></div> : null}
      {!submitted ? <form className="panel crew-closeout-form" onSubmit={(event) => void submit(event)}>
        <header><p className="eyebrow">Work record</p><h2>Submit your closeout</h2></header>
        <label>Actual start · local time<input name="actualStartsAt" type="datetime-local" required defaultValue={dateTimeInput(closeout.actualStartsAt ?? assignment.arrivalAt)}/></label>
        <label>Actual end · local time<input name="actualEndsAt" type="datetime-local" required defaultValue={dateTimeInput(closeout.actualEndsAt ?? assignment.departureAt)}/></label>
        <label>Extra minutes<input name="extraMinutes" type="number" min="0" max="1440" defaultValue={number(closeout.extraMinutes)}/></label>
        <label>Expense description<input name="expenseDescription" maxLength={240} placeholder="Parking, tolls, approved supplies…"/></label>
        <label>Expense amount<input name="expenseAmount" type="number" min="0" step="0.01" placeholder="0.00"/></label>
        <label className="form-span">Deliverable links, one per line<textarea name="deliverables" defaultValue={list(closeout.deliverables).map(String).join("\n")} placeholder="https://…"/></label>
        <label className="form-span">Notes for the studio<textarea name="notes" defaultValue={text(closeout.notes, "")} maxLength={4000}/></label>
        <button className="button button-dark" type="submit" disabled={busy}><ReceiptText size={16}/>{busy ? "Submitting…" : "Submit closeout"}</button>
      </form> : <section className="panel crew-closeout-receipt"><CheckCircle2/><span><strong>Closeout received</strong><small>The studio can review adjustments and payment without asking you to resubmit this information.</small></span></section>}
      <StudioContactForm assignment={assignment}/>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </div>
  );
}

export function LiveCrewProfile() {
  const data = useCrewData();
  if (data.loading || data.error || !data.profile)
    return <CrewPageState eyebrow="Crew profile" title="Your profile" description="Review the professional details your studio has on file." data={data} empty={!data.loading && !data.error ? "Your crew profile is not linked yet." : undefined} />;
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
        </article>
      </section>
      {/*
        Page-level, not equipment-level. It sat inside the equipment card,
        under "No equipment has been recorded", where it read as though it
        managed the availability of a camera bag.
      */}
      <div className="crew-profile-actions">
        <Link className="button button-light" href="/crew/availability">
          <CalendarDays /> Manage availability
        </Link>
      </div>
      <CrewProfileEditor data={data} profile={profile} />
    </div>
  );
}

export function LiveCrewAvailability() {
  const data = useCrewData();
  const [listRenderedAt] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<Value | null>(null);
  const [busy, setBusy] = useState(false);
  if (data.loading || data.error || !data.profile)
    return <CrewPageState eyebrow="Your calendar" title="Availability" description="Tell the studio when you are available for future assignments." data={data} empty={!data.loading && !data.error ? "Link a crew profile before recording availability." : undefined} />;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const value = new FormData(form);
    setNotice(null);
    const startsAt = new Date(String(value.get("startsAt")));
    const endsAt = new Date(String(value.get("endsAt")));
    if (Number.isNaN(startsAt.valueOf()) || Number.isNaN(endsAt.valueOf()) || endsAt <= startsAt) {
      setNotice("Choose an end time after the start time.");
      return;
    }
    setBusy(true);
    try {
      const response = await sendCrewCommand(editing ? "updateAvailability" : "setAvailability", {
        ...(editing ? { availabilityId: editing.id } : { crewProfileId: data.profile?.id }),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        status: String(value.get("status")),
        notes: String(value.get("notes")) || null,
      });
      if (!response.persisted) {
        setNotice("Development preview only. Nothing was changed.");
        return;
      }
      setNotice(editing ? "Availability updated." : "Availability saved.");
      form.reset();
      setEditing(null);
      data.refresh();
    } catch (caught: unknown) {
      setNotice(
        crewPublicError(caught, "Your availability could not be saved.", "CREW_AVAILABILITY_SAVE_FAILED"),
      );
    } finally { setBusy(false); }
  }
  const remove = async (item: Value) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendCrewCommand("deleteAvailability", { availabilityId: item.id });
      if (!response.persisted) { setNotice("Development preview only. Nothing was changed."); return; }
      if (editing?.id === item.id) setEditing(null);
      setNotice("Availability removed.");
      data.refresh();
    } catch (caught: unknown) {
      setNotice(crewPublicError(caught, "Your availability could not be removed.", "CREW_AVAILABILITY_REMOVE_FAILED"));
    } finally { setBusy(false); }
  };
  return (
    <div className="crew-mobile-page">
      <header className="crew-portal-hero">
        <div>
          <p className="eyebrow">Your calendar</p>
          <h1>Availability</h1>
          <p>Availability helps studios plan; accepted assignments remain authoritative.</p>
        </div>
      </header>
      <form key={editing?.id ?? "new"} className="panel crew-availability-form" onSubmit={(event) => void submit(event)}>
        <label>
          Starts · local time
          <input name="startsAt" type="datetime-local" defaultValue={dateTimeInput(editing?.startsAt)} required />
        </label>
        <label>
          Ends · local time
          <input name="endsAt" type="datetime-local" defaultValue={dateTimeInput(editing?.endsAt)} required />
        </label>
        <label>
          Status
          <select name="status" defaultValue={text(editing?.status, "available")}>
            <option value="available">Available</option>
            <option value="tentative">Tentative</option>
            <option value="unavailable">Unavailable</option>
          </select>
        </label>
        <label>
          Notes
          <input name="notes" maxLength={1000} defaultValue={text(editing?.notes, "")} />
        </label>
        <button className="button button-dark" type="submit" disabled={busy}>
          {busy ? "Saving…" : editing ? "Update availability" : "Save availability"}
        </button>
        {editing ? <button className="button button-light" type="button" onClick={() => setEditing(null)}>Cancel edit</button> : null}
      </form>
      <section className="panel crew-availability-list">
        {[...data.availability]
          .filter((item) => !item.archivedAt)
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
                {/* A window that has already gone by was rendered in the same
                    green as a live one, so the only entry on the page — a date
                    two weeks past — read as this person's current availability. */}
                <StatusBadge
                  tone={
                    Date.parse(text(item.endsAt) || "") <= listRenderedAt
                      ? "neutral"
                      : status === "available"
                        ? "success"
                        : status === "unavailable"
                          ? "danger"
                          : "warning"
                  }
                >
                  {Date.parse(text(item.endsAt) || "") <= listRenderedAt
                    ? `${status} · past`
                    : status}
                </StatusBadge>
                <span className="crew-availability-actions">
                  <button aria-label="Edit availability" type="button" onClick={() => setEditing(item)} disabled={busy}><Pencil size={15} /></button>
                  <button aria-label="Remove availability" type="button" onClick={() => void remove(item)} disabled={busy}><Trash2 size={15} /></button>
                </span>
              </article>
            );
          })}
      </section>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </div>
  );
}
