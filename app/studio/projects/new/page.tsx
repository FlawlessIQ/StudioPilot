import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateProjectForm } from "@/components/crm/create-project-form";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "New project" };

export default function NewProjectPage() {
  return <AppShell active="Projects"><div className="crm-form-page"><Link className="back-link" href="/studio/projects"><ArrowLeft size={15} /> Projects</Link><div className="dashboard-heading"><div><p className="eyebrow">New project</p><h1>Create a project</h1><p>Add the client and event essentials now. You can choose a package and build the rest of the plan afterward.</p></div></div><CreateProjectForm /></div></AppShell>;
}
