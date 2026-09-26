"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import {
  ArrowRight,
  CalendarClock,
  Check,
  ClipboardList,
  Inbox,
  Package,
  PenLine,
} from "lucide-react";
import { useSetupState } from "@/components/setup/use-setup-state";
import {
  SETUP_ORDER,
  SETUP_STEP_NAME,
  type SetupGapKey,
} from "@/features/today/setup-gaps";

/**
 * Help's "Set up your studio": the same five questions as /studio/setup, in
 * the same order, read from the same state.
 *
 * It used to be its own list of five different steps (preview the form,
 * offerings, calendar, first project, invite team), so Help, setup and Today
 * each said something different about how set up a studio was
 * (docs/onboarding-assessment-2026-09-26.md). Every step now leads into setup,
 * where it's answered.
 */
const ICONS: Record<SetupGapKey, ComponentType<{ size?: number }>> = {
  inquiries: Inbox,
  availability: CalendarClock,
  packages: Package,
  agreement: PenLine,
  questionnaire: ClipboardList,
};

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export function SetupChecklist() {
  const { gaps, loading } = useSetupState();
  const open = new Set(gaps.map((gap) => gap.key));
  const completed = SETUP_ORDER.filter((key) => !open.has(key)).length;
  const total = SETUP_ORDER.length;

  return (
    <section className="ds-card ds-setup">
      <div className="ds-setup-head">
        <div>
          <span className="ds-eyebrow">Get started</span>
          <h2>Set up your studio workspace</h2>
          <p>Five questions, most answered in a tap. Skip anything and come back when you need it.</p>
        </div>
        {!loading ? (
          <span className="ds-badge ds-badge-brass">{`${completed} of ${total} complete`}</span>
        ) : null}
      </div>
      <div className="ds-setup-track" aria-label={`${completed} of ${total} setup steps complete`}>
        <i style={{ width: `${(completed / total) * 100}%` }} />
      </div>
      <div className="ds-setup-steps">
        {SETUP_ORDER.map((key) => {
          const Icon = ICONS[key];
          const done = !loading && !open.has(key);
          return (
            <Link className={done ? "is-done" : ""} href="/studio/setup" key={key}>
              <span>{done ? <Check size={16} /> : <Icon size={16} />}</span>
              <div>
                <strong>{capitalise(SETUP_STEP_NAME[key])}</strong>
              </div>
            </Link>
          );
        })}
      </div>
      <Link className="ds-btn ds-btn-primary" href="/studio/setup">
        {completed === total ? "Review setup" : "Continue setup"} <ArrowRight size={16} />
      </Link>
    </section>
  );
}
