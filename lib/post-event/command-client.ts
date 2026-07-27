"use client";
import { collection,getDocs,limit,query,where } from "firebase/firestore";
import { getAppCheckToken } from "@/lib/firebase/app-check";
import { getFirebaseClient } from "@/lib/firebase/client";

export async function sendPostEventCommand(type:string,input:Record<string,unknown>){
  const endpoint=process.env.NEXT_PUBLIC_POST_EVENT_FUNCTIONS_URL;
  if(!endpoint)return{persisted:false,result:{preview:true} as Record<string,unknown>};
  const {auth,firestore}=getFirebaseClient();
  const user=auth.currentUser;if(!user)throw new Error("Sign in before changing post-event records.");
  const memberships=await getDocs(query(collection(firestore,"memberships"),where("userId","==",user.uid),where("status","==","active"),limit(1)));
  const membership=memberships.docs[0];if(!membership)throw new Error("No active studio membership was found.");
  const appCheckToken=await getAppCheckToken();
  const response=await fetch(`${endpoint.replace(/\/$/,"")}/postEventCommand`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${await user.getIdToken()}`,...(appCheckToken?{"x-firebase-appcheck":appCheckToken}:{})},body:JSON.stringify({type,tenantId:membership.data().tenantId as string,idempotencyKey:crypto.randomUUID(),input})});
  const result=await response.json() as Record<string,unknown>;
  if(!response.ok)throw new Error(typeof result.error==="string"?result.error:"Post-event command failed.");
  return{persisted:true,result};
}
