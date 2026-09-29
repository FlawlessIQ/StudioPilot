"use client";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";
import { activeMembership } from "@/lib/firebase/active-membership";
import { markTenantRecordsWritten } from "@/lib/live/record-writes";

/**
 * `idempotencyKey`: pass one to make a retry of the same action the same
 * command — a release keeps its key until it succeeds, so a second press can
 * never become a second release (D1, docs/delivery-plan-2026-09-28.md).
 */
export async function sendPostEventCommand(type:string,input:Record<string,unknown>,idempotencyKey?:string){
  const endpoint=process.env.NEXT_PUBLIC_POST_EVENT_FUNCTIONS_URL;
  if(!endpoint)return{persisted:false,result:{preview:true} as Record<string,unknown>};
  const {auth,firestore}=getFirebaseClient();
  const user=auth.currentUser;if(!user)throw new Error("Sign in before changing post-event records.");
  const membership=await activeMembership(firestore,user.uid);
  const appCheckToken=await getAppCheckToken();
  const response=await fetch(`${endpoint.replace(/\/$/,"")}/postEventCommand`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${await user.getIdToken()}`,...(appCheckToken?{"x-firebase-appcheck":appCheckToken}:{})},body:JSON.stringify({type,tenantId:membership.data().tenantId as string,idempotencyKey:idempotencyKey??crypto.randomUUID(),input})});
  const result=await response.json() as Record<string,unknown>;
  if(!response.ok)throw new Error(typeof result.error==="string"?result.error:"Post-event command failed.");
  markTenantRecordsWritten();
  return{persisted:true,result};
}
