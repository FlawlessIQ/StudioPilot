import { Check } from "lucide-react";

/**
 * Where a new studio is in signup: three steps, named, from the first field to
 * the card.
 *
 * Signup never said how long it was. A studio that had just verified its email
 * met "Create your workspace", then "Start your 14-day trial" and a card, and
 * at no point could tell which screen was the last (onboarding audit,
 * 2026-10-24). Shown on the account form, the studio form and the plan picker,
 * so each one says where it sits.
 */
export const SIGNUP_STEPS = ["Your account", "Your studio", "Start your trial"] as const;

export function SignupSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol aria-label={`Signup, step ${current} of ${SIGNUP_STEPS.length}`} className="signup-steps">
      {SIGNUP_STEPS.map((label, index) => {
        const step = index + 1;
        return (
          <li
            aria-current={step === current ? "step" : undefined}
            className={step < current ? "is-done" : step === current ? "is-current" : undefined}
            key={label}
          >
            <span aria-hidden="true">{step < current ? <Check size={12} strokeWidth={3} /> : step}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
