import { createHmac,timingSafeEqual } from "node:crypto";
import type { Entitlements } from "@/features/subscriptions/entitlements";
import type { Subscription,UsageCounter } from "@/features/subscriptions/schema";

export function assertSubscriptionCapacity(subscription:Subscription,resource:"internal_user"|"brand"|"subcontractor"){
  const {entitlements}=subscription;
  if(resource==="internal_user"&&subscription.internalUserCount>=entitlements.maxInternalUsers)throw new Error("INTERNAL_USER_LIMIT_REACHED");
  if(resource==="brand"&&subscription.brandCount>=entitlements.maxBrands)throw new Error("BRAND_LIMIT_REACHED");
  if(resource==="subcontractor"&&entitlements.maxActiveSubcontractors!==null&&subscription.activeSubcontractorCount>=entitlements.maxActiveSubcontractors)throw new Error("SUBCONTRACTOR_LIMIT_REACHED");
}
export function consumeAiAction(usage:UsageCounter,entitlements:Entitlements,occurredAt:string):UsageCounter{
  if(usage.aiActions>=entitlements.aiActionsMonthly)throw new Error("AI_MONTHLY_QUOTA_EXCEEDED");
  return{...usage,aiActions:usage.aiActions+1,lastAiActionAt:occurredAt,updatedAt:occurredAt,updatedBy:"system"};
}
export function remainingAiActions(usage:UsageCounter,entitlements:Entitlements){return Math.max(0,entitlements.aiActionsMonthly-usage.aiActions)}
export function verifyStripeSignature(rawBody:string,header:string,secret:string,nowSeconds:number,toleranceSeconds=300){
  const parts=Object.fromEntries(header.split(",").map(part=>part.split("=",2) as [string,string]));
  const timestamp=Number(parts.t);const signature=parts.v1;
  if(!Number.isFinite(timestamp)||!signature||Math.abs(nowSeconds-timestamp)>toleranceSeconds)return false;
  const expected=createHmac("sha256",secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const received=Buffer.from(signature);const expectedBuffer=Buffer.from(expected);
  return received.length===expectedBuffer.length&&timingSafeEqual(received,expectedBuffer);
}
