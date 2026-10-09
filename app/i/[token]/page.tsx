import type { Metadata } from "next";
import { CoupleInquiryPage } from "@/components/inquiries/couple-inquiry-page";

export const metadata: Metadata = {
  title: "Your inquiry",
  // Fixed at build time, before anyone knows whose client is looking: a makeup
  // artist's or hair stylist's client has no call to pick a time for.
  description: "Tell your studio about your day.",
  // A private link: never indexed, never previewed with its contents.
  robots: { index: false, follow: false },
};

export default async function InquiryLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CoupleInquiryPage token={token} />;
}
