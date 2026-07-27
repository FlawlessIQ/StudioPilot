import { AppShell } from "@/components/layout/app-shell";
import { DataControls } from "@/components/settings/data-controls";
export default function SettingsPage(){return <AppShell active="Settings"><div className="saas-page"><header className="page-heading"><div><p className="eyebrow">Tenant administration</p><h1>Settings & data</h1><p>Owner-only export and deletion controls with explicit retention boundaries.</p></div></header><DataControls/></div></AppShell>}
