"use client";

import Link from "next/link";
import { CircleAlert, PlugZap, ShieldCheck } from "lucide-react";
import type { IntegrationCapability } from "@/features/integrations/schema";
import { useCapability } from "@/components/integrations/use-capability";
import { useNativeSigning } from "@/components/contracts/use-native-signing";

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
  const native = useNativeSigning();
  /**
   * A studio StudioCue writes contracts for has no signing app and needs
   * none. "You send the agreement yourself" would be false for it, so the
   * signing note says what actually happens.
   */
  if (capability === "signing" && native.enabled && native.agreementTemplateId) {
    return (
      <p
        className={`capability-note is-ready${className ? ` ${className}` : ""}`}
        role="note"
      >
        <ShieldCheck aria-hidden="true" size={14} />
        <span>
          {native.autoSend.enabled
            ? "When they accept, StudioCue writes the contract from your agreement, signs it for you and sends it for their signature."
            : "When they accept, StudioCue writes the contract from your agreement for you to read, sign and send."}
        </span>
      </p>
    );
  }
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
