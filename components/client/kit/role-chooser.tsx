"use client";

import { Button, ButtonRow } from "@/components/kit/kit";

/**
 * "Which are you?" — on a form that asks by role ("Bride's email", "Groom's
 * phone"), one tap fills the details of the person who inquired and their
 * partner's (functions/src/planning/job-facts.ts, coupleRoleChoices).
 *
 * Shown at the top of the section holding the first question it fills, until
 * they pick or answer those themselves; it fills only blanks. Shared by the
 * portal's form and the inquiry page, like the questions themselves
 * (questionnaire-question.tsx).
 */

export type RoleChoices = { bride: Record<string, string>; groom: Record<string, string> };

const blank = (value: unknown) => value === undefined || value === null || value === "";

/** The choices, when well formed and with something still to fill. */
export function parseRoleChoices(value: unknown): RoleChoices | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  const side = (entry: unknown) =>
    typeof entry === "object" && entry !== null
      ? Object.fromEntries(
          Object.entries(entry as Record<string, unknown>).filter(
            (pair): pair is [string, string] => typeof pair[1] === "string" && pair[1].length > 0,
          ),
        )
      : {};
  const choices = { bride: side(row.bride), groom: side(row.groom) };
  return Object.keys(choices.bride).length || Object.keys(choices.groom).length ? choices : null;
}

/**
 * Whether to ask: only while every question it would fill is still empty.
 * Once they've picked — or started typing those answers themselves — it goes;
 * a partner the job knows nothing about leaves their questions blank, and
 * asking again after the tap would read as if the tap did nothing.
 */
export function roleChoicesOpen(choices: RoleChoices | null, answers: Record<string, unknown>): boolean {
  if (!choices) return false;
  return [...Object.keys(choices.bride), ...Object.keys(choices.groom)].every((fieldId) => blank(answers[fieldId]));
}

/** The question ids a choice would fill, to place the chooser above the first. */
export function roleChoiceFieldIds(choices: RoleChoices | null): Set<string> {
  return new Set(choices ? [...Object.keys(choices.bride), ...Object.keys(choices.groom)] : []);
}

export function RoleChooser({
  choices,
  answers,
  onFill,
}: {
  choices: RoleChoices;
  answers: Record<string, unknown>;
  onFill: (fieldId: string, value: string) => void;
}) {
  function pick(role: "bride" | "groom") {
    for (const [fieldId, value] of Object.entries(choices[role])) if (blank(answers[fieldId])) onFill(fieldId, value);
  }
  return (
    <div className="kit-stack-tight">
      <p className="kit-subsection">Which are you?</p>
      <p className="kit-hint">We&rsquo;ll fill in your details and your partner&rsquo;s name from your inquiry. You can change anything.</p>
      <ButtonRow>
        <Button onClick={() => pick("bride")} size="compact" variant="secondary">
          I&rsquo;m the bride
        </Button>
        <Button onClick={() => pick("groom")} size="compact" variant="secondary">
          I&rsquo;m the groom
        </Button>
      </ButtonRow>
    </div>
  );
}
