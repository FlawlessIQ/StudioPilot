"use client";
import { useEffect,useState } from "react";
import { ArrowRight,CreditCard } from "lucide-react";
import { getFirebaseClient } from "@/lib/firebase/client";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { activeMembership } from "@/lib/firebase/active-membership";
import { friendlyError } from "@/lib/ai/friendly-error";

export function BillingAction({plan,cadence,label}:{plan?:"solo"|"studio"|"multi_brand";cadence?:"monthly"|"yearly";label:string}){
  const[interactive,setInteractive]=useState(false);const[notice,setNotice]=useState<string|null>(null);
  useEffect(()=>{const frame=requestAnimationFrame(()=>setInteractive(true));return()=>cancelAnimationFrame(frame)},[]);
  const run=async()=>{const endpoint=process.env.NEXT_PUBLIC_BILLING_FUNCTIONS_URL;if(!endpoint){setNotice("Development preview: Stripe Checkout was not opened and no subscription changed.");return}try{const {auth,firestore}=getFirebaseClient();const user=auth.currentUser;if(!user)throw new Error("Sign in to manage billing.");const membership=await activeMembership(firestore,user.uid);const tenantId=membership.data().tenantId;if(typeof tenantId!=="string")throw new Error("No active studio membership was found.");const token=await getAppCheckToken();const response=await fetch(`${endpoint.replace(/\/$/,"")}/billingCommand`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${await user.getIdToken()}`,...(token?{"x-firebase-appcheck":token}:{})},body:JSON.stringify({type:plan?"createCheckout":"createPortal",tenantId,plan,cadence})});const result=await response.json() as {url?:string;error?:string};if(!response.ok||!result.url)throw new Error(result.error??"Billing could not be opened.");window.location.assign(result.url)}catch(caught:unknown){setNotice(friendlyError(caught, "Billing could not be opened."))}};
  return <div className="billing-action"><button className="button button-dark" type="button" disabled={!interactive} onClick={()=>void run()}>{plan?<ArrowRight size={16}/>:<CreditCard size={16}/>} {label}</button>{notice?<p className="form-notice" role="status">{notice}</p>:null}</div>;
}
