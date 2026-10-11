/**
 * Two decisions the import review screen makes, kept out of the component so
 * they can be tested against the walk that found them (Priya Shah, Jess
 * Styles Bridal, 2026-10-10).
 */

type ReviewedDraft = {
  assetType: string;
  reviewDecision: string;
};

type OnScreenDraft = {
  id: string;
  name: string;
  assetType: string;
  structuredContent: Record<string, unknown>;
};

/**
 * What an approval carries: the name and content on screen when either was
 * changed and not saved. A name typed without "Save & confirm" first was
 * dropped, and the package went live under the old one. The edits go with
 * the approval, in one write; an untouched draft, or a rejection, carries
 * none.
 */
export function approvalEdits(input: {
  action: "approve" | "reject";
  versionId: string;
  selected: OnScreenDraft | null | undefined;
  name: string;
  content: Record<string, unknown>;
}): { name: string; assetType: string; structuredContent: Record<string, unknown> } | null {
  const { selected } = input;
  if (input.action !== "approve" || !selected || selected.id !== input.versionId) return null;
  const edited =
    input.name !== selected.name ||
    JSON.stringify(input.content) !== JSON.stringify(selected.structuredContent);
  return edited
    ? {
        name: input.name.trim() || selected.name,
        assetType: selected.assetType,
        structuredContent: input.content,
      }
    : null;
}

const OTHER_TYPES = ["proposal", "schedule", "crew_preference", "coi_instruction", "workflow"];

/**
 * What activating actually did, and nothing else. The banner listed forms,
 * timing rules, messages and delivery defaults after Jess imported one price
 * list — and a hair studio delivers nothing.
 */
export function activationSummary(drafts: readonly ReviewedDraft[]): string {
  const approvedOf = (assetType: string) =>
    drafts.filter((draft) => draft.assetType === assetType && draft.reviewDecision === "approved")
      .length;
  const count = (assetType: string, one: string, many: string, done: string) => {
    const n = approvedOf(assetType);
    return n ? `${n} ${n === 1 ? one : many} ${done}` : "";
  };
  const others = OTHER_TYPES.reduce((sum, assetType) => sum + approvedOf(assetType), 0);
  return [
    count("package", "package is", "packages are", "in your library"),
    count("contract", "agreement is", "agreements are", "in your library"),
    count("questionnaire", "form is", "forms are", "ready to send"),
    count("timing_rule", "timing rule is", "timing rules are", "active"),
    count("message_template", "message is", "messages are", "ready to turn on"),
    approvedOf("delivery_instruction") ? "Delivery instructions are saved as your defaults" : "",
    approvedOf("review_request") ? "Your review link is saved" : "",
    others ? `${others} more ${others === 1 ? "item is" : "items are"} saved to your library` : "",
  ]
    .filter(Boolean)
    .map((sentence) => `${sentence}.`)
    .join(" ");
}
