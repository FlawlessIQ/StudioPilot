"use client";

import Link from "next/link";
import { useNativeSigning } from "@/components/contracts/use-native-signing";

/**
 * The way into the agreement editor, shown only to a studio StudioCue writes
 * contracts for. Everyone else would be offered a page that says "not yet".
 */
export function AgreementLinkCard() {
  const native = useNativeSigning();
  if (native.loading || !native.enabled) return null;
  return (
    <section className="panel booking-project-prompt">
      <h2>Your agreement</h2>
      <p>
        {native.agreementTemplateId
          ? "The text every contract is written from. Edit it any time — contracts already sent keep their version."
          : "Set up the text StudioCue writes every contract from. Start from the agreement you already use."}
      </p>
      <Link className="button button-light" href="/studio/contracts/agreement">
        {native.agreementTemplateId ? "Open your agreement" : "Set up your agreement"}
      </Link>
    </section>
  );
}
