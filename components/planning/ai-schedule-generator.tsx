"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarClock,
  CheckCircle2,
  ListPlus,
  LoaderCircle,
  PencilLine,
  Plus,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { friendlyAiError } from "@/lib/ai/friendly-error";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { useReturnToJob } from "@/lib/projects/return-to-job";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  manualScheduleBlockers,
  manualScheduleItem,
  nextItemStart,
  seededManualSchedule,
} from "@/features/planning/manual-run-of-show";
import { liveProjects } from "@/features/projects/put-away";
import { itemCrewIds, withCrewIds } from "@/features/schedules/item-crew";
import {
  moveScheduleItem,
  scheduleItemMoves,
  sortScheduleItems,
} from "@/features/schedules/run-of-show-order";
import {
  WEDDING_STANDARD_MOMENTS,
  isWeddingJob,
  placeStandardMoment,
  type StandardMomentKey,
} from "@/features/schedules/standard-moments";
import { scheduleCrewOptions } from "@/features/schedules/crew-options";
import { currentJobSnapshots, jobCoverageMinutes } from "@/features/packages/job-packages";
import { InfoHint } from "@/components/ui/info-hint";
import { VendorReshareBanner } from "@/components/planning/vendor-reshare-banner";

type ScheduleItem = {
  id: string;
  startAt: string;
  endAt: string;
  title: string;
  description: string;
  location: string | null;
  address: string | null;
  travelMinutes: number;
  /** Anyone on the segment, any trade. Read through itemCrewIds: older drafts carry only photographerIds. */
  crewIds?: string[];
  photographerIds?: string[];
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

/** The inverse of toLocalInput, or null for a cleared or half-typed field. */
const fromLocalInput = (value: string): string | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? parsed.toISOString() : null;
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
  // Who can be put on a segment: everyone booked on the job, any trade.
  const { records: crewAssignments } = useTenantDocuments("crewAssignments");
  const { records: crewProfiles } = useTenantDocuments("crewProfiles");
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
  const returnToJob = useReturnToJob(projectId);
  const [notice, setNotice] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // Vendors whose links still show the version just replaced (publishSchedule).
  const [staleVendors, setStaleVendors] = useState(0);
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
  /**
   * What happened to the questions, said where they were sent from.
   *
   * The result used to go to the page notice at the very top, a long scroll
   * above the Send button — so a send looked like nothing had happened
   * (GR Productions, 2026-10-01).
   */
  const [askResult, setAskResult] = useState<
    { tone: "sent" | "error" | "preview"; message: string } | null
  >(null);
  /** The publish result, beside the Publish button for the same reason. */
  const [publishNotice, setPublishNotice] = useState<
    { failed: boolean; message: string } | null
  >(null);
  /**
   * Moment times the couple gave on their form, when the studio's own
   * questionnaire asks (the starter one asks only for the ceremony). The
   * "Add a moment" chips place from them first.
   */
  const [momentTimes, setMomentTimes] = useState<{
    firstLookAt: string;
    cocktailAt: string;
    dinnerAt: string;
    cakeAt: string;
  }>({ firstLookAt: "", cocktailAt: "", dinnerAt: "", cakeAt: "" });

  const selectedProject = useMemo(
    () => projects?.find((project) => project.id === projectId),
    [projectId, projects],
  );
  const crewOptions = useMemo(
    () =>
      scheduleCrewOptions({
        projectId,
        assignments: crewAssignments ?? [],
        profiles: crewProfiles ?? [],
      }),
    [crewAssignments, crewProfiles, projectId],
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
  /**
   * The length of the day, from every package on the job.
   *
   * This read one snapshot — the job's primary, or failing that any snapshot
   * on the project, a replaced one included — so a photo-and-video booking was
   * given the photo package's minutes and the video coverage was cut short.
   */
  const packageMinutes = useMemo(
    () =>
      jobCoverageMinutes(
        currentJobSnapshots(packageSnapshots ?? [], selectedProject),
      ),
    [packageSnapshots, selectedProject],
  );
  // The newest version. By version number first: publishing stamps the old
  // version superseded at the same instant the new one is created, so their
  // updatedAt tie and the old one could be picked.
  const selectedSchedule = useMemo(
    () =>
      schedules
        ?.filter((schedule) => schedule.projectId === projectId)
        .sort(
          (left, right) =>
            Number(right.version ?? 0) - Number(left.version ?? 0) ||
            String(right.updatedAt ?? right.createdAt ?? "").localeCompare(
              String(left.updatedAt ?? left.createdAt ?? ""),
            ),
        )[0],
    [projectId, schedules],
  );
  const publishedVersion = Number(selectedSchedule?.version ?? 0) || null;
  const publishedHasItems =
    Array.isArray(selectedSchedule?.items) && selectedSchedule.items.length > 0;
  /**
   * The couple asked for changes to the published version (their portal, or
   * the studio writing down what they said). Today and the email both link
   * here, so their words are the first thing on the page.
   */
  const coupleChangeRequest =
    selectedSchedule &&
    (selectedSchedule.approvalState === "changes_requested" ||
      selectedSchedule.status === "changes_requested")
      ? String(selectedSchedule.approvalNotes ?? "").trim()
      : null;
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
    /**
     * The couple answered these on the form the studio sent; nobody should
     * retype them.
     *
     * The lookups below used to name fields no starter questionnaire has —
     * `ceremony-location`, `coverageEndTime`, `gettingReadyLocation` — so on a
     * real wedding the generator opened blank while the answers sat in the
     * project. The starter ids come first; the older aliases stay for studios
     * whose own forms use them.
     */
    const ceremony = answer(answers, [
      "ceremony-time",
      "ceremonyTime",
      "ceremony_time",
    ]);
    const reception = answer(answers, [
      "receptionTime",
      "reception-time",
      "reception_time",
    ]);
    /**
     * A moment's time, when the studio's form asks for one.
     *
     * The starter questionnaire asks only for the ceremony; a studio that adds
     * a cocktail-hour or cake-cutting question gets it here. Only an actual
     * clock time counts — "Yes" to "Cocktail hour?" is not 5:30.
     */
    const momentTime = (keys: readonly string[]) =>
      eventDateTime(
        eventDate,
        keys
          .map((key) => answer(answers, [key]))
          .find((value) => /^\d{2}:\d{2}$/.test(value)) ?? "",
      );
    const nextMomentTimes = {
      firstLookAt: momentTime(["first-look-time", "firstLookTime", "first_look_time"]),
      cocktailAt: momentTime(["cocktail-hour", "cocktail-hour-time", "cocktail-time", "cocktailHour", "cocktailTime"]),
      dinnerAt: momentTime(["dinner-time", "dinnerTime", "dinner"]),
      cakeAt: momentTime(["cake-cutting", "cake-cutting-time", "cakeCutting", "cakeCuttingTime"]),
    };
    const minutes = packageMinutes ?? 480;
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
      "end-time",
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
      answer(answers, ["getting-ready", "gettingReadyLocation", "getting-ready-location"]),
      answer(answers, ["ceremony-address", "ceremonyLocation", "ceremony-location"]),
      answer(answers, ["reception-address", "receptionLocation", "reception-location"]),
      answer(answers, ["venue-address", "address"]),
    ].filter(Boolean);
    const nextLocations = Array.from(
      new Set([...questionnaireLocations, venue].filter(Boolean)),
    );
    // What shapes the day, in the couple's own words. The last three are the
    // answers a photographer must have before the first frame — they belong in
    // the brief the AI writes from, not only in the crew brief.
    const labelled = (label: string, value: string) => (value ? `${label}: ${value}` : "");
    const nextPreferences = [
      answer(answers, ["first-look", "firstLook"]) &&
        `First look: ${answer(answers, ["first-look", "firstLook"])}`,
      labelled("Must-have groups", answer(answers, ["must-have-groups", "familyPhotoList", "family-photo-list"])),
      labelled("Sunset portraits", answer(answers, ["sunset-priority"])),
      labelled("Guest count", answer(answers, ["guest-count", "headcount"])),
      labelled("Planner", answer(answers, ["planner"])),
      labelled("Videographer", answer(answers, ["videographer"])),
      labelled("Do not photograph", answer(answers, ["no-photo-list"])),
      labelled("Handle carefully", answer(answers, ["sensitivities"])),
      labelled("Venue restrictions", answer(answers, ["restrictions"])),
      labelled("Accessibility", answer(answers, ["accessibility", "accessibilityNeeds"])),
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
      setMomentTimes(nextMomentTimes);
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
    packageMinutes,
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
            crewIds: [],
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
      // Server-sorted already; kept in start order from here on.
      setDraft({ ...result, items: sortScheduleItems(result.items) });
      setAskResult(null);
      setPublishNotice(null);
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
  /**
   * What a hand-started draft was built from.
   *
   * `sourceTrace` only counts what the model was given — questionnaire
   * answers, timing rules, crew facts — so a draft seeded from the form read
   * "Nothing from this job yet", which was untrue the moment the studio typed
   * a ceremony time. The form is a source; say so.
   */
  const manualGrounding =
    draft && String(draft.interactionId ?? "").startsWith("manual_")
      ? [
          coverageStartsAt && coverageEndsAt ? "your coverage window" : null,
          ceremonyTime ? "the ceremony time" : null,
          receptionTime ? "the reception time" : null,
          locations.trim() ? "your locations" : null,
        ].filter(Boolean)
      : [];
  const groundingParts = [...grounding, ...manualGrounding];
  const ungrounded = groundingParts.length === 0;
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
    : groundingParts.join(", ");

  /** Send the edited questions to the client on this job. */
  async function askTheCouple() {
    if (!askDraft || !clientContactId || !selectedProject) return;
    setAsking(true);
    setAskResult(null);
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
        setAskResult({ tone: "preview", message: "This is a preview, so nothing was sent." });
        return;
      }
      setAskDraft(null);
      setAskResult({
        tone: "sent",
        message: `Sent to ${clientName} — their answers will ground the next draft.`,
      });
    } catch (caught: unknown) {
      setAskResult({
        tone: "error",
        message: friendlyError(caught, "The questions couldn't be sent. Try again in a moment."),
      });
    } finally {
      setAsking(false);
    }
  }

  async function publish() {
    if (!draft) return;
    setPublishing(true);
    setPublishNotice(null);
    try {
      const response = await sendPlanningCommand("publishSchedule", {
        projectId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        coverageMinutes: derivedCoverageMinutes,
        // Both fields, so a function still reading photographerIds sees the crew.
        // In start order: the server sorts too, but what is sent is what was seen.
        items: sortScheduleItems(draft.items).map((item) => withCrewIds(item)),
      });
      const stale = Number(
        (response.result as { staleVendorShareCount?: unknown }).staleVendorShareCount ?? 0,
      );
      setPublishNotice({
        failed: false,
        message: !response.persisted
          ? "Development preview validated the schedule without publishing."
          : stale > 0
            ? "Published. Your crew can see it now. Your vendors still have the old version — send them this one below."
            : "Published. Your crew can see it now — taking you back to the job.",
      });
      // Say it, then show it. The job page lists this step as complete and
      // names the next move, which is the confirmation the notice alone
      // could not give from the bottom of a long page. Unless vendors hold
      // the old version: then the next move is here, and leaving would hide it.
      if (response.persisted && stale > 0) setStaleVendors(stale);
      else if (response.persisted) returnToJob();
    } catch (caught: unknown) {
      setPublishNotice({ failed: true, message: friendlyError(caught, "Publish failed.") });
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
    // Seeded from the form above, which the studio has usually just filled in
    // — see seededManualSchedule. It used to discard all of it.
    const seeded = seededManualSchedule(() => crypto.randomUUID(), {
      coverageStartsAt: coverageStartsAt || null,
      coverageEndsAt: coverageEndsAt || null,
      ceremonyTime: ceremonyTime || null,
      receptionTime: receptionTime || null,
      locations: locations || null,
    });
    setFailed(false);
    setAskResult(null);
    setPublishNotice(null);
    setNotice(
      seeded.length > 1
        ? `Run of show started from what you entered — ${seeded.length} items. Add the rest, then publish it as a version.`
        : "Empty run of show started. Add each item, then publish it as a version.",
    );
    setDraft({
      items: seeded as ScheduleItem[],
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
            items: sortScheduleItems([
              ...current.items,
              manualScheduleItem(
                crypto.randomUUID(),
                nextItemStart(current.items, coverageStartsAt || null),
              ) as ScheduleItem,
            ]),
          }
        : current,
    );
  }

  /**
   * One of the standard wedding moments, placed from what is known.
   *
   * See features/schedules/standard-moments.ts for where each one lands. The
   * list re-sorts, so it appears in its place in the day, not at the bottom.
   */
  function addMoment(key: StandardMomentKey) {
    setDraft((current) => {
      if (!current) return current;
      const placed = placeStandardMoment(key, current.items, {
        coverageStartsAt: coverageStartsAt || null,
        coverageEndsAt: coverageEndsAt || null,
        ceremonyAt: ceremonyTime || null,
        receptionAt: receptionTime || null,
        firstLookAt: momentTimes.firstLookAt || null,
        cocktailAt: momentTimes.cocktailAt || null,
        dinnerAt: momentTimes.dinnerAt || null,
        cakeAt: momentTimes.cakeAt || null,
      });
      const item = {
        ...manualScheduleItem(crypto.randomUUID(), placed.startAt, placed.title),
        endAt: placed.endAt,
        location:
          locations
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)[0] ?? null,
      } as ScheduleItem;
      return { ...current, items: sortScheduleItems([...current.items, item]) };
    });
  }

  /**
   * Back into time order once a time has been changed.
   *
   * On leaving the field rather than on every change: a row that jumped while
   * its clock was being typed would take the cursor with it.
   */
  function resortItems() {
    setDraft((current) => {
      if (!current) return current;
      const sorted = sortScheduleItems(current.items);
      return sorted.every((item, index) => item === current.items[index])
        ? current
        : { ...current, items: sorted };
    });
  }

  /**
   * Move a row up or down the day.
   *
   * The list is always in time order, so moving a row moves its time: it
   * trades slots with its neighbour, each keeping its own length. Two items at
   * the same time just swap places. See features/schedules/run-of-show-order.ts.
   */
  function moveItem(index: number, direction: "up" | "down") {
    setDraft((current) =>
      current
        ? { ...current, items: moveScheduleItem(current.items, index, direction) }
        : current,
    );
  }

  /**
   * Start a draft from the version already published.
   *
   * There was no way to edit a published run of show: the only paths were a
   * new AI draft or "Build it myself" from the form, so changing one time the
   * couple asked about meant rebuilding the day. Publishing it again makes a
   * new version, as before.
   */
  function editPublishedVersion() {
    if (!selectedSchedule) return;
    const items = Array.isArray(selectedSchedule.items)
      ? (selectedSchedule.items as ScheduleItem[])
      : [];
    if (!items.length) return;
    setFailed(false);
    setAskResult(null);
    setPublishNotice(null);
    setNotice(
      `Version ${Number(selectedSchedule.version ?? 1)} is open below. Change what you need, then publish it as a new version.`,
    );
    setDraft({
      items: sortScheduleItems(
        items.map((item) => ({
          ...item,
          description: item.description ?? "",
          location: item.location ?? null,
          address: item.address ?? null,
          travelMinutes: item.travelMinutes ?? 0,
          participants: item.participants ?? [],
          vendorContactIds: item.vendorContactIds ?? [],
          equipment: item.equipment ?? [],
          notes: item.notes ?? null,
          visibility: item.visibility ?? "shared",
          blockingIssues: item.blockingIssues ?? [],
          sourceReferences: item.sourceReferences ?? [],
        })),
      ),
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

  /** Put someone on a segment, or take them off it. */
  function toggleCrew(index: number, crewId: string) {
    const item = draft?.items[index];
    if (!item) return;
    const current = itemCrewIds(item);
    const next = current.includes(crewId)
      ? current.filter((id) => id !== crewId)
      : [...current, crewId];
    updateItem(index, withCrewIds(item, next));
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
      {coupleChangeRequest !== null ? (
        <div className="schedule-replanning-notice" role="status">
          <PencilLine aria-hidden="true" />
          <span>
            <strong>
              {`${clientName === "the couple" ? "The couple" : clientName} asked for changes${
                publishedVersion ? ` to version ${publishedVersion}` : ""
              }`}
            </strong>
            {coupleChangeRequest ? <small>“{coupleChangeRequest}”</small> : null}
            <small>
              {`Your crew still have this version. Make the change and publish it — ${clientName} will be asked to check the new one.`}
            </small>
            {!draft && publishedHasItems ? (
              <button
                className="button button-dark schedule-revise-button"
                onClick={editPublishedVersion}
                type="button"
              >
                <PencilLine size={15} /> {`Open version ${publishedVersion} to change it`}
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
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
              {liveProjects(projects).map((project) => <option key={project.id} value={project.id}>{String(project.name)}</option>)}
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
            {/* Change one time without rebuilding the day. */}
            {!draft && publishedHasItems ? (
              <button
                className="button button-light"
                disabled={busy}
                onClick={editPublishedVersion}
                type="button"
              >
                <PencilLine /> {`Edit version ${publishedVersion}`}
              </button>
            ) : null}
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
                <h2>
                  The day
                  <InfoHint label="The day">
                    Each item says where its time came from: the couple’s answers, one of your timing rules, or an
                    assumption. Check the assumptions before you publish.
                  </InfoHint>
                </h2>
                <p>Change anything — it stays in time order. Your crew sees it once you publish.</p>
              </div>
              <AlertTriangle />
            </div>
            {draft.items.map((item, index) => (
              <article key={item.id}>
                <input aria-label="Item title" value={item.title} onChange={(event) => updateItem(index, { title: event.target.value })} />
                {/* Re-sorted on leaving the field — see resortItems. */}
                <input aria-label="Start time" type="datetime-local" value={toLocalInput(item.startAt)} onBlur={resortItems} onChange={(event) => { const startAt = fromLocalInput(event.target.value); if (startAt) updateItem(index, { startAt }); }} />
                <input aria-label="End time" type="datetime-local" value={toLocalInput(item.endAt)} onBlur={resortItems} onChange={(event) => { const endAt = fromLocalInput(event.target.value); if (endAt) updateItem(index, { endAt }); }} />
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
                {/*
                  * Who is on it — photographers and videographers alike.
                  *
                  * Items carried a crew list nobody could edit, so the
                  * videographer on a photo + video wedding could not be put on
                  * the speeches, and their day sheet could not say so.
                  */}
                {crewOptions.length ? (
                  <fieldset className="schedule-item-crew">
                    <legend>Crew on this</legend>
                    {crewOptions.map((member) => (
                      <label key={member.id}>
                        <input
                          checked={itemCrewIds(item).includes(member.id)}
                          onChange={() => toggleCrew(index, member.id)}
                          type="checkbox"
                        />
                        {member.name} · {member.role}
                      </label>
                    ))}
                  </fieldset>
                ) : null}
                {/*
                  * Move moves the time: the list is always in time order, so
                  * a manual order the sort would undo is not on offer.
                  */}
                <div className="schedule-item-actions">
                  <button
                    aria-label={`Move ${item.title || `item ${index + 1}`} earlier`}
                    className="button button-quiet schedule-item-move"
                    disabled={!scheduleItemMoves(draft.items.length, index).up}
                    onClick={() => moveItem(index, "up")}
                    type="button"
                  >
                    <ArrowUp size={14} /> Move up
                  </button>
                  <button
                    aria-label={`Move ${item.title || `item ${index + 1}`} later`}
                    className="button button-quiet schedule-item-move"
                    disabled={!scheduleItemMoves(draft.items.length, index).down}
                    onClick={() => moveItem(index, "down")}
                    type="button"
                  >
                    <ArrowDown size={14} /> Move down
                  </button>
                  <button
                    aria-label={`Remove item ${index + 1}`}
                    className="button button-quiet schedule-item-remove"
                    onClick={() => removeItem(index)}
                    type="button"
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
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
            {/*
              * The moments every wedding has, one tap each, placed from the
              * ceremony, reception and coverage times above. See
              * features/schedules/standard-moments.ts.
              */}
            {isWeddingJob(selectedProject) ? (
              <div className="schedule-moments" role="group" aria-label="Add a moment">
                <span>Add a moment</span>
                {WEDDING_STANDARD_MOMENTS.map((moment) => (
                  <button
                    className="schedule-moment-chip"
                    key={moment.key}
                    onClick={() => addMoment(moment.key)}
                    type="button"
                  >
                    <Plus aria-hidden size={13} /> {moment.label}
                  </button>
                ))}
              </div>
            ) : null}
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
                yours. Ask {clientName}{" "} the questions below, or add your own
                timing rules, and the next draft will be built from real
                answers instead.
              </p>
            ) : (
              <p className="schedule-basis-empty">
                Built from {groundingSummary}.
                {" "}{draft.sourceTrace.assumptionItemCount > 0
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
                  onClick={() => {
                    setAskResult(null);
                    setAskDraft(
                      [
                        // No greeting here: the branded renderer writes
                        // "Hi <first name>," itself and strips one from the
                        // body, so a greeting typed here is invisible to the
                        // couple and only misleads whoever edits this draft.
                        "A few questions so we can plan your day properly:",
                        "",
                        ...draft.suggestedQuestions.map(
                          (question) => `- ${question}`,
                        ),
                        "",
                        "No rush — whatever you know so far helps.",
                      ].join("\n"),
                    );
                  }}
                  type="button"
                >
                  <Sparkles size={16} />{" "}
                  {askResult?.tone === "sent" ? "Write another message" : "Put these in a message"}
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
              {/* The answer to "did it go?", right under the button that sent it. */}
              {askResult ? (
                <p
                  className={
                    askResult.tone === "error"
                      ? "form-notice form-notice-error schedule-ask-result"
                      : "form-notice schedule-ask-result"
                  }
                  role={askResult.tone === "error" ? "alert" : "status"}
                >
                  {askResult.tone === "error" ? (
                    <AlertTriangle aria-hidden size={16} />
                  ) : askResult.tone === "sent" ? (
                    <CheckCircle2 aria-hidden size={16} />
                  ) : null}
                  {askResult.message}
                </p>
              ) : null}
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
              <strong>
                Nothing reaches your crew until you publish.
                <InfoHint label="Publishing">
                  Publishing saves a new version. Accepted crew get the items meant for them and confirm it again; the
                  couple is asked to approve the items meant for them.
                </InfoHint>
              </strong>
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
          {publishNotice ? (
            <p
              className={publishNotice.failed ? "form-notice form-notice-error" : "form-notice"}
              role={publishNotice.failed ? "alert" : "status"}
            >
              {publishNotice.failed ? (
                <AlertTriangle aria-hidden size={16} />
              ) : (
                <CheckCircle2 aria-hidden size={16} />
              )}
              {publishNotice.message}
            </p>
          ) : null}
          {staleVendors > 0 && projectId ? <VendorReshareBanner projectId={projectId} /> : null}
        </>
      ) : null}
    </div>
  );
}
