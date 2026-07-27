import { CloudCog } from "lucide-react";
import { AdminShell } from "@/components/platform/admin-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { systemHealth } from "@/config/saas-demo-data";
export default function IntegrationsPage(){return <AdminShell active="Integrations"><header><div><p className="eyebrow">Provider fleet</p><h1>Integration health</h1><p>Normalized provider checks across tenant connections.</p></div></header><section className="ops-grid">{systemHealth.map(item=><article className="panel health-card" key={item.component}><CloudCog/><span><strong>{item.component}</strong><small>{item.latency} · {item.failures} recent failures</small></span><StatusBadge tone={item.status==="Healthy"?"success":"warning"}>{item.status}</StatusBadge></article>)}</section></AdminShell>}
