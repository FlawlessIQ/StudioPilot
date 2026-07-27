import { PortalShell } from "@/components/layout/portal-shell";
import { ClientQuestionnaireForm } from "@/components/planning/client-questionnaire-form";
export default function ClientQuestionnairePage(){return <PortalShell active="Questionnaires"><div className="client-booking-page"><p className="eyebrow">Wedding planning</p><h1>Your questionnaire</h1><p>Save a draft at any time. Submission creates the deterministic completion evidence used by the studio workflow.</p><section className="panel"><ClientQuestionnaireForm/></section></div></PortalShell>}
