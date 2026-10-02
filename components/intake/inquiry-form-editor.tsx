"use client";

import { useEffect, useMemo, useState } from "react";
import { JOB_KIND_LABELS } from "@/features/job-kinds/job-kinds";
import { doc, getDoc } from "firebase/firestore";
import { ArrowDown, ArrowUp, ExternalLink, FileText, Plus, X } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  dayFieldsForKind,
  defaultInquiryFormConfig,
  inquiryIdFor,
  INQUIRY_BACKGROUNDS,
  INQUIRY_FORM_LIMITS,
  normaliseHexColor,
  normaliseInquiryFormConfig,
  validateInquiryFormConfig,
  type InquiryEventKind,
  type InquiryEventType,
  type InquiryFieldMode,
  type InquiryFormConfig,
  type InquiryQuestion,
  type InquiryQuestionType,
} from "@/features/leads/inquiry-form-config";
import { INQUIRY_BACKGROUND_SWATCHES, inquiryFormTheme } from "@/features/leads/inquiry-form-theme";
import { inquiryUrl } from "@/features/intake/website-embed";
import { friendlyError } from "@/lib/ai/friendly-error";
import { runCrmCommand } from "@/lib/crm/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";

/**
 * Settings → Inquiry capture → "Your inquiry form".
 *
 * GR Productions, 2026-10-01: the inquiry form is the studio's main website
 * contact form, so it has to fit the studio — "Sports. Portraits. Studio
 * time. Wedding. Etc." — and not ask a cheer parent about guests and a venue.
 * Here a studio writes its own kinds of inquiry and what each is asked, turns
 * the budget and referral questions off, adds questions of its own, and picks
 * its colours. The design is in features/leads/inquiry-form-config.ts; the
 * save goes through the crm command `setInquiryForm` (owner or admin), which
 * checks it again in full.
 *
 * Every input is controlled by a row keyed on a stable id, so typing never
 * loses focus.
 */

// The product's names for the kinds of job (job-kinds.ts), plus the
// inquiry-only general question.
const KIND_LABEL: Record<InquiryEventKind, string> = {
  ...JOB_KIND_LABELS,
  general: "General question — skips “your day”",
};

const MODE_LABEL: Record<InquiryFieldMode, string> = {
  required: "Required",
  optional: "Optional",
  hidden: "Don’t ask",
};

const QUESTION_TYPE_LABEL: Record<InquiryQuestionType, string> = {
  short_text: "Short answer",
  long_text: "Longer answer",
  choice: "Choose one",
  yes_no: "Yes or no",
};

const BACKGROUND_HINT: Record<(typeof INQUIRY_BACKGROUNDS)[number], string> = {
  cream: "Warm, the default",
  white: "Matches most websites",
  light: "Cool and neutral",
};

/** Swap two rows. */
function moved<T>(rows: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= rows.length) return [...rows];
  const next = [...rows];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}

