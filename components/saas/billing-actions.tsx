"use client";
import { useEffect, useState } from "react";
import { useHydrated } from "@/lib/react/hydrated";
import { ArrowRight,CreditCard,LoaderCircle } from "lucide-react";
import { getFirebaseClient } from "@/lib/firebase/client";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { activeMembership } from "@/lib/firebase/active-membership";
import { friendlyError } from "@/lib/ai/friendly-error";
import { rememberedPromotionCode } from "@/features/subscriptions/promotion-code";

/**
 * Opens Stripe: Checkout for a plan, the customer portal without one.
 *
 * Creating the Checkout session takes a second or more (longer on a cold
 * start), and the button gave no sign it had been pressed: on the last step
 * of signup a studio pressed again, or decided it hadn't worked (onboarding
 * audit, 2026-10-24). It says what it's doing until Stripe opens.
 */
export function BillingAction({plan,cadence,label,tone="dark",ariaLabel}:{plan?:"studio"|"multi_brand"|"vendor";cadence?:"monthly"|"yearly";label:string;tone?:"dark"|"light";ariaLabel?:string}){
  const interactive=useHydrated();const[notice,setNotice]=useState<string|null>(null);const[busy,setBusy]=useState(false);
  // Back from Stripe with the browser's back button: the page comes back from the cache still saying it's opening checkout.
  useEffect(()=>{const reset=(event:PageTransitionEvent)=>{if(event.persisted)setBusy(false)};window.addEventListener("pageshow",reset);return()=>window.removeEventListener("pageshow",reset)},[]);
  const run=async()=>{const endpoint=process.env.NEXT_PUBLIC_BILLING_FUNCTIONS_URL;if(!endpoint){setNotice("Development preview: Stripe Checkout was not opened and no subscription changed.");return}setBusy(true);setNotice(null);try{const {auth,firestore}=getFirebaseClient();const user=auth.currentUser;if(!user)throw new Error("Sign in to manage billing.");const membership=await activeMembership(firestore,user.uid);const tenantId=membership.data().tenantId;if(typeof tenantId!=="string")throw new Error("No active studio membership was found.");const token=await getAppCheckToken();const response=await fetch(`${endpoint.replace(/\/$/,"")}/billingCommand`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${await user.getIdToken()}`,...(token?{"x-firebase-appcheck":token}:{})},body:JSON.stringify({type:plan?"createCheckout":"createPortal",tenantId,plan,cadence,...(plan?{promotionCode:rememberedPromotionCode()??undefined}:{})})});const result=await response.json() as {url?:string;error?:string};if(!response.ok||!result.url)throw new Error(result.error??"Billing could not be opened.");window.location.assign(result.url)}catch(caught:unknown){setBusy(false);setNotice(friendlyError(caught, "Billing could not be opened."))}};
  const buttonClass=tone==="light"?"button button-light":"button button-dark";
  return <div className="billing-action"><button aria-label={busy?undefined:ariaLabel} className={buttonClass} type="button" disabled={!interactive||busy} onClick={()=>void run()}>{busy?<LoaderCircle className="spin" size={16}/>:plan?<ArrowRight size={16}/>:<CreditCard size={16}/>} {busy?(plan?"Opening secure checkout…":"Opening billing…"):label}</button>{notice?<p className="form-notice" role="status">{notice}</p>:null}</div>;
}
