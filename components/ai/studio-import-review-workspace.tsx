"use client";

import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  CircleAlert,
  Eye,
  GitMerge,
  LoaderCircle,
  Play,
  RotateCcw,
  Save,
  Scissors,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  activateStudioImport,
  getStudioImportReview,
  mergeStudioImportDrafts,
  reviewStudioImportDraft,
  simulateStudioImport,
  splitStudioImportDraft,
  type StudioImportReview,
  type StudioImportReviewDraft,
} from "@/lib/studio-import/command-client";
import { StructuredContentFields } from "@/components/ai/structured-content-fields";

const labels: Record<string, string> = {
  message_template: "Message",
  package: "Package",
  proposal: "Proposal",
  contract: "Contract",
  questionnaire: "Questionnaire",
  schedule: "Schedule",
  timing_rule: "Timing rule",
  crew_preference: "Crew preference",
  coi_instruction: "COI instruction",
  delivery_instruction: "Delivery instruction",
  review_request: "Review request",
  workflow: "Workflow",
};

type Simulation = Awaited<ReturnType<typeof simulateStudioImport>>;

function issues(draft: StudioImportReviewDraft) {
  return Array.isArray(draft.validation.issues)
    ? draft.validation.issues
    : [];
}

function draftState(draft: StudioImportReviewDraft) {
  if (draft.reviewDecision === "approved") return "Approved";
  if (draft.reviewDecision === "rejected") return "Rejected";
  if (draft.reviewDecision === "ignored") return "Ignored";
  if (issues(draft).some((issue) => issue.severity === "blocking"))
    return "Needs correction";
  return "Ready to approve";
}

function hasBlockingIssue(draft: StudioImportReviewDraft) {
  return issues(draft).some((issue) => issue.severity === "blocking");
}

