"use client";

import {
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileCheck2,
  FileText,
  Globe2,
  LoaderCircle,
  Mail,
  MessageSquareText,
  PackageCheck,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
  Workflow,
  X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  STUDIO_IMPORT_MAX_FILES,
  STUDIO_IMPORT_MAX_FILE_BYTES,
  studioImportAllowedExtensions,
  validateStudioImportFileCandidate,
} from "@/features/studio-import/schema";

type SourceMode = "files" | "email" | "website";
type ImportKind =
  | "Email journey"
  | "Contract"
  | "Questionnaire"
  | "Schedule"
  | "Package"
  | "Workflow";

type SourceFile = {
  id: string;
  name: string;
  size: number;
  type: string;
  kind: ImportKind;
};

type RejectedSourceFile = {
  id: string;
  name: string;
  message: string;
};

const sourceModes: Array<{
  id: SourceMode;
  label: string;
  detail: string;
  icon: typeof Upload;
}> = [
  {
    id: "files",
    label: "Upload files",
    detail: "PDF, Word, text, or CSV",
    icon: Upload,
  },
  {
    id: "email",
    label: "Use an email",
    detail: "Paste a message you already send",
    icon: Mail,
  },
  {
    id: "website",
    label: "Use a page",
    detail: "Import a form or package page",
    icon: Globe2,
  },
];

const kindDetails: Record<
  ImportKind,
  { icon: typeof FileText; destination: string; tone: string }
> = {
  "Email journey": {
    icon: MessageSquareText,
    destination: "Branded email template",
    tone: "coral",
  },
  Contract: {
    icon: FileCheck2,
    destination: "Booking agreement draft",
    tone: "violet",
  },
  Questionnaire: {
    icon: FileText,
    destination: "Client questionnaire",
    tone: "gold",
  },
  Schedule: {
    icon: Workflow,
    destination: "Timeline rules & milestones",
    tone: "blue",
  },
  Package: {
    icon: PackageCheck,
    destination: "Package and pricing draft",
    tone: "mint",
  },
  Workflow: {
    icon: WandSparkles,
    destination: "End-to-end workflow",
    tone: "rose",
  },
};

function inferKind(name: string): ImportKind {
  const normalized = name.toLowerCase();
  if (/(email|message|reply|follow.?up)/.test(normalized)) return "Email journey";
  if (/(contract|agreement|terms)/.test(normalized)) return "Contract";
  if (/(question|form|intake|details)/.test(normalized)) return "Questionnaire";
  if (/(schedule|timeline|run.?of.?show|shot.?list)/.test(normalized))
    return "Schedule";
  if (/(package|pricing|rate|proposal)/.test(normalized)) return "Package";
  return "Workflow";
}

function readableSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TemplateImportStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("files");
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [rejectedFiles, setRejectedFiles] = useState<RejectedSourceFile[]>([]);
  const [emailText, setEmailText] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [selected, setSelected] = useState<ImportKind[]>([]);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [dragging, setDragging] = useState(false);

  const suggestions = useMemo(() => {
    const kinds = new Set<ImportKind>(files.map((file) => file.kind));
    if (emailText.trim()) kinds.add("Email journey");
    if (websiteUrl.trim()) {
      kinds.add("Questionnaire");
      kinds.add("Package");
    }
    return Array.from(kinds);
  }, [emailText, files, websiteUrl]);

  function addFiles(incoming: FileList | File[]) {
    const checked = Array.from(incoming).map((file) => {
      const id = `${file.name}-${file.size}-${file.lastModified}`;
      const validation = validateStudioImportFileCandidate({
        clientId: id,
        name: file.name,
        sizeBytes: file.size,
        contentType: file.type || "application/octet-stream",
        lastModifiedAt: new Date(file.lastModified).toISOString(),
      });
      return { file, id, validation };
    });
    const next = checked.flatMap(({ file, id, validation }) =>
      validation.accepted
        ? [
            {
              id,
              name: validation.candidate.name,
              size: validation.candidate.sizeBytes,
              type: validation.candidate.contentType,
              kind: inferKind(file.name),
            },
          ]
        : [],
    );
    const rejected = checked.flatMap(({ file, id, validation }) =>
      validation.accepted
        ? []
        : [{ id, name: file.name, message: validation.message }],
    );
    setFiles((current) => {
      const ids = new Set(current.map((file) => file.id));
      return [...current, ...next.filter((file) => !ids.has(file.id))].slice(
        0,
        STUDIO_IMPORT_MAX_FILES,
      );
    });
    setRejectedFiles((current) => {
      const ids = new Set(current.map((file) => file.id));
      return [
        ...current,
        ...rejected.filter((file) => !ids.has(file.id)),
      ].slice(0, STUDIO_IMPORT_MAX_FILES);
    });
    setComplete(false);
  }

  function buildPlan() {
    setBusy(true);
    setComplete(false);
    window.setTimeout(() => {
      setSelected(suggestions);
      setBusy(false);
    }, 650);
  }

  function createDrafts() {
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      setComplete(true);
    }, 700);
  }

  const hasSource =
    files.length > 0 || emailText.trim().length > 20 || websiteUrl.trim().length > 8;

  return (
    <div className="template-import-page">
      <header className="template-import-hero">
        <div>
          <p className="template-import-kicker">
            <Sparkles size={15} /> AI import studio
          </p>
          <h1>Bring your current business.<br />Leave the retyping.</h1>
          <p>
            Give StudioCue the files, messages, and pages you already use. It
            will map them to real app templates, preserve your voice, and ask
            for approval before anything goes live.
          </p>
        </div>
        <aside>
          <span><strong>5–6 hrs</strong><small>admin per wedding today</small></span>
          <ArrowRight size={18} />
          <span><strong>&lt; 1 hr</strong><small>target with one workflow</small></span>
        </aside>
      </header>

      <div className="template-import-layout">
        <section className="template-source-panel">
          <div className="template-step-heading">
            <span>1</span>
            <div>
              <p className="eyebrow">Show StudioCue what you use</p>
              <h2>Choose a source</h2>
            </div>
          </div>

          <div className="template-source-tabs" role="tablist" aria-label="Import source">
            {sourceModes.map((mode) => {
              const Icon = mode.icon;
              return (
                <button
                  aria-selected={sourceMode === mode.id}
                  className={sourceMode === mode.id ? "is-active" : ""}
                  key={mode.id}
                  onClick={() => {
                    setSourceMode(mode.id);
                    setComplete(false);
                  }}
                  role="tab"
                  type="button"
                >
                  <Icon size={18} />
                  <span><strong>{mode.label}</strong><small>{mode.detail}</small></span>
                </button>
              );
            })}
          </div>

          {sourceMode === "files" ? (
            <>
              <button
                className={`template-dropzone ${dragging ? "is-dragging" : ""}`}
                onClick={() => inputRef.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setDragging(false);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  addFiles(event.dataTransfer.files);
                }}
                type="button"
              >
                <span><Upload size={23} /></span>
                <strong>Drop your working files here</strong>
                <small>
                  Contracts, email copy, questionnaires, schedules, packages ·{" "}
                  {STUDIO_IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB each
                </small>
                <em>Browse files</em>
              </button>
              <input
                accept={studioImportAllowedExtensions
                  .map((extension) => `.${extension}`)
                  .join(",")}
                hidden
                multiple
                onChange={(event) => event.target.files && addFiles(event.target.files)}
                ref={inputRef}
                type="file"
              />
              {files.length ? (
                <div className="template-file-list">
                  {files.map((file) => {
                    const detail = kindDetails[file.kind];
                    const Icon = detail.icon;
                    return (
                      <article key={file.id}>
                        <span className={`template-file-icon tone-${detail.tone}`}>
                          <Icon size={17} />
                        </span>
                        <span>
                          <strong>{file.name}</strong>
                          <small>{readableSize(file.size)} · looks like a {file.kind.toLowerCase()}</small>
                        </span>
                        <button
                          aria-label={`Remove ${file.name}`}
                          onClick={() =>
                            setFiles((current) =>
                              current.filter((item) => item.id !== file.id),
                            )
                          }
                          type="button"
                        >
                          <X size={15} />
                        </button>
                      </article>
                    );
                  })}
                </div>
              ) : null}
              {rejectedFiles.length ? (
                <div className="template-file-errors" role="alert">
                  {rejectedFiles.map((file) => (
                    <article key={file.id}>
                      <CircleAlert size={16} />
                      <span>
                        <strong>{file.name}</strong>
                        <small>{file.message}</small>
                      </span>
                      <button
                        aria-label={`Dismiss error for ${file.name}`}
                        onClick={() =>
                          setRejectedFiles((current) =>
                            current.filter((item) => item.id !== file.id),
                          )
                        }
                        type="button"
                      >
                        <X size={15} />
                      </button>
                    </article>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}

          {sourceMode === "email" ? (
            <label className="template-paste-source">
              <span>Paste the full message</span>
              <textarea
                onChange={(event) => {
                  setEmailText(event.target.value);
                  setComplete(false);
                }}
                placeholder="Hi {{first name}}, thank you for reaching out about your wedding…"
                value={emailText}
              />
              <small>StudioCue will keep the tone and replace personal details with safe variables.</small>
            </label>
          ) : null}

          {sourceMode === "website" ? (
            <label className="template-paste-source">
              <span>Public page URL</span>
              <input
                onChange={(event) => {
                  setWebsiteUrl(event.target.value);
                  setComplete(false);
                }}
                placeholder="https://yourstudio.com/wedding-info"
                type="url"
                value={websiteUrl}
              />
              <small>Useful for existing inquiry forms, package pages, and planning questionnaires.</small>
            </label>
          ) : null}

          <button
            className="template-analyze-button"
            disabled={!hasSource || busy}
            onClick={buildPlan}
            type="button"
          >
            {busy && !selected.length ? <LoaderCircle className="spin" /> : <WandSparkles />}
            {busy && !selected.length ? "Mapping your workflow…" : "Preview AI import"}
            <ArrowRight size={16} />
          </button>
        </section>

        <section className="template-plan-panel">
          <div className="template-step-heading">
            <span>2</span>
            <div>
              <p className="eyebrow">Review before creation</p>
              <h2>Your import plan</h2>
            </div>
            <span className="template-review-badge">
              <ShieldCheck size={14} /> You approve
            </span>
          </div>

          {selected.length ? (
            <>
              <div className="template-plan-list">
                {suggestions.map((kind) => {
                  const detail = kindDetails[kind];
                  const Icon = detail.icon;
                  const checked = selected.includes(kind);
                  return (
                    <button
                      className={checked ? "is-selected" : ""}
                      key={kind}
                      onClick={() =>
                        setSelected((current) =>
                          current.includes(kind)
                            ? current.filter((item) => item !== kind)
                            : [...current, kind],
                        )
                      }
                      type="button"
                    >
                      <span className={`template-plan-icon tone-${detail.tone}`}>
                        <Icon size={18} />
                      </span>
                      <span>
                        <small>Source pattern</small>
                        <strong>{kind}</strong>
                      </span>
                      <ChevronRight size={15} />
                      <span>
                        <small>StudioCue creates</small>
                        <strong>{detail.destination}</strong>
                      </span>
                      <i>{checked ? <Check size={14} /> : null}</i>
                    </button>
                  );
                })}
              </div>

              <div className="template-ai-guard">
                <CircleAlert size={17} />
                <span>
                  <strong>Drafts only—never silent automation.</strong>
                  <small>Dates, prices, legal language, signatures, payments, and readiness still require verified records or your approval.</small>
                </span>
              </div>

              <button
                className="template-create-button"
                disabled={!selected.length || busy || complete}
                onClick={createDrafts}
                type="button"
              >
                {busy ? <LoaderCircle className="spin" /> : complete ? <CheckCircle2 /> : <Sparkles />}
                {busy
                  ? "Creating drafts…"
                  : complete
                    ? `${selected.length} drafts ready to review`
                    : `Create ${selected.length} draft ${selected.length === 1 ? "template" : "templates"}`}
              </button>
              {complete ? (
                <p className="template-complete-note" role="status">
                  <CheckCircle2 size={15} />
                  Your review queue is ready. Nothing has been activated yet.
                </p>
              ) : null}
            </>
          ) : (
            <div className="template-plan-empty">
              <span><Workflow size={25} /></span>
              <strong>Your studio, translated—not replaced.</strong>
              <p>
                Add a source on the left. StudioCue will identify reusable
                content, form fields, milestones, pricing, and follow-ups, then
                show exactly where each one belongs.
              </p>
              <ul>
                <li><Check size={14} /> Preserve your language and brand voice</li>
                <li><Check size={14} /> Connect related steps into one workflow</li>
                <li><Check size={14} /> Flag missing details and risky assumptions</li>
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
