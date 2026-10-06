import Link from "next/link";
import { ArrowRight, ShieldCheck, X } from "lucide-react";
import { CUE_DUTIES, CUE_NEVER, DUTY_AREAS, type CueDuty, type DutyMode } from "@/features/marketing/cue-duties";

const TAGS: Record<DutyMode, { className: string; label: string }> = {
  on_its_own: { className: "mk-role-tag mk-role-tag--auto", label: "On its own" },
  you_approve: { className: "mk-role-tag mk-role-tag--approve", label: "You approve" },
};

/**
 * Cue's job description: the role, its duties by area, and what it will
 * never do. The homepage shows a few duties per area and links to
 * /office-manager, which shows them all with what each one needs.
 *
 * Every duty and its "on its own" / "you approve" tag come from
 * features/marketing/cue-duties.ts, so the posting can't claim more than the
 * code does.
 */
export function JobDescription({ perArea, showNeeds = false }: { perArea?: number; showNeeds?: boolean }) {
  const duties: ReadonlyArray<CueDuty> = CUE_DUTIES;
  return (
    <article aria-label="Cue's job description" className="mk-role">
      <dl className="mk-role-meta">
        <div>
          <dt>Position</dt>
          <dd>Office manager</dd>
        </div>
        <div>
          <dt>Hours</dt>
          <dd>All of them, weekends included</dd>
        </div>
        <div>
          <dt>Reports to</dt>
          <dd>You</dd>
        </div>
      </dl>

      <div className="mk-role-duties">
        {DUTY_AREAS.map((area) => {
          const all = duties.filter((duty) => duty.area === area.id);
          const shown = perArea ? all.slice(0, perArea) : all;
          return (
            <section key={area.id}>
              <h3>{area.title}</h3>
              <ul>
                {shown.map((duty) => {
                  const tag = TAGS[duty.mode];
                  return (
                    <li key={duty.id}>
                      <span>{duty.text}</span>
                      <span className="mk-role-tags">
                        <span className={tag.className}>{tag.label}</span>
                        {showNeeds && duty.needs ? <span className="mk-role-needs">{`Needs: ${duty.needs}`}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <section aria-label="What Cue will never do" className="mk-role-never">
        <h3>
          <ShieldCheck aria-hidden="true" size={17} /> Will never
        </h3>
        <ul>
          {CUE_NEVER.map((item) => (
            <li key={item.title}>
              <X aria-hidden="true" size={15} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {perArea ? (
        <Link className="journey-film-page-link mk-role-more" href="/office-manager">
          Read Cue&rsquo;s whole job description <ArrowRight aria-hidden="true" size={14} />
        </Link>
      ) : null}
    </article>
  );
}
