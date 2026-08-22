"use client";

import Link from "next/link";
import { CircleAlert, PlugZap, ShieldCheck } from "lucide-react";
import type { IntegrationCapability } from "@/features/integrations/schema";
import { useCapability } from "@/components/integrations/use-capability";

/**
 * What happens next, named, wherever a provider is about to be used.
 *
 * The proposal page offered "Send for approval" and never said that an
 * approved proposal produces a signature request, which provider sends it,
 * or whether that provider is connected. The system knew all three. This
 * says them at the point of action, so the answer arrives before the click
 * rather than as a failed provider job afterwards.
 *
 * Renders nothing while the status is loading or unavailable — a page about
 * to send a proposal should not sprout a warning because an endpoint was
 * slow.
 */
export function CapabilityNote({
  capability,
  className,
}: {
  capability: IntegrationCapability;
  className?: string;
}) {
  const readiness = useCapability(capability);
  if (!readiness) return null;
  const Icon = readiness.ok
    ? ShieldCheck
    : readiness.state === "none_connected"
      ? PlugZap
      : CircleAlert;
  return (
    <p
      className={`capability-note is-${readiness.ok ? "ready" : "attention"}${className ? ` ${className}` : ""}`}
      role="note"
    >
      <Icon aria-hidden="true" size={14} />
      <span>
        {readiness.summary}
        {readiness.remedy ? (
          <>
            {" "}
            <Link href="/studio/integrations">{readiness.remedy}</Link>.
          </>
        ) : null}
      </span>
    </p>
  );
}
