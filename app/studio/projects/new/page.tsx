import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { CreateProjectForm } from "@/components/crm/create-project-form";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = { title: "New project · StudioHub" };

export default function NewProjectPage() {
  return <AppShell active="Projects"><div className="crm-form-page"><Link className="back-link" href="/studio/projects"><ArrowLeft size={15} /> Projects</Link><div className="dashboard-heading"><div><p className="eyebrow">New record</p><h1>Create a project</h1><p>Projects begin in Lead and can only move through explicit lifecycle transitions.</p></div></div><CreateProjectForm /></div></AppShell>;
}
