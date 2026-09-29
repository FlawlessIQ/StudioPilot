"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { doc, getDoc } from "firebase/firestore";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  MessageCircle,
  Paperclip,
  Send,
} from "lucide-react";
import {
  Actions,
  Button,
  ButtonRow,
  Card,
  Choices,
  Field,
  List,
  Main,
  Note,
  Pill,
  PoweredBy,
  Row,
  Steps,
  TextArea,
} from "@/components/kit/kit";
import { useWorkspace } from "@/features/auth/workspace-context";
import {
  legacyQuestionnaireSections,
  parseQuestionnaireSections,
  visibleQuestionnaireSections,
  type QuestionnaireField,
  type QuestionnaireSection,
} from "@/features/questionnaires/client-form";
import {
  answerIsPresent,
  outstandingNotice,
  outstandingRequired,
} from "@/features/questionnaires/outstanding";
import { friendlyError } from "@/lib/ai/friendly-error";
import { uploadClientQuestionnaireFile } from "@/lib/client/questionnaire-upload";
import { getFirebaseClient } from "@/lib/firebase/client";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { dataIsLive } from "@/lib/runtime-mode";
import { date, text, useProjectRecords } from "@/components/client/live-client-views";
import { EmptyMoment } from "@/components/client/kit/empty-moment";

type ResponseRecord = Record<string, unknown> & { id: string };

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const isSubmitted = (status: unknown) => status === "submitted" || status === "locked";

/** An answer as the couple would say it back. */
function spoken(value: unknown, type = "text"): string {
  if (type === "time" && typeof value === "string" && /^\d{2}:\d{2}/.test(value)) {
    const [hours, minutes] = value.split(":").map(Number) as [number, number];
    return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  }
  if (type === "date" && typeof value === "string" && value) return date(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const named = record(value).name;
  if (typeof named === "string") return named;
  return String(value ?? "").trim();
}

/**
 * The couple's planning questionnaire, one section per screen (M4 of
 * docs/mobile-first-client-crew-plan-2026-09-28.md).
 *
 * It used to be every section on one long page, a <select> for every choice,
 * and inputs disabled during each autosave, which dropped the phone's
 * keyboard mid-word. Now: a section a screen with a progress bar, choice
 * chips, an autosave that never touches the field, a review of what's still
 * needed, and a read-only copy of what was sent.
 */
export function ClientQuestionnaire() {
  const responses = useProjectRecords("questionnaireResponses");
  const ordered = useMemo(
    () =>
      [...responses.value].sort((left, right) => {
        const leftDone = isSubmitted(left.status) ? 1 : 0;
        const rightDone = isSubmitted(right.status) ? 1 : 0;
        if (leftDone !== rightDone) return leftDone - rightDone;
        const due = String(left.dueDate ?? "9999").localeCompare(String(right.dueDate ?? "9999"));
        if (due !== 0) return due;
        return String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? ""));
      }),
    [responses.value],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current =
    ordered.length === 1 ? ordered[0] : ordered.find((response) => response.id === selectedId);

  if (!ordered.length)
    return (
      <Main label="Questionnaire">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Planning</p>
          <h1 className="kit-title">Your questionnaire</h1>
        </div>
        <EmptyMoment
          area="questionnaire"
          error={responses.error}
          loading={responses.loading}
          loadingText="Opening your questionnaire…"
          upcoming="Your studio hasn’t sent a questionnaire yet. You’ll get an email when there’s one to fill in."
        />
        <PoweredBy />
      </Main>
    );

  if (!current)
    return (
      <Main label="Questionnaires">
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Planning</p>
          <h1 className="kit-title">Your questionnaires</h1>
          <p className="kit-body">Your studio uses these to plan the day. Answers save as you go.</p>
        </div>
        <List label="Questionnaires">
          {ordered.map((response, index) => (
            <Row
              icon={isSubmitted(response.status) ? CheckCircle2 : ClipboardList}
              key={response.id}
              onClick={() => setSelectedId(response.id)}
              subtitle={
                isSubmitted(response.status)
                  ? "Sent to your studio"
                  : response.dueDate
                    ? `Due ${date(response.dueDate)}`
                    : "Ready to fill in"
              }
              title={text(response.name ?? response.templateName, `Questionnaire ${index + 1}`)}
            />
          ))}
        </List>
        <PoweredBy />
      </Main>
    );

  return (
    <QuestionnaireForm
      key={current.id}
      onBack={ordered.length > 1 ? () => setSelectedId(null) : undefined}
      onSubmitted={() => responses.refresh?.()}
      response={current}
    />
  );
}

