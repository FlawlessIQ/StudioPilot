"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ListPlus,
  LoaderCircle,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyAiError } from "@/lib/ai/friendly-error";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  manualScheduleBlockers,
  manualScheduleItem,
  nextItemStart,
} from "@/features/planning/manual-run-of-show";

type ScheduleItem = {
  id: string;
  startAt: string;
  endAt: string;
  title: string;
  description: string;
  location: string | null;
  address: string | null;
  travelMinutes: number;
  photographerIds: string[];
  participants: string[];
  vendorContactIds: string[];
  equipment: string[];
  notes: string | null;
  visibility: "studio" | "client" | "crew" | "shared";
  blockingIssues: string[];
  sourceReferences: Array<{
    type:
      | "project_fact"
      | "questionnaire_answer"
      | "timing_rule"
      | "package_fact"
      | "crew_fact"
      | "assumption";
    sourceId: string;
    label: string;
  }>;
};

type Draft = {
  items: ScheduleItem[];
  assumptions: string[];
  missingInformation: string[];
  conflicts: string[];
  risks: string[];
  suggestedQuestions: string[];
  interactionId: string;
  humanReviewRequired: true;
  sourceTrace: {
    questionnaireCount: number;
    timingRuleCount: number;
    crewFactCount: number;
    assumptionItemCount: number;
  };
};

const isoOrNull = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "");
  return text ? new Date(text).toISOString() : null;
};

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const answer = (
  answers: Record<string, unknown>,
  keys: readonly string[],
): string => {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const key of keys) {
    const value = answers[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    const normalizedKey = normalize(key);
    const flexible = Object.entries(answers).find(
      ([candidate]) => normalize(candidate) === normalizedKey,
    )?.[1];
    if (typeof flexible === "string" && flexible.trim()) return flexible.trim();
  }
  return "";
};

const eventDateTime = (eventDate: string, time: string) =>
  eventDate && /^\d{2}:\d{2}$/.test(time)
    ? `${eventDate}T${time}`
    : "";

/**
 * A UTC instant, as the wall clock a datetime-local input expects.
 *
 * The review list rendered `item.startAt.slice(0, 16)`. Item times are
 * normalised to UTC by the command's schema, so slicing hands the input the
 * *UTC* wall clock and the browser shows it as if it were local — a four-hour
 * lie in New York, and the reason a noon wedding's ceremony read 12:00 AM the
 * next day.
 *
 * Worse than being wrong, it was wrong in one direction only: the onChange
 * beside it does `new Date(value).toISOString()`, which reads the field as
 * local and converts to UTC. Read and write used opposite conventions, so
 * merely opening a time field and confirming it shifted the item by the
 * offset. This is the inverse of that write, so a value that is not edited
 * round-trips unchanged.
 *
 * Browser-local on purpose: the coverage inputs above already work this way —
 * naive local strings, converted on submit by `isoOrNull` — so the whole
 * screen now speaks one convention. A studio shooting outside its own
 * timezone is a separate question and needs `project.timezone` threaded
 * through both halves, not just this one.
 */
const toLocalInput = (iso: string) => {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.valueOf())) return "";
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.valueOf() - offset).toISOString().slice(0, 16);
};

const shiftLocalMinutes = (value: string, minutes: number) => {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf())) return "";
  const shifted = new Date(parsed.valueOf() + minutes * 60_000);
  const offset = shifted.getTimezoneOffset() * 60_000;
  return new Date(shifted.valueOf() - offset).toISOString().slice(0, 16);
};

