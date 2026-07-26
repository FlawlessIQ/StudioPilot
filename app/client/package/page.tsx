import { CircleCheck, Clock3 } from "lucide-react";
import { PortalShell } from "@/components/layout/portal-shell";
export default function ClientPackagePage() {
  return <PortalShell active="Package"><div className="client-booking-page"><p className="eyebrow">Your selection</p><h1>The Signature Collection</h1><p>Package version 4 · selected June 24, 2026</p><section className="panel client-package-card"><div><h2>What is included</h2><strong>$7,640</strong></div><ul><li><CircleCheck/> 10 hours of wedding-day coverage</li><li><CircleCheck/> Two photographers</li><li><CircleCheck/> Engagement session</li><li><CircleCheck/> Full-resolution digital gallery</li></ul><div className="immutable-note"><Clock3/><span><strong>Your pricing is locked.</strong><small>Future studio package changes will not affect this project.</small></span></div></section></div></PortalShell>;
}
