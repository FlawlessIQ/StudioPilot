"use client";

import { InquiryFormEditor } from "@/components/intake/inquiry-form-editor";
import {
  JOB_KIND_LABELS,
  JOB_KINDS,
  journeyProfile,
  PAYMENT_SHAPE_LABELS,
  vocab,
} from "@/features/job-kinds/job-kinds";

/**
 * Settings → Job types (docs/job-types-plan-2026-10-02.md).
 *
 * The studio's own types, and what each kind of work does by default. A
 * family session books on payment alone with no agreement; a sports day
 * books on its date and is paid on the day; a wedding keeps the agreement,
 * the retainer and the final details. Shown so a studio can see why a job
 * behaves as it does — the kind decides, and the package's "How it's paid"
 * can change the payment.
 */
export function JobTypesSettings() {
  return (
    <div className="job-types-settings">
      <InquiryFormEditor typesOnly />
      <section aria-labelledby="job-kinds-guide-title" className="panel job-kinds-guide">
        <p className="eyebrow">What each kind does</p>
        <h2 id="job-kinds-guide-title">The same journey, sized to the work</h2>
        <p>
          Every job runs through the same steps. Its kind decides which apply, when, and the words
          your client reads. How a job is paid can be changed on its package.
        </p>
        <ul>
          {JOB_KINDS.map((kind) => {
            const profile = journeyProfile(kind);
            return (
              <li key={kind}>
                <strong>{JOB_KIND_LABELS[kind]}</strong>
                <span>
                  {[
                    profile.agreement ? "Agreement to book" : "No agreement",
                    PAYMENT_SHAPE_LABELS[profile.payment],
                    profile.consultation ? "Consultation offered" : "No consultation",
                    profile.detailsFormDaysBefore
                      ? `${vocab(kind).detailsForm} ${
                          profile.detailsFormDaysBefore >= 60
                            ? `${Math.round(profile.detailsFormDaysBefore / 30)} months`
                            : `${Math.round(profile.detailsFormDaysBefore / 7)} weeks`
                        } before`
                      : null,
                    profile.finalDetailsLock ? "Final details locked before the day" : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