function QuestionnaireForm({
  response,
  onBack,
  onSubmitted,
}: {
  response: ResponseRecord;
  onBack?: () => void;
  onSubmitted: () => void;
}) {
  const workspace = useWorkspace();
  const projectId = text(response.projectId, "");
  const name = text(response.name ?? response.templateName, "Planning questionnaire");
  const studioName =
    workspace.tenantName && !workspace.tenantName.startsWith("Loading") ? workspace.tenantName : "your studio";

  // Mock records carry their template; live ones are read in full below,
  // because the portal's record list leaves the template out.
  const [sections, setSections] = useState<QuestionnaireSection[]>(() =>
    dataIsLive ? legacyQuestionnaireSections : parseQuestionnaireSections(record(response.templateSnapshot).sections),
  );
  const [answers, setAnswers] = useState<Record<string, unknown>>(() => record(response.answers));
  const [provenance, setProvenance] = useState<Record<string, unknown>>({});
  const [status, setStatus] = useState(text(response.status, "in_progress"));
  const [loaded, setLoaded] = useState(!dataIsLive);
  const [index, setIndex] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [notice, setNotice] = useState<{ tone?: "danger" | "accent"; text: string } | null>(null);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const answersRef = useRef(answers);
  const changeVersion = useRef(0);
  const submitted = isSubmitted(status);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  // Read once, when the form opens. It used to re-read whenever its parent
  // re-rendered (a fresh `{}` default each time) and put the stored answers
  // back over whatever the couple had just typed.
  useEffect(() => {
    if (!dataIsLive) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "questionnaireResponses", response.id))
      .then((snapshot) => {
        if (!active || !snapshot.exists()) return;
        setSections(parseQuestionnaireSections(record(snapshot.get("templateSnapshot")).sections));
        setAnswers(record(snapshot.get("answers")));
        setProvenance(record(snapshot.get("answerProvenance")));
        setStatus(text(snapshot.get("status"), "in_progress"));
        setLoaded(true);
      })
      .catch(() => {
        if (active) setNotice({ tone: "danger", text: "Your questionnaire couldn’t be opened. Refresh to try again." });
      });
    return () => {
      active = false;
    };
  }, [response.id]);

  const visible = useMemo(() => visibleQuestionnaireSections(sections, answers), [sections, answers]);
  const requiredFields = visible.flatMap((section) => section.fields.filter((field) => field.required));
  const outstanding = outstandingRequired(requiredFields, answers);
  const reviewIndex = visible.length;
  // A condition answered one way can take a section away under the couple.
  const at = Math.min(index, reviewIndex);

  const persist = useCallback(
    async (submit: boolean) => {
      const version = changeVersion.current;
      if (submit) setSubmitting(true);
      else setSaving(true);
      try {
        // Every answer the response holds, not just the ones on screen. A
        // save of the visible ones wiped the studio's internal answers and
        // any the couple had hidden by changing a condition.
        const payload = { ...answersRef.current };
        const result = dataIsLive
          ? await sendPlanningCommand("saveQuestionnaire", {
              responseId: response.id,
              projectId,
              answers: payload,
              submit,
            })
          : { persisted: false };
        if (version === changeVersion.current) setDirty(false);
        setLastSavedAt(new Date());
        if (submit) {
          setStatus("submitted");
          setNotice(
            result.persisted
              ? null
              : { text: "Preview: your answers were checked, but nothing was sent." },
          );
          window.scrollTo({ top: 0 });
          onSubmitted();
        }
      } catch (caught: unknown) {
        const message = friendlyError(caught, "Your answers couldn’t be saved. Check your connection.");
        setNotice({ tone: "danger", text: message });
        // The studio already has it: show what they have rather than a form
        // that can no longer save.
        if (caught instanceof Error && caught.message === "QUESTIONNAIRE_ALREADY_SUBMITTED") setStatus("submitted");
      } finally {
        if (submit) setSubmitting(false);
        else setSaving(false);
      }
    },
    [onSubmitted, projectId, response.id],
  );

  // Autosave. Nothing is disabled while it runs, so the keyboard stays up.
  useEffect(() => {
    if (!dirty || !loaded || submitted || saving || submitting) return;
    const timer = window.setTimeout(() => void persist(false), 1_200);
    return () => window.clearTimeout(timer);
  }, [dirty, loaded, persist, saving, submitted, submitting]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function update(fieldId: string, value: unknown) {
    if (submitted) return;
    changeVersion.current += 1;
    setAnswers((existing) => ({ ...existing, [fieldId]: value }));
    setDirty(true);
  }

  function goTo(next: number) {
    if (dirty && !saving) void persist(false);
    setIndex(next);
    setNotice(null);
    window.scrollTo({ top: 0 });
  }

  async function uploadFile(fieldId: string, file: File | null) {
    if (!file) return;
    setUploadingField(fieldId);
    setNotice(null);
    try {
      if (!dataIsLive) {
        update(fieldId, { name: file.name });
      } else {
        if (!workspace.tenantId) throw new Error("Sign in before uploading an attachment.");
        const uploaded = await uploadClientQuestionnaireFile({
          tenantId: workspace.tenantId,
          projectId,
          responseId: response.id,
          fieldId,
          file,
        });
        update(fieldId, uploaded);
      }
    } catch (caught: unknown) {
      setNotice({ tone: "danger", text: friendlyError(caught, "That file couldn’t be uploaded.") });
    } finally {
      setUploadingField(null);
    }
  }

  const saveState = saving
    ? "Saving…"
    : dirty
      ? "Saving shortly…"
      : lastSavedAt
        ? `Saved ${lastSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
        : "Your answers save as you type.";

  const backToList = onBack ? (
    <Button icon={ArrowLeft} onClick={onBack} size="compact" variant="soft">
      All questionnaires
    </Button>
  ) : null;

  if (!loaded)
    return (
      <Main label="Questionnaire">
        {backToList}
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">Planning</p>
          <h1 className="kit-title">{name}</h1>
        </div>
        <Card>
          <p className="kit-body" role={notice ? "alert" : "status"}>
            {notice?.text ?? "Opening your questions…"}
          </p>
        </Card>
        <PoweredBy />
      </Main>
    );

  if (submitted)
    return (
      <Main label="Questionnaire">
        {backToList}
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">{name}</p>
          <h1 className="kit-title">Sent to {studioName}</h1>
          <p className="kit-body">
            {response.submittedAt ? `Sent ${date(response.submittedAt)}. ` : ""}
            Here’s what they have.
          </p>
        </div>
        {notice ? <Note tone={notice.tone}>{notice.text}</Note> : null}
        {outstanding.length ? (
          <Note tone="danger">{outstandingNotice(outstanding.map((field) => field.label))}</Note>
        ) : (
          <Note icon={CheckCircle2} tone="accent">
            Every question they asked is answered.
          </Note>
        )}
        {visible.map((section) => (
          <section aria-label={section.title} className="kit-stack-tight" key={section.id}>
            <h2 className="kit-subsection">{section.title}</h2>
            <List>
              {section.fields
                .filter((field) => field.type !== "information")
                .map((field) => (
                  <Row
                    key={field.id}
                    subtitle={spoken(answers[field.id], field.type) || "Not answered"}
                    title={field.label}
                    trailing={
                      field.required && !answerIsPresent(answers[field.id]) ? (
                        <Pill tone="danger">Still needed</Pill>
                      ) : undefined
                    }
                  />
                ))}
            </List>
          </section>
        ))}
        <Link
          className="kit-caption"
          href="/client/messages?context=Questionnaire"
          style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
        >
          <MessageCircle aria-hidden size={15} /> {`Ask ${studioName} to change an answer`}
        </Link>
        <PoweredBy />
      </Main>
    );

  if (at === reviewIndex)
    return (
      <>
        <Main label="Questionnaire">
          {backToList}
          <div className="kit-stack-tight">
            <Steps step={reviewIndex} total={reviewIndex} />
            <p className="kit-caption">Last step · review</p>
          </div>
          <div className="kit-stack-tight">
            <p className="kit-eyebrow">{name}</p>
            <h1 className="kit-title">{outstanding.length ? "Nearly there" : "Ready to send"}</h1>
            <p className="kit-body">
              {outstanding.length
                ? `${outstanding.length === 1 ? "One question needs" : `${outstanding.length} questions need`} an answer before this goes to ${studioName}.`
                : `Everything ${studioName} asked for is answered.`}
            </p>
          </div>
          {notice ? <Note tone={notice.tone}>{notice.text}</Note> : null}
          {outstanding.length ? (
            <List label="Still needed">
              {outstanding.map((field) => {
                const home = visible.findIndex((section) => section.fields.some((item) => item.id === field.id));
                return (
                  <Row
                    key={field.id}
                    onClick={() => goTo(Math.max(home, 0))}
                    subtitle={visible[home]?.title}
                    title={field.label}
                  />
                );
              })}
            </List>
          ) : (
            <Card tone="accent">
              <p className="kit-body">
                {`Once it’s sent, ${studioName} has your answers. To change one after that, just message them.`}
              </p>
            </Card>
          )}
          <PoweredBy />
        </Main>
        <Actions note={saveState}>
          <ButtonRow>
            <Button
              disabled={submitting}
              icon={ArrowLeft}
              onClick={() => goTo(reviewIndex - 1)}
              size="compact"
              variant="secondary"
            >
              Back
            </Button>
            <Button
              disabled={submitting || saving || outstanding.length > 0}
              icon={Send}
              onClick={() => void persist(true)}
            >
              {submitting ? "Sending…" : "Send answers"}
            </Button>
          </ButtonRow>
        </Actions>
      </>
    );

  const section = visible[at]!;
  return (
    <>
      <Main label="Questionnaire">
        {backToList}
        <div className="kit-stack-tight">
          <Steps step={at} total={reviewIndex} />
          <p className="kit-caption">
            Section {at + 1} of {reviewIndex}
            {response.dueDate ? ` · due ${date(response.dueDate)}` : ""}
          </p>
        </div>
        <div className="kit-stack-tight">
          <p className="kit-eyebrow">{name}</p>
          <h1 className="kit-title">{section.title}</h1>
        </div>
        {notice ? <Note tone={notice.tone}>{notice.text}</Note> : null}
        <div className="kit-stack">
          {section.fields.map((field) => (
            <Question
              answer={answers[field.id]}
              field={field}
              key={field.id}
              onChange={(value) => update(field.id, value)}
              onFile={(file) => void uploadFile(field.id, file)}
              source={text(record(provenance[field.id]).label, "")}
              uploading={uploadingField === field.id}
            />
          ))}
        </div>
        <Link className="kit-caption" href="/client/plan">
          Finish later: your answers are kept.
        </Link>
        <PoweredBy />
      </Main>
      <Actions note={saveState}>
        {at > 0 ? (
          <ButtonRow>
            <Button icon={ArrowLeft} onClick={() => goTo(at - 1)} size="compact" variant="secondary">
              Back
            </Button>
            <Button onClick={() => goTo(at + 1)}>
              {at + 1 === reviewIndex ? "Review answers" : "Next section"} <ArrowRight aria-hidden size={20} />
            </Button>
          </ButtonRow>
        ) : (
          <Button onClick={() => goTo(at + 1)}>
            {at + 1 === reviewIndex ? "Review answers" : "Next section"} <ArrowRight aria-hidden size={20} />
          </Button>
        )}
      </Actions>
    </>
  );
}

function Question({
  field,
  answer,
  source,
  uploading,
  onChange,
  onFile,
}: {
  field: QuestionnaireField;
  answer: unknown;
  source: string;
  uploading: boolean;
  onChange: (value: unknown) => void;
  onFile: (file: File | null) => void;
}) {
  const label = (
    <>
      {field.label}
      {field.required ? <span className="required-mark">Required</span> : null}
    </>
  );
  const hint = source ? `Filled in from ${source}. You can change it.` : undefined;
  const value = typeof answer === "string" ? answer : answer == null ? "" : spoken(answer);

  if (field.type === "information")
    return (
      <div className="kit-stack-tight">
        <p className="kit-subsection">{field.label}</p>
        {value ? <p className="kit-body">{value}</p> : null}
      </div>
    );

  // The studio set this one; the couple can see it, not change it.
  if (field.locked)
    return <Field hint="Set by your studio." label={field.label} readOnly value={value} />;

  if (field.type === "file")
    return (
      <div className="kit-field">
        <span className="kit-field-label">{label}</span>
        <label className="kit-button" data-variant="secondary">
          <Paperclip aria-hidden size={20} />
          {uploading ? "Uploading…" : value ? "Replace file" : "Choose a file or photo"}
          <input
            accept=".pdf,.docx,.jpg,.jpeg,.png"
            className="kit-sr"
            disabled={uploading}
            onChange={(event) => onFile(event.target.files?.[0] ?? null)}
            type="file"
          />
        </label>
        <span className="kit-hint">
          {value ? `${value} · uploaded securely` : "PDF, Word, JPG or PNG, up to 12 MB."}
        </span>
      </div>
    );

  if (["long_text", "address", "repeating_group"].includes(field.type))
    return (
      <TextArea
        hint={hint}
        label={label}
        name={field.id}
        onChange={(event) => onChange(event.target.value)}
        rows={field.type === "address" ? 3 : 5}
        value={value}
      />
    );

  if (["dropdown", "radio"].includes(field.type) && field.options.length)
    return (
      <Choices
        legend={label}
        onChange={(next) => onChange(next)}
        options={field.options.map((option) => ({ value: option, label: option }))}
        value={value || null}
      />
    );

  if (["checkbox", "acknowledgement"].includes(field.type))
    return (
      <label className="kit-check">
        <input
          checked={answer === true}
          name={field.id}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span>{label}</span>
      </label>
    );

  const inputType =
    field.type === "phone" ? "tel" : ["email", "date", "time"].includes(field.type) ? field.type : "text";
  return (
    <Field
      autoComplete={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "off"}
      hint={hint}
      inputMode={field.type === "phone" ? "tel" : field.type === "email" ? "email" : undefined}
      label={label}
      name={field.id}
      onChange={(event) => onChange(event.target.value)}
      type={inputType}
      value={value}
    />
  );
}
