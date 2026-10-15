"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { ClipboardList } from "lucide-react";
import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  currentInquiryFormTemplate,
  inquiryFormChoices,
  suggestedInquiryForm,
} from "@/features/questionnaires/inquiry-form-setting";
import { friendlyError } from "@/lib/ai/friendly-error";
import { getFirebaseClient } from "@/lib/firebase/client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { formNameInSentence, tradeProfile, tradeVocab } from "@/features/trades/trades";
import { JOB_KIND_LABELS, vocab } from "@/features/job-kinds/job-kinds";

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
export function InquiryEventFormSetting({
  onSaved,
  kind,
}: {
  onSaved?: () => void;
  /**
   * A kind with its own inquiry form (functions/src/intake/inquiry-form.ts
   * INQUIRY_FORM_KINDS): a mitzvah's details form, saved beside the wedding
   * one. Shown only while the studio's inquiry form offers the kind.
   */
  kind?: "mitzvah" | "quince" | "sweet16" | "sacrament";
} = {}) {
  const workspace = useWorkspace();
  const kindWords = kind ? JOB_KIND_LABELS[kind].toLowerCase() : "wedding";
  // "a bar or bat mitzvah", "a quinceañera": the kind's own, never another's.
  const oneOfKind = kind ? (vocab(kind).oneOf ?? `a ${vocab(kind).event}`) : "a wedding";
  // A makeup artist or hair stylist has no call: the inquiry page takes the
  // couple's details and the quote follows (functions/src/intake/inquiry-link.ts).
  // A DJ's call is a vibe call (trades.ts).
  const calls = tradeProfile(workspace.tenantTrade).consultation;
  const callWord = tradeVocab(workspace.tenantTrade).consultation.toLowerCase();
  const offer = tradeVocab(workspace.tenantTrade).proposal.toLowerCase();
  // A vendor's client fills in one form, sent when they book (trades.ts `journey.oneForm`).
  const ownForm = tradeProfile(workspace.tenantTrade).journey.oneForm ? tradeVocab(workspace.tenantTrade, kind).detailsForm : null;
  const { records: templates } = useTenantDocuments("questionnaireTemplates");
  const ownerOrAdmin = ["studio_owner", "studio_admin"].includes(String(workspace.role));
  const [savedId, setSavedId] = useState<string | null>(null);
  // Never saved, not even "no form": nothing has been chosen yet.
  const [decided, setDecided] = useState(true);
  // Null until the studio touches the picker; "" means "no form".
  const [choice, setChoice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!dataIsLive);
  // A kind's picker shows only while the inquiry form offers the kind.
  const [offered, setOffered] = useState(!kind);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!dataIsLive || !workspace.tenantId || !ownerOrAdmin) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "leadCaptureSettings", workspace.tenantId))
      .then((snapshot) => {
        if (!active) return;
        const setting = (
          kind
            ? (snapshot.get("inquiryEventFormByKind") as Record<string, unknown> | undefined)?.[kind]
            : snapshot.get("inquiryEventForm")
        ) as { templateId?: unknown } | null | undefined;
        setSavedId(typeof setting?.templateId === "string" ? setting.templateId : null);
        setDecided(setting !== undefined);
        if (kind) {
          const types = (snapshot.get("inquiryForm") as { eventTypes?: Array<{ kind?: unknown }> } | undefined)?.eventTypes;
          setOffered(Array.isArray(types) && types.some((type) => type?.kind === kind));
        }
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [workspace.tenantId, ownerOrAdmin, kind]);

  const rows = templates ?? [];
  // A saved id goes stale when the form is edited; show the live version.
  const current = currentInquiryFormTemplate(rows, savedId);
  // A kind's picker lists its own forms first.
  const choices = kind
    ? [...inquiryFormChoices(rows)].sort((left, right) => Number(right.eventTypeId === kind) - Number(left.eventTypeId === kind))
    : inquiryFormChoices(rows);
  const forThisKind = (item: (typeof choices)[number]) => (kind ? item.eventTypeId === kind : item.forWeddings);
  // A studio that hasn't chosen starts on its wedding form, ready to save:
  // "Don't send a form", greyed out, was where every studio sat (2026-10-05).
  const selected =
    choice ??
    current?.id ??
    (decided
      ? ""
      : kind
        ? (choices.find((item) => item.recommendedId === `${kind}-details`)?.id ?? "")
        : suggestedInquiryForm(choices));

  if (!ownerOrAdmin || !offered) return null;

  async function save(templateId: string | null) {
    setBusy(true);
    setNotice(null);
    try {
      const response = await sendPlanningCommand("setInquiryEventForm", { templateId, ...(kind ? { kind } : {}) });
      const name = choices.find((item) => item.id === templateId)?.name;
      setSavedId(templateId);
      setChoice(null);
      if (response.persisted) {
        setDecided(true);
        onSaved?.();
      }
      setNotice(
        !response.persisted
          ? "Preview: nothing was saved."
          : templateId
            ? `Saved. ${kind ? "Families" : "Couples"} who write in about ${oneOfKind} will be asked to fill out ${name ?? "this form"} ${calls ? "before they pick a time to talk" : "on their inquiry page"}.`
            : calls
              ? "Saved. The inquiry page goes straight to picking a time again."
              : "Saved. The inquiry page asks just a few details again.",
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "That setting couldn't be saved."));
    } finally {
      setBusy(false);
    }
  }

  return (
    // Today and setup link here (features/today/setup-gaps.ts) when it hasn't been chosen.
    <section
      className="panel"
      aria-labelledby={kind ? `inquiry-event-form-heading-${kind}` : "inquiry-event-form-heading"}
      id={kind ? `inquiry-form-${kind}` : "inquiry-form"}
    >
      <div>
        <p className="eyebrow">
          <ClipboardList aria-hidden="true" size={14} />{" "}
          {calls ? `Before the ${callWord}` : "With every new inquiry"}
        </p>
        <h2 id={kind ? `inquiry-event-form-heading-${kind}` : "inquiry-event-form-heading"}>
          {`Send a form with new ${kindWords} inquiries`}
        </h2>
        <p>
          {`${kind ? "Families" : "Couples"} fill it in on the page your first reply links to${
            calls ? ", before they pick a time to talk — so you have their answers for the call" : ` — so you have their answers for the ${offer}`
          }, and for the contract. It lands on the job like any other questionnaire.`}
        </p>
        {ownForm ? (
          <p>
            {`Optional: your clients fill in one form, your ${formNameInSentence(ownForm)}, when they book. Your inquiry page already asks what you price on, so most studios like yours send nothing here.`}
          </p>
        ) : null}
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
            {`Form for ${kindWords} inquiries`}
            <select onChange={(event) => setChoice(event.target.value)} value={selected}>
              <option value="">
                {calls ? "Don’t send a form — go straight to picking a time" : "Don’t send a form — ask just a few details"}
              </option>
              {choices.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                  {forThisKind(item) ? "" : ` (not ${oneOfKind} form)`}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button-dark"
            disabled={busy || (decided && selected === (current?.id ?? ""))}
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
          {`${kind ? "Bar & bat mitzvah" : "Wedding"} inquiries are asked to fill out ${String(current.name ?? "your form")} first.`}
        </p>
      ) : null}
      {notice ? <p className="form-notice" role="status">{notice}</p> : null}
    </section>
  );
}
