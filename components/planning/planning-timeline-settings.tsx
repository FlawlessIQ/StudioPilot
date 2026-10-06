"use client";

import { useState } from "react";
import { CalendarRange, CheckCircle2, LoaderCircle } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { resolvePlanningTimeline, type PlanningFormSend } from "@/features/planning/planning-timeline";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

/**
 * When a couple's planning starts, and when their details lock.
 *
 * GR Productions (2026-10-02): send the planning form and timeline six months
 * before (couples get nervous), lock the final details four weeks before.
 * Owner or admin, audited server-side (planningCommand, setPlanningTimeline).
 */
export function PlanningTimelineSettings() {
  const workspace = useWorkspace();
  const mayEdit = workspace.role === "studio_owner" || workspace.role === "studio_admin";
  const { records: tenants } = useTenantDocuments("tenants");
  const { records: templates } = useTenantDocuments("questionnaireTemplates");
  const tenant = tenants?.find((entry) => entry.id === workspace.tenantId);
  const stored = resolvePlanningTimeline(tenant?.planningTimeline);

  const [months, setMonths] = useState<number | null>(null);
  const [send, setSend] = useState<PlanningFormSend | null>(null);
  const [templateId, setTemplateId] = useState<string | null | undefined>(undefined);
  const [lockWeeks, setLockWeeks] = useState<number | null>(null);
  const [atBooking, setAtBooking] = useState<boolean | null>(null);
  const [review, setReview] = useState<boolean | null>(null);
  const [shotListId, setShotListId] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveMonths = months ?? stored.formMonthsBefore;
  const effectiveSend = send ?? stored.formSend;
  const effectiveTemplate = templateId === undefined ? stored.formTemplateId : templateId;
  const effectiveLockWeeks = lockWeeks ?? Math.round(stored.lockDaysBefore / 7);
  const effectiveAtBooking = atBooking ?? stored.formAtBooking;
  const effectiveReview = review ?? stored.reviewAtFormDate;
  const effectiveShotList = shotListId === undefined ? stored.shotListTemplateId : shotListId;
  const forms = (templates ?? [])
    .filter((template) => template.status === "active" && !template.archivedAt)
    .map((template) => ({ id: template.id, name: String(template.name ?? "Questionnaire") }))
    .sort((left, right) => left.name.localeCompare(right.name));

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await sendPlanningCommand("setPlanningTimeline", {
        formMonthsBefore: effectiveMonths,
        formSend: effectiveSend,
        formTemplateId: effectiveTemplate,
        lockDaysBefore: effectiveLockWeeks * 7,
        formAtBooking: effectiveAtBooking,
        reviewAtFormDate: effectiveReview,
        shotListTemplateId: effectiveShotList,
      });
      setSaved(true);
    } catch (caught: unknown) {
      setError(friendlyError(caught, "That setting couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  const touch = () => setSaved(false);
  return (
    <section className="panel crew-offer-settings" aria-labelledby="planning-timeline-title">
      <form
        className="crm-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="email-branding-heading">
          <span className="data-control-icon">
            <CalendarRange aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">Planning</p>
            <h2 id="planning-timeline-title">Planning timeline</h2>
            <p>When couples get their planning form, and when their final details lock. Other kinds of work follow their own timing (Settings → Job types).</p>
          </div>
        </div>
        <div className="crm-form-grid crew-offer-settings-fields">
          <label>
            Send the planning form
            <select
              disabled={!mayEdit}
              onChange={(event) => {
                setMonths(Number(event.target.value));
                touch();
              }}
              value={effectiveMonths}
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {value === 1 ? "1 month before the wedding" : `${value} months before the wedding`}
                </option>
              ))}
            </select>
          </label>
          <label>
            Which form
            <select
              disabled={!mayEdit}
              onChange={(event) => {
                setTemplateId(event.target.value || null);
                touch();
              }}
              value={effectiveTemplate ?? ""}
            >
              <option value="">Your newest planning form</option>
              {forms.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-checkbox">
            <input
              checked={effectiveSend === "auto"}
              disabled={!mayEdit}
              onChange={(event) => {
                setSend(event.target.checked ? "auto" : "remind");
                touch();
              }}
              type="checkbox"
            />
            <span>Send it automatically</span>
            <small>
              On, StudioCue sends the form to every booked couple on that day. Off, Today reminds you to send it then.
              Imported or paused bookings are never sent anything automatically.
            </small>
          </label>
          {/* GR (2026-10-05): the final schedule "sent after contract signed,
              and then again 6 months out" — the same form, updated. */}
          <label className="form-checkbox">
            <input
              checked={effectiveAtBooking}
              disabled={!mayEdit}
              onChange={(event) => {
                setAtBooking(event.target.checked);
                touch();
              }}
              type="checkbox"
            />
            <span>Also send it as soon as they book</span>
            <small>The moment the agreement is signed and the booking confirmed, so they can start early.</small>
          </label>
          <label className="form-checkbox">
            <input
              checked={effectiveReview}
              disabled={!mayEdit || effectiveSend !== "auto"}
              onChange={(event) => {
                setReview(event.target.checked);
                touch();
              }}
              type="checkbox"
            />
            <span>Then ask them to look it over at that date</span>
            <small>
              {effectiveSend === "auto"
                ? "Anyone who already filled it in gets a note to update anything that changed: the same answers, not a new form."
                : "Needs “Send it automatically”."}
            </small>
          </label>
          {/* GR (2026-10-05): the shot list is "its own form", due four
              weeks out, and the crew must have it — features/questionnaires/
              recommended-templates.ts has one to copy. */}
          <label>
            Shot list
            <select
              disabled={!mayEdit}
              onChange={(event) => {
                setShotListId(event.target.value || null);
                touch();
              }}
              value={effectiveShotList ?? ""}
            >
              <option value="">Don&rsquo;t send one</option>
              {forms.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.name}
                </option>
              ))}
            </select>
            <small>
              {effectiveSend === "auto"
                ? "Goes out with the planning form, due when the details lock. Your crew see the answers on their day sheet."
                : "Sent with the planning form when that goes out automatically. Until then, send it from the job's forms."}
            </small>
          </label>
          <label>
            Lock the final details
            <select
              disabled={!mayEdit}
              onChange={(event) => {
                setLockWeeks(Number(event.target.value));
                touch();
              }}
              value={effectiveLockWeeks}
            >
              {[2, 3, 4, 5, 6, 8].map((weeks) => (
                <option key={weeks} value={weeks}>{`${weeks} weeks before the wedding`}</option>
              ))}
            </select>
            <small>
              From then the couple confirms their final details, and changes to locations or times come to you as a request.
              Little things — guest count, phone numbers, family groups — they can still change themselves.
            </small>
          </label>
        </div>
        {mayEdit ? (
          <div className="final-balance-buttons">
            <button className="button button-dark" disabled={busy} type="submit">
              {busy ? <LoaderCircle aria-hidden="true" className="spin" size={15} /> : null}
              Save
            </button>
            {saved ? (
              <span className="form-notice" role="status">
                <CheckCircle2 aria-hidden="true" size={14} /> Saved
              </span>
            ) : null}
          </div>
        ) : (
          <p className="form-notice">An owner or admin changes the planning timeline.</p>
        )}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
