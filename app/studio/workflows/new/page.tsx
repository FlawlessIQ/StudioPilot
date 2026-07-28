import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateWorkflowForm } from "@/components/workflows/create-workflow-form";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "New workflow" };

export default function NewWorkflowPage() {
  return (
    <AppShell active="Workflows">
      <div className="crm-form-page">
        <Link className="back-link" href="/studio/workflows"><ArrowLeft size={15} /> Back to workflows</Link>
        <div className="dashboard-heading"><div><p className="eyebrow">New workflow</p><h1>Create a workflow</h1><p>Choose the steps your team follows and when each one should be complete.</p></div></div>
        <CreateWorkflowForm />
      </div>
    </AppShell>
  );
}
