"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Forward } from "lucide-react";
import { useWorkspace } from "@/features/auth/workspace-context";
import { sendCommunicationsCommand } from "@/lib/communications/command-client";

/**
 * "Forward any inquiry to this address."
 *
 * Inquiries that arrive by email, from The Knot or WeddingWire, or anywhere
 * other than the website form become leads when forwarded here — with the
 * date checked and a reply drafted, like a form inquiry. Renders nothing until
 * the address resolves (inbound mail not configured means no address).
 */
export function InquiryForwardingAddress() {
  const workspace = useWorkspace();
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  if (!address) return null;
  return (
    <div className="inquiry-forwarding">
      <Forward aria-hidden="true" size={16} />
      <span>
        <strong>Inquiry by email, The Knot or WeddingWire?</strong>
        <small>
          Forward it to <code>{address}</code> and it becomes an inquiry here,
          with the date checked and a reply drafted.
        </small>
      </span>
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
    </div>
  );
}
