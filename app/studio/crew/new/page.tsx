import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { CreateCrewProfileForm } from "@/components/crew/create-crew-profile-form";

export default function NewCrewProfilePage() {
  return <AppShell active="Crew"><div className="crew-ops-page"><Link className="back-link" href="/studio/crew"><ArrowLeft size={15}/> Back to crew</Link><header className="page-heading"><div><p className="eyebrow">Crew directory</p><h1>Add crew member</h1><p>Create the relationship record before inviting them to a project.</p></div></header><section className="panel crew-form-preview"><div className="human-boundary"><ShieldCheck/><span><strong>Profile creation is server-authorized.</strong><small>Rates, tax documents, insurance, and private notes are never exposed to unrelated users.</small></span></div><CreateCrewProfileForm/></section></div></AppShell>;
}
