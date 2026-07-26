import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateWorkflowForm } from "@/components/workflows/create-workflow-form";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "New workflow · StudioHub" };

export default function NewWorkflowPage() {
  return (
    <AppShell active="Workflows">
      <div className="crm-form-page">
        <Link className="back-link" href="/studio/workflows"><ArrowLeft size={15} /> Workflow templates</Link>
        <div className="dashboard-heading"><div><p className="eyebrow">New immutable version</p><h1>Create a workflow</h1><p>Choose deterministic checkpoints and due dates. Published versions never change active runs.</p></div></div>
        <CreateWorkflowForm />
      </div>
    </AppShell>
  );
}
