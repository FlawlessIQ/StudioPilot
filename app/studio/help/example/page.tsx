import type { Metadata } from "next";
import { AppShell } from "@/components/layout/app-shell";
import { ExampleTour } from "@/components/help/example-tour";

export const metadata: Metadata = { title: "Example job" };

export default function ExampleJobPage() {
  return (
    <AppShell active="Help & guides">
      <ExampleTour />
    </AppShell>
  );
}