export function InquiryFormEditor({
  typesOnly = false,
}: {
  /**
   * Settings → Job types: only the list of types, each one kind of work.
   * The same list the inquiry form offers — one source of truth for "what
   * kinds of job does this studio take".
   */
  typesOnly?: boolean;
} = {}) {
  const workspace = useWorkspace();
  const ownerOrAdmin = ["studio_owner", "studio_admin"].includes(String(workspace.role));
  const [saved, setSaved] = useState<InquiryFormConfig>(() => defaultInquiryFormConfig());
  const [draft, setDraft] = useState<InquiryFormConfig>(() => defaultInquiryFormConfig());
  // What is typed in the hex box, kept apart so a half-typed colour isn't lost.
  const [colorText, setColorText] = useState("");
  const [loaded, setLoaded] = useState(!dataIsLive);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);

  useEffect(() => {
    if (!dataIsLive || !workspace.tenantId || !ownerOrAdmin) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "leadCaptureSettings", workspace.tenantId))
      .then((snapshot) => {
        if (!active) return;
        const config = normaliseInquiryFormConfig(snapshot.get("inquiryForm"));
        setSaved(config);
        setDraft(config);
        setColorText(config.buttonColor ?? "");
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [workspace.tenantId, ownerOrAdmin]);

  const brandColor = workspace.tenantBrand?.primaryColor ?? null;
  const theme = useMemo(() => inquiryFormTheme(brandColor, draft), [brandColor, draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const origin = typeof window === "undefined" ? "https://studio-cue.com" : window.location.origin;
  const previewHref = workspace.tenantSlug ? `${inquiryUrl(origin, workspace.tenantSlug)}&preview=studio` : null;

  if (!ownerOrAdmin) return null;

  const change = (patch: Partial<InquiryFormConfig>) => {
    setNotice(null);
    setProblems([]);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const changeType = (id: string, patch: Partial<InquiryEventType>) =>
    change({ eventTypes: draft.eventTypes.map((type) => (type.id === id ? { ...type, ...patch } : type)) });
  const changeQuestion = (id: string, patch: Partial<InquiryQuestion>) =>
    change({ questions: draft.questions.map((question) => (question.id === id ? { ...question, ...patch } : question)) });

  function addType() {
    const label = "New type";
    const id = inquiryIdFor(label, draft.eventTypes.map((type) => type.id), "type");
    change({ eventTypes: [...draft.eventTypes, { id, label, kind: "other", ...dayFieldsForKind("other") }] });
  }

  function removeType(id: string) {
    change({
      eventTypes: draft.eventTypes.filter((type) => type.id !== id),
      // A question asked only for this type is now asked for nobody: ask everyone instead.
      questions: draft.questions.map((question) => ({
        ...question,
        eventTypeIds: question.eventTypeIds.filter((typeId) => typeId !== id),
      })),
    });
  }

  function addQuestion() {
    const id = inquiryIdFor(`question ${draft.questions.length + 1}`, draft.questions.map((question) => question.id), "question");
    change({
      questions: [
        ...draft.questions,
        { id, label: "", type: "short_text", options: [], required: false, eventTypeIds: [] },
      ],
    });
  }

  async function save() {
    const checked = validateInquiryFormConfig(draft);
    if (!checked.ok) {
      setProblems(checked.errors);
      return;
    }
    setBusy(true);
    setNotice(null);
    setProblems([]);
    try {
      const response = await runCrmCommand("setInquiryForm", { config: checked.config });
      setSaved(checked.config);
      setDraft(checked.config);
      setNotice(
        response.persisted
          ? "Saved. Your form asks this from the next inquiry on — open the preview to try it."
          : "Preview: nothing was saved.",
      );
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Your form couldn't be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="inquiry-form-editor-title" className="panel inquiry-form-editor">
      <div className="email-branding-heading">
        <span className="data-control-icon">
          <FileText aria-hidden="true" />
        </span>
        <div>
          <p className="eyebrow">{typesOnly ? "Job types" : "Your inquiry form"}</p>
          <h2 id="inquiry-form-editor-title">{typesOnly ? "The work you take" : "What your form asks"}</h2>
          <p>
            {typesOnly
              ? "Your own names — Mini sessions, Cheer, Headshots — each one kind of work. Clients pick one on your inquiry form, and you pick one when you start a job."
              : "It’s your website’s contact form. Choose the kinds of inquiry you take, what each one is asked, and how it looks."}
          </p>
        </div>
      </div>
      {previewHref ? (
        <p className="capture-lead">
          <a className="button button-light button-sm" href={previewHref} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" size={14} /> Preview your form
          </a>{" "}
          {dirty ? "Save first to see your changes." : null}
        </p>
      ) : null}

      {!loaded ? (
        <p className="form-notice" role="status">Loading…</p>
      ) : (
        <>
          <fieldset className="inquiry-form-editor-group">
            <legend>Kinds of inquiry</legend>
            <p className="inquiry-form-editor-hint">
              Clients choose one at the end of the first page, and the next page asks only what you tick here. A
              general question skips straight to their message.
            </p>
            {draft.eventTypes.map((type, index) => (
              <div className="inquiry-form-editor-row" key={type.id}>
                <div className="inquiry-form-editor-row-head">
                  <label>
                    <span>Name</span>
                    <input
                      maxLength={INQUIRY_FORM_LIMITS.typeLabel}
                      onChange={(event) => changeType(type.id, { label: event.target.value })}
                      value={type.label}
                    />
                  </label>
                  <label>
                    <span>Kind</span>
                    <select
                      onChange={(event) => {
                        const kind = event.target.value as InquiryEventKind;
                        // A new kind starts from that kind's usual questions.
                        changeType(type.id, { kind, ...dayFieldsForKind(kind) });
                      }}
                      value={type.kind}
                    >
                      {(Object.keys(KIND_LABEL) as InquiryEventKind[]).map((kind) => (
                        <option key={kind} value={kind}>
                          {KIND_LABEL[kind]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="inquiry-form-editor-actions">
                    <button
                      aria-label={`Move ${type.label} up`}
                      className="button button-quiet button-sm"
                      disabled={index === 0}
                      onClick={() => change({ eventTypes: moved(draft.eventTypes, index, index - 1) })}
                      type="button"
                    >
                      <ArrowUp aria-hidden="true" size={14} />
                    </button>
                    <button
                      aria-label={`Move ${type.label} down`}
                      className="button button-quiet button-sm"
                      disabled={index === draft.eventTypes.length - 1}
                      onClick={() => change({ eventTypes: moved(draft.eventTypes, index, index + 1) })}
                      type="button"
                    >
                      <ArrowDown aria-hidden="true" size={14} />
                    </button>
                    <button
                      aria-label={`Remove ${type.label}`}
                      className="button button-quiet button-sm"
                      disabled={draft.eventTypes.length === 1}
                      onClick={() => removeType(type.id)}
                      type="button"
                    >
                      <X aria-hidden="true" size={14} />
                    </button>
                  </span>
                </div>
                {type.kind === "general" ? (
                  <p className="inquiry-form-editor-hint">Asks nothing about a date or place — straight to their message.</p>
                ) : (
                  <div className="inquiry-form-editor-fields">
                    <label>
                      <span>Date</span>
                      <select
                        onChange={(event) => changeType(type.id, { eventDate: event.target.value as InquiryFieldMode })}
                        value={type.eventDate}
                      >
                        {(Object.keys(MODE_LABEL) as InquiryFieldMode[]).map((mode) => (
                          <option key={mode} value={mode}>
                            {MODE_LABEL[mode]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>City</span>
                      <select
                        onChange={(event) => changeType(type.id, { city: event.target.value as InquiryFieldMode })}
                        value={type.city}
                      >
                        {(Object.keys(MODE_LABEL) as InquiryFieldMode[]).map((mode) => (
                          <option key={mode} value={mode}>
                            {MODE_LABEL[mode]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="inquiry-form-editor-check">
                      <input
                        checked={type.venue}
                        onChange={(event) =>
                          changeType(type.id, { venue: event.target.checked, coi: event.target.checked && type.coi })
                        }
                        type="checkbox"
                      />
                      <span>Venue</span>
                    </label>
                    <label className="inquiry-form-editor-check">
                      <input
                        checked={type.guests}
                        onChange={(event) => changeType(type.id, { guests: event.target.checked })}
                        type="checkbox"
                      />
                      <span>Guest count</span>
                    </label>
                    <label className="inquiry-form-editor-check">
                      <input
                        checked={type.venue && type.coi}
                        disabled={!type.venue}
                        onChange={(event) => changeType(type.id, { coi: event.target.checked })}
                        type="checkbox"
                      />
                      <span>Venue insurance question</span>
                    </label>
                  </div>
                )}
              </div>
            ))}
            {draft.eventTypes.length < INQUIRY_FORM_LIMITS.eventTypes ? (
              <button className="button button-light button-sm" onClick={addType} type="button">
                <Plus aria-hidden="true" size={14} /> {typesOnly ? "Add a kind of work" : "Add a kind of inquiry"}
              </button>
            ) : null}
          </fieldset>

          {typesOnly ? null : (
          <>
          <fieldset className="inquiry-form-editor-group">
            <legend>On the last page</legend>
            <label className="inquiry-form-editor-check">
              <input
                checked={draft.askBudget}
                onChange={(event) => change({ askBudget: event.target.checked })}
                type="checkbox"
              />
              <span>Ask for their photography budget</span>
            </label>
            <label className="inquiry-form-editor-check">
              <input
                checked={draft.askReferral}
                onChange={(event) => change({ askReferral: event.target.checked })}
                type="checkbox"
              />
              <span>Ask how they heard about you</span>
            </label>
          </fieldset>

          <fieldset className="inquiry-form-editor-group">
            <legend>Your own questions</legend>
            <p className="inquiry-form-editor-hint">
              Up to {INQUIRY_FORM_LIMITS.questions}, asked after their message. Their answers show on the inquiry and
              help Cue draft your reply.
            </p>
            {draft.questions.map((question, index) => (
              <div className="inquiry-form-editor-row" key={question.id}>
                <div className="inquiry-form-editor-row-head">
                  <label>
                    <span>Question</span>
                    <input
                      maxLength={INQUIRY_FORM_LIMITS.questionLabel}
                      onChange={(event) => changeQuestion(question.id, { label: event.target.value })}
                      placeholder="e.g. Which team or school is it for?"
                      value={question.label}
                    />
                  </label>
                  <label>
                    <span>Answer</span>
                    <select
                      onChange={(event) => changeQuestion(question.id, { type: event.target.value as InquiryQuestionType })}
                      value={question.type}
                    >
                      {(Object.keys(QUESTION_TYPE_LABEL) as InquiryQuestionType[]).map((type) => (
                        <option key={type} value={type}>
                          {QUESTION_TYPE_LABEL[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <span className="inquiry-form-editor-actions">
                    <button
                      aria-label="Move this question up"
                      className="button button-quiet button-sm"
                      disabled={index === 0}
                      onClick={() => change({ questions: moved(draft.questions, index, index - 1) })}
                      type="button"
                    >
                      <ArrowUp aria-hidden="true" size={14} />
                    </button>
                    <button
                      aria-label="Move this question down"
                      className="button button-quiet button-sm"
                      disabled={index === draft.questions.length - 1}
                      onClick={() => change({ questions: moved(draft.questions, index, index + 1) })}
                      type="button"
                    >
                      <ArrowDown aria-hidden="true" size={14} />
                    </button>
                    <button
                      aria-label="Remove this question"
                      className="button button-quiet button-sm"
                      onClick={() => change({ questions: draft.questions.filter((item) => item.id !== question.id) })}
                      type="button"
                    >
                      <X aria-hidden="true" size={14} />
                    </button>
                  </span>
                </div>
                {question.type === "choice" ? (
                  <label className="inquiry-form-editor-options">
                    <span>Answers to choose from — one per line</span>
                    <textarea
                      onChange={(event) => changeQuestion(question.id, { options: event.target.value.split("\n") })}
                      rows={3}
                      value={question.options.join("\n")}
                    />
                  </label>
                ) : null}
                <div className="inquiry-form-editor-fields">
                  <label className="inquiry-form-editor-check">
                    <input
                      checked={question.required}
                      onChange={(event) => changeQuestion(question.id, { required: event.target.checked })}
                      type="checkbox"
                    />
                    <span>Required</span>
                  </label>
                </div>
                <div className="inquiry-form-editor-asked">
                  <span>Ask for</span>
                  <div className="capture-chips">
                    <button
                      aria-pressed={question.eventTypeIds.length === 0}
                      className={question.eventTypeIds.length === 0 ? "capture-chip is-on" : "capture-chip"}
                      onClick={() => changeQuestion(question.id, { eventTypeIds: [] })}
                      type="button"
                    >
                      Every inquiry
                    </button>
                    {draft.eventTypes.map((type) => {
                      const on = question.eventTypeIds.includes(type.id);
                      return (
                        <button
                          aria-pressed={on}
                          className={on ? "capture-chip is-on" : "capture-chip"}
                          key={type.id}
                          onClick={() =>
                            changeQuestion(question.id, {
                              eventTypeIds: on
                                ? question.eventTypeIds.filter((typeId) => typeId !== type.id)
                                : [...question.eventTypeIds, type.id],
                            })
                          }
                          type="button"
                        >
                          {type.label || "Untitled"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
            {draft.questions.length < INQUIRY_FORM_LIMITS.questions ? (
              <button className="button button-light button-sm" onClick={addQuestion} type="button">
                <Plus aria-hidden="true" size={14} /> Add a question
              </button>
            ) : null}
          </fieldset>

          <fieldset className="inquiry-form-editor-group">
            <legend>Colours</legend>
            <div className="inquiry-form-editor-fields">
              <label>
                <span>Buttons</span>
                <input
                  aria-label="Button colour"
                  onChange={(event) => {
                    setColorText(event.target.value.toUpperCase());
                    change({ buttonColor: normaliseHexColor(event.target.value) });
                  }}
                  type="color"
                  value={draft.buttonColor ?? theme.accent}
                />
              </label>
              <label>
                <span>Hex</span>
                <input
                  maxLength={7}
                  onChange={(event) => {
                    setColorText(event.target.value);
                    const color = normaliseHexColor(event.target.value);
                    if (color || !event.target.value.trim()) change({ buttonColor: color });
                  }}
                  placeholder={brandColor ?? "#8A6A3A"}
                  value={colorText}
                />
              </label>
              {draft.buttonColor ? (
                <button
                  className="button button-quiet button-sm"
                  onClick={() => {
                    setColorText("");
                    change({ buttonColor: null });
                  }}
                  type="button"
                >
                  Use my brand colour
                </button>
              ) : null}
            </div>
            <div className="inquiry-form-editor-asked">
              <span>Background</span>
              <div className="capture-chips">
                {INQUIRY_BACKGROUNDS.map((background) => (
                  <button
                    aria-pressed={draft.background === background}
                    className={draft.background === background ? "capture-chip is-on" : "capture-chip"}
                    key={background}
                    onClick={() => change({ background })}
                    title={BACKGROUND_HINT[background]}
                    type="button"
                  >
                    {INQUIRY_BACKGROUND_SWATCHES[background].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="inquiry-form-editor-sample" style={{ background: theme.page }}>
              <span style={{ background: theme.accent, color: theme.onAccent }}>Continue</span>
              <small style={{ color: theme.accent }}>
                {draft.buttonColor && theme.accent !== draft.buttonColor
                  ? "Darkened a little so the text stays readable."
                  : "How your buttons and links will look."}
              </small>
            </div>
          </fieldset>
          </>
          )}

          {problems.length ? (
            <ul className="inquiry-form-editor-problems" role="alert">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
          <div className="inquiry-form-editor-footer">
            <button className="button button-dark" disabled={busy || !dirty} onClick={() => void save()} type="button">
              {busy ? "Saving…" : typesOnly ? "Save your job types" : "Save your form"}
            </button>
            {dirty ? (
              <button
                className="button button-light"
                disabled={busy}
                onClick={() => {
                  setDraft(saved);
                  setColorText(saved.buttonColor ?? "");
                  setProblems([]);
                }}
                type="button"
              >
                Undo changes
              </button>
            ) : null}
          </div>
          {notice ? <p className="form-notice" role="status">{notice}</p> : null}
        </>
      )}
    </section>
  );
}
