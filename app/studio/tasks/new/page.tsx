import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { CreateTaskForm } from "@/components/workflows/create-task-form";

export const metadata: Metadata = { title: "New task · StudioHub" };

export default function NewTaskPage() {
  return <AppShell active="Tasks"><div className="crm-form-page"><Link className="back-link" href="/studio/tasks"><ArrowLeft size={15} /> Tasks</Link><div className="dashboard-heading"><div><p className="eyebrow">New work item</p><h1>Create a task</h1><p>Attach an owned, dated action to an authorized project.</p></div></div><CreateTaskForm /></div></AppShell>;
}
