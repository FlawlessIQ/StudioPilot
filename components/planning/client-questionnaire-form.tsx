"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { CheckCircle2, Save, Send, ShieldCheck } from "lucide-react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { sendPlanningCommand } from "@/lib/planning/command-client";
import { getFirebaseClient } from "@/lib/firebase/client";
import { dataIsLive } from "@/lib/runtime-mode";
import { uploadClientQuestionnaireFile } from "@/lib/client/questionnaire-upload";
import { friendlyError } from "@/lib/ai/friendly-error";

type Field = {
  id: string;
  label: string;
  type: string;
  required: boolean;
  locked: boolean;
  internalOnly: boolean;
  options: string[];
  conditionalOn: { fieldId: string; equals: unknown } | null;
};
type Section = { id: string; title: string; fields: Field[] };
type Context = { projectId: string; responseId: string };

const record = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const legacySections: Section[] = [
  {
    id: "planning",
    title: "Project details",
    fields: [
      {
        id: "planner",
        label: "Planner",
        type: "contact",
        required: false,
        locked: false,
        internalOnly: false,
        options: [],
        conditionalOn: null,
      },
      {
        id: "ceremonyTime",
        label: "Ceremony time",
        type: "time",
        required: true,
        locked: false,
        internalOnly: false,
        options: [],
        conditionalOn: null,
      },
      {
        id: "familyPhotoList",
        label: "Family photo list",
        type: "long_text",
        required: true,
        locked: false,
        internalOnly: false,
        options: [],
        conditionalOn: null,
      },
      {
        id: "accessibilityNeeds",
        label: "Accessibility needs",
        type: "long_text",
        required: false,
        locked: false,
        internalOnly: false,
        options: [],
        conditionalOn: null,
      },
    ],
  },
];

function parseSections(value: unknown): Section[] {
  if (!Array.isArray(value)) return legacySections;
  return value.flatMap((sectionValue) => {
    const section = record(sectionValue);
    if (!Array.isArray(section.fields)) return [];
    return [
      {
        id: String(section.id ?? crypto.randomUUID()),
        title: String(section.title ?? "Project details"),
        fields: section.fields.map((fieldValue) => {
          const field = record(fieldValue);
          return {
            id: String(field.id),
            label: String(field.label),
            type: String(field.type ?? "text"),
            required: field.required === true,
            locked: field.locked === true,
            internalOnly: field.internalOnly === true,
            options: Array.isArray(field.options)
              ? field.options.map(String)
              : [],
            conditionalOn: field.conditionalOn
              ? {
                  fieldId: String(record(field.conditionalOn).fieldId),
                  equals: record(field.conditionalOn).equals,
                }
              : null,
          };
        }),
      },
    ];
  });
}

