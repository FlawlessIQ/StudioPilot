import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateWorkflowForm } from "@/components/workflows/create-workflow-form";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "New workflow" };

export default async function NewWorkflowPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  // Arriving from "New version" on a template: same form, same command —
  // createWorkflowTemplate already versions by name and supersedes the
  // outgoing one. What was missing was a door with the right label on it.
  const revising = Boolean(from);
  return (
    <AppShell active="Workflows">
      <div className="crm-form-page">
        <Link className="back-link" href="/studio/workflows"><ArrowLeft size={15} /> Back to workflows</Link>
        <div className="dashboard-heading">
          <div>
            <p className="eyebrow">{revising ? "New version" : "New workflow"}</p>
            <h1>{revising ? "Revise this workflow" : "Create a workflow"}</h1>
            <p>
              {revising
                ? "Change what you need and publish. Jobs already running keep the version they started on."
                : "Choose which steps a job goes through, and publish it to start using it."}
            </p>
          </div>
        </div>
        <CreateWorkflowForm reviseTemplateId={from ?? null} />
      </div>
    </AppShell>
  );
}
