import type { Metadata } from "next";
import { EventSignupPage } from "@/components/group-events/event-signup-page";

export const metadata: Metadata = {
  title: "Event sign-up",
  description: "Pick a package and how you’ll pay.",
  // A private link: never indexed, never previewed with its contents.
  robots: { index: false, follow: false },
};

/** An event's sign-up link, sent by the studio or scanned from its QR code at the field. */
export default async function EventSignupLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <EventSignupPage orderToken={null} token={token} />;
}
