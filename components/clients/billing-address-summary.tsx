import Link from "next/link";
import { MapPin } from "lucide-react";
import { coupleConfirmed, formatBillingAddress } from "@/features/contacts/billing-address-signing";
import { billingAddressOf } from "@/components/clients/client-record-actions";

/**
 * Where the couple is billed, on the job's booking page.
 *
 * QuickBooks works out sales tax from it, so it is said plainly beside the
 * agreement and the retainer: the address, and whether the couple confirmed
 * it themselves when they signed (features/contacts/billing-address-
 * signing.ts) or the studio entered it. Edited in Clients, like any other
 * client detail.
 */
export function BillingAddressSummary({
  contact,
  showMissing,
  signsAgreement = true,
}: {
  contact: Record<string, unknown> | null;
  /** Whether this kind of job has an agreement to sign (job-kinds.ts): the address is asked there. */
  signsAgreement?: boolean;
  /** Say "none yet" only where it matters — a studio invoicing through QuickBooks. */
  showMissing: boolean;
}) {
  if (!contact) return null;
  const address = billingAddressOf(contact.billingAddress);
  if (!address && !showMissing) return null;
  const byCouple = address ? coupleConfirmed(contact) : null;
  const email = typeof contact.email === "string" ? contact.email : "";
  const editHref = `/studio/clients${email ? `?q=${encodeURIComponent(email)}` : ""}`;
  return (
    <aside aria-label="Billing address" className="booking-billing-address">
      <MapPin aria-hidden="true" size={17} />
      {/* The state is the headline and the reason the small print. With no
          address it read the other way round: "No billing address yet" in
          11px grey over a bold sentence about QuickBooks (UI audit,
          2026-10-02). */}
      {address ? (
        <span>
          <small>
            {byCouple
              ? "Billing address · confirmed by the client at signing"
              : "Billing address · added by the studio"}
          </small>
          <strong>{formatBillingAddress(address)}</strong>
        </span>
      ) : (
        <span>
          <strong>No billing address yet</strong>
          <small>
            {signsAgreement
              ? "QuickBooks works out sales tax from it. The client is asked for it when they sign."
              : "QuickBooks works out sales tax from it. This kind of job has no agreement to ask it on — add it here if you charge tax."}
          </small>
        </span>
      )}
      <Link className="button button-light" href={editHref}>
        {address ? "Edit" : "Add it"}
      </Link>
    </aside>
  );
}
