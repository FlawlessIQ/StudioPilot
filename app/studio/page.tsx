import type { Metadata } from "next";
import { TodayInbox } from "@/components/today/today-inbox";

export const metadata: Metadata = {
  title: "Today",
  description:
    "Everything that needs you, ranked by what it costs to wait — and everything StudioCue already handled.",
};

export default function StudioPage() {
  return <TodayInbox />;
}
