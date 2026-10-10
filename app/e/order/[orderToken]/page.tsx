import type { Metadata } from "next";
import { EventSignupPage } from "@/components/group-events/event-signup-page";

export const metadata: Metadata = {
  title: "Your order",
  description: "Your order and how to pay.",
  // A private link: never indexed, never previewed with its contents.
  robots: { index: false, follow: false },
};

/** One parent's order, from the link in their confirmation and receipt emails. */
export default async function EventOrderPage({ params }: { params: Promise<{ orderToken: string }> }) {
  const { orderToken } = await params;
  return <EventSignupPage orderToken={orderToken} token={null} />;
}
