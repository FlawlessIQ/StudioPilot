"use client";

import { useState } from "react";
import { ArrowRight, LoaderCircle, Send } from "lucide-react";
import {
  refreshTenantRecords,
  useTenantDocuments,
} from "@/components/live/tenant-records";
import { friendlyError } from "@/lib/ai/friendly-error";
import { sendPlanningCommand } from "@/lib/planning/command-client";

/**
 * Sending the form, from the page the journey sends you to.
 *
 * The job page says "YOUR NEXT MOVE — Send the form" and links here. What
 * arrived was a large empty box reading "No questionnaires assigned · Assign a
 * template below", with the assign form itself off the bottom of the screen —
 * so the one thing the studio came to do required scrolling past the statement
 * that it had not been done, then choosing from two dropdowns whose answers
 * were already known: this project, and the one active template for its event
 * type.
 *
 * When both are unambiguous this is a single button naming the template. When
 * they are not — no template for the event type, or several — it steps aside
 * and the picker below handles it, because guessing which of three forms a
 * studio meant is worse than asking.
 */
export function QuestionnaireQuickSend({ projectId }: { projectId: string }) {
  const { records: projects } = useTenantDocuments("projects");
  const { records: templates } = useTenantDocuments("questionnaireTemplates");
  const { records: responses } = useTenantDocuments("questionnaireResponses");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const project = projects?.find((item) => item.id === projectId);
  const alreadyAssigned = (responses ?? []).some(
    (response) =>
      response.projectId === projectId && response.archivedAt === null,
  );
  const eventTypeId = String(project?.eventTypeId ?? "");
  const candidates = (templates ?? []).filter(
    (template) =>
      template.status === "active" &&
      String(template.eventTypeId ?? "") === eventTypeId,
  );
  const template = candidates.length === 1 ? candidates[0] : null;

  // Nothing to offer: already sent, still loading, or the choice is genuinely
  // the studio's to make.
  if (!project || alreadyAssigned || !template) return null;

  async function send() {
    if (!template) return;
    setBusy(true);
    setNotice(null);
    try {
      await sendPlanningCommand("assignQuestionnaire", {
        projectId,
        templateId: template.id,
      });
      refreshTenantRecords("questionnaireResponses", "checkpoints");
      setNotice(
        "Sent. The couple can fill it in from their portal, and readiness updates when they do.",
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That form could not be sent."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel questionnaire-quick-send">
      <div>
        <p className="eyebrow">Your next move</p>
        <h2>Send {String(project.name ?? "this client")} their details form</h2>
        <p>
          <strong>{String(template.name)}</strong> — the active form for a{" "}
          {eventTypeId || "this"} job. It is due{" "}
          {Number(template.dueDaysBeforeEvent ?? 0)} days before the date, and
          StudioCue works out that date from the job.
        </p>
      </div>
      <div className="questionnaire-quick-send-actions">
        <button
          className="button button-dark"
          disabled={busy}
          onClick={() => void send()}
          type="button"
        >
          {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
          {busy ? "Sending…" : "Send the form"}
        </button>
        <small>
          Or choose a different template below <ArrowRight size={12} />
        </small>
      </div>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
