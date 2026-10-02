"use client";

import { useState } from "react";
import { JOB_KIND_LABELS, JOB_KINDS } from "@/features/job-kinds/job-kinds";
import { ArrowDown, ArrowUp, LoaderCircle, PencilLine, Plus, Trash2 } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { criticalCrewQuestions } from "@/features/questionnaires/crew-brief";
import type { SuggestedFrom } from "@/features/questionnaires/field-extras";
import { repairTemplateLinks, type TemplateLinkProblem } from "@/features/questionnaires/template-rules";
import {
  moveField,
  moveFieldToSection,
  moveSection,
  newSectionId,
  questionDestinations,
  removeSection,
} from "@/features/questionnaires/template-editing";

/**
 * Building and editing a questionnaire template: its sections, its questions
 * in order, and the rules between them.
 *
 * Templates could be created and never changed — `questionnaireTemplates` is
 * `allow write: if false` and there was no update command — so a typo in a form
 * sent to every client was permanent. Then a studio could change the wording
 * but not the order, the sections, "show only when" or a suggested time
 * (GR Productions' recommended forms, 2026-10-02: "they can make a copy and
 * adjust"). Now all of it, here; "Build template" opens the same editor empty.
 *
 * Moving or deleting a question can leave another's rule pointing at a
 * question that now comes after it. Every rearrangement runs
 * repairTemplateLinks and says what it cleared, and the server refuses a
 * template that still breaks a link (QUESTIONNAIRE_TEMPLATE_INVALID).
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
  internalOnly: boolean;
  /** Set by the studio; the couple sees it, can't change it. Kept, not edited here. */
  locked?: boolean;
  /** Whether the answer reaches crew on the job. */
  crewVisible: boolean;
  options: string;
  /** "Show only when" an earlier question has this answer. */
  conditionalOn?: { fieldId: string; equals: unknown } | null;
  /** A note under the question, for the couple. */
  help?: string;
  /** The couple may answer "TBD" (features/questionnaires/field-extras.ts). */
  allowTbd?: boolean;
  /** A time suggested from an earlier time. */
  suggestedFrom?: SuggestedFrom | null;
};

type EditableSection = { id: string; title: string; fields: EditableField[] };

type EditableTemplate = {
  id: string;
  name: string;
  status: string;
  dueDaysBeforeEvent: number;
  reminderDaysBeforeDue: number[];
  sections: EditableSection[];
};

const FIELD_TYPES: Array<[string, string]> = [
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
];

const CHOICE_TYPES = ["dropdown", "multi_select", "radio"];

/** Questions a couple can honestly answer "not decided yet". */
const TBD_TYPES = ["text", "long_text", "time", "address", "contact"];

const DESTINATION_LABEL = { contract: "In the contract", locks: "Locks with the final details" } as const;

const blankQuestion = (): EditableField => ({
  id: `field-${crypto.randomUUID().slice(0, 8)}`,
  label: "",
  type: "text",
  required: false,
  internalOnly: false,
  crewVisible: false,
  options: "",
});

const blankTemplate = (): EditableTemplate => ({
  id: "",
  name: "",
  status: "active",
  dueDaysBeforeEvent: 60,
  reminderDaysBeforeDue: [7, 3, 1],
  sections: [{ id: "section-1", title: "About your day", fields: [blankQuestion()] }],
});

/** "14, 3" → [14, 3]: whole days, each once, most first. */
function parseReminders(value: string): number[] {
  return [...new Set(value.split(/[\s,]+/).map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 365))].sort(
    (left, right) => right - left,
  );
}

/** What a repair cleared, in words. */
function clearedNotice(cleared: TemplateLinkProblem[], sections: EditableSection[]): string | null {
  if (!cleared.length) return null;
  const label = (fieldId: string) =>
    sections.flatMap((section) => section.fields).find((field) => field.id === fieldId)?.label.trim() || "a question";
  const lines = cleared.map((problem) =>
    problem.kind === "condition"
      ? `"${label(problem.fieldId)}" shows always now — the question it waited on isn't above it any more.`
      : `"${label(problem.fieldId)}" no longer suggests a time — the time it followed isn't above it any more.`,
  );
  return lines.join(" ");
}