export function AiScheduleGenerator({
  initialProjectId = "",
}: {
  initialProjectId?: string;
}) {
  const workspace = useWorkspace();
  const { records: projects, loading } = useTenantDocuments("projects");
  const { records: questionnaires } = useTenantDocuments(
    "questionnaireResponses",
  );
  const { records: packageSnapshots } =
    useTenantDocuments("packageSnapshots");
  const { records: schedules } = useTenantDocuments("schedules");
  // For naming the recipient of the suggested questions.
  const { records: contacts } = useTenantDocuments("contacts");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [coverageMinutes, setCoverageMinutes] = useState(480);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [coverageStartsAt, setCoverageStartsAt] = useState("");
  /**
   * The day the ceremony and reception pickers are allowed to land on.
   *
   * Taken from the coverage window, which is prefilled from the project, so
   * it is the event's own day rather than whatever today happens to be.
   */
  const eventDayBounds = useMemo(() => {
    const day = coverageStartsAt.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(day)
      ? { min: `${day}T00:00`, max: `${day}T23:59` }
      : { min: undefined, max: undefined };
  }, [coverageStartsAt]);
  const [coverageEndsAt, setCoverageEndsAt] = useState("");
  const [ceremonyTime, setCeremonyTime] = useState("");
  const [receptionTime, setReceptionTime] = useState("");
  const [locations, setLocations] = useState("");
  const [preferences, setPreferences] = useState("");
  const [prefillSummary, setPrefillSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /**
   * The questions, on their way to the couple.
   *
   * "Suggested questions" was the most useful thing the draft produced — it is
   * the pre-wedding conversation, written out — and it was read-only text that
   * dead-ended. Every answer it collects is grounding the next draft does not
   * have to assume, so this is the loop that makes the feature worth having.
   *
   * Editable before it goes, and never sent without a second click: the studio
   * writes to their own client, so the draft belongs to them.
   */
  const [askDraft, setAskDraft] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  const selectedProject = useMemo(
    () => projects?.find((project) => project.id === projectId),
    [projectId, projects],
  );
  /** Who the questions would go to, and whether there is anyone to send to. */
  const clientContactId = useMemo(() => {
    const ids = selectedProject?.clientContactIds;
    return Array.isArray(ids) && typeof ids[0] === "string" ? ids[0] : null;
  }, [selectedProject]);
  const clientName = useMemo(() => {
    const match = contacts?.find((contact) => contact.id === clientContactId);
    return String(match?.displayName ?? "").trim() || "the couple";
  }, [contacts, clientContactId]);
  const selectedQuestionnaire = useMemo(
    () =>
      questionnaires
        ?.filter(
          (response) =>
            response.projectId === projectId &&
            ["submitted", "locked"].includes(String(response.status)),
        )
        .sort((left, right) =>
          String(right.updatedAt ?? right.submittedAt ?? "").localeCompare(
            String(left.updatedAt ?? left.submittedAt ?? ""),
          ),
        )[0],
    [projectId, questionnaires],
  );
  const selectedPackage = useMemo(
    () =>
      packageSnapshots?.find(
        (snapshot) =>
          snapshot.id === selectedProject?.packageSnapshotId ||
          snapshot.projectId === projectId,
      ),
    [packageSnapshots, projectId, selectedProject?.packageSnapshotId],
  );
  const selectedSchedule = useMemo(
    () =>
      schedules
        ?.filter((schedule) => schedule.projectId === projectId)
        .sort((left, right) =>
          String(right.updatedAt ?? right.createdAt ?? "").localeCompare(
            String(left.updatedAt ?? left.createdAt ?? ""),
          ),
        )[0],
    [projectId, schedules],
  );
  const planningInputsChanged = Boolean(
    selectedSchedule &&
      selectedQuestionnaire &&
      String(
        selectedQuestionnaire.updatedAt ??
          selectedQuestionnaire.submittedAt ??
          "",
      ) > String(selectedSchedule.updatedAt ?? selectedSchedule.createdAt ?? ""),
  );

  useEffect(() => {
    if (!selectedProject || !questionnaires || !packageSnapshots) return;
    const eventDate = String(selectedProject.eventDate ?? "");
    if (!eventDate) return;
    const rawAnswers = record(selectedQuestionnaire?.answers);
    const planningPackage = record(selectedQuestionnaire?.planningPackage);
    const planningFacts: Array<Record<string, unknown> & {
      label: string;
      fieldId: string;
    }> = Array.isArray(planningPackage.facts)
      ? planningPackage.facts.flatMap((item) => {
          const fact = record(item);
          const label = String(fact.label ?? "").trim();
          const fieldId = String(fact.fieldId ?? "").trim();
          return label || fieldId ? [{ ...fact, label, fieldId }] : [];
        })
      : [];
    const answers = {
      ...Object.fromEntries(
        planningFacts.flatMap((fact) => [
          [fact.fieldId, fact.value],
          [fact.label, fact.value],
        ]),
      ),
      ...rawAnswers,
    };
    const ceremony = answer(answers, [
      "ceremonyTime",
      "ceremony-time",
      "ceremony_time",
    ]);
    const reception = answer(answers, [
      "receptionTime",
      "reception-time",
      "reception_time",
    ]);
    const minutes = Number(
      selectedPackage?.includedCoverageMinutes ??
        selectedPackage?.coverageMinutes ??
        480,
    );
    const safeMinutes =
      Number.isFinite(minutes) && minutes >= 30 && minutes <= 1440
        ? minutes
        : 480;
    const ceremonyLocal = eventDateTime(eventDate, ceremony);
    const configuredStart = answer(answers, [
      "coverageStartsAt",
      "coverageStartTime",
      "photographyStartTime",
    ]);
    const start =
      (configuredStart.includes("T")
        ? configuredStart.slice(0, 16)
        : eventDateTime(eventDate, configuredStart)) ||
      (ceremonyLocal
        ? shiftLocalMinutes(ceremonyLocal, -120)
        : `${eventDate}T12:00`);
    const configuredEnd = answer(answers, [
      "coverageEndsAt",
      "coverageEndTime",
      "photographyEndTime",
    ]);
    const end =
      (configuredEnd.includes("T")
        ? configuredEnd.slice(0, 16)
        : eventDateTime(eventDate, configuredEnd)) ||
      shiftLocalMinutes(start, safeMinutes);
    const venue = String(selectedProject.venueName ?? "").trim();
    const questionnaireLocations = [
      answer(answers, ["gettingReadyLocation", "getting-ready-location"]),
      answer(answers, ["ceremonyLocation", "ceremony-location"]),
      answer(answers, ["receptionLocation", "reception-location"]),
    ].filter(Boolean);
    const nextLocations = Array.from(
      new Set([...questionnaireLocations, venue].filter(Boolean)),
    );
    const nextPreferences = [
      answer(answers, ["firstLook", "first-look"]),
      answer(answers, ["familyPhotoList", "family-photo-list"]),
      answer(answers, ["accessibility", "accessibilityNeeds"]),
      answer(answers, ["timelineNotes", "planningNotes"]),
      ...planningFacts
        .filter((fact) =>
          ["family_formals", "vendors", "preferences"].includes(
            String(fact.category),
          ),
        )
        .map((fact) => `${fact.label}: ${Array.isArray(fact.value) ? fact.value.map(String).join(", ") : String(fact.value ?? "")}`),
    ].filter(Boolean);

    const frame = requestAnimationFrame(() => {
      setCoverageMinutes(safeMinutes);
      setCoverageStartsAt(start);
      setCoverageEndsAt(end);
      setCeremonyTime(ceremonyLocal);
      setReceptionTime(eventDateTime(eventDate, reception));
      setLocations(nextLocations.join("\n"));
      setPreferences(nextPreferences.join("\n"));
      setPrefillSummary(
        selectedQuestionnaire
          ? `Project, package, and ${planningFacts.length} sourced planning details were filled automatically.`
          : "Project and package details were filled automatically. Missing times are clearly treated as assumptions.",
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [
    packageSnapshots,
    questionnaires,
    selectedPackage,
    selectedProject,
    selectedQuestionnaire,
  ]);

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!workspace.tenantId) return;
    setBusy(true);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      const startsAt = isoOrNull(form.get("coverageStartsAt"));
      const endsAt = isoOrNull(form.get("coverageEndsAt"));
      if (!startsAt || !endsAt) throw new Error("Enter a coverage window.");
      const endpoint = process.env.NEXT_PUBLIC_AI_FUNCTIONS_URL;
      if (!endpoint) throw new Error("AI schedule generation is not configured.");
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) throw new Error("Sign in before generating a schedule.");
      const appCheckToken = await getAppCheckToken();
      const parsedLocations = String(form.get("locations") ?? "")
        .split("\n")
        .map((name) => name.trim())
        .filter(Boolean)
        .map((name) => ({ name, address: null }));
      const response = await fetch(
        `${endpoint.replace(/\/$/, "")}/aiScheduleCommand`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${await user.getIdToken()}`,
            ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
          },
          body: JSON.stringify({
            tenantId: workspace.tenantId,
            projectId,
            coverageMinutes: derivedCoverageMinutes,
            photographerIds: [],
            coverageStartsAt: startsAt,
            coverageEndsAt: endsAt,
            ceremonyTime: isoOrNull(form.get("ceremonyTime")),
            receptionTime: isoOrNull(form.get("receptionTime")),
            locations: parsedLocations,
            preferences: String(form.get("preferences") ?? ""),
          }),
        },
      );
      const result = (await response.json()) as Draft & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Generation failed.");
      setDraft(result);
      setFailed(false);
      setNotice("Draft generated. Review every item and conflict before publishing.");
    } catch (caught: unknown) {
      setFailed(true);
      setNotice(
        friendlyAiError(caught, "We couldn't draft this schedule. Try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  const publishBlockers = draft ? manualScheduleBlockers(draft.items) : [];

  /**
   * Whether this draft rests on anything real, in the studio's words.
   *
   * The panel used to read "0 questionnaire · 0 timing rules · 0 crew facts",
   * which is the shape of the trace rather than an answer to the only question
   * a photographer has: is this my day, or a generic one? With nothing to work
   * from, the AI adds nothing over a template, and saying so plainly is more
   * use than a row of zeroes.
   */
  const grounding = draft
    ? [
        draft.sourceTrace.questionnaireCount > 0
          ? `${draft.sourceTrace.questionnaireCount} answer${draft.sourceTrace.questionnaireCount === 1 ? "" : "s"} from your couple`
          : null,
        draft.sourceTrace.timingRuleCount > 0
          ? `${draft.sourceTrace.timingRuleCount} of your timing rule${draft.sourceTrace.timingRuleCount === 1 ? "" : "s"}`
          : null,
        draft.sourceTrace.crewFactCount > 0
          ? `${draft.sourceTrace.crewFactCount} crew detail${draft.sourceTrace.crewFactCount === 1 ? "" : "s"}`
          : null,
      ].filter(Boolean)
    : [];
  const ungrounded = grounding.length === 0;
  /**
   * Coverage length, read off the window rather than typed beside it.
   *
   * Falls back to the package's figure only while the window is incomplete,
   * so there is exactly one answer at any moment.
   */
  // Two Date.parse calls and a subtraction — not worth a hook, and the React
  // Compiler could not preserve one here anyway.
  const derivedCoverageMinutes = (() => {
    const start = Date.parse(coverageStartsAt);
    const end = Date.parse(coverageEndsAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return coverageMinutes;
    }
    return Math.round((end - start) / 60_000);
  })();
  const derivedCoverageLabel = (() => {
    const hours = Math.floor(derivedCoverageMinutes / 60);
    const minutes = derivedCoverageMinutes % 60;
    if (!hours) return `${minutes} min`;
    return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
  })();
  const groundingSummary = ungrounded
    ? "Nothing from this job yet — every time is a typical wedding"
    : grounding.join(", ");

  /** Send the edited questions to the client on this job. */
  async function askTheCouple() {
    if (!askDraft || !clientContactId || !selectedProject) return;
    setAsking(true);
    setNotice(null);
    setFailed(false);
    try {
      const result = await sendCommunicationsCommand({
        type: "sendMessage",
        tenantId: workspace.tenantId,
        idempotencyKey: `ask_${projectId}_${Date.now()}`,
        input: {
          projectId,
          contactId: clientContactId,
          subject: `A few questions about your ${String(
            selectedProject.eventType ?? "event",
          ).toLowerCase()} day`,
          body: askDraft,
          category: "general",
          actionLabel: null,
          actionUrl: null,
          scheduledFor: null,
        },
      });
      if (result.mode === "preview") {
        setNotice("Preview mode — nothing was sent.");
        return;
      }
      setAskDraft(null);
      setNotice(`Sent to ${clientName}. Their answers will ground the next draft.`);
    } catch (caught: unknown) {
      setFailed(true);
      setNotice(friendlyError(caught, "The questions could not be sent."));
    } finally {
      setAsking(false);
    }
  }

  async function publish() {
    if (!draft) return;
    setPublishing(true);
    setNotice(null);
    try {
      const response = await sendPlanningCommand("publishSchedule", {
        projectId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        coverageMinutes: derivedCoverageMinutes,
        items: draft.items,
      });
      setNotice(
        response.persisted
          ? "Published. Your crew can see it now."
          : "Development preview validated the schedule without publishing.",
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Publish failed."));
    } finally {
      setPublishing(false);
    }
  }

  /**
   * An empty draft the studio fills in themselves.
   *
   * Shaped exactly like a generated one so the review screen below is reused
   * as-is. The trace counts are zero and the assumption count is zero because
   * nothing was inferred — a hand-built schedule has no sources to cite, and
   * claiming otherwise would be the one thing this product must not do.
   */
  function startManualDraft() {
    const start = nextItemStart([], coverageStartsAt || null);
    setFailed(false);
    setNotice(
      "Empty run of show started. Add each item, then publish it as a version.",
    );
    setDraft({
      items: [manualScheduleItem(crypto.randomUUID(), start) as ScheduleItem],
      assumptions: [],
      missingInformation: [],
      conflicts: [],
      risks: [],
      suggestedQuestions: [],
      interactionId: `manual_${crypto.randomUUID()}`,
      humanReviewRequired: true,
      sourceTrace: {
        questionnaireCount: 0,
        timingRuleCount: 0,
        crewFactCount: 0,
        assumptionItemCount: 0,
      },
    });
  }

  function addItem() {
    setDraft((current) =>
      current
        ? {
            ...current,
            items: [
              ...current.items,
              manualScheduleItem(
                crypto.randomUUID(),
                nextItemStart(current.items, coverageStartsAt || null),
              ) as ScheduleItem,
            ],
          }
        : current,
    );
  }

  function removeItem(index: number) {
    setDraft((current) =>
      current
        ? {
            ...current,
            items: current.items.filter((_, itemIndex) => itemIndex !== index),
          }
        : current,
    );
  }

  function updateItem(index: number, patch: Partial<ScheduleItem>) {
    setDraft((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item, itemIndex) =>
              itemIndex === index ? { ...item, ...patch } : item,
            ),
          }
        : current,
    );
  }

  return (
    <div className="schedule-generator">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Draft · nothing is sent yet</p>
            <h2>Generate a run of show</h2>
            <p>Fill in what you know. Anything you leave blank is guessed and labelled as a guess.</p>
          </div>
          <Sparkles />
        </div>
        <form className="schedule-generator-form" onSubmit={(event) => void generate(event)}>
          <label>
            Project
            <select
              required
              disabled={loading || Boolean(initialProjectId)}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">{loading ? "Loading projects…" : "Select a project"}</option>
              {projects?.map((project) => <option key={project.id} value={project.id}>{String(project.name)}</option>)}
            </select>
          </label>
          <label>
            Coverage starts
            <input
              required
              name="coverageStartsAt"
              onChange={(event) => setCoverageStartsAt(event.target.value)}
              type="datetime-local"
              value={coverageStartsAt}
            />
          </label>
          <label>
            Coverage ends
            <input
              required
              name="coverageEndsAt"
              onChange={(event) => setCoverageEndsAt(event.target.value)}
              type="datetime-local"
              value={coverageEndsAt}
            />
          </label>
          {/*
            * Derived, not a third field to disagree with the other two.
            *
            * Coverage starts, coverage ends and coverage minutes all described
            * the same fact and nothing said which won if they differed — a
            * studio could set 12:00–18:00 and 300 minutes and get no warning.
            * The window is the input a photographer actually holds; the length
            * follows from it.
            */}
          <label>
            How long that is
            <output className="schedule-derived-field">
              {derivedCoverageLabel}
            </output>
          </label>
          {/*
            * Bounded to the event day.
            *
            * An empty datetime-local shows *today* in the picker, so on a
            * wedding four months out the ceremony field offered today's date
            * and a studio filling it in without reading the day would set the
            * ceremony six weeks before the wedding. The field knows which day
            * it belongs to — coverage is already on it — so it says so.
            */}
          <label>
            Ceremony time
            <input
              max={eventDayBounds.max}
              min={eventDayBounds.min}
              name="ceremonyTime"
              onChange={(event) => setCeremonyTime(event.target.value)}
              type="datetime-local"
              value={ceremonyTime}
            />
          </label>
          <label>
            Reception time
            <input
              max={eventDayBounds.max}
              min={eventDayBounds.min}
              name="receptionTime"
              onChange={(event) => setReceptionTime(event.target.value)}
              type="datetime-local"
              value={receptionTime}
            />
          </label>
          <label className="form-span">
            Locations, one per line
            <textarea
              name="locations"
              onChange={(event) => setLocations(event.target.value)}
              placeholder="Getting-ready location&#10;Ceremony venue&#10;Reception venue"
              value={locations}
            />
          </label>
          <label className="form-span">
            Preferences and known constraints
            <textarea
              name="preferences"
              onChange={(event) => setPreferences(event.target.value)}
              placeholder="First look, family-photo duration, venue rules, important moments…"
              value={preferences}
            />
          </label>
          {prefillSummary ? (
            <p className="form-notice form-span">{prefillSummary}</p>
          ) : null}
          {selectedSchedule ? (
            <div className="schedule-replanning-notice form-span">
              <CalendarClock aria-hidden="true" />
              <span>
                <strong>
                  {planningInputsChanged
                    ? "New planning details are ready to reconcile"
                    : `A schedule version already exists for this project`}
                </strong>
                <small>
                  {planningInputsChanged
                    ? "The submitted questionnaire changed after the current version. The new draft will be compared when you publish it."
                    : "Generate only when facts changed. Publishing creates an immutable version and shows the exact impact."}
                </small>
              </span>
            </div>
          ) : null}
          <div className="schedule-generate-actions">
            <button className="button button-dark" disabled={busy} type="submit">
              {busy ? <LoaderCircle className="spin" /> : <Sparkles />}
              {busy
                ? "Generating…"
                : selectedSchedule
                  ? "Prepare updated draft"
                  : "Generate draft"}
            </button>
            {/**
              * The path that does not need AI.
              *
              * `publishSchedule` never cared where the items came from, but
              * generation was their only source — so a workspace with AI off
              * ("AI drafting isn't switched on for this workspace yet") could
              * not produce a run of show at all, and "Final run of show
              * approved" is a blocking readiness checkpoint. This starts an
              * empty draft and hands it to the same review-and-publish screen.
              */}
            {draft ? null : (
              <button
                className="button button-light"
                disabled={busy}
                onClick={startManualDraft}
                type="button"
              >
                <ListPlus /> Build it myself
              </button>
            )}
          </div>
        </form>
      </section>
      {notice ? (
        <p
          className={failed ? "form-notice form-notice-error" : "form-notice"}
          role={failed ? "alert" : "status"}
        >
          {failed ? <AlertTriangle aria-hidden size={16} /> : null}
          {notice}
        </p>
      ) : null}
      {draft ? (
        <>
          <section className="panel schedule-draft-items">
            <div className="panel-heading">
              <div>
                <h2>The day</h2>
                <p>Change anything. Your crew sees this once you publish it.</p>
              </div>
              <AlertTriangle />
            </div>
            {draft.items.map((item, index) => (
              <article key={item.id}>
                <input aria-label="Item title" value={item.title} onChange={(event) => updateItem(index, { title: event.target.value })} />
                <input aria-label="Start time" type="datetime-local" value={toLocalInput(item.startAt)} onChange={(event) => updateItem(index, { startAt: new Date(event.target.value).toISOString() })} />
                <input aria-label="End time" type="datetime-local" value={toLocalInput(item.endAt)} onChange={(event) => updateItem(index, { endAt: new Date(event.target.value).toISOString() })} />
                <input aria-label="Location" value={item.location ?? ""} onChange={(event) => updateItem(index, { location: event.target.value || null })} />
                {/*
                  * Only when there is something to say.
                  *
                  * "No model-reported issue" appeared under every item — nine
                  * repetitions of a double negative that told the studio
                  * nothing, on a screen already dense with the model talking
                  * about itself. The source chips below already carry
                  * provenance.
                  */}
                {item.blockingIssues.length || !item.sourceReferences.length ? (
                  <small>
                    {item.blockingIssues.join(" · ") ||
                      "Yours, not the model's"}
                  </small>
                ) : null}
                <button
                  aria-label={`Remove item ${index + 1}`}
                  className="button button-quiet schedule-item-remove"
                  onClick={() => removeItem(index)}
                  type="button"
                >
                  <Trash2 size={14} /> Remove
                </button>
                <div className="schedule-item-sources">
                  {item.sourceReferences.map((source) => (
                    <span
                      className={
                        source.type === "assumption" ? "is-assumption" : ""
                      }
                      key={`${source.type}-${source.sourceId}`}
                    >
                      {source.type.replaceAll("_", " ")} · {source.label}
                    </span>
                  ))}
                </div>
              </article>
            ))}
            <button
              className="button button-light schedule-add-item"
              onClick={addItem}
              type="button"
            >
              <ListPlus size={15} /> Add an item
            </button>
          </section>
          {/*
            * Everything the model has to say about itself, folded away.
            *
            * These six panels used to sit *above* the run of show, so a
            * photographer scrolled five screens of "Grounded inputs",
            * "0 crew facts" and "Risks" before reaching the timeline they
            * came for. The order now matches the job: the schedule first,
            * then — if they want it — what it was built from.
            */}
          <details className="panel schedule-basis">
            <summary>
              <strong>What this schedule is based on</strong>
              <small>{groundingSummary}</small>
            </summary>
            {ungrounded ? (
              <p className="schedule-basis-empty">
                Nothing yet — every time below is a typical wedding day, not
                yours. Ask {clientName} the questions below, or add your own
                timing rules, and the next draft will be built from real
                answers instead.
              </p>
            ) : (
              <p className="schedule-basis-empty">
                Built from {groundingSummary}.
                {draft.sourceTrace.assumptionItemCount > 0
                  ? ` ${draft.sourceTrace.assumptionItemCount} of the items below still rest on an assumption — each one is labelled.`
                  : ""}
              </p>
            )}
            <div className="schedule-basis-grid">
              {[
                ["What we assumed", draft.assumptions],
                ["What we still need", draft.missingInformation],
                ["Times that do not fit", draft.conflicts],
                ["What could go wrong", draft.risks],
              ].map(([label, values]) => (
                <article key={label as string}>
                  <strong>{label as string}</strong>
                  {(values as string[]).length ? (
                    <ul>
                      {(values as string[]).map((value) => (
                        <li key={value}>{value}</li>
                      ))}
                    </ul>
                  ) : (
                    <small>Nothing to flag</small>
                  )}
                </article>
              ))}
            </div>
          </details>
          {/*
            * The questions, with somewhere to go.
            *
            * Read-only before this: the one panel that told the studio exactly
            * what to ask their couple, and no way to ask it. Every answer it
            * collects becomes grounding the next draft does not have to guess.
            */}
          {draft.suggestedQuestions.length ? (
            <section className="panel schedule-questions">
              <div className="panel-heading">
                <div>
                  <h2>Ask {clientName}</h2>
                  <p>
                    Their answers replace the assumptions above. This is the
                    fastest way to make the next draft real.
                  </p>
                </div>
                <Sparkles />
              </div>
              <ul>
                {draft.suggestedQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
              {askDraft === null ? (
                <button
                  className="button button-dark"
                  disabled={!clientContactId}
                  onClick={() =>
                    setAskDraft(
                      [
                        `Hi ${clientName},`,
                        "",
                        "A few questions so we can plan your day properly:",
                        "",
                        ...draft.suggestedQuestions.map(
                          (question) => `- ${question}`,
                        ),
                        "",
                        "No rush — whatever you know so far helps.",
                      ].join("\n"),
                    )
                  }
                  type="button"
                >
                  <Sparkles size={16} /> Put these in a message
                </button>
              ) : (
                <div className="schedule-ask-editor">
                  <label>
                    Message to {clientName}
                    <textarea
                      onChange={(event) => setAskDraft(event.target.value)}
                      rows={12}
                      value={askDraft}
                    />
                  </label>
                  <div className="schedule-ask-actions">
                    <button
                      className="button button-dark"
                      disabled={asking}
                      onClick={() => void askTheCouple()}
                      type="button"
                    >
                      {asking ? "Sending…" : `Send to ${clientName}`}
                    </button>
                    <button
                      className="button button-quiet"
                      disabled={asking}
                      onClick={() => setAskDraft(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {!clientContactId ? (
                <small>
                  No client is linked to this job yet, so there is nobody to
                  send to. Add one on the job first.
                </small>
              ) : null}
            </section>
          ) : null}
          <div className="human-boundary">
            <CheckCircle2 />
            <span>
              <strong>Nothing reaches your crew until you publish.</strong>
              <small>
                {/* Say what is wrong rather than letting the command refuse. */}
                {publishBlockers.length
                  ? publishBlockers.join(" ")
                  : "Publishing replaces the current version, so anyone who already confirmed will be asked again."}
              </small>
            </span>
            <button
              className="button button-dark"
              disabled={publishing || publishBlockers.length > 0}
              onClick={() => void publish()}
              type="button"
            >
              {publishing ? "Publishing…" : "Publish reviewed schedule"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
