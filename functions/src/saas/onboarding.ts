import { createHash,randomUUID } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { z } from "zod";
import { requireAppCheck,requireIdentity } from "../crm/security.js";

const inputSchema=z.object({businessName:z.string().trim().min(2).max(120),legalName:z.string().trim().min(2).max(160),timezone:z.string().min(1).max(80),currency:z.string().length(3).transform(value=>value.toUpperCase())});
const soloEntitlements={maxInternalUsers:1,maxBrands:1,maxActiveSubcontractors:10,aiActionsMonthly:500,smsEnabled:false,coiEnabled:false,customWorkflowsEnabled:false,advancedReportingEnabled:false,apiAccessEnabled:false,prioritySupportEnabled:false};
const slug=(value:string)=>value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,48)||"studio";

export const tenantOnboardingCommand=onRequest({cors:[/localhost/,/\.studiohub\.app$/, /\.flawlessiq\.chatgpt\.site$/],invoker:"public"},async(request,response)=>{
  if(request.method!=="POST"){response.status(405).json({error:"METHOD_NOT_ALLOWED"});return}
  try{await requireAppCheck(request);const identity=await requireIdentity(request);if(identity.email_verified!==true||typeof identity.email!=="string")throw new Error("VERIFIED_EMAIL_REQUIRED");const input=inputSchema.parse(request.body);const db=getFirestore();const now=new Date().toISOString();const onboardingReference=db.doc(`tenantOnboarding/${identity.uid}`);
    const result=await db.runTransaction(async transaction=>{const existing=await transaction.get(onboardingReference);if(existing.exists)return{tenantId:String(existing.get("tenantId")),created:false};const tenantId=`tenant_${randomUUID()}`;const membershipId=`${tenantId}_${identity.uid}`;const publicSlug=`${slug(input.businessName)}-${createHash("sha256").update(identity.uid).digest("hex").slice(0,8)}`;const trialEndAt=new Date(Date.now()+14*86400000).toISOString();
      transaction.set(db.doc(`users/${identity.uid}`),{id:identity.uid,tenantId:"platform",email:identity.email,displayName:String(identity.name??input.businessName),emailVerified:true,photoUrl:identity.picture??null,phone:null,lastLoginAt:now,createdAt:now,updatedAt:now,createdBy:identity.uid,updatedBy:identity.uid,archivedAt:null},{merge:true});
      transaction.create(db.doc(`tenants/${tenantId}`),{id:tenantId,tenantId,businessName:input.businessName,legalName:input.legalName,brandName:input.businessName,publicSlug,timezone:input.timezone,currency:input.currency,dateFormat:"MMM d, yyyy",status:"trial",subscriptionPlan:"solo",trialEndAt,createdAt:now,updatedAt:now,createdBy:identity.uid,updatedBy:identity.uid,archivedAt:null});
      transaction.create(db.doc(`memberships/${membershipId}`),{id:membershipId,tenantId,userId:identity.uid,role:"studio_owner",explicitPermissions:[],projectIds:[],status:"active",createdAt:now,updatedAt:now,createdBy:identity.uid,updatedBy:identity.uid,archivedAt:null});
      transaction.create(db.doc(`subscriptions/${tenantId}`),{id:tenantId,tenantId,plan:"solo",cadence:"monthly",status:"trialing",stripeCustomerId:null,stripeSubscriptionId:null,stripePriceId:null,currentPeriodStart:now,currentPeriodEnd:trialEndAt,cancelAtPeriodEnd:false,entitlements:soloEntitlements,internalUserCount:1,brandCount:1,activeSubcontractorCount:0,createdAt:now,updatedAt:now,createdBy:identity.uid,updatedBy:identity.uid,archivedAt:null});
      transaction.create(onboardingReference,{userId:identity.uid,tenantId,createdAt:now});
      transaction.create(db.doc(`auditEvents/onboarding_${identity.uid}`),{id:`onboarding_${identity.uid}`,tenantId,projectId:null,actorId:identity.uid,actorType:"user",action:"tenant.created",entityType:"tenant",entityId:tenantId,timestamp:now,before:null,after:{businessName:input.businessName,plan:"solo",status:"trial"},ipAddress:request.ip??null,userAgent:request.get("user-agent")??null,correlationId:identity.uid,automationRunId:null,providerEventId:null});
      return{tenantId,created:true}});
    response.status(200).json(result)
  }catch(caught:unknown){const message=caught instanceof Error?caught.message:"ONBOARDING_FAILED";response.status(message==="VERIFIED_EMAIL_REQUIRED"?403:400).json({error:message})}
});
