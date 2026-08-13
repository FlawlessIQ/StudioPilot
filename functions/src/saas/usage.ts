import type { Firestore,Transaction } from "firebase-admin/firestore";

export async function consumeAiQuota(transaction:Transaction,db:Firestore,tenantId:string,now:string):Promise<void>{
  const subscriptionReference=db.doc(`subscriptions/${tenantId}`);
  const subscription=await transaction.get(subscriptionReference);
  if(!subscription.exists||!["trialing","active"].includes(String(subscription.get("status"))))throw new Error("ACTIVE_SUBSCRIPTION_REQUIRED");
  const limit=Number(subscription.get("entitlements.aiActionsMonthly"));
  if(!Number.isInteger(limit)||limit<=0)throw new Error("AI_ENTITLEMENT_REQUIRED");
  const period=now.slice(0,7);const usageReference=db.doc(`usageCounters/${tenantId}_${period}`);const usage=await transaction.get(usageReference);const current=Number(usage.get("aiActions")??0);
  if(current>=limit)throw new Error("AI_MONTHLY_QUOTA_EXCEEDED");
  transaction.set(usageReference,{id:`${tenantId}_${period}`,tenantId,period,aiActions:current+1,smsSegments:Number(usage.get("smsSegments")??0),apiRequests:Number(usage.get("apiRequests")??0),lastAiActionAt:now,createdAt:usage.get("createdAt")??now,updatedAt:now,createdBy:usage.get("createdBy")??"system",updatedBy:"system"},{merge:true});
}

export async function refundAiQuota(
  transaction: Transaction,
  db: Firestore,
  tenantId: string,
  reservedAt: string,
): Promise<void> {
  const period = reservedAt.slice(0, 7);
  const usageReference = db.doc(`usageCounters/${tenantId}_${period}`);
  const usage = await transaction.get(usageReference);
  if (!usage.exists) return;
  const current = Number(usage.get("aiActions") ?? 0);
  transaction.set(
    usageReference,
    {
      aiActions: Math.max(0, current - 1),
      updatedAt: new Date().toISOString(),
      updatedBy: "system",
    },
    { merge: true },
  );
}
