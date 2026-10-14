"use client";

import { useTenantDocuments } from "@/components/live/tenant-records";
import { useWorkspace } from "@/features/auth/workspace-context";

/**
 * The insurance page's line and its six steps, in the studio's own way of
 * getting certificates.
 *
 * Both described an agent — "Ask your insurance agent…", "Your agent replies
 * with a PDF" — to a studio that makes its certificates on its insurer's
 * website, on the very page its certificate kit lives on (walked on prod,
 * 2026-10-14).
 */
export function CoiPageIntro() {
  const role = String(useWorkspace().role ?? "");
  const { records } = useTenantDocuments("coiSettings", {
    enabled: ["studio_owner", "studio_admin", "studio_coordinator"].includes(role),
  });
  const selfServe = (records ?? [])[0]?.source === "self_serve";
  const steps = selfServe
    ? [
        "StudioCue gets the details ready",
        "You make it on your insurer’s website",
        "It comes back by email or upload",
        "StudioCue checks it against the venue’s requirements",
        "You approve it",
        "StudioCue sends it to the venue",
      ]
    : [
        "You request it from your agent",
        "Your agent replies with a PDF",
        "You review it against the venue’s requirements",
        "You approve it",
        "StudioCue sends it to the venue",
        "The venue acknowledges it",
      ];
  return (
    <>
      <p>
        {selfServe
          ? "Make the certificate on your insurer’s website with the details below; StudioCue checks it and sends it on."
          : "Ask your insurance agent for a certificate naming the venue, review it, then send it on."}
      </p>
      {/* Who does what, in order. Four parties are involved — the studio,
          its agent or insurer, a reviewer and the venue. */}
      <ol className="coi-flow-stages" aria-label="How a certificate gets to the venue">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </>
  );
}
