"use client";

import { FormEvent, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ClipboardPlus,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import {
  refreshTenantRecords,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

const fieldTypes = [
  ["text", "Short text"],
  ["long_text", "Long text"],
  ["email", "Email"],
  ["phone", "Phone"],
  ["date", "Date"],
  ["time", "Time"],
  ["address", "Address"],
  ["dropdown", "Dropdown"],
  ["multi_select", "Multi-select"],
  ["radio", "Multiple choice"],
  ["checkbox", "Checkbox"],
  ["file", "File upload"],
  ["contact", "Contact"],
  ["repeating_group", "Repeating group"],
  ["acknowledgement", "Acknowledgement"],
  ["information", "Information block"],
] as const;

type FieldRow = {
  id: string;
  label: string;
  type: (typeof fieldTypes)[number][0];
  required: boolean;
  options: string;
  conditionalFieldId: string;
  conditionalEquals: string;
};

const startingFields: FieldRow[] = [
  { id: "planner", label: "Planner", type: "contact", required: false, options: "", conditionalFieldId: "", conditionalEquals: "" },
  { id: "ceremony-time", label: "Ceremony time", type: "time", required: true, options: "", conditionalFieldId: "", conditionalEquals: "" },
  { id: "family-photo-list", label: "Family photo list", type: "long_text", required: true, options: "", conditionalFieldId: "", conditionalEquals: "" },
  { id: "accessibility", label: "Accessibility needs", type: "long_text", required: false, options: "", conditionalFieldId: "", conditionalEquals: "" },
];

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
  const [fields, setFields] = useState<FieldRow[]>(startingFields);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canBuild = ["studio_owner", "studio_admin"].includes(
    String(workspace.role),
  );

  function updateField(id: string, value: Partial<FieldRow>) {
    setFields((current) =>
      current.map((field) => (field.id === id ? { ...field, ...value } : field)),
    );
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    // See vendor-create-form: `currentTarget` is null after the await.
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      if (!fields.length) throw new Error("Add at least one field.");
      if (fields.some((field) => !field.label.trim()))
        throw new Error("Every field needs a label.");
      await sendPlanningCommand("createQuestionnaireTemplate", {
        name: String(form.get("name")),
        eventTypeId: String(form.get("eventTypeId")),
        status: String(form.get("status")),
        sections: [
          {
            id: "section-1",
            title: String(form.get("sectionTitle")),
            fields: fields.map((field) => ({
              id: field.id,
              label: field.label.trim(),
              type: field.type,
              required: field.required,
              locked: false,
              internalOnly: false,
              options: field.options
                .split(",")
                .map((option) => option.trim())
                .filter(Boolean),
              conditionalOn: field.conditionalFieldId
                ? {
                    fieldId: field.conditionalFieldId,
                    equals: field.conditionalEquals,
                  }
                : null,
            })),
          },
        ],
        dueDaysBeforeEvent: Number(form.get("dueDaysBeforeEvent")),
        reminderDaysBeforeDue: [7, 3, 1],
      });
      setNotice("Questionnaire template saved.");
      refreshTenantRecords("questionnaireTemplates");
      element.reset();
      setFields(startingFields);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Template could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      await sendPlanningCommand("assignQuestionnaire", {
        projectId: String(form.get("projectId")),
        templateId: String(form.get("templateId")),
      });
      setNotice("Questionnaire assigned. Its due date was calculated from the project date.");
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
          <h2>{mode === "create" ? "Create a reusable template" : "Send a questionnaire"}</h2>
          <p>{mode === "create" ? "Add fields visually and arrange them in the order clients should see." : "Choose an active project and the template you want the client to complete."}</p>
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
                    </small>
                  </div>
                  {imported ? <em>Imported by AI</em> : null}
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
        <form className="questionnaire-template-form" onSubmit={(event) => void create(event)}>
          <div className="form-grid">
            <label className="form-span">Template name <span className="required-mark">Required</span><input name="name" placeholder="e.g. Wedding planning questionnaire" required /></label>
            <label>Event type<select name="eventTypeId"><option value="wedding">Wedding</option><option value="corporate">Corporate</option><option value="sports">Sports</option></select></label>
            <label>Section title<input name="sectionTitle" defaultValue="Project details" required /></label>
            <label>Due before event<input name="dueDaysBeforeEvent" type="number" min="0" max="365" defaultValue="60" required /></label>
            <label>Status<select name="status"><option value="active">Active</option><option value="draft">Draft</option></select></label>
          </div>
          <fieldset className="visual-field-builder">
            <legend>Fields</legend>
            {fields.map((field, index) => (
              <div className="visual-field-row" key={field.id}>
                <span className="field-order">{index + 1}</span>
                <label>Question or label<input aria-label={`Field ${index + 1} label`} onChange={(event) => updateField(field.id, { label: event.target.value })} value={field.label} /></label>
                <label>Answer type<select aria-label={`Field ${index + 1} type`} onChange={(event) => updateField(field.id, { type: event.target.value as FieldRow["type"] })} value={field.type}>{fieldTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                {["dropdown", "multi_select", "radio"].includes(field.type) ? <label>Options<input aria-label={`Field ${index + 1} options`} onChange={(event) => updateField(field.id, { options: event.target.value })} placeholder="Yes, No, Unsure" value={field.options} /></label> : null}
                <label>Show after<select aria-label={`Field ${index + 1} condition`} onChange={(event) => updateField(field.id, { conditionalFieldId: event.target.value })} value={field.conditionalFieldId}><option value="">Always visible</option>{fields.slice(0, index).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label || candidate.id}</option>)}</select></label>
                {field.conditionalFieldId ? <label>When answer is<input aria-label={`Field ${index + 1} condition value`} onChange={(event) => updateField(field.id, { conditionalEquals: event.target.value })} value={field.conditionalEquals} /></label> : null}
                <label className="field-required"><input aria-label={`${field.label || `Field ${index + 1}`} required`} checked={field.required} onChange={(event) => updateField(field.id, { required: event.target.checked })} type="checkbox" /> Required</label>
                <div className="field-row-actions">
                  <button aria-label={`Move ${field.label || `field ${index + 1}`} up`} disabled={index === 0} onClick={() => moveField(index, -1)} type="button"><ArrowUp size={15} /></button>
                  <button aria-label={`Move ${field.label || `field ${index + 1}`} down`} disabled={index === fields.length - 1} onClick={() => moveField(index, 1)} type="button"><ArrowDown size={15} /></button>
                  <button aria-label={`Remove ${field.label || `field ${index + 1}`}`} onClick={() => setFields((current) => current.filter((item) => item.id !== field.id))} type="button"><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
            <button className="button button-light button-sm" onClick={() => setFields((current) => [...current, { id: crypto.randomUUID(), label: "", type: "text", required: false, options: "", conditionalFieldId: "", conditionalEquals: "" }])} type="button"><Plus size={15} /> Add field</button>
          </fieldset>
          <button className="button button-dark" disabled={busy} type="submit"><ClipboardPlus size={16} /> {busy ? "Saving…" : "Save template"}</button>
        </form>
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
          <label>Template <span className="required-mark">Required</span><select name="templateId" required><option value="">Select template</option>{templates?.filter((template) => template.status === "active").map((template) => <option key={template.id} value={template.id}>{String(template.name)}</option>)}</select></label>
          <button className="button button-dark" disabled={busy} type="submit"><Send size={16} /> {busy ? "Assigning…" : "Assign questionnaire"}</button>
        </form>
      )}
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </section>
  );
}
