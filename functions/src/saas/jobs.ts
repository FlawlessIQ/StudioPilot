import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
export const operationsHealthScheduler=onSchedule({schedule:"every 15 minutes",timeZone:"UTC",retryCount:3},async()=>{
  const db=getFirestore();const now=new Date().toISOString();const [connections,deadProviderJobs,deadEmailJobs,deadAiJobs,deadPdfJobs,activeSupport,oauthStates]=await Promise.all([
    db.collection("integrationConnections").where("archivedAt","==",null).limit(200).get(),
    db.collection("providerJobs").where("status","==","dead_letter").limit(100).get(),
    db.collection("emailJobs").where("status","==","dead_letter").limit(100).get(),
    db.collection("aiJobs").where("status","==","dead_letter").limit(100).get(),
    db.collection("pdfJobs").where("status","==","dead_letter").limit(100).get(),
    db.collection("supportAccess").where("status","==","active").limit(100).get(),
    db.collection("oauthStates").where("expiresAt","<=",now).limit(100).get(),
  ]);const batch=db.batch();
  for(const connection of connections.docs){const status=connection.get("status")==="connected"?"healthy":"degraded";batch.set(db.doc(`systemHealth/integration_${connection.id}`),{id:`integration_${connection.id}`,tenantId:connection.get("tenantId"),category:"integration",component:String(connection.get("provider")),status,checkedAt:now,latencyMs:null,message:status==="healthy"?null:"Connection requires attention",failureCount:status==="healthy"?0:1,createdAt:now,updatedAt:now,createdBy:"scheduler",updatedBy:"scheduler"},{merge:true})}
  for(const access of activeSupport.docs)if(new Date(String(access.get("expiresAt")))<=new Date(now))batch.update(access.ref,{status:"expired",updatedAt:now,updatedBy:"scheduler"});
  for(const state of oauthStates.docs)batch.delete(state.ref);
  for(const [component,snapshot] of [["provider_jobs",deadProviderJobs],["email_jobs",deadEmailJobs],["ai_jobs",deadAiJobs],["pdf_jobs",deadPdfJobs]] as const){batch.set(db.doc(`systemHealth/platform_${component}`),{id:`platform_${component}`,tenantId:null,category:"background_job",component,status:snapshot.empty?"healthy":"degraded",checkedAt:now,latencyMs:null,message:snapshot.empty?null:`${snapshot.size} dead-letter jobs require attention`,failureCount:snapshot.size,createdAt:now,updatedAt:now,createdBy:"scheduler",updatedBy:"scheduler"},{merge:true})}
  await batch.commit();
  console.info(JSON.stringify({severity:"INFO",event:"operations.health.completed",checkedAt:now,connections:connections.size,deadLetters:{provider:deadProviderJobs.size,email:deadEmailJobs.size,ai:deadAiJobs.size,pdf:deadPdfJobs.size}}));
});