function packagePrice(draft: StudioImportReviewDraft) {
  if (draft.assetType !== "package") return null;
  const raw =
    draft.structuredContent.price ??
    draft.structuredContent.packagePrice ??
    draft.structuredContent.amount;
  const cents = draft.structuredContent.amountCents;
  const amount =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.replace(/[^0-9.-]/g, ""))
        : typeof cents === "number"
          ? cents / 100
          : Number.NaN;
  if (!Number.isFinite(amount)) return null;
  const extractedCurrency = draft.structuredContent.currency;
  const currency =
    typeof extractedCurrency === "string" &&
    /^[A-Za-z]{3}$/.test(extractedCurrency)
      ? extractedCurrency.toUpperCase()
      : "USD";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function StudioImportReviewWorkspace({
  review,
  onReview,
  onError,
}: {
  review: StudioImportReview;
  onReview: (review: StudioImportReview) => void;
  onError: (message: string | null) => void;
}) {
  const visibleDrafts = useMemo(
    () =>
      review.drafts.filter(
        (draft) =>
          !["split", "merged"].includes(draft.reviewDecision) &&
          draft.status !== "archived",
      ),
    [review.drafts],
  );
  const [selectedId, setSelectedId] = useState(
    visibleDrafts[0]?.id ?? "",
  );
  const selected =
    visibleDrafts.find((draft) => draft.id === selectedId) ??
    visibleDrafts[0] ??
    null;
  const [name, setName] = useState(selected?.name ?? "");
  const [content, setContent] = useState<Record<string, unknown>>(
    selected?.structuredContent ?? {},
  );
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [simulation, setSimulation] = useState<Simulation | null>(null);
  const [librarySyncComplete, setLibrarySyncComplete] = useState(false);
  const [mergeSourceId, setMergeSourceId] = useState("");
  const draftListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setSelectedId(selected.id);
      setName(selected.name);
      setContent(selected.structuredContent);
      setMergeSourceId("");
    });
    return () => {
      active = false;
    };
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refresh() {
    const next = await getStudioImportReview(review.session.id);
    onReview(next);
    return next;
  }

  async function run(label: string, operation: () => Promise<unknown>) {
    setBusyAction(label);
    onError(null);
    try {
      await operation();
      await refresh();
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : "";
      onError(
        message.includes("DUPLICATE_IMPORT_SOURCE_ALREADY_ACTIVATED")
          ? "This exact file was already activated from another import session. No duplicate content was created."
          : message
            ? message
          : "The review action could not be completed.",
      );
    } finally {
      setBusyAction(null);
    }
  }

  const pending = visibleDrafts.filter(
    (draft) => draft.reviewDecision === "pending",
  ).length;
  const approved = visibleDrafts.filter(
    (draft) => draft.reviewDecision === "approved",
  ).length;
  const decided = visibleDrafts.length - pending;
  const selectedIndex = visibleDrafts.findIndex(
    (draft) => draft.id === selected?.id,
  );
  const nextPendingDraft = [
    ...visibleDrafts.slice(selectedIndex + 1),
    ...visibleDrafts.slice(0, Math.max(selectedIndex + 1, 0)),
  ].find((draft) => draft.reviewDecision === "pending");
  const blockedDrafts = visibleDrafts.filter(hasBlockingIssue);
  const usableDrafts = visibleDrafts.filter(
    (draft) =>
      !hasBlockingIssue(draft) &&
      !["rejected", "ignored"].includes(draft.reviewDecision),
  );
  const usablePackages = usableDrafts.filter(
    (draft) => draft.assetType === "package",
  );
  const contractDrafts = usableDrafts.filter(
    (draft) => draft.assetType === "contract",
  );
  const duplicateSources = review.sources.filter((source) => source.duplicate);
  const duplicateActivationBlocked = duplicateSources.some(
    (source) => source.duplicate?.activationBlocked === true,
  );
  const mergeCandidates = selected
    ? visibleDrafts.filter(
        (draft) =>
          draft.id !== selected.id &&
          draft.assetType === selected.assetType &&
          draft.reviewDecision === "pending",
      )
    : [];
  const hasApprovedPackages = visibleDrafts.some(
    (draft) => draft.assetType === "package" && draft.reviewDecision === "approved",
  );
  const hasApprovedQuestionnaires = visibleDrafts.some(
    (draft) =>
      draft.assetType === "questionnaire" && draft.reviewDecision === "approved",
  );

  function selectDraftAndReveal(draftId: string) {
    setSelectedId(draftId);
    requestAnimationFrame(() => {
      const draftButton = Array.from(
        draftListRef.current?.querySelectorAll<HTMLElement>("[data-draft-id]") ??
          [],
      ).find((element) => element.dataset.draftId === draftId);
      draftButton?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  if (!selected) {
    return (
      <div className="studio-import-review-empty">
        <CircleAlert size={22} />
        <strong>No reviewable drafts were extracted.</strong>
        <p>Check the source errors or retry the analysis before activation.</p>
      </div>
    );
  }

  return (
    <div className="studio-import-review">
      <div className="studio-import-review-summary">
        <div>
          <span><Sparkles size={15} /> AI review workspace</span>
          <strong>
            {usablePackages.length
              ? `${usablePackages.length} package${usablePackages.length === 1 ? "" : "s"} ready to review`
              : `${usableDrafts.length} usable draft${usableDrafts.length === 1 ? "" : "s"} ready`}
          </strong>
          <small>
            {contractDrafts.length
              ? `${contractDrafts.length} contract${contractDrafts.length === 1 ? "" : "s"} requires review · `
              : ""}
            {blockedDrafts.length
              ? `${blockedDrafts.length} blocked item${blockedDrafts.length === 1 ? "" : "s"} excluded · `
              : ""}
            {approved} approved · nothing is live
          </small>
        </div>
        <div className="studio-import-coverage">
          <span>
            <strong>{review.coverage.percent}%</strong>
            <small>potential draft coverage</small>
          </span>
          {review.coverage.sections.map((section) => (
            <i
              className={section.complete ? "is-complete" : ""}
              key={section.key}
              title={`${section.label}: ${
                section.complete ? "covered" : "gap"
              }`}
            />
          ))}
        </div>
      </div>

      <div
        className={`studio-import-review-grid${selected.assetType === "contract" ? " is-contract" : ""}`}
      >
        <aside className="studio-import-draft-nav" aria-label="Extracted drafts">
          <div className="studio-import-draft-nav-heading">
            <span>
              <strong>Review queue</strong>
              <small>{decided} of {visibleDrafts.length} decided</small>
            </span>
            <b className={pending > 0 ? "has-pending" : ""}>
              {pending > 0 ? `${pending} left` : "Complete"}
            </b>
            <progress
              aria-label={`${decided} of ${visibleDrafts.length} drafts decided`}
              max={visibleDrafts.length}
              value={decided}
            />
          </div>
          <div className="studio-import-draft-list" ref={draftListRef}>
            {visibleDrafts.map((draft, index) => (
              <button
                aria-current={draft.id === selected.id ? "true" : undefined}
                aria-label={`Draft ${index + 1} of ${visibleDrafts.length}: ${draft.name}, ${draftState(draft)}`}
                className={draft.id === selected.id ? "is-active" : ""}
                data-draft-id={draft.id}
                key={draft.id}
                onClick={() => selectDraftAndReveal(draft.id)}
                type="button"
              >
                <span>
                  {draft.reviewDecision === "approved" ? (
                    <CheckCircle2 size={15} />
                  ) : hasBlockingIssue(draft) ? (
                    <AlertTriangle size={15} />
                  ) : (
                    <Eye size={15} />
                  )}
                </span>
                <span>
                  <small>
                    {index + 1} · {labels[draft.assetType] ?? draft.assetType}
                  </small>
                  <strong>{draft.name}</strong>
                  <span className="studio-import-draft-meta">
                    <em>{draftState(draft)}</em>
                    {packagePrice(draft) ? <b>{packagePrice(draft)}</b> : null}
                  </span>
                </span>
              </button>
            ))}
          </div>
          <div className="studio-import-draft-nav-footer" role="status">
            {nextPendingDraft ? (
              <>
                <span>
                  <strong>{pending} draft{pending === 1 ? "" : "s"} still need a decision</strong>
                  <small>Approve, reject, or ignore each one.</small>
                </span>
                <button
                  onClick={() => selectDraftAndReveal(nextPendingDraft.id)}
                  type="button"
                >
                  Review next undecided
                </button>
              </>
            ) : (
              <span className="is-complete">
                <CheckCircle2 size={16} />
                <strong>All {visibleDrafts.length} drafts reviewed</strong>
              </span>
            )}
          </div>
        </aside>

        <section className="studio-import-source-proof">
          <p className="eyebrow">Original source</p>
          <h3>What the AI used</h3>
          {selected.sourceCitations.length ? (
            selected.sourceCitations.map((citation, index) => (
              <blockquote key={`${citation.locator}-${index}`}>
                <small>{citation.locator ?? `Source ${index + 1}`}</small>
                <p>{citation.excerpt ?? "Source excerpt retained by hash."}</p>
                <span>
                  <ShieldCheck size={13} /> Traceable to the uploaded file
                </span>
              </blockquote>
            ))
          ) : (
            <div className="studio-import-missing-proof">
              <CircleAlert size={16} />
              Missing citation—activation is blocked.
            </div>
          )}
          {review.sources
            .filter((source) => selected.sourceItemIds.includes(source.id))
            .map((source) => (
              <div className="studio-import-source-file" key={source.id}>
                <strong>{source.name}</strong>
                <small>{source.status.replaceAll("_", " ")}</small>
                {source.duplicate ? (
                  <span className="is-duplicate">
                    <ArrowLeftRight size={13} /> Exact file already imported
                    {source.duplicate.activationBlocked === true
                      ? " and activated"
                      : " — only one session can be activated"}
                  </span>
                ) : null}
              </div>
            ))}
        </section>

        <section
          className={`studio-import-draft-editor${selected.assetType === "contract" ? " is-contract" : ""}`}
        >
          <div className="studio-import-editor-heading">
            <div>
              <p className="eyebrow">StudioCue draft</p>
              <h3>Edit before approval</h3>
            </div>
            <span>{Math.round(selected.confidence * 100)}% AI confidence</span>
          </div>
          <label>
            <span>Template name</span>
            <input
              disabled={selected.reviewDecision === "approved"}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          <div className="studio-import-friendly-fields">
            <span>Extracted details</span>
            <StructuredContentFields
              disabled={selected.reviewDecision === "approved"}
              onChange={setContent}
              value={content}
            />
          </div>
          {issues(selected).length ? (
            <div className="studio-import-validation">
              {issues(selected).map((issue) => (
                <p className={`is-${issue.severity}`} key={issue.code}>
                  {issue.severity === "blocking" ? (
                    <CircleAlert size={14} />
                  ) : (
                    <AlertTriangle size={14} />
                  )}
                  <span>{issue.message}</span>
                </p>
              ))}
            </div>
          ) : (
            <p className="studio-import-validation-passed">
              <Check size={14} /> Checks passed
            </p>
          )}

          <div className="studio-import-editor-actions">
            <button
              disabled={Boolean(busyAction) || selected.reviewDecision === "approved"}
              onClick={() =>
                void run("save", () =>
                  reviewStudioImportDraft({
                    sessionId: review.session.id,
                    versionId: selected.id,
                    action: "update",
                    name,
                    assetType: selected.assetType,
                    structuredContent: content,
                    confirmClassification: true,
                  }),
                )
              }
              type="button"
            >
              {busyAction === "save" ? (
                <LoaderCircle className="spin" />
              ) : (
                <Save />
              )}
              Save & confirm
            </button>
            <button
              className="is-approve"
              disabled={
                Boolean(busyAction) ||
                selected.reviewDecision === "approved" ||
                selected.validation.status !== "passed"
              }
              onClick={() =>
                void run("approve", () =>
                  reviewStudioImportDraft({
                    sessionId: review.session.id,
                    versionId: selected.id,
                    action: "approve",
                  }),
                )
              }
              type="button"
            >
              {busyAction === "approve" ? (
                <LoaderCircle className="spin" />
              ) : (
                <Check />
              )}
              Approve
            </button>
            <button
              disabled={Boolean(busyAction)}
              onClick={() =>
                void run("reject", () =>
                  reviewStudioImportDraft({
                    sessionId: review.session.id,
                    versionId: selected.id,
                    action: "reject",
                  }),
                )
              }
              type="button"
            >
              <X /> Reject
            </button>
          </div>

          <details className="studio-import-advanced-review">
            <summary>Split, merge, or ignore this draft</summary>
            <div>
              <button
                disabled={
                  Boolean(busyAction) ||
                  Object.keys(selected.structuredContent).length < 2
                }
                onClick={() => {
                  const entries = Object.entries(content);
                  const pivot = Math.ceil(entries.length / 2);
                  void run("split", () =>
                    splitStudioImportDraft({
                      sessionId: review.session.id,
                      versionId: selected.id,
                      parts: [
                        {
                          name: `${selected.name} · Part 1`,
                          assetType: selected.assetType,
                          structuredContent: Object.fromEntries(
                            entries.slice(0, pivot),
                          ),
                        },
                        {
                          name: `${selected.name} · Part 2`,
                          assetType: selected.assetType,
                          structuredContent: Object.fromEntries(
                            entries.slice(pivot),
                          ),
                        },
                      ],
                    }),
                  );
                }}
                type="button"
              >
                <Scissors /> Split by sections
              </button>
              {mergeCandidates.length ? (
                <span className="studio-import-merge-control">
                  <select
                    aria-label="Draft to merge into this draft"
                    onChange={(event) => setMergeSourceId(event.target.value)}
                    value={mergeSourceId}
                  >
                    <option value="">Choose matching draft…</option>
                    {mergeCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={Boolean(busyAction) || !mergeSourceId}
                    onClick={() =>
                      void run("merge", () =>
                        mergeStudioImportDrafts({
                          sessionId: review.session.id,
                          targetVersionId: selected.id,
                          sourceVersionId: mergeSourceId,
                        }),
                      )
                    }
                    type="button"
                  >
                    <GitMerge /> Merge
                  </button>
                </span>
              ) : null}
              <button
                disabled={Boolean(busyAction)}
                onClick={() =>
                  void run("ignore", () =>
                    reviewStudioImportDraft({
                      sessionId: review.session.id,
                      versionId: selected.id,
                      action: "ignore",
                    }),
                  )
                }
                type="button"
              >
                <RotateCcw /> Ignore source
              </button>
            </div>
          </details>
        </section>
      </div>

      <div className="studio-import-release-bar">
        <div>
          <strong>Human-gated activation</strong>
          <small>
            {review.session.status === "activated"
              ? "This import is activated. Sync once to repair or confirm its native Library records."
              : duplicateActivationBlocked
                ? "This exact source was activated from an earlier import session. This session cannot be activated again."
              : pending > 0
                ? `Review ${pending} remaining draft${pending === 1 ? "" : "s"}. Approve, reject, or ignore each one to unlock activation.`
                : approved === 0
                  ? "Approve at least one draft to finish this import."
                  : `${approved} approved draft${approved === 1 ? " is" : "s are"} ready to activate. Provider actions will not run.`}
          </small>
        </div>
        <button
          disabled={Boolean(busyAction)}
          onClick={() =>
            void run("simulate", async () => {
              setSimulation(await simulateStudioImport(review.session.id));
            })
          }
          type="button"
        >
          <Play /> Simulate a wedding
        </button>
        <button
          className="is-activate"
          disabled={
            Boolean(busyAction) ||
            librarySyncComplete ||
            (review.session.status !== "activated" &&
              (approved === 0 || pending > 0 || duplicateActivationBlocked))
          }
          onClick={() =>
            void run("activate", async () => {
              await activateStudioImport(review.session.id);
              setLibrarySyncComplete(true);
            })
          }
          type="button"
        >
          {busyAction === "activate" ? (
            <LoaderCircle className="spin" />
          ) : librarySyncComplete ? (
            <CheckCircle2 />
          ) : (
            <ShieldCheck />
          )}
          {review.session.status === "activated"
            ? librarySyncComplete
              ? "Library synced"
              : "Sync to library"
            : `Activate ${approved} approved`}
        </button>
      </div>
      {review.session.status === "activated" ? (
        <div className="studio-import-native-links" role="status">
          <div>
            <strong>Your approved content is now native StudioCue data.</strong>
            <small>
              Questionnaires and timing rules are active. Imported messages
              are ready for one-click activation; approved delivery and review
              instructions are saved as studio defaults.
            </small>
          </div>
          {hasApprovedPackages ? <Link href="/studio/packages">View packages</Link> : null}
          {hasApprovedQuestionnaires ? (
            <Link href="/studio/questionnaires">View questionnaires</Link>
          ) : null}
          <Link href="/studio/messages">Review messages</Link>
          <Link href="/studio/library">Open studio library</Link>
        </div>
      ) : null}

      {simulation ? (
        <div className="studio-import-simulation" role="dialog">
          <div>
            <span>
              <Sparkles size={15} /> Safe simulation
            </span>
            <strong>{simulation.scenario}</strong>
            <small>No messages, payments, signatures, or provider actions ran.</small>
          </div>
          <ol>
            {simulation.steps.map((step) => (
              <li className={`is-${step.status}`} key={step.stage}>
                <span>{step.stage}</span>
                <strong>{step.outcome}</strong>
                <small>
                  {step.status === "configured" ? "Configured" : "Coverage gap"}
                </small>
              </li>
            ))}
          </ol>
          <button onClick={() => setSimulation(null)} type="button">
            Close simulation
          </button>
        </div>
      ) : null}
    </div>
  );
}
