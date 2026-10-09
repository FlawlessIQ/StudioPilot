"use client";

import { fillMcScript, patchMcScript, type McScript } from "@/features/schedules/mc-script";
import { DJ_MOMENTS, planNight } from "@/features/schedules/night-plan";
import { chairDayPlan, planChairs } from "@/features/schedules/chair-plan";
import { parsePartyList, type BeautyService } from "@/features/schedules/party-list";
import { tradeOf, tradeProfile, tradeVocab } from "@/features/trades/trades";
import { resolveCoverage } from "@/features/packages/coverage";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ListPlus,
  LoaderCircle,
  PencilLine,
  Music,
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
import { sortScheduleItems } from "@/features/schedules/run-of-show-order";
import { clockOf, eventZone, isoToWallClock, spokenClock, wallClockToIso } from "@/features/schedules/day-clock";
import {
  flowEnds,
  pinnedEnds,
  planDay,
  planItems,
  titleIsTbd,
  withTbdTitle,
} from "@/features/schedules/day-plan";
import { TimingRuleEditor } from "@/components/planning/timing-rule-editor";
import {
  WEDDING_STANDARD_MOMENTS,
  isWeddingJob,
  kindMomentsFor,
  placeKindMoment,
  placeStandardMoment,
  type KindMoment,
  type StandardMomentKey,
} from "@/features/schedules/standard-moments";
import { scheduleCrewOptions } from "@/features/schedules/crew-options";
import { crewLabels, sortLabels } from "@/features/schedules/crew-labels";
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
  /** A DJ's MC script for the moment (features/schedules/mc-script.ts). */
  mc?: McScript;
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

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Where a line's time came from, in the studio's words. The chips read
 * "project fact · ceremonyTime" and "assumption · Standard 30 min duration for
 * getting into the dress" (GR Productions, 2026-10-06): the system talking to
 * itself. The laid-out day already labels its own lines plainly.
 */
