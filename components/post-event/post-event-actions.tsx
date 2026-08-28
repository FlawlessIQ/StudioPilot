"use client";
import { useState } from "react";
import { useHydrated } from "@/lib/react/hydrated";
import { CheckCircle2,Download,Printer,Send } from "lucide-react";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

export function PostEventAction({type,input,label,completedLabel}:{type:string;input:Record<string,unknown>;label:string;completedLabel:string}){
  const interactive=useHydrated();const[done,setDone]=useState(false);const[notice,setNotice]=useState<string|null>(null);
  const run=async()=>{setNotice(null);try{const response=await sendPostEventCommand(type,input);setDone(true);setNotice(response.persisted?completedLabel:`Development preview: ${completedLabel.toLowerCase()} No server record was changed.`)}catch(caught:unknown){setNotice(friendlyError(caught, "The action could not be completed."))}};
  return <div className="post-event-action"><button className="button button-dark" type="button" disabled={!interactive||done} onClick={()=>void run()}>{done?<CheckCircle2 size={16}/>:<Send size={16}/>} {done?completedLabel:label}</button>{notice?<p className="form-notice" role="status">{notice}</p>:null}</div>;
}

export function ReportCsvExport(){
  const download=()=>{const rows=[["Metric","Value"],["Booking conversion","42%"],["Average booking value","684000 cents"],["Event readiness","86%"],["Automation reliability","98.7%"]];const csv=rows.map(row=>row.join(",")).join("\n");const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));link.download="studiocue-report-2026-07.csv";link.click();URL.revokeObjectURL(link.href)};
  return <button className="button button-light" type="button" onClick={download}><Download size={16}/> Export CSV</button>;
}

export function PrintReportButton(){
  return <button className="button button-light" type="button" onClick={()=>window.print()}><Printer size={16}/> Print report</button>;
}
