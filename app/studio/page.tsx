import type { Metadata } from "next";
import { StudioDashboard } from "@/components/dashboard/studio-dashboard";

export const metadata: Metadata = {
  title: "Studio Dashboard",
  description: "Your projects, blockers, next actions, and studio readiness in one view.",
};

export default function StudioPage() {
  return <StudioDashboard />;
}
