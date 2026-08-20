import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateProjectForm } from "@/components/crm/create-project-form";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "New project" };

export default function NewProjectPage() {
  return <AppShell active="Projects"><div className="crm-form-page"><Link className="back-link" href="/studio/projects"><ArrowLeft size={15} /> Back to projects</Link><div className="dashboard-heading"><div><p className="eyebrow">New project</p><h1>Create a project</h1><p>Start from the client&rsquo;s message, confirm the details, and the journey takes it from there.</p></div></div><CreateProjectForm /></div></AppShell>;
}
