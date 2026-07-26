import { RefreshCw } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { invoices } from "@/config/booking-demo-data";

export default function InvoicesPage() {
  return <AppShell active="Invoices"><div className="booking-page"><header className="page-heading"><div><p className="eyebrow">QuickBooks references</p><h1>Invoices</h1><p>QuickBooks Online remains the accounting and payment system of record.</p></div><span className="sync-label"><RefreshCw size={15}/> Synced 2 min ago</span></header><section className="panel"><div className="booking-table"><div className="booking-table-head"><span>Project</span><span>Type</span><span>Amount</span><span>Balance</span><span>Status</span></div>{invoices.map((item)=><div key={item.id}><span><strong>{item.project}</strong><small>{item.id} · Due {item.due}</small></span><span>{item.kind}</span><span>{item.amount}</span><span>{item.balance}</span><StatusBadge tone={item.status==="Paid"?"success":"info"}>{item.status}</StatusBadge></div>)}</div></section><p className="source-note">Payment links are QuickBooks-hosted. StudioHub never stores card or bank credentials.</p></div></AppShell>;
}
