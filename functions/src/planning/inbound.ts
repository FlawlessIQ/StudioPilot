import { createHash, timingSafeEqual } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { consumeAiQuota } from "../saas/usage.js";
const payload = z.object({ messageId: z.string(), replyToken: z.string().min(20), filename: z.string().endsWith(".pdf"), contentType: z.literal("application/pdf"), sizeBytes: z.number().int().positive().max(15*1024*1024), temporaryObject: z.string().min(1) });
function equal(a: string|undefined,b: string|undefined){if(!a||!b)return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export const sendgridInboundCoi = onRequest({ cors: false, invoker: "public", secrets: ["SENDGRID_INBOUND_TOKEN"] }, async (request,response)=>{
  if(request.method!=="POST"||!equal(request.header("x-studiohub-inbound-token"),process.env.SENDGRID_INBOUND_TOKEN)){response.status(401).json({error:"INVALID_INBOUND_TOKEN"});return;}
  const parsed=payload.safeParse(request.body);if(!parsed.success){response.status(400).json({error:"INVALID_PAYLOAD"});return;}
  const db=getFirestore();const tokenHash=createHash("sha256").update(parsed.data.replyToken).digest("hex");
  const requests=await db.collection("insuranceRequests").where("replyTokenHash","==",tokenHash).limit(1).get();
  const coi=requests.docs[0];if(!coi){response.status(404).json({error:"REQUEST_NOT_FOUND"});return;}
  const event=db.doc(`webhookEvents/sendgrid_${parsed.data.messageId}`);
  await db.runTransaction(async tx=>{if((await tx.get(event)).exists)return;const now=new Date().toISOString();await consumeAiQuota(tx,db,String(coi.get("tenantId")),now);tx.create(event,{tenantId:coi.get("tenantId"),provider:"sendgrid",providerEventId:parsed.data.messageId,status:"processed",createdAt:now});tx.update(coi.ref,{status:"received",inboundMessageId:parsed.data.messageId,receivedAt:now,temporaryObject:parsed.data.temporaryObject,updatedAt:now,updatedBy:"sendgrid-inbound"});tx.create(db.doc(`aiJobs/coi_${coi.id}`),{tenantId:coi.get("tenantId"),projectId:coi.get("projectId"),type:"coi_extraction",status:"queued",humanApprovalRequired:true,createdAt:now});});
  response.status(204).send();
});
