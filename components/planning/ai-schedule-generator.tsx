"use client";

import { FormEvent, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { sendPlanningCommand } from "@/lib/planning/command-client";

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

export function AiScheduleGenerator() {
  const workspace = useWorkspace();
  const { records: projects, loading } = useTenantDocuments("projects");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [coverageMinutes, setCoverageMinutes] = useState(480);
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
      const locations = String(form.get("locations") ?? "")
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
            coverageMinutes,
            photographerIds: [],
            coverageStartsAt: startsAt,
            coverageEndsAt: endsAt,
            ceremonyTime: isoOrNull(form.get("ceremonyTime")),
            receptionTime: isoOrNull(form.get("receptionTime")),
            locations,
            preferences: String(form.get("preferences") ?? ""),
          }),
        },
      );
      const result = (await response.json()) as Draft & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Generation failed.");
      setDraft(result);
      setNotice("Draft generated. Review every item and conflict before publishing.");
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "Generation failed.");
    } finally {
      setBusy(false);
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
        coverageMinutes,
        items: draft.items,
      });
      setNotice(
        response.persisted
          ? "The reviewed schedule was published as a new immutable version."
          : "Development preview validated the schedule without publishing.",
      );
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
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
            <p className="eyebrow">Unapproved draft</p>
            <h2>Generate a run of show</h2>
            <p>Structured model output is validated before it reaches this review screen.</p>
          </div>
          <Sparkles />
        </div>
        <form className="schedule-generator-form" onSubmit={(event) => void generate(event)}>
          <label>
            Project
            <select required disabled={loading} value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">{loading ? "Loading projects…" : "Select a project"}</option>
              {projects?.map((project) => <option key={project.id} value={project.id}>{String(project.name)}</option>)}
            </select>
          </label>
          <label>
            Coverage starts
            <input required name="coverageStartsAt" type="datetime-local" />
          </label>
          <label>
            Coverage ends
            <input required name="coverageEndsAt" type="datetime-local" />
          </label>
          <label>
            Coverage minutes
            <input min={30} max={1440} type="number" value={coverageMinutes} onChange={(event) => setCoverageMinutes(Number(event.target.value))} />
          </label>
          <label>
            Ceremony time
            <input name="ceremonyTime" type="datetime-local" />
          </label>
          <label>
            Reception time
            <input name="receptionTime" type="datetime-local" />
          </label>
          <label className="form-span">
            Locations, one per line
            <textarea name="locations" placeholder="Getting-ready location&#10;Ceremony venue&#10;Reception venue" />
          </label>
          <label className="form-span">
            Preferences and known constraints
            <textarea name="preferences" placeholder="First look, family-photo duration, venue rules, important moments…" />
          </label>
          <button className="button button-dark" disabled={busy} type="submit">
            {busy ? <LoaderCircle className="spin" /> : <Sparkles />}
            {busy ? "Generating…" : "Generate draft"}
          </button>
        </form>
      </section>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
      {draft ? (
        <>
          <section className="schedule-review-summary">
            <article className="panel schedule-source-summary">
              <strong>Grounded inputs</strong>
              <p>
                {draft.sourceTrace.questionnaireCount} questionnaire ·{" "}
                {draft.sourceTrace.timingRuleCount} timing rules ·{" "}
                {draft.sourceTrace.crewFactCount} crew facts
              </p>
              <small>
                {draft.sourceTrace.assumptionItemCount} schedule items still
                include a labeled assumption.
              </small>
            </article>
            {[
              ["Assumptions", draft.assumptions],
              ["Missing information", draft.missingInformation],
              ["Conflicts", draft.conflicts],
              ["Risks", draft.risks],
              ["Suggested questions", draft.suggestedQuestions],
            ].map(([label, values]) => (
              <article className="panel" key={label as string}>
                <strong>{label as string}</strong>
                {(values as string[]).length ? (
                  <ul>{(values as string[]).map((value) => <li key={value}>{value}</li>)}</ul>
                ) : (
                  <small>None reported</small>
                )}
              </article>
            ))}
          </section>
          <section className="panel schedule-draft-items">
            <div className="panel-heading">
              <div>
                <h2>Human review</h2>
                <p>Edit titles, times, and locations before creating a published version.</p>
              </div>
              <AlertTriangle />
            </div>
            {draft.items.map((item, index) => (
              <article key={item.id}>
                <input aria-label="Item title" value={item.title} onChange={(event) => updateItem(index, { title: event.target.value })} />
                <input aria-label="Start time" type="datetime-local" value={item.startAt.slice(0, 16)} onChange={(event) => updateItem(index, { startAt: new Date(event.target.value).toISOString() })} />
                <input aria-label="End time" type="datetime-local" value={item.endAt.slice(0, 16)} onChange={(event) => updateItem(index, { endAt: new Date(event.target.value).toISOString() })} />
                <input aria-label="Location" value={item.location ?? ""} onChange={(event) => updateItem(index, { location: event.target.value || null })} />
                <small>{item.blockingIssues.join(" · ") || "No model-reported issue"}</small>
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
          </section>
          <div className="human-boundary">
            <CheckCircle2 />
            <span>
              <strong>Publishing is the human approval boundary.</strong>
              <small>A new immutable version will reset current crew acknowledgements.</small>
            </span>
            <button className="button button-dark" disabled={publishing} type="button" onClick={() => void publish()}>
              {publishing ? "Publishing…" : "Publish reviewed schedule"}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