export function ClientQuestionnaireForm({
  tenantId,
  projectId: assignedProjectId,
  responseId: assignedResponseId,
  initialAnswers = {},
  status = "in_progress",
}: {
  tenantId?: string;
  projectId?: string;
  responseId?: string;
  initialAnswers?: Record<string, unknown>;
  status?: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [context, setContext] = useState<Context | null>(
    assignedProjectId && assignedResponseId
      ? { projectId: assignedProjectId, responseId: assignedResponseId }
      : dataIsLive
        ? null
        : {
            projectId: "wedding-booked",
            responseId: "wedding-booked-planning",
          },
  );
  const [sections, setSections] = useState<Section[]>(legacySections);
  const [answers, setAnswers] =
    useState<Record<string, unknown>>(initialAnswers);
  const [provenance, setProvenance] = useState<Record<string, unknown>>({});
  const [loaded, setLoaded] = useState(!dataIsLive);
  const [dirty, setDirty] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const changeVersion = useRef(0);
  const submitted = status === "submitted";

  useEffect(() => {
    if (!dataIsLive || context) return;
    let active = true;
    void (async () => {
      const { auth, firestore } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) return;
      const memberships = await getDocs(
        query(
          collection(firestore, "memberships"),
          where("userId", "==", user.uid),
          where("status", "==", "active"),
          limit(1),
        ),
      );
      const membership = memberships.docs[0]?.data();
      const tenantId = membership?.tenantId;
      const projectId = Array.isArray(membership?.projectIds)
        ? membership.projectIds[0]
        : null;
      if (typeof tenantId !== "string" || typeof projectId !== "string") return;
      const responses = await getDocs(
        query(
          collection(firestore, "questionnaireResponses"),
          where("tenantId", "==", tenantId),
          where("projectId", "==", projectId),
          limit(1),
        ),
      );
      const responseId = responses.docs[0]?.id;
      if (active && responseId) setContext({ projectId, responseId });
    })().catch(() => setNotice("Questionnaire context could not be loaded."));
    return () => {
      active = false;
    };
  }, [context]);

  useEffect(() => {
    if (!dataIsLive || !context) return;
    let active = true;
    const { firestore } = getFirebaseClient();
    void getDoc(doc(firestore, "questionnaireResponses", context.responseId))
      .then((snapshot) => {
        if (!active || !snapshot.exists()) return;
        const templateSnapshot = record(snapshot.get("templateSnapshot"));
        setSections(parseSections(templateSnapshot.sections));
        setAnswers({
          ...initialAnswers,
          ...record(snapshot.get("answers")),
        });
        setProvenance(record(snapshot.get("answerProvenance")));
        setLoaded(true);
      })
      .catch(() =>
        setNotice("The assigned questionnaire could not be loaded."),
      );
    return () => {
      active = false;
    };
  }, [context, initialAnswers]);

  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          fields: section.fields.filter(
            (field) =>
              !field.internalOnly &&
              (!field.conditionalOn ||
                JSON.stringify(answers[field.conditionalOn.fieldId]) ===
                  JSON.stringify(field.conditionalOn.equals)),
          ),
        }))
        .filter((section) => section.fields.length),
    [answers, sections],
  );
  const requiredFields = visibleSections.flatMap((section) =>
    section.fields.filter((field) => field.required),
  );
  const completedRequired = requiredFields.filter((field) => {
    const value = answers[field.id];
    return Array.isArray(value)
      ? value.length > 0
      : typeof value === "boolean"
        ? value
        : String(value ?? "").trim().length > 0;
  }).length;
  const completionPercent = requiredFields.length
    ? Math.round((completedRequired / requiredFields.length) * 100)
    : 100;

  function update(fieldId: string, value: unknown) {
    if (submitted) return;
    changeVersion.current += 1;
    setAnswers((current) => ({ ...current, [fieldId]: value }));
    setDirty(true);
  }

  const visibleAnswers = useMemo(() => {
    const visibleIds = new Set(
      visibleSections.flatMap((section) =>
        section.fields.map((field) => field.id),
      ),
    );
    return Object.fromEntries(
      Object.entries(answers).filter(([fieldId]) => visibleIds.has(fieldId)),
    );
  }, [answers, visibleSections]);

  const persist = useCallback(async (submitResponse: boolean, quiet = false) => {
    const savedVersion = changeVersion.current;
    if (quiet) setAutoSaving(true);
    else setBusy(true);
    if (!quiet) setNotice(null);
    try {
      if (!context) throw new Error("No questionnaire is assigned.");
      if (submitResponse && completionPercent < 100)
        throw new Error("Complete each visible required question first.");
      const response = await sendPlanningCommand("saveQuestionnaire", {
        responseId: context.responseId,
        projectId: context.projectId,
        answers: visibleAnswers,
        submit: submitResponse,
      });
      if (savedVersion === changeVersion.current) setDirty(false);
      setLastSavedAt(new Date());
      setNotice(
        response.persisted
          ? submitResponse
            ? "Questionnaire submitted for studio review."
            : quiet
              ? null
              : "Draft saved securely."
          : `Development preview: ${submitResponse ? "submission" : "draft"} validated, but no answers were persisted.`,
      );
    } catch (caught: unknown) {
      setNotice(
        friendlyError(caught, "Questionnaire could not be saved."),
      );
    } finally {
      if (quiet) setAutoSaving(false);
      else setBusy(false);
    }
  }, [completionPercent, context, visibleAnswers]);

  useEffect(() => {
    if (!dirty || !loaded || !context || submitted || busy || autoSaving) return;
    const timer = window.setTimeout(() => void persist(false, true), 1_200);
    return () => window.clearTimeout(timer);
  }, [autoSaving, busy, context, dirty, loaded, persist, submitted]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  async function uploadFile(fieldId: string, file: File | null) {
    if (!file || !tenantId || !context) return;
    setUploadingField(fieldId);
    setNotice(null);
    try {
      const uploaded = await uploadClientQuestionnaireFile({
        tenantId,
        projectId: context.projectId,
        responseId: context.responseId,
        fieldId,
        file,
      });
      update(fieldId, uploaded);
      setNotice(`${file.name} uploaded securely and is being scanned.`);
    } catch (caught: unknown) {
      setNotice(friendlyError(caught, "Attachment upload failed."));
    } finally {
      setUploadingField(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void persist(false);
  }

  return (
    <form className="planning-form-preview" onSubmit={submit}>
      <header className="questionnaire-progress">
        <span>
          <strong>{completionPercent}% complete</strong>
          <small>
            {submitted
              ? "Submitted to your studio"
              : autoSaving
                ? "Saving changes…"
                : dirty
                  ? "Changes waiting to save"
                  : lastSavedAt
                    ? `Saved at ${lastSavedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                    : "Your answers save automatically into this project"}
          </small>
        </span>
        <i aria-hidden="true">
          <b style={{ width: `${completionPercent}%` }} />
        </i>
      </header>
      {!loaded ? <p>Loading your planning questions…</p> : null}
      {visibleSections.map((section) => (
        <fieldset className="client-questionnaire-section" key={section.id}>
          <legend>{section.title}</legend>
          {section.fields.map((field) => {
            const source = record(provenance[field.id]);
            const sourceLabel = String(source.label ?? "");
            const common = {
              disabled: busy || autoSaving || field.locked || submitted,
              name: field.id,
              required: field.required,
            };
            return (
              <label key={field.id}>
                <span>
                  {field.label}
                  {field.required ? <em>Required</em> : null}
                </span>
                {field.type === "information" ? (
                  <p>{String(answers[field.id] ?? "")}</p>
                ) : field.type === "file" ? (
                  <span className="client-questionnaire-upload">
                    <input
                      {...common}
                      accept=".pdf,.docx,.jpg,.jpeg,.png"
                      onChange={(event) =>
                        void uploadFile(field.id, event.target.files?.[0] ?? null)
                      }
                      type="file"
                    />
                    {record(answers[field.id]).name ? (
                      <small>
                        <CheckCircle2 size={13} /> {String(record(answers[field.id]).name)} uploaded
                      </small>
                    ) : null}
                    {uploadingField === field.id ? <small>Uploading securely…</small> : null}
                  </span>
                ) : field.type === "long_text" ||
                  field.type === "address" ||
                  field.type === "repeating_group" ? (
                  <textarea
                    {...common}
                    onChange={(event) => update(field.id, event.target.value)}
                    value={String(answers[field.id] ?? "")}
                  />
                ) : ["dropdown", "radio"].includes(field.type) ? (
                  <select
                    {...common}
                    onChange={(event) => update(field.id, event.target.value)}
                    value={String(answers[field.id] ?? "")}
                  >
                    <option value="">Choose…</option>
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : ["checkbox", "acknowledgement"].includes(field.type) ? (
                  <input
                    {...common}
                    checked={answers[field.id] === true}
                    onChange={(event) => update(field.id, event.target.checked)}
                    type="checkbox"
                  />
                ) : (
                  <input
                    {...common}
                    onChange={(event) => update(field.id, event.target.value)}
                    type={
                      ["email", "phone", "date", "time"].includes(
                        field.type,
                      )
                        ? field.type === "phone"
                          ? "tel"
                          : field.type
                        : "text"
                    }
                    value={String(answers[field.id] ?? "")}
                  />
                )}
                {sourceLabel ? (
                  <small className="answer-provenance">
                    <ShieldCheck size={13} /> Prefilled from {sourceLabel}. You
                    can correct it here.
                  </small>
                ) : null}
              </label>
            );
          })}
        </fieldset>
      ))}
      <div className="questionnaire-actions">
        {submitted ? (
          <p className="form-notice">
            <CheckCircle2 size={16} /> Submitted. Message your studio if an answer needs to be reopened.
          </p>
        ) : null}
        <button
          className="button button-light"
          disabled={busy || autoSaving || submitted || !dirty}
          type="submit"
        >
          <Save size={16} /> Save draft
        </button>
        <button
          className="button button-dark"
          disabled={busy || autoSaving || submitted || completionPercent < 100}
          onClick={() => void persist(true)}
          type="button"
        >
          {completionPercent === 100 ? (
            <CheckCircle2 size={16} />
          ) : (
            <Send size={16} />
          )}
          Submit questionnaire
        </button>
      </div>
      {notice ? (
        <p className="form-notice" role="status">
          {notice}
        </p>
      ) : null}
    </form>
  );
}
