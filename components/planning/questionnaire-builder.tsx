"use client";

import { FormEvent, useState } from "react";
import { ClipboardPlus, Send } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendPlanningCommand } from "@/lib/planning/command-client";

const allowedTypes = new Set([
  "text",
  "long_text",
  "email",
  "phone",
  "date",
  "time",
  "address",
  "dropdown",
  "multi_select",
  "radio",
  "checkbox",
  "file",
  "contact",
  "repeating_group",
  "acknowledgement",
  "information",
]);

export function QuestionnaireBuilder() {
  const workspace = useWorkspace();
  const { records: projects } = useTenantDocuments("projects");
  const { records: templates } = useTenantDocuments("questionnaireTemplates");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canBuild = ["studio_owner", "studio_admin"].includes(
    String(workspace.role),
  );

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      const lines = String(form.get("fields"))
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const fields = lines.map((line, index) => {
        const [label, requestedType = "text", required = "no"] = line
          .split("|")
          .map((value) => value.trim());
        if (!label) throw new Error(`Field line ${index + 1} needs a label.`);
        const type = allowedTypes.has(requestedType) ? requestedType : "text";
        return {
          id: `field-${index + 1}`,
          label,
          type,
          required: ["required", "yes", "true"].includes(required.toLowerCase()),
          locked: false,
          internalOnly: false,
          options: [],
          conditionalOn: null,
        };
      });
      await sendPlanningCommand("createQuestionnaireTemplate", {
        name: String(form.get("name")),
        eventTypeId: String(form.get("eventTypeId")),
        status: String(form.get("status")),
        sections: [
          {
            id: "section-1",
            title: String(form.get("sectionTitle")),
            fields,
          },
        ],
        dueDaysBeforeEvent: Number(form.get("dueDaysBeforeEvent")),
        reminderDaysBeforeDue: [7, 3, 1],
      });
      setNotice("Questionnaire template version created.");
      event.currentTarget.reset();
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "Template failed.");
    } finally {
      setBusy(false);
    }
  }

  async function assign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice(null);
    const form = new FormData(event.currentTarget);
    try {
      await sendPlanningCommand("assignQuestionnaire", {
        projectId: String(form.get("projectId")),
        templateId: String(form.get("templateId")),
      });
      setNotice("Questionnaire assigned with a resolved project due date.");
      event.currentTarget.reset();
    } catch (caught: unknown) {
      setNotice(caught instanceof Error ? caught.message : "Assignment failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="questionnaire-builder">
      {canBuild ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Versioned builder</p>
              <h2>Create template version</h2>
              <p>One field per line: Label | field_type | required.</p>
            </div>
            <ClipboardPlus />
          </div>
          <form onSubmit={(event) => void create(event)}>
            <label>Name<input name="name" required /></label>
            <label>Event type<select name="eventTypeId"><option value="wedding">Wedding</option><option value="corporate">Corporate</option><option value="sports">Sports</option></select></label>
            <label>Section title<input name="sectionTitle" defaultValue="Project details" required /></label>
            <label>Due days before event<input name="dueDaysBeforeEvent" type="number" min="0" max="365" defaultValue="60" required /></label>
            <label>Status<select name="status"><option value="active">Active</option><option value="draft">Draft</option></select></label>
            <label className="form-span">Fields<textarea name="fields" required defaultValue={"Planner | contact | no\nCeremony time | time | required\nFamily photo list | long_text | required\nAccessibility needs | long_text | no"} /></label>
            <button className="button button-dark" disabled={busy} type="submit"><ClipboardPlus /> Create version</button>
          </form>
        </section>
      ) : null}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Project assignment</p>
            <h2>Assign active questionnaire</h2>
          </div>
          <Send />
        </div>
        <form onSubmit={(event) => void assign(event)}>
          <label>Project<select name="projectId" required><option value="">Select project</option>{projects?.map((project) => <option key={project.id} value={project.id}>{String(project.name)}</option>)}</select></label>
          <label>Template<select name="templateId" required><option value="">Select template</option>{templates?.filter((template) => template.status === "active").map((template) => <option key={template.id} value={template.id}>{String(template.name)} · v{String(template.version)}</option>)}</select></label>
          <button className="button button-dark" disabled={busy} type="submit"><Send /> Assign questionnaire</button>
        </form>
      </section>
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </div>
  );
}
