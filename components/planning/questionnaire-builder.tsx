"use client";

import { FormEvent, useState } from "react";
import { ClipboardPlus, Send } from "lucide-react";
import {
  refreshTenantRecords,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  questionnaireAssignNotice,
  type AssignResult,
} from "@/features/questionnaires/assign-notice";
import { QuestionnaireTemplateEditor } from "@/components/planning/questionnaire-template-editor";
import { fieldReachesCrew } from "@/features/questionnaires/crew-brief";
import { InfoHint } from "@/components/ui/info-hint";
import { suggestedFromOf } from "@/features/questionnaires/field-extras";

/** A saved "Show after" condition, carried through the editor unchanged. */
function conditionOf(value: unknown): { fieldId: string; equals: unknown } | null {
  if (typeof value !== "object" || value === null) return null;
  const condition = value as Record<string, unknown>;
  return typeof condition.fieldId === "string" && condition.fieldId
    ? { fieldId: condition.fieldId, equals: condition.equals }
    : null;
}

function templateFieldCount(sections: unknown): number {
  if (!Array.isArray(sections)) return 0;
  return sections.reduce((total, section) => {
    if (typeof section !== "object" || section === null) return total;
    const fields = "fields" in section ? section.fields : null;
    return total + (Array.isArray(fields) ? fields.length : 0);
  }, 0);
}

