"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { ClipboardList } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  currentInquiryFormTemplate,
  inquiryFormChoices,
} from "@/features/questionnaires/inquiry-form-setting";
import { friendlyError } from "@/lib/ai/friendly-error";
import { getFirebaseClient } from "@/lib/firebase/client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { dataIsLive } from "@/lib/runtime-mode";

/**
 * "Send this form with every new wedding inquiry" — the studio's event form
 * on the couple's inquiry page, before they pick a consultation time
 * (functions/src/intake/inquiry-form.ts).
 *
 * GR Productions: "They should get the wedding info form right away after
 * wedding inquiry." The setting lives on the studio's inquiry settings
 * (leadCaptureSettings/{tenantId}.inquiryEventForm), written only by the
 * planning command setInquiryEventForm, which checks owner or admin.
 */
export function InquiryEventFormSetting() {
  const workspace = useWorkspace();
  const { records: templates } = useTenantDocuments("questionnaireTemplates");
  const ownerOrAdmin = ["studio_owner", "studio_admin"].includes(String(workspace.role));
  const [savedId, setSavedId] = useState<string | null>(null);
  // Null until the studio touches the picker; "" means "no form".
  const [choice, setChoice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!dataIsLive);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!dataIsLive || !workspace.tenantId || !ownerOrAdmin) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "leadCaptureSettings", workspace.tenantId))
      .then((snapshot) => {
        if (!active) return;
        const setting = snapshot.get("inquiryEventForm") as { templateId?: unknown } | null | undefined;
        setSavedId(typeof setting?.templateId === "string" ? setting.templateId : null);
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [workspace.tenantId, ownerOrAdmin]);

  const rows = templates ?? [];
  // A saved id goes stale when the form is edited; show the live version.
  const current = currentInquiryFormTemplate(rows, savedId);
  const choices = inquiryFormChoices(rows);
  const selected = choice ?? current?.id ?? "";

  if (!ownerOrAdmin) return null;

  async function save(templateId: string | null) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendPlanningCommand("setInquiryEventForm", { templateId });
      const name = choices.find((item) => item.id === templateId)?.name;
      setSavedId(templateId);
      setChoice(null);
      setNotice(
        !response.persisted
          ? "Preview: nothing was saved."
          : templateId
            ? `Saved. Couples who write in about a wedding will be asked to fill out ${name ?? "this form"} before they pick a time to talk.`
            : "Saved. The inquiry page goes straight to picking a time again.",
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That setting couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="inquiry-event-form-heading">
      <div>
        <p className="eyebrow">
          <ClipboardList aria-hidden="true" size={14} /> Before the consultation
        </p>
        <h2 id="inquiry-event-form-heading">Send a form with new wedding inquiries</h2>
        <p>
          Couples fill it in on the page your first reply links to, before they pick a time to talk — so you
          have their answers for the call, and for the contract. It lands on the job like any other
          questionnaire.
        </p>
      </div>
      {!loaded ? (
        <p className="form-notice" role="status">Loading…</p>
      ) : choices.length ? (
        <form
          className="questionnaire-assign-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save(selected || null);
          }}
        >
          <label>
            Form for wedding inquiries
            <select onChange={(event) => setChoice(event.target.value)} value={selected}>
              <option value="">Don’t send a form — go straight to picking a time</option>
              {choices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {item.forWeddings ? "" : " (not a wedding form)"}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button-dark"
            disabled={busy || selected === (current?.id ?? "")}
            type="submit"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </form>
      ) : (
        <p className="form-notice">Make a questionnaire Active first, then choose it here.</p>
      )}
      {current && !notice ? (
        <p className="form-notice" role="status">
          {`Wedding inquiries are asked to fill out ${String(current.name ?? "your form")} first.`}
        </p>
      ) : null}
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </section>
  );
}
