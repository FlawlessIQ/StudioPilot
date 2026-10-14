import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { QuestionnaireBuilder } from "@/components/planning/questionnaire-builder";
import { RecommendedQuestionnaires } from "@/components/planning/recommended-questionnaires";

export const metadata: Metadata = { title: "Questionnaire templates" };

/**
 * Building and editing questionnaire templates, on a page of its own.
 *
 * The builder rendered in full under the list of forms sent to couples: 812
 * buttons and 2,403 text elements on one screen, so the list a studio checks
 * every week sat above a tool it opens a few times a year (laptop UI audit,
 * 2026-10-14).
 */
export default function QuestionnaireTemplatesPage() {
  return (
    <AppShell active="Questionnaires">
      <div className="live-domain-page">
        <Link className="back-link" href="/studio/questionnaires">
          <ArrowLeft size={15} /> Questionnaires
        </Link>
        <header className="page-heading">
          <div>
            <p className="eyebrow">Library</p>
            <h1>Questionnaire templates</h1>
            <p>The forms you send to clients. A change makes a new version; clients part-way through keep theirs.</p>
          </div>
        </header>
        {/* GR Productions' wedding forms, for any studio to copy. */}
        <RecommendedQuestionnaires />
        <QuestionnaireBuilder />
      </div>
    </AppShell>
  );
}
