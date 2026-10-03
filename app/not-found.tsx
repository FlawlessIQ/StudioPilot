import type { Metadata } from "next";
import { StatusPage } from "@/components/observability/status-page";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function NotFound() {
  return (
    <StatusPage
      eyebrow="404 · Page not found"
      title="We couldn't find that page."
      lead="The link may be old, mistyped, or for something that has since moved. Nothing on your account has changed."
    />
  );
}
