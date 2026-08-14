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
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Upload,
  WandSparkles,
  Workflow,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  STUDIO_IMPORT_MAX_FILES,
  STUDIO_IMPORT_MAX_FILE_BYTES,
  studioImportAllowedExtensions,
  validateStudioImportFileCandidate,
} from "@/features/studio-import/schema";
import { StudioImportReviewWorkspace } from "@/components/ai/studio-import-review-workspace";
import {
  cancelStudioImport,
  getStudioImportReview,
  importStudioTextSource,
  retryStudioImportItem,
  uploadStudioImportFiles,
  waitForStudioImportReview,
  type StudioImportRemoteItem,
  type StudioImportReview,
  type StudioImportUploadProgress,
} from "@/lib/studio-import/command-client";

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
  file: File;
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

function kindsFromReview(review: StudioImportReview): ImportKind[] {
  const kindByAssetType: Record<string, ImportKind> = {
    message_template: "Email journey",
    contract: "Contract",
    questionnaire: "Questionnaire",
    schedule: "Schedule",
    timing_rule: "Schedule",
    package: "Package",
    proposal: "Package",
    workflow: "Workflow",
    crew_preference: "Workflow",
    coi_instruction: "Workflow",
    delivery_instruction: "Workflow",
    review_request: "Workflow",
  };
  return Array.from(
    new Set(
      review.drafts.map(
        (draft) => kindByAssetType[draft.assetType] ?? "Workflow",
      ),
    ),
  );
}

function readyDraftLabel(review: StudioImportReview) {
  const usable = review.drafts.filter(
    (draft) =>
      !["rejected", "ignored"].includes(draft.reviewDecision) &&
      !draft.validation.issues?.some(
        (issue) => issue.severity === "blocking",
      ),
  );
  const packages = usable.filter((draft) => draft.assetType === "package");
  if (packages.length) {
    return `${packages.length} package draft${packages.length === 1 ? "" : "s"} ready below`;
  }
  return `${usable.length} usable draft${usable.length === 1 ? "" : "s"} ready below`;
}

function readableSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function importStatusLabel(status: string | undefined) {
  if (!status) return null;
  if (status === "awaiting_upload") return "Waiting for secure upload";
  if (status === "quarantined") return "In private quarantine";
  if (status === "scanning") return "Running file-safety checks";
  if (status === "ready_for_analysis") return "Verified and ready for AI";
  if (status === "analyzing") return "AI is mapping reusable content";
  if (status === "review_ready") return "Drafts ready for review";
  if (status === "approved") return "Approved for activation";
  if (status === "ignored") return "Ignored";
  if (status === "rejected") return "Rejected by file safety";
  if (status === "failed") return "Import needs attention";
  if (status === "cancelled") return "Cancelled";
  return status.replaceAll("_", " ");
}

