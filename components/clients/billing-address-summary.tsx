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
}: {
  contact: Record<string, unknown> | null;
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
      <span>
        <small>
          {address
            ? byCouple
              ? "Billing address · confirmed by the couple at signing"
              : "Billing address · added by the studio"
            : "No billing address yet"}
        </small>
        <strong>
          {address
            ? formatBillingAddress(address)
            : "QuickBooks works out sales tax from it. The couple is asked for it when they sign."}
        </strong>
      </span>
      <Link className="button button-light" href={editHref}>
        {address ? "Edit" : "Add it"}
      </Link>
    </aside>
  );
}
