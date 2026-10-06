import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { planCards } from "@/config/saas-plans";
import {
  ASSISTANT_WAGE,
  CUE_DUTIES,
  CUE_NEVER,
  DUTY_AREAS,
  SATURDAY_LOG,
  assistantHoursFor,
  type CueDuty,
  type DutyMode,
} from "@/features/marketing/cue-duties";

const SHEET_TAGS: Record<DutyMode, { className: string; label: string }> = {
  on_its_own: { className: "mk-sheet-tag", label: "on its own" },
  you_approve: { className: "mk-sheet-tag mk-sheet-tag--approve", label: "you approve" },
};

export const metadata: Metadata = {
  title: "Cue's job description · one page",
  robots: { index: false, follow: false },
};

/**
 * Cue's job description on one printed page, for Gabe to hand to other
 * vendors (docs/positioning-office-manager-plan-2026-10-06.md → Outbound).
 * Print it from the browser, or `npx tsx scripts/marketing/one-pager.ts` for
 * the PDF. Every duty, the Saturday lines and the wage come from
 * features/marketing/cue-duties.ts, so the sheet can't promise more than the
 * site, which the claims tests hold to the code. Not in the sitemap; noindex.
 */
export default function OnePager() {
  const duties: ReadonlyArray<CueDuty> = CUE_DUTIES;
  const price = planCards[0];
  return (
    <div className="ds-root marketing-page mk-sheet" data-ds-theme="emerald">
      <header className="mk-sheet-head">
        <Logo />
        <span>studio-cue.com</span>
      </header>
      <h1>Meet Cue, your studio&rsquo;s office manager.</h1>
      <p className="mk-sheet-lede">
        Cue answers new inquiries, sends the paperwork, chases the insurance certificate, lines up your crew and keeps
        your clients on schedule, at any hour. Anything that matters waits for your yes.
      </p>

      <dl className="mk-sheet-meta">
        <div>
          <dt>Position</dt>
          <dd>Office manager</dd>
        </div>
        <div>
          <dt>Hours</dt>
          <dd>All of them</dd>
        </div>
        <div>
          <dt>Reports to</dt>
          <dd>You</dd>
        </div>
        <div>
          <dt>Costs</dt>
          <dd>{`${price.monthly} a month`}</dd>
        </div>
      </dl>

      <section className="mk-sheet-duties" aria-label="Duties">
        {DUTY_AREAS.map((area) => (
          <div key={area.id}>
            <h2>{area.title}</h2>
            <ul>
              {duties
                .filter((duty) => duty.area === area.id)
                .map((duty) => (
                  <li key={duty.id}>
                    {duty.text}
                    <span className={SHEET_TAGS[duty.mode].className}>{SHEET_TAGS[duty.mode].label}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      <div className="mk-sheet-row">
        <section className="mk-sheet-never" aria-label="What Cue will never do">
          <h2>Will never</h2>
          <ul>
            {CUE_NEVER.map((item) => (
              <li key={item.title}>{item.title}</li>
            ))}
          </ul>
        </section>
        <section className="mk-sheet-saturday" aria-label="An example Saturday">
          <h2>While you were shooting</h2>
          <ul>
            {SATURDAY_LOG.slice(0, 5).map((entry) => (
              <li key={entry.time}>
                <time>{entry.time}</time> {entry.text}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className="mk-sheet-foot">
        <p>
          {`${price.monthly} a month is about ${assistantHoursFor(price.monthlyCents / 100)} of an administrative assistant at the US median wage ($${ASSISTANT_WAGE.hourly.toFixed(2)} an hour, ${ASSISTANT_WAGE.source}). Cue works every hour of the month.`}
        </p>
        <p className="mk-sheet-quote">
          &ldquo;I review it and send it.&rdquo; <span>Gabriel Rhodes, GR Productions</span>
        </p>
        <p className="mk-sheet-cta">Try it free for 14 days at studio-cue.com</p>
      </footer>
    </div>
  );
}
