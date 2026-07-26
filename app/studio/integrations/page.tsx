import { Cable, CheckCircle2, FlaskConical, RefreshCw } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { integrations } from "@/config/booking-demo-data";

export default function IntegrationsPage() {
  return <AppShell active="Integrations"><div className="booking-page"><header className="page-heading"><div><p className="eyebrow">Provider health</p><h1>Integrations</h1><p>Tenant-scoped connections, least-privilege scopes, encrypted credential references, and normalized failures.</p></div></header><div className="integration-health-grid">{integrations.map((item)=><article className="panel integration-health-card" key={item.provider}><div className="integration-mark">{item.mock?<FlaskConical/>:<Cable/>}</div><div><h2>{item.provider}</h2><p>{item.description}</p></div><StatusBadge tone={item.mock?"warning":"success"}>{item.status}</StatusBadge><dl><div><dt>Resource</dt><dd>{item.scope}</dd></div><div><dt>Last check</dt><dd>{item.sync}</dd></div></dl><footer>{item.mock?<><FlaskConical size={15}/> Explicit development adapter</>:<><CheckCircle2 size={15}/> OAuth connection healthy</>}<RefreshCw size={14}/></footer></article>)}</div><p className="source-note">OAuth refresh tokens are referenced through encrypted Secret Manager storage and never returned to the browser.</p></div></AppShell>;
}
