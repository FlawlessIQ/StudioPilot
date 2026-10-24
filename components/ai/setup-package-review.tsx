"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, CheckCircle2, CircleAlert, LoaderCircle, PackageCheck } from "lucide-react";
import { refreshTenantRecords } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";
import { coverageLabel, depositLabel, priceLabel } from "@/features/setup/package-preview";
import { tradeVocab } from "@/features/trades/trades";
import { friendlyError } from "@/lib/ai/friendly-error";
import {
  activateStudioImport,
  reviewStudioImportDraft,
  type StudioImportPackagePreview,
  type StudioImportReview,
} from "@/lib/studio-import/command-client";

/** Decisions that take a draft out of the review for good. */
const SETTLED = new Set(["split", "merged", "rejected", "ignored"]);

/**
 * A draft's blocking issue that confirming it here clears: low confidence is
 * the AI asking for a person's look (review.ts sets confidence 1 on a
 * confirmed draft). Anything else needs the detailed review.
 */
const CLEARED_BY_CONFIRMING = new Set(["LOW_CONFIDENCE"]);

/**
 * Setup's "What do you charge?", finished in one place.
 *
 * After pasting a price list from setup a new studio landed in the general
 * import workspace: a review queue, the source, an editor of "Template name",
 * "Variables" and "Pricing items", "82% AI confidence", four buttons a draft
 * and a separate "Human-gated activation" — the heaviest step left in
 * onboarding (docs/onboarding-assessment-2026-10-24.md). Here each package is
 * a card saying what activation will create — its price, what holds the date,
 * what's included — read from the server's own materialisation
 * (packagePreviews). The studio unchecks anything that isn't a package and
 * adds the rest in one press; every detail stays editable on the package
 * itself afterwards, and the full workspace is one link away.
 *
 * Nothing is created until the studio presses the button: the drafts are
 * approved as the studio confirmed them, then the session is activated, both
 * through the same studio-import commands the workspace uses.
 */
