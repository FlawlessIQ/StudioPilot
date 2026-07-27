"use client";
import { useEffect,useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { signOut } from "firebase/auth";
import { collection,getDocs,limit,query,where } from "firebase/firestore";
import { getFirebaseClient } from "@/lib/firebase/client";
type Area="studio"|"client"|"crew"|"platform";
const allowed:Record<Exclude<Area,"platform">,string[]>={studio:["studio_owner","studio_admin","studio_coordinator","staff_photographer"],client:["client"],crew:["subcontractor"]};
export function AuthBoundary({area,children}:{area:Area;children:React.ReactNode}){const router=useRouter();const[authorized,setAuthorized]=useState(process.env.NEXT_PUBLIC_INTEGRATION_MODE!=="live");useEffect(()=>{if(process.env.NEXT_PUBLIC_INTEGRATION_MODE!=="live")return;const{auth,firestore}=getFirebaseClient();return onAuthStateChanged(auth,user=>{void(async()=>{if(!user){router.replace("/auth/login");return}if(area==="platform"){const token=await user.getIdTokenResult();if(token.claims.platformAdmin!==true){router.replace("/studio");return}setAuthorized(true);return}const memberships=await getDocs(query(collection(firestore,"memberships"),where("userId","==",user.uid),where("status","==","active"),limit(10)));const permitted=memberships.docs.some(document=>allowed[area].includes(String(document.data().role)));if(!permitted){router.replace(area==="studio"?"/auth/onboarding":"/studio");return}setAuthorized(true)})()})},[area,router]);return authorized?<>{children}</>:<main className="auth-loading" aria-live="polite"><span>Verifying access…</span></main>}
export function SignOutButton({className}:{className?:string}){const router=useRouter();async function leave(){if(process.env.NEXT_PUBLIC_INTEGRATION_MODE==="live"){const{auth}=getFirebaseClient();await signOut(auth)}router.push("/auth/login")}return <button className={className} type="button" onClick={()=>void leave()}>Sign out</button>}
