import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import {
  CONNECTED_SERVICES,
  CORE_SUBPROCESSORS,
  LEGAL_ENTITY,
  PRIVACY_EFFECTIVE,
  legalDate,
  type Subprocessor,
} from "@/features/legal/legal";

export const metadata: Metadata = {
  title: "Subprocessors",
  description: "The service providers that process data for StudioCue, what each does, and where.",
  alternates: { canonical: "/subprocessors" },
};

function Entry({ entry }: { entry: Subprocessor }) {
  return (
    <li>
      <strong>{entry.service}</strong> ({entry.name}) — {entry.purpose}. <em>Data:</em> {entry.data}. <em>Location:</em>{" "}
      {entry.location}.
    </li>
  );
}

/** The list behind Terms §5 and the Privacy Policy (features/legal/legal.ts). */
export default function SubprocessorsPage() {
  return (
    <main className="ds-root legal-page" data-ds-theme="emerald">
      <header><Link href="/"><Logo /></Link><Link href="/"><ArrowLeft size={15} /> Back home</Link></header>
      <article>
        <p className="eyebrow">Updated {legalDate(PRIVACY_EFFECTIVE)}</p>
        <h1>Subprocessors</h1>
        <p className="legal-lead">
          These are the service providers {LEGAL_ENTITY.name} uses to run {LEGAL_ENTITY.product}. Each receives only the
          information it needs to do its job, under terms that protect it. We update this page before adding a new one.
        </p>

        <h2>Used for every studio</h2>
        <ul className="legal-list">
          {CORE_SUBPROCESSORS.map((entry) => (
            <Entry entry={entry} key={entry.service} />
          ))}
        </ul>

        <h2>Used only when a studio connects them</h2>
        <p>
          A studio chooses whether to connect these. Until it does, they receive nothing from {LEGAL_ENTITY.product}, and the
          studio can disconnect them at any time.
        </p>
        <ul className="legal-list">
          {CONNECTED_SERVICES.map((entry) => (
            <Entry entry={entry} key={entry.service} />
          ))}
        </ul>

        <h2>Questions</h2>
        <p>
          See our <Link href="/privacy">Privacy Policy</Link> and <Link href="/terms">Terms of Service</Link>, or email{" "}
          <a href={`mailto:${LEGAL_ENTITY.email}`}>{LEGAL_ENTITY.email}</a>.
        </p>
      </article>
    </main>
  );
}