export function SetupPackageReview({
  review,
  onDetailed,
  onAdded,
}: {
  review: StudioImportReview;
  /** Open the full import workspace instead. */
  onDetailed: () => void;
  /** The packages are created. */
  onAdded?: () => void;
}) {
  const trade = useWorkspace().tenantTrade;
  const drafts = new Map(review.drafts.map((draft) => [draft.id, draft]));
  const previews = (review.packagePreviews ?? []).filter((preview) => {
    const draft = drafts.get(preview.versionId);
    return draft ? !SETTLED.has(draft.reviewDecision) : false;
  });
  const needsDetail = (preview: StudioImportPackagePreview) =>
    (drafts.get(preview.versionId)?.validation.issues ?? []).some(
      (issue) => issue.severity === "blocking" && !CLEARED_BY_CONFIRMING.has(String(issue.code)),
    );
  const [leftOut, setLeftOut] = useState<Set<string>>(
    () => new Set(previews.filter(needsDetail).map((preview) => preview.versionId)),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<StudioImportPackagePreview[] | null>(
    review.session.status === "activated" ? previews : null,
  );
  const chosen = previews.filter((preview) => !leftOut.has(preview.versionId));

  async function addPackages() {
    setBusy(true);
    setError(null);
    try {
      for (const preview of chosen)
        await reviewStudioImportDraft({
          sessionId: review.session.id,
          versionId: preview.versionId,
          action: "approve",
          confirmClassification: true,
        });
      // Left out is a decision too: the detailed review shows it as one.
      for (const preview of previews.filter((candidate) => leftOut.has(candidate.versionId)))
        await reviewStudioImportDraft({
          sessionId: review.session.id,
          versionId: preview.versionId,
          action: "reject",
        });
      await activateStudioImport(review.session.id);
      refreshTenantRecords("packages");
      setAdded(chosen);
      onAdded?.();
    } catch (caught: unknown) {
      const code = caught instanceof Error ? caught.message : "";
      setError(
        code.includes("IMPORT_DRAFT_HAS_BLOCKING_ISSUES")
          ? "One of these needs a closer look before it can be added. Uncheck it, or open the detailed review."
          : friendlyError(caught, "Your packages couldn't be added just now. Nothing was created; try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  // An older functions build sends no previews: the workspace still works.
  if (!review.packagePreviews)
    return (
      <section className="panel setup-package-review">
        <p>Your price list is in. Check each package in the detailed review to add it.</p>
        <div className="setup-package-actions">
          <button className="button button-dark" onClick={onDetailed} type="button">
            Review your packages <ArrowRight size={15} />
          </button>
        </div>
      </section>
    );

  if (added)
    return (
      <section aria-live="polite" className="panel setup-package-review setup-package-done">
        <CheckCircle2 aria-hidden="true" size={26} />
        <h2>
          {added.length === 1 ? "Your package is added" : `${added.length} packages added`}
        </h2>
        <p>
          They&apos;re ready to use in {tradeVocab(trade).proposal.toLowerCase()}s. Check or change any detail —
          what&apos;s included, the deposit, travel — on the package itself.
        </p>
        <ul className="setup-package-added">
          {added.map((preview) => (
            <li key={preview.versionId}>
              <span>
                <strong>{preview.name}</strong> · {priceLabel(preview.basePriceCents, preview.currency)}
              </span>
              <Link href={`/studio/packages/${encodeURIComponent(preview.packageId)}?from=setup`}>
                Check or change
              </Link>
            </li>
          ))}
        </ul>
        <div className="setup-package-actions">
          <Link className="button button-dark" href="/studio/setup">
            Back to setup <ArrowRight size={15} />
          </Link>
        </div>
      </section>
    );

  // Drafts of another kind mean StudioCue read the text as something else,
  // which the full review can change; none means it found nothing at all.
  const otherDrafts = review.drafts.filter(
    (draft) => draft.assetType !== "package" && !SETTLED.has(draft.reviewDecision) && draft.status !== "archived",
  ).length;
  if (!previews.length)
    return (
      <section className="panel setup-package-review">
        <h2>{otherDrafts ? "That didn't read as a price list" : "No prices found in that"}</h2>
        <p>
          {otherDrafts
            ? "StudioCue found something in that, but no packages. Paste just your packages and their prices, one to a line, and draft them again — or add one by hand."
            : "Paste just your price list — each package with its price — and try again, or add a package by hand."}
        </p>
        <div className="setup-package-actions">
          <Link className="button button-dark" href="/studio/packages/new?from=setup">
            Add one by hand <ArrowRight size={15} />
          </Link>
          <button className="setup-answer-link" onClick={onDetailed} type="button">
            See everything StudioCue found
          </button>
        </div>
      </section>
    );

  return (
    <section aria-labelledby="setup-package-review-title" className="panel setup-package-review">
      <header>
        <span aria-hidden="true" className="setup-package-icon">
          <PackageCheck size={20} />
        </span>
        <div>
          <h2 id="setup-package-review-title">
            {previews.length === 1 ? "Here's the package StudioCue found" : `Here are the ${previews.length} packages StudioCue found`}
          </h2>
          <p>
            Uncheck anything that isn&apos;t a package. Nothing is added until you say so, and every
            detail can be changed afterwards.
          </p>
        </div>
      </header>
      <ul className="setup-package-list">
        {previews.map((preview) => {
          const included = !leftOut.has(preview.versionId);
          const coverage = coverageLabel(preview.includedCoverageMinutes, preview.includedCoverage);
          const deposit = depositLabel(preview.retainerRule, preview.basePriceCents, preview.currency, trade);
          const shown = preview.includedDeliverables.slice(0, 5);
          const more = preview.includedDeliverables.length - shown.length;
          return (
            <li className={included ? "setup-package-card" : "setup-package-card is-left-out"} key={preview.versionId}>
              <label className="setup-package-pick">
                <input
                  checked={included}
                  disabled={busy}
                  onChange={() =>
                    setLeftOut((current) => {
                      const next = new Set(current);
                      if (next.has(preview.versionId)) next.delete(preview.versionId);
                      else next.add(preview.versionId);
                      return next;
                    })
                  }
                  type="checkbox"
                />
                <span className="setup-package-name">{preview.name}</span>
                <span className="setup-package-price">{priceLabel(preview.basePriceCents, preview.currency)}</span>
              </label>
              {/* Unstated is shown as unstated: the package would book on
                  nothing down until the studio sets it. */}
              <p className="setup-package-meta">
                {[
                  coverage,
                  deposit ?? `${capitalised(tradeVocab(trade).deposit)} not set — add it on the package after`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {shown.length ? (
                <ul className="setup-package-includes">
                  {shown.map((line, index) => (
                    <li key={`${index}-${line}`}>{line}</li>
                  ))}
                  {more > 0 ? <li>and {more} more</li> : null}
                </ul>
              ) : null}
              {preview.addOns.length ? (
                <p className="setup-package-extras">
                  Extras:{" "}
                  {preview.addOns
                    .map((addOn) => `${addOn.name} ${priceLabel(addOn.unitPriceCents, preview.currency)}${addOn.unitLabel ? ` per ${addOn.unitLabel}` : ""}`)
                    .join(", ")}
                </p>
              ) : null}
              {needsDetail(preview) ? (
                <p className="setup-package-issue">
                  <CircleAlert size={13} /> Needs a closer look in the detailed review before it can be added.
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="setup-package-actions">
        <button className="button button-dark" disabled={busy || chosen.length === 0} onClick={() => void addPackages()} type="button">
          {busy ? <LoaderCircle className="spin" size={15} /> : null}
          {busy
            ? "Adding…"
            : chosen.length === 0
              ? "Check a package to add it"
              : chosen.length === 1
                ? "Add this package"
                : `Add these ${chosen.length} packages`}
        </button>
        <button className="setup-answer-link" disabled={busy} onClick={onDetailed} type="button">
          Review every detail instead
        </button>
      </div>
    </section>
  );
}

/** "retainer" → "Retainer". */
function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}
