import type { Metadata } from "next";
import { CoupleInquiryPage } from "@/components/inquiries/couple-inquiry-page";

export const metadata: Metadata = {
  title: "Your inquiry",
  description: "Tell your photographer about your day and pick a time to talk.",
  // A private link: never indexed, never previewed with its contents.
  robots: { index: false, follow: false },
};

export default async function InquiryLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CoupleInquiryPage token={token} />;
}