export function QuestionnaireBuilder({
  defaultMode = "create",
  defaultProjectId,
}: {
  defaultMode?: "create" | "assign";
  defaultProjectId?: string;
} = {}) {
  const workspace = useWorkspace();
  const { records: projects } = useTenantDocuments("projects");
  const { records: templates } = useTenantDocuments("questionnaireTemplates");
  const [mode, setMode] = useState<"create" | "assign">(defaultMode);
  const [assignProjectId, setAssignProjectId] = useState(defaultProjectId ?? "");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canBuild = ["studio_owner", "studio_admin"].includes(
    String(workspace.role),
  );

  /**
   * Active templates, the ones built for this job's event type first.
   *
   * `assignQuestionnaire` accepts any active template, and that is right —
   * a studio may deliberately send the wedding form to an engagement shoot.
   * What was wrong was presenting all of them as equally applicable.
   */
  const selectedProject = projects?.find(
    (item) => item.id === assignProjectId,
  );
  const projectEventType = String(selectedProject?.eventTypeId ?? "");
  const orderedTemplates = (templates ?? [])
    .filter((template) => template.status === "active")
    .map((template) => ({
      id: template.id,
      name: String(template.name ?? "Untitled questionnaire"),
      eventTypeId: String(template.eventTypeId ?? ""),
      fitsProject:
        !projectEventType ||
        String(template.eventTypeId ?? "") === projectEventType,
    }))
    .sort((left, right) => Number(right.fitsProject) - Number(left.fitsProject));

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      const response = await sendPlanningCommand("assignQuestionnaire", {
        projectId: String(form.get("projectId")),
        templateId: String(form.get("templateId")),
      });
      // Sending a form the job already has re-sends it (a reminder) instead
      // of making the couple a second copy. An inquiry may have no date and
      // no portal yet; the result says so (features/questionnaires/assign-notice.ts).
      setNotice(questionnaireAssignNotice(response.result as AssignResult));
      element.reset();
      // The panel above this form lists what is assigned, and without this it
      // kept reading "No questionnaires assigned" directly under a notice
      // saying the opposite.
      refreshTenantRecords("questionnaireResponses", "checkpoints");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Questionnaire could not be assigned."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="questionnaire-workspace panel">
      <header className="questionnaire-workspace-header">
        <div>
          <p className="eyebrow">Questionnaire tools</p>
          <h2>
            {mode === "create" ? "Create a reusable template" : "Send a questionnaire"}
            <InfoHint label="Templates and due dates">
              Only Active templates can be sent. A form is due the set number of days before the event, with
              reminders 7, 3 and 1 days before that until the couple sends it.
            </InfoHint>
          </h2>
          <p>{mode === "create" ? "Add sections and questions in the order couples see them, with the rules between them. Every saved form below edits the same way." : "Choose an active project and the template you want the client to complete."}</p>
        </div>
        <div className="segmented-control" aria-label="Questionnaire action">
          {canBuild ? <button className={mode === "create" ? "active" : ""} onClick={() => setMode("create")} type="button"><ClipboardPlus size={15} /> Build template</button> : null}
          <button className={mode === "assign" ? "active" : ""} onClick={() => setMode("assign")} type="button"><Send size={15} /> Assign to project</button>
        </div>
      </header>

      <section className="questionnaire-template-library" aria-label="Saved questionnaire templates">
        <div>
          <span>
            <p className="eyebrow">Saved templates</p>
            <h3>Questionnaire library</h3>
          </span>
          <strong>{templates?.length ?? 0} saved</strong>
        </div>
        {templates?.length ? (
          <div className="questionnaire-template-list">
            {templates.map((template) => {
              const imported = Boolean(template.sourceStudioAssetId);
              const count = templateFieldCount(template.sections);
              return (
                <article key={template.id}>
                  <span><ClipboardPlus size={17} /></span>
                  <div>
                    <strong>{String(template.name ?? "Untitled questionnaire")}</strong>
                    <small>
                      {count} field{count === 1 ? "" : "s"} · {String(template.status ?? "draft")}
                      {/* The version is how a studio sees that an edit landed:
                          saving supersedes, so the row is replaced and any
                          notice inside it goes with it. */}
                      {Number(template.version ?? 0) > 1
                        ? ` · v${Number(template.version)}`
                        : null}
                    </small>
                  </div>
                  {imported ? <em>Imported by AI</em> : null}
                  {/* Editing a template in place, preserving its sections. The
                      builder above flattens everything into one, which would
                      collapse a six-section starter template. See
                      components/planning/questionnaire-template-editor.tsx. */}
                  {canBuild ? (
                    <QuestionnaireTemplateEditor
                      template={{
                        id: template.id,
                        name: String(template.name ?? ""),
                        status: String(template.status ?? "draft"),
                        dueDaysBeforeEvent: Number(
                          template.dueDaysBeforeEvent ?? 0,
                        ),
                        reminderDaysBeforeDue: Array.isArray(
                          template.reminderDaysBeforeDue,
                        )
                          ? template.reminderDaysBeforeDue.map(Number)
                          : [7, 3, 1],
                        sections: Array.isArray(template.sections)
                          ? template.sections.map((raw, index) => {
                              const value =
                                typeof raw === "object" && raw !== null
                                  ? (raw as Record<string, unknown>)
                                  : {};
                              return {
                                id: String(value.id ?? `section-${index + 1}`),
                                title: String(value.title ?? "Details"),
                                fields: Array.isArray(value.fields)
                                  ? value.fields.map((rawField) => {
                                      const f =
                                        typeof rawField === "object" &&
                                        rawField !== null
                                          ? (rawField as Record<string, unknown>)
                                          : {};
                                      return {
                                        id: String(f.id ?? crypto.randomUUID()),
                                        label: String(f.label ?? ""),
                                        type: String(f.type ?? "text"),
                                        required: f.required === true,
                                        internalOnly: f.internalOnly === true,
                                        crewVisible: fieldReachesCrew({
                                          id: String(f.id ?? ""),
                                          label: String(f.label ?? ""),
                                          type: String(f.type ?? "text"),
                                          internalOnly: f.internalOnly === true,
                                          crewVisible:
                                            typeof f.crewVisible === "boolean"
                                              ? f.crewVisible
                                              : undefined,
                                        }),
                                        options: Array.isArray(f.options)
                                          ? f.options.map(String).join(", ")
                                          : "",
                                        locked: f.locked === true,
                                        conditionalOn: conditionOf(f.conditionalOn),
                                        help: typeof f.help === "string" ? f.help : "",
                                        allowTbd: f.allowTbd === true,
                                        suggestedFrom: suggestedFromOf(f.suggestedFrom),
                                      };
                                    })
                                  : [],
                              };
                            })
                          : [],
                      }}
                    />
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : (
          <p className="questionnaire-template-empty">
            No saved questionnaire templates yet. Imported templates will appear here after activation.
          </p>
        )}
      </section>

      {mode === "create" && canBuild ? (
        // The same editor a saved template opens in, empty: sections, order,
        // "show only when" and suggested times from the first save.
        <QuestionnaireTemplateEditor mode="create" />
      ) : (
        <form className="questionnaire-assign-form" onSubmit={(event) => void assign(event)}>
          {/**
            * Controlled, not `defaultValue`.
            *
            * `defaultValue` applies once, at mount, and the project options
            * arrive from a live query a moment later — so a photographer who
            * followed "Send the questionnaire" from their job's readiness list
            * landed on a form reading "Select project", and had to find their
            * own wedding again in a list of eleven. A controlled select is
            * blank until its options load and then shows the right one.
            */}
          <label>Project <span className="required-mark">Required</span><select name="projectId" onChange={(event) => setAssignProjectId(event.target.value)} required value={assignProjectId}><option value="">Select project</option>{projects?.map((project) => <option key={project.id} value={project.id}>{String(project.name)}</option>)}</select></label>
          {/* Labelled by fit, not filtered by it.
              An "other" job was offered the Wedding Planning Questionnaire, the
              Corporate Shoot Brief and the Sports Day Brief as equal choices,
              with nothing saying which suited it. Filtering outright would be
              wrong — a studio may well send the wedding form to an engagement
              shoot — so the ones built for this job type come first and the
              rest say what they are for. */}
          <label>Template <span className="required-mark">Required</span><select name="templateId" required><option value="">Select template</option>{orderedTemplates.map((template) => <option key={template.id} value={template.id}>{template.name}{template.fitsProject ? "" : ` — for ${template.eventTypeId || "another"} jobs`}</option>)}</select></label>
          <button className="button button-dark" disabled={busy} type="submit"><Send size={16} /> {busy ? "Assigning…" : "Assign questionnaire"}</button>
        </form>
      )}
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </section>
  );
}
