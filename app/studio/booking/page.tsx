import { CheckCircle2, CircleAlert, FolderCheck } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { bookingProjects } from "@/config/booking-demo-data";

export default function BookingPage() {
  return <AppShell active="Booking"><div className="booking-page"><header className="page-heading"><div><p className="eyebrow">Deterministic gate</p><h1>Booking readiness</h1><p>Contract, accounting, availability, and contact evidence must all pass exactly once.</p></div></header><div className="booking-gate-grid">{bookingProjects.map((item)=><article className="panel booking-gate-card" key={item.id}><div><span><small>{item.id}</small><h2>{item.project}</h2></span><StatusBadge tone={item.blockers===0?"success":"warning"}>{item.state}</StatusBadge></div><div className="gate-score"><strong>{item.score}%</strong><span><i style={{width:`${item.score}%`}}/></span></div><ul>{item.checks.map((check)=><li key={check}>{check.toLowerCase().includes("unpaid")||check.toLowerCase().includes("incomplete")||check.toLowerCase().includes("not created")?<CircleAlert size={16}/>:<CheckCircle2 size={16}/>} {check}</li>)}</ul><footer>{item.blockers===0?<><FolderCheck size={17}/> Booking side effects completed idempotently</>:<><CircleAlert size={17}/> {item.blockers} blocker{item.blockers===1?"":"s"} prevent booking</>}</footer></article>)}</div></div></AppShell>;
}
