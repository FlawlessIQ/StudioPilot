"use client";

import { friendlyAiError } from "@/lib/ai/friendly-error";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export type ProposedTimingRule = {
  name: string;
  anchor: string;
  offsetMinutes: number;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  rationale: string;
};

export type TimingRuleProposal =
  | { mode: "preview"; rules: ProposedTimingRule[]; assumptions: string[] }
  | { mode: "live"; rules: ProposedTimingRule[]; assumptions: string[] };

/**
 * Ask the server to propose timing rules from a pasted past schedule.
 * Proposals are advisory — saving each rule via the deterministic
 * saveTimingRule command is the approval step.
 */
export async function proposeTimingRules(input: {
  tenantId: string;
  eventTypeId: string;
  scheduleText: string;
}): Promise<TimingRuleProposal> {
  const endpoint = process.env.NEXT_PUBLIC_AI_FUNCTIONS_URL;
  if (!endpoint) {
    return {
      mode: "preview",
      rules: [
        {
          name: "Coverage starts before ceremony",
          anchor: "ceremony_start",
          offsetMinutes: -120,
          durationMinutes: 120,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          rationale:
            "Preview example: coverage typically begins two hours before the ceremony.",
        },
      ],
      assumptions: ["Preview mode: connect AI functions to analyze your file."],
    };
  }
  const { auth } = getFirebaseClient();
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in before proposing timing rules.");
  const appCheckToken = await getAppCheckToken();
  const response = await fetch(
    `${endpoint.replace(/\/$/, "")}/aiTimingRulesCommand`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${await user.getIdToken()}`,
        ...(appCheckToken ? { "x-firebase-appcheck": appCheckToken } : {}),
      },
      body: JSON.stringify(input),
    },
  );
  const result = (await response.json()) as {
    rules?: ProposedTimingRule[];
    assumptions?: string[];
    error?: string;
  };
  if (!response.ok || !Array.isArray(result.rules))
    throw new Error(
      friendlyAiError(
        new Error(result.error ?? ""),
        "We couldn't read timing rules from that schedule. Try again.",
      ),
    );
  return {
    mode: "live",
    rules: result.rules,
    assumptions: result.assumptions ?? [],
  };
}
