"use client";
import { useState } from "react";
import { useHydrated } from "@/lib/react/hydrated";
import { CheckCircle2,Send } from "lucide-react";
import { sendPostEventCommand } from "@/lib/post-event/command-client";
import { friendlyError } from "@/lib/ai/friendly-error";

export function PostEventAction({type,input,label,completedLabel}:{type:string;input:Record<string,unknown>;label:string;completedLabel:string}){
  const interactive=useHydrated();const[done,setDone]=useState(false);const[notice,setNotice]=useState<string|null>(null);
  const run=async()=>{setNotice(null);try{const response=await sendPostEventCommand(type,input);setDone(true);setNotice(response.persisted?completedLabel:`Development preview: ${completedLabel.toLowerCase()} No server record was changed.`)}catch(caught:unknown){setNotice(friendlyError(caught, "The action could not be completed."))}};
  return <div className="post-event-action"><button className="button button-dark" type="button" disabled={!interactive||done} onClick={()=>void run()}>{done?<CheckCircle2 size={16}/>:<Send size={16}/>} {done?completedLabel:label}</button>{notice?<p className="form-notice" role="status">{notice}</p>:null}</div>;
}
