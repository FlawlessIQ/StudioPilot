"use client";

import { useState } from "react";
import { CheckCircle2, Copy, LoaderCircle, Sparkles } from "lucide-react";
import { refreshTenantRecords, useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  recommendedFieldCount,
  recommendedQuestionnaires,
  type RecommendedQuestionnaire,
} from "@/features/questionnaires/recommended-templates";
import { allowsTbd } from "@/features/questionnaires/field-extras";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPlanningCommand } from "@/lib/planning/command-client";

/**
 * StudioCue's recommended wedding forms (GR Productions', 2026-10-02), offered
 * on the questionnaire library: look through one, then make a copy — an
 * ordinary template of the studio's own, edited like any other. The forms
 * themselves never change under a studio (features/questionnaires/recommended-templates.ts).
 *
 * Owner or admin, as for any template (createQuestionnaireTemplate).
 */
export function RecommendedQuestionnaires() {
  const workspace = useWorkspace();
  const { records: templates } = useTenantDocuments("questionnaireTemplates");
  const canBuild = ["studio_owner", "studio_admin"].includes(String(workspace.role));
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string } | null>(null);
  if (!canBuild) return null;

  const rows = templates ?? [];
  const live = (row: (typeof rows)[number]) => row.status !== "archived" && !row.archivedAt;

  /** The form's name, or "Name (2)" when the studio already has one called that. */
  function freeName(name: string) {
    const taken = new Set(rows.map((row) => String(row.name ?? "").toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let copy = 2; ; copy += 1) if (!taken.has(`${name} (${copy})`.toLowerCase())) return `${name} (${copy})`;
  }

  async function copy(form: RecommendedQuestionnaire) {
    setBusy(form.id);
    setNotice(null);
    const name = freeName(form.name);
    try {
      const response = await sendPlanningCommand("createQuestionnaireTemplate", {
        name,
        eventTypeId: form.eventTypeId,
        status: "active",
        sections: form.sections,
        dueDaysBeforeEvent: form.dueDaysBeforeEvent,
        reminderDaysBeforeDue: form.reminderDaysBeforeDue,
        recommendedId: form.id,
      });
      refreshTenantRecords("questionnaireTemplates");
      setNotice({
        id: form.id,
        text: response.persisted
          ? `"${name}" is in your forms below. Change anything with "Edit this questionnaire". ${form.useIt}`
          : "Preview: nothing was saved.",
      });
    } catch (caught: unknown) {
      setNotice({ id: form.id, text: friendlyError(caught, "That form couldn't be copied.") });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel recommended-forms" aria-labelledby="recommended-forms-title">
      <div>
        <p className="eyebrow">
          <Sparkles aria-hidden="true" size={14} /> Recommended by StudioCue
        </p>
        <h2 id="recommended-forms-title">Ready-to-use wedding forms</h2>
        <p>
          Written by a working wedding studio to cover nearly every wedding. Use them as they are, or make a copy and
          change anything — your copy is yours to edit.
        </p>
      </div>
      <div className="recommended-forms-list">
        {recommendedQuestionnaires().map((form) => {
          const copies = rows.filter((row) => row.recommendedId === form.id && live(row));
          return (
            <article key={form.id}>
              <div className="recommended-forms-heading">
                <h3>{form.name}</h3>
                {copies.length ? (
                  <em>
                    <CheckCircle2 aria-hidden="true" size={12} /> In your forms
                  </em>
                ) : null}
              </div>
              <p>{form.summary}</p>
              <small className="recommended-forms-meta">{`${recommendedFieldCount(form)} questions · ${form.useIt}`}</small>
              <details className="recommended-forms-preview">
                <summary>See the questions</summary>
                {form.sections.map((section) => (
                  <div key={section.id}>
                    <h4>{section.title}</h4>
                    <ol>
                      {section.fields.map((field) => (
                        <li key={field.id}>
                          <span>
                            {field.label}
                            {allowsTbd(field) ? <em>TBD allowed</em> : null}
                          </span>
                          {field.help ? <small>{field.help}</small> : null}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </details>
              <div className="recommended-forms-actions">
                <button
                  className={copies.length ? "button button-light" : "button button-dark"}
                  disabled={busy !== null}
                  onClick={() => void copy(form)}
                  type="button"
                >
                  {busy === form.id ? <LoaderCircle aria-hidden="true" className="spin" size={15} /> : <Copy aria-hidden="true" size={15} />}
                  {copies.length ? "Make another copy" : "Make a copy"}
                </button>
              </div>
              {notice?.id === form.id ? (
                <p className="form-notice" role="status">
                  {notice.text}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