export function TemplateImportStudio({
  resumeSessionId,
}: {
  resumeSessionId?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>("files");
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [rejectedFiles, setRejectedFiles] = useState<RejectedSourceFile[]>([]);
  const [emailText, setEmailText] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [selected, setSelected] = useState<ImportKind[]>([]);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [uploadProgress, setUploadProgress] =
    useState<StudioImportUploadProgress | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [secureSourcesReady, setSecureSourcesReady] = useState(false);
  const [review, setReview] = useState<StudioImportReview | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const handleOffline = () => {
      abortRef.current?.abort();
      setBusy(false);
      setPipelineError(
        "Your internet connection was lost. Reconnect, then try the import again. Nothing was activated.",
      );
      setUploadProgress((current) =>
        current
          ? {
              ...current,
              phase: "failed",
              message: "Connection lost. Reconnect and try again.",
            }
          : current,
      );
    };
    window.addEventListener("offline", handleOffline);
    return () => window.removeEventListener("offline", handleOffline);
  }, []);

  useEffect(() => {
    if (!resumeSessionId) return;
    let active = true;
    void Promise.resolve()
      .then(() => {
        if (!active) throw new DOMException("Cancelled", "AbortError");
        setBusy(true);
        setPipelineError(null);
        return getStudioImportReview(resumeSessionId);
      })
      .then((restored) => {
        if (!active) return;
        setReview(restored);
        setSelected(kindsFromReview(restored));
        setComplete(true);
        setSecureSourcesReady(restored.sources.length > 0);
        setUploadProgress({
          phase: "ready",
          percent: 100,
          message:
            restored.session.status === "activated"
              ? "This import was activated. You can sync its approved content to the library below."
              : "Your saved import review has been restored.",
          sessionId: restored.session.id,
          items: [],
        });
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setPipelineError(
          caught instanceof Error
            ? caught.message
            : "StudioCue could not restore this import session.",
        );
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [resumeSessionId]);

  const suggestions = useMemo(() => {
    const kinds = new Set<ImportKind>(files.map((file) => file.kind));
    if (emailText.trim()) kinds.add("Email journey");
    if (websiteUrl.trim()) {
      kinds.add("Questionnaire");
      kinds.add("Package");
    }
    return Array.from(kinds);
  }, [emailText, files, websiteUrl]);
  const planKinds = review ? kindsFromReview(review) : suggestions;

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
              file,
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
    setSelected([]);
    setSecureSourcesReady(false);
    setUploadProgress(null);
    setPipelineError(null);
    setReview(null);
  }

  async function buildPlan() {
    if (navigator.onLine === false) {
      setPipelineError(
        "Your internet connection is offline. Reconnect, then try the import again. Nothing was activated.",
      );
      return;
    }
    setBusy(true);
    setComplete(false);
    setPipelineError(null);
    setSecureSourcesReady(false);
    setReview(null);
    if (sourceMode === "files" && files.length > 0) {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const result = await uploadStudioImportFiles({
          files: files.map((source) => source.file),
          signal: controller.signal,
          onProgress: setUploadProgress,
        });
        if (result.persisted) {
          if (!result.ready) {
            const failed = result.result.items.find(
              (item) => item.failure?.message,
            );
            throw new Error(
              failed?.failure?.message ??
                "One or more files did not pass safety checks.",
            );
          }
          setSecureSourcesReady(true);
          setUploadProgress({
            phase: "ready",
            percent: 100,
            message: "Files are safe. AI is creating cited drafts…",
            sessionId: result.result.session.id,
            items: result.result.items,
          });
          const importedReview = await waitForStudioImportReview({
            sessionId: result.result.session.id,
            signal: controller.signal,
            onReview: (next) =>
              setUploadProgress((current) => ({
                phase: "ready",
                percent: 100,
                message:
                  next.drafts.length > 0
                    ? `AI found ${next.drafts.length} reusable draft${
                        next.drafts.length === 1 ? "" : "s"
                      }.`
                    : "AI is classifying the verified sources…",
                sessionId: result.result.session.id,
                items: current?.items ?? result.result.items,
              })),
          });
          setReview(importedReview);
          setSelected(kindsFromReview(importedReview));
          setComplete(true);
          setBusy(false);
          abortRef.current = null;
          return;
        }
      } catch (caught: unknown) {
        const cancelled =
          caught instanceof DOMException && caught.name === "AbortError";
        setPipelineError(
          cancelled
            ? "Import cancelled. No source was activated."
            : caught instanceof Error
              ? caught.message
              : "The secure import could not be completed.",
        );
        setBusy(false);
        abortRef.current = null;
        return;
      }
    }
    if (sourceMode !== "files") {
      const controller = new AbortController();
      abortRef.current = controller;
      setUploadProgress({
        phase: "creating",
        percent: 8,
        message:
          sourceMode === "website"
            ? "Reading the public page and mapping reusable content…"
            : "Mapping your message into a reusable StudioCue draft…",
        sessionId: null,
        items: [],
      });
      try {
        const result = await importStudioTextSource({
          sourceType: sourceMode === "website" ? "website" : "email_text",
          name:
            sourceMode === "website"
              ? `Imported page · ${new URL(websiteUrl).hostname}`
              : "Imported studio email",
          ...(sourceMode === "website"
            ? { url: websiteUrl.trim() }
            : { content: emailText.trim() }),
          signal: controller.signal,
          onReview: (next) =>
            setUploadProgress({
              phase: next.drafts.length ? "ready" : "scanning",
              percent: next.drafts.length ? 100 : 72,
              message: next.drafts.length
                ? `${next.drafts.length} cited draft${next.drafts.length === 1 ? " is" : "s are"} ready for your approval.`
                : "StudioCue is extracting reusable content…",
              sessionId: next.session.id,
              items: [],
            }),
        });
        if (result.persisted) {
          setReview(result.review);
          setSelected(kindsFromReview(result.review));
          setSecureSourcesReady(true);
          setComplete(true);
          setUploadProgress({
            phase: "ready",
            percent: 100,
            message: `${result.review.drafts.length} cited draft${result.review.drafts.length === 1 ? " is" : "s are"} ready for your approval.`,
            sessionId: result.result.session.id,
            items: result.result.items,
          });
          window.requestAnimationFrame(() =>
            reviewRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            }),
          );
          return;
        }
      } catch (caught: unknown) {
        const cancelled =
          caught instanceof DOMException && caught.name === "AbortError";
        setPipelineError(
          cancelled
            ? "Import cancelled. No source was activated."
            : caught instanceof Error
              ? caught.message
              : "The source could not be imported.",
        );
        return;
      } finally {
        setBusy(false);
        abortRef.current = null;
      }
    }
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

  async function retryFile(
    source: SourceFile,
    item: StudioImportRemoteItem,
  ) {
    const sessionId = uploadProgress?.sessionId;
    if (!sessionId) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setPipelineError(null);
    try {
      const retried = await retryStudioImportItem({
        sessionId,
        itemId: item.id,
        file: source.file,
        signal: controller.signal,
        onProgress: (fraction) =>
          setUploadProgress((current) => ({
            phase: "uploading",
            percent: Math.max(4, Math.round(fraction * 70)),
            message: `Re-uploading ${source.name} to private quarantine…`,
            sessionId,
            items: current?.items ?? [],
          })),
        onSafetyProgress: (result) =>
          setUploadProgress({
            phase: "scanning",
            percent: 82,
            message: "Repeating file-signature and malware checks…",
            sessionId,
            items: result.items,
          }),
      });
      setUploadProgress({
        phase: retried.ready ? "ready" : "failed",
        percent: retried.ready ? 100 : 96,
        message: retried.ready
          ? "Every source passed file-safety checks."
          : "The source still needs attention.",
        sessionId,
        items: retried.result.items,
      });
      if (retried.ready) {
        setSecureSourcesReady(true);
        const importedReview = await waitForStudioImportReview({
          sessionId,
          signal: controller.signal,
        });
        setSelected(kindsFromReview(importedReview));
        setReview(importedReview);
        setComplete(true);
      } else {
        const failed = retried.result.items.find(
          (candidate) => candidate.failure?.message,
        );
        setPipelineError(
          failed?.failure?.message ??
            "The source still needs attention.",
        );
      }
    } catch (caught: unknown) {
      setPipelineError(
        caught instanceof Error
          ? caught.message
          : "The source could not be retried.",
      );
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function resumeImportAnalysis() {
    const sessionId = uploadProgress?.sessionId;
    if (!sessionId) {
      await buildPlan();
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setPipelineError(null);
    setUploadProgress((current) =>
      current
        ? {
            ...current,
            phase: "ready",
            percent: 100,
            message: "Checking the existing AI import…",
          }
        : current,
    );
    try {
      const importedReview = await waitForStudioImportReview({
        sessionId,
        signal: controller.signal,
        onReview: (next) =>
          setUploadProgress((current) =>
            current
              ? {
                  ...current,
                  message:
                    next.drafts.length > 0
                      ? `AI found ${next.drafts.length} reusable draft${
                          next.drafts.length === 1 ? "" : "s"
                        }.`
                      : "AI is still classifying the verified sources…",
                }
              : current,
          ),
      });
      setSelected(kindsFromReview(importedReview));
      setReview(importedReview);
      setComplete(true);
    } catch (caught: unknown) {
      setPipelineError(
        caught instanceof Error
          ? caught.message
          : "StudioCue could not resume this import.",
      );
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
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
                    setSelected([]);
                    setSecureSourcesReady(false);
                    setUploadProgress(null);
                    setPipelineError(null);
                    setReview(null);
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
                    const remoteItem = uploadProgress?.items.find(
                      (item) => item.clientId === file.id,
                    );
                    return (
                      <article key={file.id}>
                        <span className={`template-file-icon tone-${detail.tone}`}>
                          <Icon size={17} />
                        </span>
                        <span>
                          <strong>{file.name}</strong>
                          <small>
                            {readableSize(file.size)} ·{" "}
                            {importStatusLabel(remoteItem?.status) ??
                              `looks like a ${file.kind.toLowerCase()}`}
                          </small>
                        </span>
                        {remoteItem?.failure?.retryable &&
                        uploadProgress?.sessionId ? (
                          <button
                            aria-label={`Retry ${file.name}`}
                            disabled={busy}
                            onClick={() => void retryFile(file, remoteItem)}
                            title="Retry safety checks"
                            type="button"
                          >
                            <RefreshCw size={15} />
                          </button>
                        ) : (
                          <button
                            aria-label={`Remove ${file.name}`}
                            disabled={busy}
                            onClick={() => {
                              setFiles((current) =>
                                current.filter((item) => item.id !== file.id),
                              );
                              setSelected([]);
                              setSecureSourcesReady(false);
                              setUploadProgress(null);
                              setPipelineError(null);
                              setReview(null);
                            }}
                            type="button"
                          >
                            <X size={15} />
                          </button>
                        )}
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
                  setPipelineError(null);
                  setReview(null);
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
                  setPipelineError(null);
                  setReview(null);
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
            onClick={() => void buildPlan()}
            type="button"
          >
            {busy && !selected.length ? <LoaderCircle className="spin" /> : <WandSparkles />}
            {busy && uploadProgress
              ? uploadProgress.phase === "uploading"
                ? "Uploading securely…"
                : "Running safety checks…"
              : busy && !selected.length
                ? "Mapping your workflow…"
                : sourceMode === "files"
                  ? "Upload and verify sources"
                  : "Preview AI import"}
            <ArrowRight size={16} />
          </button>
          {busy && uploadProgress?.sessionId ? (
            <button
              className="template-cancel-import"
              onClick={() => {
                abortRef.current?.abort();
                void cancelStudioImport(uploadProgress.sessionId ?? "");
              }}
              type="button"
            >
              Cancel secure import
            </button>
          ) : null}
          {uploadProgress ? (
            <div
              className={`template-import-progress is-${uploadProgress.phase}`}
              role="status"
            >
              <span>
                <i style={{ width: `${uploadProgress.percent}%` }} />
              </span>
              <small>{uploadProgress.message}</small>
            </div>
          ) : null}
          {pipelineError ? (
            <div className="template-pipeline-error" role="alert">
              <CircleAlert size={15} />
              <span>{pipelineError}</span>
              <button
                disabled={busy}
                onClick={() =>
                  void (secureSourcesReady && uploadProgress?.sessionId
                    ? resumeImportAnalysis()
                    : buildPlan())
                }
                type="button"
              >
                <RefreshCw size={13} />
                {secureSourcesReady && uploadProgress?.sessionId
                  ? "Check again"
                  : "Retry"}
              </button>
            </div>
          ) : null}
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
                {planKinds.map((kind) => {
                  const detail = kindDetails[kind];
                  const Icon = detail.icon;
                  const checked = selected.includes(kind);
                  return (
                    <button
                      className={checked ? "is-selected" : ""}
                      disabled={Boolean(review)}
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
                disabled={!selected.length || busy || complete || secureSourcesReady}
                onClick={createDrafts}
                type="button"
              >
                {busy ? (
                  <LoaderCircle className="spin" />
                ) : secureSourcesReady ? (
                  <ShieldCheck />
                ) : complete ? (
                  <CheckCircle2 />
                ) : (
                  <Sparkles />
                )}
                {secureSourcesReady
                  ? review
                    ? readyDraftLabel(review)
                    : "AI is building cited drafts…"
                  : busy
                  ? "Creating drafts…"
                  : complete
                    ? `${selected.length} drafts ready to review`
                    : `Create ${selected.length} draft ${selected.length === 1 ? "template" : "templates"}`}
              </button>
              {secureSourcesReady && sourceMode === "files" ? (
                <p className="template-complete-note" role="status">
                  <ShieldCheck size={15} />
                  Files are private, signature-verified, and malware-scanned.
                  Nothing has been activated.
                </p>
              ) : null}
              {complete ? (
                <p className="template-complete-note" role="status">
                  <CheckCircle2 size={15} />
                  Your review queue is ready. Review every draft, then activate
                  the approved items in step 3.
                </p>
              ) : null}
              {review ? (
                <button
                  className="template-review-next-button"
                  onClick={() =>
                    reviewRef.current?.scrollIntoView({
                      behavior: "smooth",
                      block: "start",
                    })
                  }
                  type="button"
                >
                  Review {review.drafts.length} draft{review.drafts.length === 1 ? "" : "s"} and finish import
                  <ArrowRight size={16} />
                </button>
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
      {review ? (
        <div className="template-review-step" ref={reviewRef}>
          <div className="template-review-step-heading">
            <span>3</span>
            <div>
              <p className="eyebrow">Finish the import</p>
              <h2>Review, approve, and activate</h2>
              <p>
                Check each draft below. Approve or reject every item, then use
                the activation button to add approved content to StudioCue.
              </p>
            </div>
          </div>
          <StudioImportReviewWorkspace
            onError={setPipelineError}
            onReview={setReview}
            review={review}
          />
        </div>
      ) : null}
    </div>
  );
}
