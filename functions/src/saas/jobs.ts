import { getFirestore } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
export const operationsHealthScheduler=onSchedule({schedule:"every 15 minutes",timeZone:"UTC",retryCount:3},async()=>{
  const db=getFirestore();const now=new Date().toISOString();const connections=await db.collection("integrationConnections").where("archivedAt","==",null).limit(200).get();const batch=db.batch();
  for(const connection of connections.docs){const status=connection.get("status")==="connected"?"healthy":"degraded";batch.set(db.doc(`systemHealth/integration_${connection.id}`),{id:`integration_${connection.id}`,tenantId:connection.get("tenantId"),category:"integration",component:String(connection.get("provider")),status,checkedAt:now,latencyMs:null,message:status==="healthy"?null:"Connection requires attention",failureCount:status==="healthy"?0:1,createdAt:now,updatedAt:now,createdBy:"scheduler",updatedBy:"scheduler"},{merge:true})}
  await batch.commit();
});
