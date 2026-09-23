import type { Firestore,Transaction } from "firebase-admin/firestore";

export async function consumeAiQuota(transaction:Transaction,db:Firestore,tenantId:string,now:string):Promise<void>{
  const subscriptionReference=db.doc(`subscriptions/${tenantId}`);
  const subscription=await transaction.get(subscriptionReference);
  if(!subscription.exists||!["trialing","active"].includes(String(subscription.get("status"))))throw new Error("ACTIVE_SUBSCRIPTION_REQUIRED");
  const limit=Number(subscription.get("entitlements.aiActionsMonthly"));
  if(!Number.isInteger(limit)||limit<=0)throw new Error("AI_ENTITLEMENT_REQUIRED");
  /**
   * A studio can switch its own AI off.
   *
   * Until now the only way to stop StudioCue using AI on a tenant was to
   * cancel the subscription, which takes the whole product with it. A studio
   * with a concern — a client who does not want AI near their file, a bill
   * they want to stop — had nothing to reach for, and support had nothing to
   * pull. `aiPausedAt` on the tenant is that switch: everything else keeps
   * working, and every AI path refuses the same way because they all pass
   * through here.
   */
  const tenant=await transaction.get(db.doc(`tenants/${tenantId}`));
  if(typeof tenant.get("aiPausedAt")==="string")throw new Error("AI_PAUSED_BY_STUDIO");

  const period=now.slice(0,7);const usageReference=db.doc(`usageCounters/${tenantId}_${period}`);const usage=await transaction.get(usageReference);const current=Number(usage.get("aiActions")??0);
  if(current>=limit)throw new Error("AI_MONTHLY_QUOTA_EXCEEDED");

  /**
   * A month's allowance is not a day's allowance.
   *
   * The monthly cap stops a studio spending more than it bought; it does
   * nothing about spending all of it before lunch. A loop, a retry storm or a
   * script can burn 2,500 actions in an hour, and the first anyone knows is
   * the bill — or a studio locked out for the rest of the month through no
   * fault of its own.
   *
   * A day's share of the month, with a floor so a small plan is still usable
   * and headroom so a genuinely busy Monday is not refused. Resets at midnight
   * UTC, so it costs a runaway a day and costs an honest studio nothing.
   */
  const day=now.slice(0,10);
  const dailyLimit=Math.max(50,Math.ceil((limit/28)*3));
  const dailyReference=db.doc(`usageCounters/${tenantId}_${day}`);
  const daily=await transaction.get(dailyReference);
  const today=Number(daily.get("aiActions")??0);
  if(today>=dailyLimit)throw new Error("AI_DAILY_QUOTA_EXCEEDED");

  transaction.set(usageReference,{id:`${tenantId}_${period}`,tenantId,period,aiActions:current+1,smsSegments:Number(usage.get("smsSegments")??0),apiRequests:Number(usage.get("apiRequests")??0),lastAiActionAt:now,createdAt:usage.get("createdAt")??now,updatedAt:now,createdBy:usage.get("createdBy")??"system",updatedBy:"system"},{merge:true});
  transaction.set(dailyReference,{id:`${tenantId}_${day}`,tenantId,period:day,aiActions:today+1,lastAiActionAt:now,createdAt:daily.get("createdAt")??now,updatedAt:now,createdBy:daily.get("createdBy")??"system",updatedBy:"system"},{merge:true});
}

/**
 * Give back an action that was reserved and then failed.
 *
 * Both counters, because `consumeAiQuota` now takes from both. Refunding only
 * the month would leave a studio's day quietly spent by calls that never
 * happened — and a provider outage that failed fifty times would lock them out
 * of their own afternoon.
 */
export async function refundAiQuota(
  transaction: Transaction,
  db: Firestore,
  tenantId: string,
  reservedAt: string,
): Promise<void> {
  const now = new Date().toISOString();
  for (const key of [reservedAt.slice(0, 7), reservedAt.slice(0, 10)]) {
    const usageReference = db.doc(`usageCounters/${tenantId}_${key}`);
    const usage = await transaction.get(usageReference);
    if (!usage.exists) continue;
    const current = Number(usage.get("aiActions") ?? 0);
    transaction.set(
      usageReference,
      {
        aiActions: Math.max(0, current - 1),
        updatedAt: now,
        updatedBy: "system",
      },
      { merge: true },
    );
  }
}
