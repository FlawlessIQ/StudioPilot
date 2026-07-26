import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";

export default function NewCrewProfilePage() {
  return <AppShell active="Crew"><div className="crew-ops-page"><Link className="back-link" href="/studio/crew"><ArrowLeft size={15}/> Back to crew</Link><header className="page-heading"><div><p className="eyebrow">Crew directory</p><h1>Add crew member</h1><p>Create the relationship record before inviting them to a project.</p></div></header><section className="panel crew-form-preview"><div className="human-boundary"><ShieldCheck/><span><strong>Profile creation is server-authorized.</strong><small>Rates, tax documents, insurance, and private notes are never exposed to unrelated users.</small></span></div><form><label>Name<input readOnly value="New collaborator"/></label><label>Email<input readOnly value="collaborator@example.com"/></label><label>Service area<input readOnly value="New York City"/></label><label>Rate type<select disabled><option>Event rate</option></select></label><p className="source-note">Development preview: connect Firebase Authentication and the Crew Functions endpoint to persist this profile and send invitations.</p></form></section></div></AppShell>;
}
