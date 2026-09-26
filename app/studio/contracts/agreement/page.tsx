import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { AgreementEditor } from "@/components/contracts/agreement-editor";
import { BackToSetup } from "@/components/setup/back-to-setup";

export default async function AgreementPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  return (
    <AppShell active="Contracts">
      <div className="live-domain-page">
        <BackToSetup fallback={null} from={from} />
        <header className="page-heading">
          <div>
            <p className="eyebrow">
              <Link href="/studio/contracts">Contracts</Link> · Your agreement
            </p>
            <h1>Your agreement</h1>
            <p>
              Every contract is written from this, with the couple&rsquo;s details and the price they
              accepted filled in. They sign it in their portal.
            </p>
          </div>
        </header>
        <AgreementEditor />
      </div>
    </AppShell>
  );
}