const SOURCE_WORDS: Record<string, string> = {
  questionnaire_answer: "From their form",
  timing_rule: "Your timing",
  project_fact: "From the job",
  package_fact: "From the package",
  crew_fact: "From the crew",
  assumption: "Suggested — check it",
};
// A makeup or hair morning names whose chair each line is (chair-plan.ts).
const sourceWords = (source: { type: string; label: string }) =>
  /^(From their|Their form|Their second|Your timing|Suggested|Coverage starts|Chair \d)/.test(source.label)
    ? source.label
    : (SOURCE_WORDS[source.type] ?? "Suggested — check it");

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
 * Every time on this screen is a wall clock at the wedding, in the job's zone
 * (features/schedules/day-clock.ts). It used to be the browser's: a datetime-
 * local field read local, a stored instant was sliced as UTC, and the publish
 * sent the laptop's zone — fine until a laptop or a wedding was anywhere else.
 */
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
  // A DJ scripts the mic on each line (trades.ts `musicPlanner`).
  const mcScript = tradeProfile(workspace.tenantTrade).musicPlanner;
  // A makeup artist or hair stylist lays out a morning of chairs (`chairSchedule`).
  const chairs = tradeProfile(workspace.tenantTrade).chairSchedule;
  const chairService: BeautyService = tradeOf(workspace.tenantTrade) === "hair" ? "hair" : "makeup";
  // A photographer's "Coverage", anyone else's "Service" (trades.ts `coverage`).
  const coverageWord = tradeVocab(workspace.tenantTrade).coverage;
  const photo = tradeProfile(workspace.tenantTrade).family === "photo";
  // A vendor's client fills in one form and the plan is drawn from it, with
  // nothing for them to approve (trades.ts `journey.oneForm`, `scheduleApproval`).
  const oneForm = tradeProfile(workspace.tenantTrade).journey.oneForm;
  const clientApproves = tradeProfile(workspace.tenantTrade).journey.scheduleApproval;
  const formName = tradeVocab(workspace.tenantTrade).detailsForm ?? "form";
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
  /** Blocks whose end the studio set; every other block runs to the next one. */
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
  /** What the laid-out day wants the studio to check, said once above the lines. */
  const [planNotes, setPlanNotes] = useState<string[]>([]);
  // Suggested lines the answered-only layout left out (day-plan.ts, `withheld`).
  const [withheld, setWithheld] = useState(0);
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
   * questionnaire asks (the wedding starter asks for each, 2026-10-01). The
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
  /** The wedding's zone: the job's, else this browser's, else New York. */
  const zone = useMemo(
    () => eventZone(selectedProject?.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone),
    [selectedProject],
  );
  const eventDay = String(selectedProject?.eventDate ?? "").slice(0, 10);
  /** A wedding is laid out from its answers; other kinds keep the AI and moment chips. */
  const weddingDay = isWeddingJob(selectedProject);
  /** A "YYYY-MM-DDTHH:MM" field value, read at the wedding. */
  const localToIso = (local: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(local) ? wallClockToIso(local.slice(0, 10), local.slice(11, 16), zone) : null;
  /**
   * Everything the couple has told the studio, across every form on the job:
   * the event details and the final schedule are separate forms, and the day
   * needs both. Newest answer wins.
   */
  const jobAnswers = useMemo(() => {
    const merged: Record<string, unknown> = {};
    (questionnaires ?? [])
      .filter((response) => response.projectId === projectId && response.status !== "archived" && !response.withdrawnAt)
      .sort((left, right) =>
        String(left.updatedAt ?? left.submittedAt ?? "").localeCompare(String(right.updatedAt ?? right.submittedAt ?? "")),
      )
      .forEach((response) => {
        for (const [key, value] of Object.entries(record(response.answers))) {
          if (value !== null && value !== undefined && String(value).trim() !== "") merged[key] = value;
        }
      });
    return merged;
  }, [projectId, questionnaires]);
  const crewOptions = useMemo(
    () =>
      scheduleCrewOptions({
        projectId,
        assignments: crewAssignments ?? [],
        profiles: crewProfiles ?? [],
      }),
    [crewAssignments, crewProfiles, projectId],
  );
  /**
   * The crew as the studio writes them — P1, V1, P2, V2 — and the teams they
   * make: the first stays with the bride, the second takes the groom
   * (features/schedules/crew-labels.ts; GR's run of show, 2026-10-06).
   */
  const crewTags = useMemo(() => {
    const labels = crewLabels(crewOptions.map((member) => ({ id: member.id, role: member.role })));
    const byNumber = (number: number) => crewOptions.filter((member) => labels.get(member.id)?.number === number).map((member) => member.id);
    return {
      labels,
      // P1, P2, V1, V2 — the order the PDF and the chips use.
      ordered: (() => {
        const order = sortLabels(crewOptions.map((member) => labels.get(member.id)?.label ?? ""));
        const at = (id: string) => order.indexOf(labels.get(id)?.label ?? "");
        return [...crewOptions].sort((left, right) => at(left.id) - at(right.id));
      })(),
      teams: { first: byNumber(1), second: byNumber(2) },
    };
  }, [crewOptions]);
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
  /**
   * The artists the job's packages send, in the studio's own role (a
   * package's crew is roles, not photographers: coverage.ts). Maya's party of
   * six was laid out for one artist though her package booked two — the
   * plan counted only the artists the morning strictly needs.
   */
  const packageArtists = useMemo(() => {
    const role = tradeProfile(workspace.tenantTrade).coverageRoles[0];
    const count = currentJobSnapshots(packageSnapshots ?? [], selectedProject)
      .flatMap((snapshot) => resolveCoverage(snapshot))
      .filter((item) => item.role === role)
      .reduce((sum, item) => sum + item.count, 0);
    return count > 0 ? count : null;
  }, [packageSnapshots, selectedProject, workspace.tenantTrade]);
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
     * The wedding starter asks for each (first look only after "Yes" to a
     * first look); the older aliases cover studios whose own forms differ.
     * Only an actual clock time counts — "Yes" to "Cocktail hour?" is not 5:30.
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
      const startsAt = localToIso(String(form.get("coverageStartsAt") ?? ""));
      const endsAt = localToIso(String(form.get("coverageEndsAt") ?? ""));
      if (!startsAt || !endsAt) throw new Error(`Enter a ${coverageWord.toLowerCase()} window.`);
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
            ceremonyTime: localToIso(String(form.get("ceremonyTime") ?? "")),
            receptionTime: localToIso(String(form.get("receptionTime") ?? "")),
            locations: parsedLocations,
            preferences: String(form.get("preferences") ?? ""),
          }),
        },
      );
      const result = (await response.json()) as Draft & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Generation failed.");
      // Server-sorted already; kept in start order from here on. The model's
      // ends are kept as it set them; the studio can let any run to the next.
      const items = sortScheduleItems(result.items);
      setPinned(pinnedEnds(items, endsAt));
      setPlanNotes([]);
      setWithheld(0);
      setDraft({ ...result, items });
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
          coverageStartsAt && coverageEndsAt ? `your ${coverageWord.toLowerCase()} window` : null,
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
        // The wedding's zone; the server prefers the job's own (publishSchedule).
        timezone: zone,
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
            : clientApproves
              ? "Published. Your crew can see it now — taking you back to the job."
              : "Published. Your client and crew can see it now, with nothing to approve — taking you back to the job.",
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
      coverageStartsAt: localToIso(coverageStartsAt),
      coverageEndsAt: localToIso(coverageEndsAt),
      ceremonyTime: localToIso(ceremonyTime),
      receptionTime: localToIso(receptionTime),
      locations: locations || null,
      eventDate: String(selectedProject?.eventDate ?? "").slice(0, 10) || null,
    });
    setFailed(false);
    setAskResult(null);
    setPublishNotice(null);
    setNotice(
      seeded.length > 1
        ? `Run of show started from what you entered — ${seeded.length} items. Add the rest, then publish it as a version.`
        : "Empty run of show started. Add each item, then publish it as a version.",
    );
    setPinned(pinnedEnds(seeded as ScheduleItem[], localToIso(coverageEndsAt)));
    setPlanNotes([]);
    setWithheld(0);
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

  /**
   * Every change to the lines goes through here, so each block keeps running
   * to the next one (or to the end of coverage) unless the studio set its end.
   */
  function changeItems(change: (items: ScheduleItem[]) => ScheduleItem[], keepPinned: Set<string> = pinned) {
    const coverageEnd = localToIso(coverageEndsAt);
    setDraft((current) =>
      current ? { ...current, items: flowEnds(change(current.items), keepPinned, coverageEnd) } : current,
    );
  }

  /**
   * The day, laid out from the couple's answers and the studio's timings.
   *
   * GR Productions (2026-10-06): the run of show was "too strict" for a day
   * that is different every wedding, and the AI draft placed times hours off.
   * This needs no model: the ceremony is the anchor, and each milestone comes
   * from the couple's form, the studio's timing rule, or the usual timing — in
   * that order (features/schedules/day-plan.ts).
   */
  function dayPlanInput() {
    return {
      answers: jobAnswers,
      coverageMinutes: packageMinutes ?? null,
      venue: String(selectedProject?.venueName ?? "").trim() || null,
      secondTeam: crewTags.teams.second.length > 0,
    };
  }

  /**
   * The suggested lines, added to the draft as it stands.
   *
   * Merged rather than laid out again, so anything already changed by hand
   * stays changed. Each comes in marked "Suggested — check it".
   */
  function suggestGaps() {
    if (!draft || !eventDay) return;
    const full = planDay(dayPlanInput());
    const suggested = (planItems(full, {
      eventDate: eventDay,
      timeZone: zone,
      idFor: () => crypto.randomUUID(),
      teams: crewTags.teams,
    }) as ScheduleItem[]).filter((item) => item.sourceReferences[0]?.type === "assumption");
    const have = new Set(draft.items.map((item) => item.title.trim().toLowerCase()));
    const added = suggested.filter((item) => !have.has(item.title.trim().toLowerCase()));
    setDraft({
      ...draft,
      items: sortScheduleItems([...draft.items, ...added]),
      sourceTrace: { ...draft.sourceTrace, assumptionItemCount: draft.sourceTrace.assumptionItemCount + added.length },
    });
    setWithheld(0);
  }

  /**
   * A makeup or hair morning, from the client's party list: each person's
   * chair, worked back from when everyone must be ready (chair-plan.ts).
   */
  function chairMorning() {
    const clockAnswer = (key: string) => clockOf(String(jobAnswers[key] ?? ""));
    const readyBy = clockAnswer("ready-by-time");
    const plan = planChairs({
      people: parsePartyList(jobAnswers["party-list"], chairService),
      service: chairService,
      readyBy,
      earliestStart: clockAnswer("earliest-start-time"),
      // Laid out for the artists booked; the plan says if fewer would do.
      artists: packageArtists,
    });
    const place = String(jobAnswers["getting-ready"] ?? "").trim() || dayPlanInput().venue;
    return chairDayPlan(plan, { service: chairService, place, readyBy });
  }

  function layOutDay() {
    setFailed(false);
    setAskResult(null);
    setPublishNotice(null);
    if (!eventDay) {
      setNotice("This job has no date yet. Add the wedding date, then lay out the day.");
      return;
    }
    // The couple's form, and nothing else of the studio's: timing rules "don't
    // work for every wedding" (GR, 2026-10-06). Only what they answered, too:
    // the gaps' suggestions come on request ("Suggest times for the gaps").
    // A DJ's night is the ceremony music and the reception's running order,
    // not a photographer's day (night-plan.ts).
    const plan = mcScript
      ? planNight({ answers: jobAnswers, coverageMinutes: packageMinutes ?? null, venue: dayPlanInput().venue })
      : chairs
        ? chairMorning()
        : planDay({ ...dayPlanInput(), answeredOnly: true });
    setPlanNotes(plan.notes);
    setWithheld(plan.withheld);
    if (!plan.rows.length) {
      setNotice(plan.notes.join(" "));
      return;
    }
    const planned = planItems(plan, {
      eventDate: eventDay,
      timeZone: zone,
      idFor: () => crypto.randomUUID(),
      teams: crewTags.teams,
    }) as ScheduleItem[];
    // The couple's songs and names onto the lines they belong to (mc-script.ts).
    const items = mcScript ? fillMcScript(planned, jobAnswers).items : planned;
    if (plan.coverageStart) setCoverageStartsAt(`${eventDay}T${plan.coverageStart}`);
    if (plan.coverageEnd) setCoverageEndsAt(`${eventDay}T${plan.coverageEnd}`);
    const coverageEnd = plan.coverageEnd ? wallClockToIso(eventDay, plan.coverageEnd, zone) : null;
    const count = (type: string) => items.filter((item) => item.sourceReferences[0]?.type === type).length;
    setPinned(pinnedEnds(items, coverageEnd));
    setDraft({
      items,
      assumptions: [],
      missingInformation: [],
      conflicts: [],
      risks: [],
      suggestedQuestions: [],
      interactionId: `dayplan_${crypto.randomUUID()}`,
      humanReviewRequired: true,
      sourceTrace: {
        questionnaireCount: count("questionnaire_answer"),
        timingRuleCount: count("timing_rule"),
        crewFactCount: 0,
        assumptionItemCount: count("assumption"),
      },
    });
    setNotice(
      `The day is laid out: ${items.length} lines, ${plan.churchDay ? "a church day" : "all at one venue"}${
        plan.firstLook ? " with a first look" : ""
      }. Change anything, then publish.`,
    );
  }

  /**
   * The plan drawn from the one form, without being asked.
   *
   * A DJ's, makeup artist's or hair stylist's client fills in one form, and
   * the run of show or the getting-ready schedule comes from it (simpler
   * vendor journeys, Phase 2). So once that form is back, opening this page
   * lays it out, and the studio only checks it and publishes. Done here, not
   * on the server when the form arrives: the planners (chair-plan.ts,
   * night-plan.ts, day-plan.ts `planItems`) live in features/, and a draft is
   * only ever held in this editor. Once per job, only while nothing is
   * drafted or published, so it never lays over the studio's own work.
   */
  const laidOutFromForm = useRef<string | null>(null);
  const [drawnFromForm, setDrawnFromForm] = useState(false);
  useEffect(() => {
    if (!oneForm || !weddingDay || !projectId || !eventDay) return;
    // Wait for what it reads, so an existing version is never missed.
    if (!schedules || !questionnaires || !packageSnapshots) return;
    if (draft || selectedSchedule || !selectedQuestionnaire) return;
    if (laidOutFromForm.current === projectId) return;
    laidOutFromForm.current = projectId;
    setDrawnFromForm(true);
    layOutDay();
    // layOutDay reads the same answers; it is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oneForm, weddingDay, projectId, eventDay, schedules, questionnaires, packageSnapshots, draft, selectedSchedule, selectedQuestionnaire]);

  function addItem() {
    changeItems((items) =>
      sortScheduleItems([
        ...items,
        manualScheduleItem(crypto.randomUUID(), nextItemStart(items, localToIso(coverageStartsAt))) as ScheduleItem,
      ]),
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
      // As instants at the wedding: the helper reads anything Date can, and
      // a bare "2027-08-17T16:00" would be read in this browser's zone.
      const placed = placeStandardMoment(key, current.items, {
        coverageStartsAt: localToIso(coverageStartsAt),
        coverageEndsAt: localToIso(coverageEndsAt),
        ceremonyAt: localToIso(ceremonyTime),
        receptionAt: localToIso(receptionTime),
        firstLookAt: localToIso(momentTimes.firstLookAt),
        cocktailAt: localToIso(momentTimes.cocktailAt),
        dinnerAt: localToIso(momentTimes.dinnerAt),
        cakeAt: localToIso(momentTimes.cakeAt),
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
      return { ...current, items: flowEnds(sortScheduleItems([...current.items, item]), pinned, localToIso(coverageEndsAt)) };
    });
  }

  /** A corporate or sports moment, after the last item: the studio sets its time. */
  function addKindMoment(moment: KindMoment) {
    setDraft((current) => {
      if (!current) return current;
      const placed = placeKindMoment(moment, current.items, localToIso(coverageStartsAt));
      const item = {
        ...manualScheduleItem(crypto.randomUUID(), placed.startAt, placed.title),
        endAt: placed.endAt,
        location:
          locations
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)[0] ?? null,
      } as ScheduleItem;
      return { ...current, items: flowEnds(sortScheduleItems([...current.items, item]), pinned, localToIso(coverageEndsAt)) };
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
    // Every deliberate gap stays: an end that isn't where the day would put it is the studio's.
    const lastEnd = items.reduce((latest, item) => (String(item.endAt) > latest ? String(item.endAt) : latest), "");
    setPinned(pinnedEnds(items, lastEnd || null));
    setPlanNotes([]);
    setWithheld(0);
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
    changeItems((items) => items.filter((_, itemIndex) => itemIndex !== index));
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

  function updateItem(index: number, patch: Partial<ScheduleItem>, keepPinned: Set<string> = pinned) {
    changeItems((items) => items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)), keepPinned);
  }

  /** A line's own day (an after-midnight line keeps its date) and its clock there. */
  const clockOfItem = (iso: string) => isoToWallClock(iso, zone);

  /** A new start time; a block with its own end keeps its length. */
  function changeStart(index: number, clock: string) {
    const item = draft?.items[index];
    if (!item || !clock) return;
    const startAt = wallClockToIso(clockOfItem(item.startAt)?.date || eventDay, clock, zone);
    if (!startAt) return;
    const patch: Partial<ScheduleItem> = { startAt };
    if (pinned.has(item.id)) {
      const length = Date.parse(item.endAt) - Date.parse(item.startAt);
      patch.endAt = new Date(Date.parse(startAt) + Math.max(length, 15 * 60_000)).toISOString();
    }
    updateItem(index, patch);
  }

  /** Set this block's own end, or (null) let it run to the next one again. */
  function changeEnd(index: number, clock: string | null) {
    const item = draft?.items[index];
    if (!item) return;
    const next = new Set(pinned);
    if (clock === null) {
      next.delete(item.id);
      setPinned(next);
      updateItem(index, {}, next);
      return;
    }
    const endAt = wallClockToIso(clockOfItem(item.startAt)?.date || eventDay, clock, zone);
    if (!endAt || Date.parse(endAt) <= Date.parse(item.startAt)) return;
    next.add(item.id);
    setPinned(next);
    updateItem(index, { endAt }, next);
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
            {weddingDay ? (
              <>
                <h2>{mcScript ? "Lay out the night" : chairs ? "Lay out the morning" : "Lay out the day"}</h2>
                <p>
                  {mcScript
                    ? "Built from the couple’s times and their Music & moments planner: the running order, with their songs and names on each line. Every line is yours to change."
                    : chairs
                      ? "Built from their party list: everyone's chair, worked back from when they need to be ready, the bride in the middle. Every line is yours to change."
                    : "Built from the couple’s Final Schedule answers, and only those. Ask for suggested times for anything they left out. Every line is yours to change."}
                </p>
              </>
            ) : (
              <>
                <h2>Generate a run of show</h2>
                <p>Fill in what you know. Anything you leave blank is guessed and labeled as a guess.</p>
              </>
            )}
          </div>
          {weddingDay ? <CalendarClock /> : <Sparkles />}
        </div>
        <form
          className="schedule-generator-form"
          onSubmit={(event) => {
            // A wedding is laid out from its answers; the AI draft is for other kinds.
            if (weddingDay) {
              event.preventDefault();
              layOutDay();
              return;
            }
            void generate(event);
          }}
        >
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
          {/*
            * What the AI draft is asked to work from — for jobs that aren't
            * weddings. A wedding's day comes from the couple's Final Schedule
            * (layOutDay); two buttons that disagreed was the bug: GR pressed
            * the AI one and got their timing rules, not the form (2026-10-06).
            */}
          {weddingDay ? null : (
          <details className="form-span schedule-ai-inputs is-plain" open>
            <summary>{`${coverageWord}, times and notes for an AI draft`}</summary>
            <div className="schedule-ai-inputs-grid">
          <label>
            {`${coverageWord} starts`}
            <input
              required
              name="coverageStartsAt"
              onChange={(event) => setCoverageStartsAt(event.target.value)}
              type="datetime-local"
              value={coverageStartsAt}
            />
          </label>
          <label>
            {`${coverageWord} ends`}
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
              placeholder={
                photo
                  ? "First look, family-photo duration, venue rules, important moments…"
                  : "Venue rules, important moments, anything to plan around…"
              }
              value={preferences}
            />
          </label>
          {prefillSummary ? (
            <p className="form-notice form-span">{prefillSummary}</p>
          ) : null}
            </div>
          </details>
          )}
          {selectedSchedule ? (
            <div className="schedule-replanning-notice form-span">
              <CalendarClock aria-hidden="true" />
              <span>
                <strong>
                  {planningInputsChanged
                    ? "New planning details are ready to reconcile"
                    : weddingDay && publishedVersion
                      ? `Version ${publishedVersion} is published`
                      : `A schedule version already exists for this project`}
                </strong>
                <small>
                  {planningInputsChanged
                    ? "The submitted questionnaire changed after the current version. The new draft will be compared when you publish it."
                    : weddingDay
                      ? "Open it to change a time, or start over from the couple’s answers. Publishing makes a new version and shows what changed."
                      : "Generate only when facts changed. Publishing creates an immutable version and shows the exact impact."}
                </small>
              </span>
            </div>
          ) : null}
          <div className="schedule-generate-actions">
            {weddingDay ? (
              <button className="button button-dark" disabled={busy || !projectId} onClick={layOutDay} type="button">
                <CalendarClock /> {draft ? "Start over from their answers" : mcScript ? "Lay out the night" : chairs ? "Lay out the morning" : "Lay out the day"}
              </button>
            ) : null}
            {weddingDay ? null : (
              <button className="button button-dark" disabled={busy} type="submit">
                {busy ? <LoaderCircle className="spin" /> : <Sparkles />}
                {busy ? "Generating…" : selectedSchedule ? "Prepare updated draft" : "Generate draft"}
              </button>
            )}
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
      {draft && drawnFromForm ? (
        <p className="form-notice" role="status">
          <CheckCircle2 aria-hidden size={16} />
          {`Drafted from their ${formName.toLowerCase()}. Check it, then publish — there's nothing for them to approve.`}
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
                    {weddingDay
                      ? "Each line says where its time came from: the couple’s form, or a suggestion where they gave no time. Check the suggestions before you publish."
                      : "Each item says where its time came from: the client’s answers, one of your timing rules, or an assumption. Check the assumptions before you publish."}
                  </InfoHint>
                </h2>
                <p>Change anything — it stays in time order. Your crew sees it once you publish.</p>
              </div>
              <AlertTriangle />
            </div>
            {weddingDay && withheld > 0 ? (
              <p className="schedule-plan-gaps">
                <span>
                  {`Only what the couple gave is here. ${withheld === 1 ? "One part of the day has" : `${withheld} parts of the day have`} no time from them yet.`}
                </span>
                <button className="button button-light" disabled={busy} onClick={suggestGaps} type="button">
                  Suggest times for the gaps
                </button>
              </p>
            ) : null}
            {planNotes.length ? (
              <ul className="schedule-plan-notes" role="status">
                {planNotes.map((note) => (
                  <li key={note}>
                    <AlertTriangle aria-hidden size={13} /> {note}
                  </li>
                ))}
              </ul>
            ) : null}
            {/*
              * One line per block: time · what · where.
              *
              * GR Productions (2026-10-06) found the old rows "too strict" —
              * a date-and-time picker for the start and another for the end
              * of every block, on a day that only has one date. The date is
              * the wedding's; a block runs until the next one starts unless
              * its end is set; the list sorts itself, so there is nothing to
              * move.
              */}
            {draft.items.map((item, index) => {
              const start = clockOfItem(item.startAt);
              const end = clockOfItem(item.endAt);
              const tbd = titleIsTbd(item.title);
              const ownEnd = pinned.has(item.id);
              const crewCount = itemCrewIds(item).length;
              return (
                <div className={tbd ? "schedule-line is-tbd" : "schedule-line"} key={item.id}>
                  {/* Re-sorted on leaving the field — see resortItems. */}
                  <input
                    aria-label={`Time for ${item.title || `line ${index + 1}`}`}
                    className="schedule-line-time"
                    onBlur={resortItems}
                    onChange={(event) => changeStart(index, event.target.value)}
                    type="time"
                    value={start?.clock ?? ""}
                  />
                  <input
                    aria-label="What"
                    className="schedule-line-what"
                    onChange={(event) => updateItem(index, { title: withTbdTitle(event.target.value, tbd) })}
                    placeholder="What happens"
                    value={withTbdTitle(item.title, false)}
                  />
                  <input
                    aria-label="Where"
                    className="schedule-line-where"
                    onChange={(event) => updateItem(index, { location: event.target.value || null })}
                    placeholder="Where"
                    value={item.location ?? ""}
                  />
                  <div className="schedule-line-meta">
                    {ownEnd ? (
                      <span className="schedule-line-end">
                        <label>
                          Ends
                          <input
                            aria-label={`End time for ${item.title || `line ${index + 1}`}`}
                            onChange={(event) => changeEnd(index, event.target.value)}
                            type="time"
                            value={end?.clock ?? ""}
                          />
                        </label>
                        <button className="schedule-line-link" onClick={() => changeEnd(index, null)} type="button">
                          Run to the next
                        </button>
                      </span>
                    ) : (
                      <button
                        className="schedule-line-link"
                        onClick={() => end && changeEnd(index, end.clock)}
                        title="Set this block's own end"
                        type="button"
                      >
                        {end ? `until ${spokenClock(end.clock)}` : "Set an end"}
                      </button>
                    )}
                    <label className="schedule-line-tbd">
                      <input
                        checked={tbd}
                        onChange={(event) => updateItem(index, { title: withTbdTitle(item.title, event.target.checked) })}
                        type="checkbox"
                      />
                      Time TBD
                    </label>
                    {item.sourceReferences.slice(0, 1).map((source) => (
                      <span
                        className={source.type === "assumption" ? "schedule-line-source is-assumption" : "schedule-line-source"}
                        key={`${source.type}-${source.sourceId}`}
                        title={source.label}
                      >
                        {sourceWords(source)}
                      </span>
                    ))}
                    {item.blockingIssues.length ? <small>{item.blockingIssues.join(" · ")}</small> : null}
                    {mcScript ? (
                      <span className="schedule-line-mc" role="group" aria-label={`MC script for ${item.title || `line ${index + 1}`}`}>
                        <input
                          aria-label="Song"
                          onChange={(event) => updateItem(index, { mc: patchMcScript(item.mc, { song: event.target.value }) })}
                          placeholder="Song"
                          value={item.mc?.song ?? ""}
                        />
                        <input
                          aria-label="Say on the mic"
                          onChange={(event) => updateItem(index, { mc: patchMcScript(item.mc, { announcement: event.target.value }) })}
                          placeholder="Say on the mic"
                          value={item.mc?.announcement ?? ""}
                        />
                        <input
                          aria-label="How to say the names"
                          onChange={(event) => updateItem(index, { mc: patchMcScript(item.mc, { pronunciation: event.target.value }) })}
                          placeholder="How to say the names"
                          value={item.mc?.pronunciation ?? ""}
                        />
                      </span>
                    ) : null}
                    {/*
                      * Who covers it, as chips: P1 V1 with the bride, P2 V2
                      * with the groom. None picked is everyone. A line runs
                      * to the next one on its own track (day-plan.ts).
                      */}
                    {crewTags.ordered.length ? (
                      <span className="schedule-line-crew" role="group" aria-label={`Who covers ${item.title || `line ${index + 1}`}`}>
                        {crewTags.ordered.map((member) => {
                          const tag = crewTags.labels.get(member.id);
                          const on = itemCrewIds(item).includes(member.id);
                          return (
                            <button
                              aria-pressed={on}
                              className={`schedule-line-chip is-${tag?.trade ?? "photographer"}-${((tag?.number ?? 1) - 1) % 2 + 1}`}
                              key={member.id}
                              onClick={() => toggleCrew(index, member.id)}
                              title={`${member.name} · ${member.role}`}
                              type="button"
                            >
                              {tag?.label ?? member.name}
                            </button>
                          );
                        })}
                        {crewCount ? null : <small>Everyone</small>}
                      </span>
                    ) : null}
                    <button
                      aria-label={`Remove ${item.title || `line ${index + 1}`}`}
                      className="schedule-line-link schedule-line-remove"
                      onClick={() => removeItem(index)}
                      type="button"
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                </div>
              );
            })}
            {/*
              * The moments every wedding has, one tap each, placed from the
              * ceremony, reception and coverage times above. See
              * features/schedules/standard-moments.ts.
              */}
            {mcScript ? (
              // A DJ's moments, each with room for its song and announcement.
              <div className="schedule-moments" role="group" aria-label="Add a moment">
                <span>Add a moment</span>
                {DJ_MOMENTS.map((moment) => (
                  <button
                    className="schedule-moment-chip"
                    key={moment.title}
                    onClick={() => addKindMoment(moment)}
                    type="button"
                  >
                    <Plus aria-hidden size={13} /> {moment.label}
                  </button>
                ))}
                {Object.keys(jobAnswers).length ? (
                  <button
                    className="schedule-moment-chip"
                    onClick={() => changeItems((items) => fillMcScript(items, jobAnswers).items)}
                    type="button"
                  >
                    <Music aria-hidden size={13} /> Fill songs and names from their planner
                  </button>
                ) : null}
              </div>
            ) : chairs ? null : isWeddingJob(selectedProject) ? (
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
            ) : kindMomentsFor(selectedProject).length ? (
              // A corporate event's or a sports day's usual moments (job-kinds).
              <div className="schedule-moments" role="group" aria-label="Add a moment">
                <span>Add a moment</span>
                {kindMomentsFor(selectedProject).map((moment) => (
                  <button
                    className="schedule-moment-chip"
                    key={moment.title}
                    onClick={() => addKindMoment(moment)}
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
                {`Nothing yet — every time below is a typical ${isWeddingJob(selectedProject) ? "wedding day" : "day"}, not yours.`} Ask {clientName}{" "} the questions below, or add your own
                timing rules, and the next draft will be built from real
                answers instead.
              </p>
            ) : (
              <p className="schedule-basis-empty">
                Built from {groundingSummary}.
                {" "}{draft.sourceTrace.assumptionItemCount > 0
                  ? ` ${draft.sourceTrace.assumptionItemCount} of the items below still rest on an assumption — each one is labeled.`
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
                  {clientApproves
                    ? "Publishing saves a new version. Accepted crew get the items meant for them and confirm it again; the couple is asked to approve the items meant for them."
                    : "Publishing saves a new version. Accepted crew get the items meant for them and confirm it again; your client sees the items meant for them, with nothing to approve."}
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
      {/* Timing rules feed the AI draft, which only jobs that aren't weddings use. */}
      {weddingDay ? null : <TimingRuleEditor />}
    </div>
  );
}
