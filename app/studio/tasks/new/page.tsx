import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { CreateTaskForm } from "@/components/workflows/create-task-form";

export const metadata: Metadata = { title: "New task" };

export default async function NewTaskPage({
  searchParams,
}: {
  searchParams: Promise<{ project?: string }>;
}) {
  const { project = "" } = await searchParams;
  return <AppShell active="Tasks"><div className="crm-form-page"><Link className="back-link" href="/studio/tasks"><ArrowLeft size={15} /> Tasks</Link><div className="dashboard-heading"><div><p className="eyebrow">New task</p><h1>Create a task</h1><p>Choose the project, describe the work, and decide whether it affects event readiness.</p></div></div><CreateTaskForm initialProjectId={project} /></div></AppShell>;
}
