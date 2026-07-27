import { Flag } from "lucide-react";
import { AdminShell } from "@/components/platform/admin-shell";
import { AdminCommandAction } from "@/components/saas/admin-actions";
import { StatusBadge } from "@/components/ui/status-badge";
export default function FeatureFlagsPage(){return <AdminShell active="Feature flags"><header><div><p className="eyebrow">Controlled rollout</p><h1>Feature flags</h1><p>Platform-only controls; subscription capabilities still require entitlements.</p></div></header><section className="panel flag-card"><div><Flag/><span><strong>AI event copilot</strong><small>Enabled globally; entitlement and permission checks still apply</small></span><StatusBadge tone="success">Enabled</StatusBadge></div><AdminCommandAction label="Disable feature flag" complete="Feature flag disabled and audited." command={{type:"setFeatureFlag",input:{key:"ai-event-copilot",enabled:false,tenantIds:[],description:"Permission-aware event copilot rollout"}}}/></section></AdminShell>}
