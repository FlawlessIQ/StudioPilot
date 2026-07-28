import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { CreateCrewProfileForm } from "@/components/crew/create-crew-profile-form";

export default function NewCrewProfilePage() {
  return <AppShell active="Crew"><div className="crew-ops-page"><Link className="back-link" href="/studio/crew"><ArrowLeft size={15}/> Back to crew</Link><header className="page-heading"><div><p className="eyebrow">Crew directory</p><h1>Add crew member</h1><p>Add their working details now. You can invite them to a specific project afterward.</p></div></header><section className="panel crew-form-preview"><div className="human-boundary"><ShieldCheck/><span><strong>Private by default</strong><small>Rates, tax documents, insurance, and private notes are only shown to authorized studio users.</small></span></div><CreateCrewProfileForm/></section></div></AppShell>;
}
