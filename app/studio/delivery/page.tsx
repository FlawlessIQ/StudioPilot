import { AppShell } from "@/components/layout/app-shell";
import { DeliveryForm } from "@/components/post-event/delivery-form";
import { LiveDomainView } from "@/components/studio/live-domain-view";

export default function DeliveryPage() {
  return (
    <AppShell active="Delivery">
      <div className="live-domain-page">
        <header className="page-heading">
          <div>
            <p className="eyebrow">Gallery handoff</p>
            <h1>Delivery</h1>
            <p>
              Record a secure gallery only after the deterministic
              post-production delivery gate passes.
            </p>
          </div>
        </header>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">New delivery</p>
              <h2>Record gallery</h2>
            </div>
          </div>
          <DeliveryForm />
        </section>
        <section>
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">History</p>
              <h2>Delivery records</h2>
            </div>
          </div>
          <LiveDomainView domain="delivery" />
        </section>
      </div>
    </AppShell>
  );
}
