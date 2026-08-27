"use client";

import { useState } from "react";
import { LoaderCircle, PencilLine, Plus, Trash2 } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPlanningCommand } from "@/lib/planning/command-client";

/**
 * Editing a questionnaire template in place.
 *
 * Templates could be created and never changed — `questionnaireTemplates` is
 * `allow write: if false` and there was no update command — so a typo in a form
 * sent to every client was permanent.
 *
 * Deliberately *not* routed through the builder above. That flattens whatever
 * it is given into a single section, and the starter templates have four to six.
 * Editing a wedding questionnaire through it would silently collapse six
 * sections into one, which is worse than not being able to edit at all. This
 * renders the template's real sections and lets a studio change the thing they
 * actually came to change: the wording.
 *
 * Saving supersedes rather than rewrites — `updateQuestionnaireTemplate` writes
 * the next version and archives the live one — because a couple who has already
 * answered answered the questions as they stood.
 */

type EditableField = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options: string;
};

type EditableSection = { id: string; title: string; fields: EditableField[] };

const FIELD_TYPES = [
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
  "contact",
  "repeating_group",
  "acknowledgement",
];

const CHOICE_TYPES = ["dropdown", "multi_select", "radio"];

export function QuestionnaireTemplateEditor({
  template,
}: {
  template: {
    id: string;
    name: string;
    status: string;
    dueDaysBeforeEvent: number;
    reminderDaysBeforeDue: number[];
    sections: EditableSection[];
  };
}) {
  const [name, setName] = useState(template.name);
  const [status, setStatus] = useState(
    template.status === "archived" ? "archived" : template.status,
  );
  const [due, setDue] = useState(String(template.dueDaysBeforeEvent));
  const [sections, setSections] = useState<EditableSection[]>(
    template.sections,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function patchField(
    sectionId: string,
    fieldId: string,
    patch: Partial<EditableField>,
  ) {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              fields: section.fields.map((field) =>
                field.id === fieldId ? { ...field, ...patch } : field,
              ),
            }
          : section,
      ),
    );
  }

  function removeField(sectionId: string, fieldId: string) {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              fields: section.fields.filter((field) => field.id !== fieldId),
            }
          : section,
      ),
    );
  }

  function addField(sectionId: string) {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              fields: [
                ...section.fields,
                {
                  id: `field-${crypto.randomUUID().slice(0, 8)}`,
                  label: "",
                  type: "text",
                  required: false,
                  options: "",
                },
              ],
            }
          : section,
      ),
    );
  }

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const kept = sections
        .map((section) => ({
          ...section,
          fields: section.fields.filter((field) => field.label.trim()),
        }))
        .filter((section) => section.fields.length > 0);
      if (!kept.length) throw new Error("Keep at least one question.");
      await sendPlanningCommand("updateQuestionnaireTemplate", {
        templateId: template.id,
        name: name.trim(),
        status,
        dueDaysBeforeEvent: Number(due) || 0,
        reminderDaysBeforeDue: template.reminderDaysBeforeDue,
        sections: kept.map((section) => ({
          id: section.id,
          title: section.title.trim() || "Details",
          fields: section.fields.map((field) => ({
            id: field.id,
            label: field.label.trim(),
            type: field.type,
            required: field.required,
            locked: false,
            internalOnly: false,
            options: CHOICE_TYPES.includes(field.type)
              ? field.options
                  .split(",")
                  .map((option) => option.trim())
                  .filter(Boolean)
              : [],
            conditionalOn: null,
          })),
        })),
      });
      setNotice(
        "Saved as a new version. Answers already collected keep the questions they were asked.",
      );
      refreshTenantRecords("questionnaireTemplates");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That template could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="questionnaire-template-editor">
      <summary>
        <PencilLine aria-hidden="true" size={14} /> Edit this questionnaire
      </summary>
      <div>
        <div className="questionnaire-editor-meta">
          <label>
            Template name
            <input
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          <label>
            Status
            <select
              onChange={(event) => setStatus(event.target.value)}
              value={status}
            >
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label>
            Due days before event
            <input
              max="365"
              min="0"
              onChange={(event) => setDue(event.target.value)}
              type="number"
              value={due}
            />
          </label>
        </div>
        {sections.map((section) => (
          <fieldset key={section.id}>
            <legend>{section.title}</legend>
            {section.fields.map((field) => (
              <div className="questionnaire-editor-field" key={field.id}>
                <label>
                  Question
                  <input
                    onChange={(event) =>
                      patchField(section.id, field.id, {
                        label: event.target.value,
                      })
                    }
                    value={field.label}
                  />
                </label>
                <label>
                  Answer type
                  <select
                    onChange={(event) =>
                      patchField(section.id, field.id, {
                        type: event.target.value,
                      })
                    }
                    value={field.type}
                  >
                    {FIELD_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                {CHOICE_TYPES.includes(field.type) ? (
                  <label>
                    Choices
                    <input
                      onChange={(event) =>
                        patchField(section.id, field.id, {
                          options: event.target.value,
                        })
                      }
                      placeholder="Yes, No, Undecided"
                      value={field.options}
                    />
                  </label>
                ) : null}
                <label className="questionnaire-editor-required">
                  <input
                    checked={field.required}
                    onChange={(event) =>
                      patchField(section.id, field.id, {
                        required: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  Required
                </label>
                <button
                  aria-label={`Remove ${field.label || "question"}`}
                  className="button button-quiet"
                  onClick={() => removeField(section.id, field.id)}
                  type="button"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <button
              className="button button-quiet"
              onClick={() => addField(section.id)}
              type="button"
            >
              <Plus size={13} /> Add a question here
            </button>
          </fieldset>
        ))}
        <button
          className="button button-dark"
          disabled={busy}
          onClick={() => void save()}
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={14} /> : null}
          Save as new version
        </button>
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </details>
  );
}
