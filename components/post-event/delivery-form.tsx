"use client";
import { useEffect,useState,type FormEvent } from "react";
import { Send } from "lucide-react";
import { sendPostEventCommand } from "@/lib/post-event/command-client";

export function DeliveryForm(){
  const[interactive,setInteractive]=useState(false);const[notice,setNotice]=useState<string|null>(null);
  useEffect(()=>{const frame=requestAnimationFrame(()=>setInteractive(true));return()=>cancelAnimationFrame(frame)},[]);
  const submit=async(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const response=await sendPostEventCommand("recordDelivery",{projectId:"wedding-post",provider:"manual",galleryUrl:String(data.get("galleryUrl")),accessCode:String(data.get("accessCode"))||null,expirationDate:"2027-07-28",deliveryDate:"2026-07-28",notes:"Full gallery delivery",reviewDestinationUrl:"https://example.com/alder-muse-google-review"});setNotice(response.persisted?"Delivery recorded; project advanced and review requests scheduled.":"Development preview: delivery gates passed; no record, email, or project state was changed.")}catch(caught:unknown){setNotice(caught instanceof Error?caught.message:"Delivery could not be recorded.")}};
  return <form className="delivery-form" onSubmit={submit}><label>Secure gallery URL<input name="galleryUrl" type="url" defaultValue="https://gallery.example.test/emma-noah" required/></label><label>Access code<input name="accessCode" defaultValue="REED"/></label><button className="button button-dark" type="submit" disabled={!interactive}><Send size={16}/> Record &amp; send delivery</button>{notice?<p className="form-notice" role="status">{notice}</p>:null}</form>;
}
