"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, ChevronRight, Copy, Forward } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";
import { LeadCaptureSetup } from "@/components/intake/lead-capture-setup";

/**
 * "Forward any inquiry to this address."
 *
 * Inquiries that arrive by email, from The Knot or WeddingWire, or anywhere
 * other than the website form become leads when forwarded here — with the
 * date checked and a reply drafted, like a form inquiry. Renders nothing until
 * the address resolves (inbound mail not configured means no address).
 *
 * This used to be rendered in exactly one place: /studio/leads. That page has
 * no navigation entry — the studio nav goes Today, Cue, Jobs, Calendar,
 * Messages, People, AI review, Insights — and the only links to it anywhere are
 * two "Back to inquiries" back-links *inside* a lead detail page. So the sole
 * route to this address was: open an inquiry from Today, then back out into a
 * list you had never visited. A studio with no inquiries yet had no route at
 * all — and that studio is precisely the one with a mailbox full of them.
 *
 * It is now on Today while no inquiry has ever arrived, in the setup flow, and
 * in Studio settings under Communications.
 */
export function useInquiryForwardingAddress(): string | null {
  const workspace = useWorkspace();
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace.tenantId) return;
    let active = true;
    void sendCommunicationsCommand({
      type: "getInquiryForwardingAddress",
      idempotencyKey: `inquiry_address_${workspace.tenantId}`,
      input: {},
    })
      .then((result) => {
        const value =
          result.mode === "live" &&
          result.payload &&
          typeof result.payload === "object" &&
          "address" in result.payload &&
          typeof result.payload.address === "string"
            ? result.payload.address
            : null;
        if (active) setAddress(value);
      })
      .catch(() => {
        if (active) setAddress(null);
      });
    return () => {
      active = false;
    };
  }, [workspace.tenantId]);

  return address;
}

/** Copy-to-clipboard button, shared by every surface below. */
function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="button button-light button-sm"
      onClick={() => {
        void navigator.clipboard?.writeText(address).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 2000);
        });
      }}
      type="button"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
      {copied ? "Copied" : "Copy address"}
    </button>
  );
}

/** The inline strip, above a list of inquiries. */
export function InquiryForwardingAddress() {
  const address = useInquiryForwardingAddress();
  if (!address) return null;
  return (
    <div className="inquiry-forwarding">
      <Forward aria-hidden="true" size={16} />
      <span>
        <strong>Inquiry by email, The Knot or WeddingWire?</strong>
        <small>
          Forward it to <code>{address}</code>{" "}and it becomes an inquiry here,
          with the date checked and a reply drafted.
        </small>
      </span>
      <CopyAddress address={address} />
      {/* Setting it up to happen by itself lives in settings, where the three
          routes each open their own step-by-step sheet. */}
      <Link className="inquiry-forwarding-setup" href="/studio/settings/inquiry-capture">
        Capture every inquiry automatically <ChevronRight aria-hidden="true" size={14} />
      </Link>
    </div>
  );
}

/**
 * Studio settings → Communications → Inquiry capture.
 *
 * A permanent, findable home: an account-level address is the kind of thing a
 * studio hunts for in settings, and it is the only surface here that survives
 * the studio having plenty of inquiries already. The address, and the three
 * ways to get inquiries to it, are one panel: see LeadCaptureSetup.
 */
export function InquiryForwardingSettings() {
  return <LeadCaptureSetup />;
}