export function QuestionnaireTemplateEditor({
  template,
  mode = "edit",
}: {
  template?: EditableTemplate;
  mode?: "edit" | "create";
}) {
  const creating = mode === "create";
  const start = template ?? blankTemplate();
  const [name, setName] = useState(start.name);
  const [eventTypeId, setEventTypeId] = useState("wedding");
  const [status, setStatus] = useState(start.status === "archived" ? "archived" : start.status);
  const [due, setDue] = useState(String(start.dueDaysBeforeEvent));
  const [reminders, setReminders] = useState(start.reminderDaysBeforeDue.join(", "));
  const [sections, setSections] = useState<EditableSection[]>(start.sections);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [repairNotice, setRepairNotice] = useState<string | null>(null);

  /** Every change to the shape goes through here: repaired, and said so. */
  function rearrange(next: EditableSection[]) {
    const repaired = repairTemplateLinks<EditableField, EditableSection>(next);
    setSections(repaired.sections);
    setRepairNotice(clearedNotice(repaired.cleared, repaired.sections));
  }

  function patchField(fieldId: string, patch: Partial<EditableField>, repair = false) {
    const next = sections.map((section) => ({
      ...section,
      fields: section.fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
    }));
    if (repair) rearrange(next);
    else setSections(next);
  }

  function patchSection(sectionId: string, patch: Partial<EditableSection>) {
    setSections((current) => current.map((section) => (section.id === sectionId ? { ...section, ...patch } : section)));
  }

  function addField(sectionId: string, known?: (typeof criticalCrewQuestions)[number]) {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              fields: [
                ...section.fields,
                {
                  ...blankQuestion(),
                  // A known question keeps its own id: the crew brief sorts by
                  // id, so a do-not-photograph question minted as
                  // `field-9c2f1a0b` is crew-visible but lands among the
                  // addresses instead of at the top where it is read first.
                  id: known?.id ?? `field-${crypto.randomUUID().slice(0, 8)}`,
                  label: known?.label ?? "",
                  type: known?.type ?? "text",
                  crewVisible: Boolean(known),
                  options: known?.type === "dropdown" ? "Yes, No, Not sure" : "",
                },
              ],
            }
          : section,
      ),
    );
  }

  function addSection() {
    setSections((current) => [...current, { id: newSectionId(current), title: "", fields: [blankQuestion()] }]);
  }

  /** Every question before this one, in the order the couple meets them. */
  function earlierThan(fieldId: string): EditableField[] {
    const all = sections.flatMap((section) => section.fields);
    const index = all.findIndex((field) => field.id === fieldId);
    return all.slice(0, Math.max(0, index)).filter((field) => field.label.trim());
  }

  /** What "show only when" can read: one answer to compare, not a list, a file or a note. */
  const conditionSources = (fields: EditableField[]) =>
    fields.filter((field) => !["multi_select", "file", "information", "repeating_group"].includes(field.type));

  async function save() {
    setBusy(true);
    setNotice(null);
    try {
      const kept = sections
        .map((section) => ({ ...section, fields: section.fields.filter((field) => field.label.trim()) }))
        .filter((section) => section.fields.length > 0);
      if (!kept.length) throw new Error("Keep at least one question.");
      if (creating && name.trim().length < 2) throw new Error("Give the questionnaire a name.");
      // A question left blank is dropped, and a rule that read it goes with it.
      const repaired = repairTemplateLinks<EditableField, EditableSection>(kept);
      const payload = {
        name: name.trim(),
        status,
        dueDaysBeforeEvent: Number(due) || 0,
        reminderDaysBeforeDue: parseReminders(reminders),
        sections: repaired.sections.map((section, index) => ({
          id: section.id,
          title: section.title.trim() || `Part ${index + 1}`,
          fields: section.fields.map((field) => ({
            id: field.id,
            label: field.label.trim(),
            type: field.type,
            required: field.required,
            locked: field.locked === true,
            internalOnly: field.internalOnly,
            crewVisible: field.crewVisible,
            options: CHOICE_TYPES.includes(field.type)
              ? field.options
                  .split(",")
                  .map((option) => option.trim())
                  .filter(Boolean)
              : [],
            conditionalOn: field.conditionalOn ?? null,
            ...(field.help?.trim() ? { help: field.help.trim().slice(0, 500) } : {}),
            ...(field.allowTbd && TBD_TYPES.includes(field.type) ? { allowTbd: true } : {}),
            ...(field.suggestedFrom ? { suggestedFrom: field.suggestedFrom } : {}),
          })),
        })),
      };
      if (creating) {
        if (payload.status === "archived") payload.status = "draft";
        await sendPlanningCommand("createQuestionnaireTemplate", { ...payload, eventTypeId });
        setNotice(`"${payload.name}" is in your forms below.`);
        const fresh = blankTemplate();
        setName(fresh.name);
        setSections(fresh.sections);
        setRepairNotice(null);
      } else {
        await sendPlanningCommand("updateQuestionnaireTemplate", { templateId: start.id, ...payload });
        setNotice("Saved as a new version. Answers already collected keep the questions they were asked.");
        setRepairNotice(clearedNotice(repaired.cleared, repaired.sections));
      }
      refreshTenantRecords("questionnaireTemplates");
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That template could not be saved."));
    } finally {
      setBusy(false);
    }
  }

  const body = (
    <div>
      <div className="questionnaire-editor-meta">
        <label>
          {creating ? "Name" : "Template name"}
          <input maxLength={160} onChange={(event) => setName(event.target.value)} placeholder="e.g. Wedding planning form" value={name} />
        </label>
        {creating ? (
          <label>
            For
            <select onChange={(event) => setEventTypeId(event.target.value)} value={eventTypeId}>
              {JOB_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {JOB_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Status
          <select onChange={(event) => setStatus(event.target.value)} value={status}>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            {creating ? null : <option value="archived">Archived</option>}
          </select>
        </label>
        <label>
          Due days before event
          <input max="365" min="0" onChange={(event) => setDue(event.target.value)} type="number" value={due} />
        </label>
        <label>
          Reminders, days before it&rsquo;s due
          <input onChange={(event) => setReminders(event.target.value)} placeholder="7, 3, 1" value={reminders} />
        </label>
      </div>
      {repairNotice ? (
        <p className="form-notice" role="status">
          {repairNotice}
        </p>
      ) : null}
      {sections.map((section, sectionIndex) => (
        <fieldset className="questionnaire-editor-section" key={section.id}>
          <legend className="sr-only">{section.title || `Section ${sectionIndex + 1}`}</legend>
          <div className="questionnaire-editor-section-head">
            <label>
              Section title
              <input
                maxLength={160}
                onChange={(event) => patchSection(section.id, { title: event.target.value })}
                placeholder={`Part ${sectionIndex + 1}`}
                value={section.title}
              />
            </label>
            <div className="questionnaire-editor-actions">
              <button
                aria-label={`Move section ${section.title || sectionIndex + 1} up`}
                className="button button-quiet"
                disabled={sectionIndex === 0}
                onClick={() => rearrange(moveSection(sections, section.id, -1))}
                type="button"
              >
                <ArrowUp size={13} />
              </button>
              <button
                aria-label={`Move section ${section.title || sectionIndex + 1} down`}
                className="button button-quiet"
                disabled={sectionIndex === sections.length - 1}
                onClick={() => rearrange(moveSection(sections, section.id, 1))}
                type="button"
              >
                <ArrowDown size={13} />
              </button>
              {sections.length > 1 ? (
                <button
                  className="button button-quiet"
                  onClick={() =>
                    section.fields.some((field) => field.label.trim())
                      ? setRemoving(section.id)
                      : rearrange(removeSection(sections, section.id, null))
                  }
                  type="button"
                >
                  <Trash2 size={13} /> Delete section
                </button>
              ) : null}
            </div>
          </div>
          {removing === section.id ? (
            <div className="questionnaire-editor-confirm" role="group" aria-label="Delete this section">
              <p>{`This section has ${section.fields.length} question${section.fields.length === 1 ? "" : "s"}. Keep them?`}</p>
              <div className="questionnaire-editor-actions">
                {sections
                  .filter((other) => other.id !== section.id)
                  .map((other, otherIndex) => (
                    <button
                      className="button button-light button-sm"
                      key={other.id}
                      onClick={() => {
                        rearrange(removeSection(sections, section.id, other.id));
                        setRemoving(null);
                      }}
                      type="button"
                    >
                      {`Move them to ${other.title.trim() || `part ${otherIndex + 1}`}`}
                    </button>
                  ))}
                <button
                  className="button button-light button-sm"
                  onClick={() => {
                    rearrange(removeSection(sections, section.id, null));
                    setRemoving(null);
                  }}
                  type="button"
                >
                  Delete them too
                </button>
                <button className="button button-quiet button-sm" onClick={() => setRemoving(null)} type="button">
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
          {section.fields.map((field, fieldIndex) => {
            const earlier = earlierThan(field.id);
            const earlierTimes = earlier.filter((candidate) => candidate.type === "time");
            const reads = field.conditionalOn ? earlier.find((candidate) => candidate.id === field.conditionalOn!.fieldId) : undefined;
            const destinations = questionDestinations(field);
            const first = sectionIndex === 0 && fieldIndex === 0;
            const last = sectionIndex === sections.length - 1 && fieldIndex === section.fields.length - 1;
            const hasRules = Boolean(field.conditionalOn || field.suggestedFrom);
            return (
              <div className="questionnaire-editor-question" key={field.id}>
                <div className="questionnaire-editor-field">
                  <label>
                    Question
                    <input onChange={(event) => patchField(field.id, { label: event.target.value })} value={field.label} />
                  </label>
                  <label>
                    Answer type
                    <select onChange={(event) => patchField(field.id, { type: event.target.value }, true)} value={field.type}>
                      {FIELD_TYPES.map(([type, label]) => (
                        <option key={type} value={type}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {CHOICE_TYPES.includes(field.type) ? (
                    <label>
                      Choices
                      <input
                        onChange={(event) => patchField(field.id, { options: event.target.value })}
                        placeholder="Yes, No, Undecided"
                        value={field.options}
                      />
                    </label>
                  ) : null}
                  <label>
                    Note for the couple
                    <input
                      maxLength={500}
                      onChange={(event) => patchField(field.id, { help: event.target.value })}
                      placeholder="Optional"
                      value={field.help ?? ""}
                    />
                  </label>
                </div>
                <div className="questionnaire-editor-flags">
                  <label className="questionnaire-editor-required">
                    <input
                      checked={field.required}
                      onChange={(event) => patchField(field.id, { required: event.target.checked })}
                      type="checkbox"
                    />
                    Required
                  </label>
                  <label className="questionnaire-editor-required" title="The photographers on this job see the answer in their brief">
                    <input
                      checked={field.crewVisible}
                      onChange={(event) => patchField(field.id, { crewVisible: event.target.checked })}
                      type="checkbox"
                    />
                    Crew see it
                  </label>
                  {TBD_TYPES.includes(field.type) ? (
                    <label className="questionnaire-editor-required" title="The couple can answer TBD — not decided yet">
                      <input
                        checked={field.allowTbd === true}
                        onChange={(event) => patchField(field.id, { allowTbd: event.target.checked })}
                        type="checkbox"
                      />
                      Allow TBD
                    </label>
                  ) : null}
                  {destinations.map((destination) => (
                    <em className="questionnaire-editor-tag" key={destination}>
                      {DESTINATION_LABEL[destination]}
                    </em>
                  ))}
                  <span className="questionnaire-editor-actions">
                    <button
                      aria-label={`Move ${field.label || "question"} up`}
                      className="button button-quiet"
                      disabled={first}
                      onClick={() => rearrange(moveField(sections, field.id, -1))}
                      type="button"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      aria-label={`Move ${field.label || "question"} down`}
                      className="button button-quiet"
                      disabled={last}
                      onClick={() => rearrange(moveField(sections, field.id, 1))}
                      type="button"
                    >
                      <ArrowDown size={13} />
                    </button>
                    {sections.length > 1 ? (
                      <select
                        aria-label={`Move ${field.label || "question"} to another section`}
                        onChange={(event) => {
                          if (event.target.value) rearrange(moveFieldToSection(sections, field.id, event.target.value));
                          event.target.value = "";
                        }}
                        value=""
                      >
                        <option value="">Move to…</option>
                        {sections
                          .filter((other) => other.id !== section.id)
                          .map((other, otherIndex) => (
                            <option key={other.id} value={other.id}>
                              {other.title.trim() || `Part ${otherIndex + 1}`}
                            </option>
                          ))}
                      </select>
                    ) : null}
                    <button
                      aria-label={`Remove ${field.label || "question"}`}
                      className="button button-quiet"
                      onClick={() =>
                        rearrange(
                          sections.map((candidate) => ({
                            ...candidate,
                            fields: candidate.fields.filter((other) => other.id !== field.id),
                          })),
                        )
                      }
                      type="button"
                    >
                      <Trash2 size={13} />
                    </button>
                  </span>
                </div>
                <details className="questionnaire-editor-rules" open={hasRules}>
                  <summary>
                    {hasRules
                      ? [field.conditionalOn ? "Shows only sometimes" : "", field.suggestedFrom ? "Suggests a time" : ""].filter(Boolean).join(" · ")
                      : "When it shows" + (field.type === "time" ? ", suggested time" : "")}
                  </summary>
                  <div className="questionnaire-editor-field">
                    <label>
                      Show it
                      <select
                        onChange={(event) => {
                          const source = earlier.find((candidate) => candidate.id === event.target.value);
                          if (!source) return patchField(field.id, { conditionalOn: null });
                          const options = source.options.split(",").map((option) => option.trim()).filter(Boolean);
                          const equals = ["checkbox", "acknowledgement"].includes(source.type) ? true : (options[0] ?? "");
                          patchField(field.id, { conditionalOn: { fieldId: source.id, equals } });
                        }}
                        value={field.conditionalOn?.fieldId ?? ""}
                      >
                        <option value="">Always</option>
                        {conditionSources(earlier).map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {`Only when "${candidate.label.trim()}" is…`}
                          </option>
                        ))}
                      </select>
                    </label>
                    {field.conditionalOn && reads ? (
                      ["checkbox", "acknowledgement"].includes(reads.type) ? (
                        <label>
                          Answer
                          <select
                            onChange={(event) =>
                              patchField(field.id, { conditionalOn: { fieldId: reads.id, equals: event.target.value === "yes" } })
                            }
                            value={field.conditionalOn.equals === true ? "yes" : "no"}
                          >
                            <option value="yes">Ticked</option>
                            <option value="no">Not ticked</option>
                          </select>
                        </label>
                      ) : CHOICE_TYPES.includes(reads.type) && reads.options.trim() ? (
                        <label>
                          Answer
                          <select
                            onChange={(event) => patchField(field.id, { conditionalOn: { fieldId: reads.id, equals: event.target.value } })}
                            value={String(field.conditionalOn.equals ?? "")}
                          >
                            {reads.options
                              .split(",")
                              .map((option) => option.trim())
                              .filter(Boolean)
                              .map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                          </select>
                        </label>
                      ) : (
                        <label>
                          Answer
                          <input
                            onChange={(event) => patchField(field.id, { conditionalOn: { fieldId: reads.id, equals: event.target.value } })}
                            value={String(field.conditionalOn.equals ?? "")}
                          />
                        </label>
                      )
                    ) : null}
                    {field.type === "time" ? (
                      <>
                        <label>
                          Suggest a time from
                          <select
                            onChange={(event) =>
                              patchField(field.id, {
                                suggestedFrom: event.target.value
                                  ? { fieldId: event.target.value, minutes: field.suggestedFrom?.minutes ?? 0 }
                                  : null,
                              })
                            }
                            value={field.suggestedFrom?.fieldId ?? ""}
                          >
                            <option value="">No suggestion</option>
                            {earlierTimes.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.label.trim()}
                              </option>
                            ))}
                          </select>
                        </label>
                        {field.suggestedFrom ? (
                          <>
                            <label>
                              Minutes
                              <input
                                max="720"
                                min="0"
                                onChange={(event) =>
                                  patchField(field.id, {
                                    suggestedFrom: {
                                      fieldId: field.suggestedFrom!.fieldId,
                                      minutes: Math.min(720, Math.abs(Math.round(Number(event.target.value) || 0))) * (field.suggestedFrom!.minutes < 0 ? -1 : 1),
                                    },
                                  })
                                }
                                type="number"
                                value={Math.abs(field.suggestedFrom.minutes)}
                              />
                            </label>
                            <label>
                              Before or after
                              <select
                                onChange={(event) =>
                                  patchField(field.id, {
                                    suggestedFrom: {
                                      fieldId: field.suggestedFrom!.fieldId,
                                      minutes: Math.abs(field.suggestedFrom!.minutes) * (event.target.value === "before" ? -1 : 1),
                                    },
                                  })
                                }
                                value={field.suggestedFrom.minutes < 0 ? "before" : "after"}
                              >
                                <option value="before">Before</option>
                                <option value="after">After (or at)</option>
                              </select>
                            </label>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </details>
              </div>
            );
          })}
          <div className="questionnaire-editor-add">
            <button className="button button-quiet" onClick={() => addField(section.id)} type="button">
              <Plus size={13} /> Add a question here
            </button>
            {/* The questions crew read before they lift a camera. Added by
                name so the brief can put them first — a hand-written one
                reaches crew but sorts with the addresses. */}
            <label className="questionnaire-editor-known">
              <span className="sr-only">Add a question your crew read first</span>
              <select
                onChange={(event) => {
                  const known = criticalCrewQuestions.find((question) => question.id === event.target.value);
                  if (known) addField(section.id, known);
                  event.target.value = "";
                }}
                value=""
              >
                <option value="">Or add one your crew read first…</option>
                {criticalCrewQuestions
                  .filter((question) => !sections.some((existing) => existing.fields.some((field) => field.id === question.id)))
                  .map((question) => (
                    <option key={question.id} value={question.id}>
                      {question.label}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </fieldset>
      ))}
      <button className="button button-light" onClick={addSection} type="button">
        <Plus size={14} /> Add a section
      </button>
      <button className="button button-dark" disabled={busy} onClick={() => void save()} type="button">
        {busy ? <LoaderCircle className="spin" size={14} /> : null}
        {creating ? "Save template" : "Save as new version"}
      </button>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );

  if (creating) return <div className="questionnaire-template-editor is-create">{body}</div>;
  return (
    <details className="questionnaire-template-editor">
      <summary>
        <PencilLine aria-hidden="true" size={14} /> Edit this questionnaire
      </summary>
      {body}
    </details>
  );
}
