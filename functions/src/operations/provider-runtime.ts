import { createHash } from "node:crypto";
import { getFirestore,type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

export type Provider="google_calendar"|"zoom"|"dropbox"|"docusign"|"quickbooks";
type Credential={
  accessToken:string;
  refreshToken?:string;
  expiresAt?:string;
  baseUrl?:string;
  accountId?:string;
  realmId?:string;
};
type Json=Record<string,unknown>;
const asRecord=(value:unknown):Json=>typeof value==="object"&&value!==null&&!Array.isArray(value)?value as Json:{};
const text=(value:unknown)=>typeof value==="string"?value:"";
const number=(value:unknown)=>typeof value==="number"?value:Number(value);

async function googleAccessToken():Promise<string>{const response=await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",{headers:{"Metadata-Flavor":"Google"}});if(!response.ok)throw new Error("SECRET_MANAGER_IDENTITY_UNAVAILABLE");const body=asRecord(await response.json());const token=text(body.access_token);if(!token)throw new Error("SECRET_MANAGER_IDENTITY_UNAVAILABLE");return token}
async function readSecret(reference:string):Promise<Credential>{
  if(!/^projects\/[^/]+\/secrets\/[^/]+\/versions\/[^/]+$/.test(reference))throw new Error("INVALID_SECRET_REFERENCE");
  const token=await googleAccessToken();
  const response=await fetch(`https://secretmanager.googleapis.com/v1/${reference}:access`,{headers:{authorization:`Bearer ${token}`}});
  if(!response.ok)throw new Error("CREDENTIAL_UNAVAILABLE");
  const payload=asRecord(asRecord(await response.json()).payload);
  const encoded=text(payload.data);
  if(!encoded)throw new Error("CREDENTIAL_UNAVAILABLE");
  const parsed=asRecord(JSON.parse(Buffer.from(encoded,"base64").toString("utf8")));
  const accessToken=text(parsed.accessToken);
  if(!accessToken)throw new Error("CREDENTIAL_UNAVAILABLE");
  return{
    accessToken,
    refreshToken:text(parsed.refreshToken)||undefined,
    expiresAt:text(parsed.expiresAt)||undefined,
    baseUrl:text(parsed.baseUrl)||undefined,
    accountId:text(parsed.accountId)||undefined,
    realmId:text(parsed.realmId)||undefined,
  };
}
const clientPrefix=(provider:Provider)=>provider==="google_calendar"?"GOOGLE_CALENDAR":provider.toUpperCase();
const tokenUrl=(provider:Provider)=>({
  google_calendar:"https://oauth2.googleapis.com/token",
  zoom:"https://zoom.us/oauth/token",
  dropbox:"https://api.dropboxapi.com/oauth2/token",
  docusign:"https://account-d.docusign.com/oauth/token",
  quickbooks:"https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer",
})[provider];
async function refreshCredential(reference:string,provider:Provider,current:Credential):Promise<Credential>{
  if(!current.expiresAt||new Date(current.expiresAt).valueOf()>Date.now()+5*60_000)return current;
  if(!current.refreshToken)throw new Error(`${provider.toUpperCase()}_REAUTHORIZATION_REQUIRED`);
  const prefix=clientPrefix(provider);
  const clientId=process.env[`${prefix}_CLIENT_ID`];
  const clientSecret=process.env[`${prefix}_CLIENT_SECRET`];
  if(!clientId||!clientSecret)throw new Error(`${provider.toUpperCase()}_REFRESH_NOT_CONFIGURED`);
  const params=new URLSearchParams({grant_type:"refresh_token",refresh_token:current.refreshToken});
  const headers:Record<string,string>={"content-type":"application/x-www-form-urlencoded"};
  if(provider==="google_calendar"){
    params.set("client_id",clientId);
    params.set("client_secret",clientSecret);
  }else{
    headers.authorization=`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  }
  const response=await fetch(tokenUrl(provider),{method:"POST",headers,body:params});
  const body=asRecord(await response.json().catch(()=>({})));
  const accessToken=text(body.access_token);
  if(!response.ok||!accessToken)throw new Error(`${provider.toUpperCase()}_TOKEN_REFRESH_FAILED`);
  const next:Credential={
    ...current,
    accessToken,
    refreshToken:text(body.refresh_token)||current.refreshToken,
    expiresAt:new Date(Date.now()+number(body.expires_in||3600)*1000).toISOString(),
  };
  const runtimeToken=await googleAccessToken();
  const secretName=reference.replace(/\/versions\/[^/]+$/,"");
  const save=await fetch(`https://secretmanager.googleapis.com/v1/${secretName}:addVersion`,{
    method:"POST",
    headers:{authorization:`Bearer ${runtimeToken}`,"content-type":"application/json"},
    body:JSON.stringify({payload:{data:Buffer.from(JSON.stringify(next)).toString("base64")}}),
  });
  if(!save.ok)throw new Error("CREDENTIAL_REFRESH_SAVE_FAILED");
  return next;
}
async function connection(tenantId:string,provider:Provider){
  const snapshot=await getFirestore().collection("integrationConnections").where("tenantId","==",tenantId).where("provider","==",provider).where("status","==","connected").limit(1).get();
  const document=snapshot.docs[0];
  if(!document)throw new Error(`${provider.toUpperCase()}_NOT_CONNECTED`);
  if(document.get("mockMode")===true)return{document,mock:true,credential:null};
  const reference=text(document.get("encryptedCredentialRef"));
  if(!reference)throw new Error(`${provider.toUpperCase()}_CREDENTIAL_MISSING`);
  try{
    const credential=await refreshCredential(reference,provider,await readSecret(reference));
    if(credential.expiresAt&&new Date(credential.expiresAt).valueOf()<=Date.now()+5*60_000)throw new Error("CREDENTIAL_EXPIRED");
    return{document,mock:false,credential};
  }catch(caught:unknown){
    await document.ref.update({status:"error",lastError:caught instanceof Error?caught.message:"CREDENTIAL_FAILED",updatedAt:new Date().toISOString()});
    throw caught;
  }
}

export async function checkProviderConnection(tenantId:string,provider:Provider){
  const current=await connection(tenantId,provider);
  const now=new Date().toISOString();
  if(current.mock){
    await current.document.ref.update({lastHealthCheckAt:now,lastError:null,updatedAt:now});
    return{provider,status:"connected",mockMode:true};
  }
  const credential=current.credential;
  if(!credential)throw new Error("CREDENTIAL_UNAVAILABLE");
  const probes:Record<Provider,()=>Promise<Response>>={
    google_calendar:()=>fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1",{headers:{authorization:`Bearer ${credential.accessToken}`}}),
    zoom:()=>fetch("https://api.zoom.us/v2/users/me",{headers:{authorization:`Bearer ${credential.accessToken}`}}),
    dropbox:()=>fetch("https://api.dropboxapi.com/2/users/get_current_account",{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`}}),
    docusign:()=>fetch("https://account-d.docusign.com/oauth/userinfo",{headers:{authorization:`Bearer ${credential.accessToken}`}}),
    quickbooks:()=>fetch(`https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(credential.realmId??String(current.document.get("providerAccountId")??""))}/companyinfo/${encodeURIComponent(credential.realmId??String(current.document.get("providerAccountId")??""))}?minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json"}}),
  };
  const response=await probes[provider]();
  if(!response.ok){
    const code=`${provider.toUpperCase()}_HEALTH_FAILED:${response.status}`;
    await current.document.ref.update({status:"error",lastHealthCheckAt:now,lastError:code,updatedAt:now});
    throw new Error(code);
  }
  await current.document.ref.update({status:"connected",lastHealthCheckAt:now,lastError:null,updatedAt:now});
  return{provider,status:"connected",mockMode:false};
}
async function providerJson(url:string,init:RequestInit,code:string):Promise<Json>{const response=await fetch(url,init);const body=asRecord(await response.json().catch(()=>({})));if(!response.ok)throw new Error(`${code}:${response.status}:${text(asRecord(body.error).message)||text(body.message)||"PROVIDER_ERROR"}`);return body}
const mockId=(scope:string,id:string)=>`mock_${scope}_${createHash("sha256").update(id).digest("hex").slice(0,16)}`;

export async function createConsultationResources(job:DocumentSnapshot){const db=getFirestore();const consultationId=job.id.replace(/^consultation_/,"");const consultationReference=db.doc(`consultations/${consultationId}`);let consultation=await consultationReference.get();if(!consultation.exists)throw new Error("CONSULTATION_NOT_FOUND");const tenantId=String(job.get("tenantId"));let meetingId:string|null=consultation.get("meetingId")||null;let joinUrl:string|null=consultation.get("joinUrl")||null;
  if(consultation.get("providerState")==="completed")return{consultationId,meetingId:consultation.get("meetingId"),calendarEventId:consultation.get("calendarEventId")};
  if(consultation.get("mode")==="zoom"&&!meetingId){const zoom=await connection(tenantId,"zoom");if(zoom.mock){meetingId=mockId("zoom",job.id);joinUrl=`https://zoom.example.test/j/${meetingId}`}else{const value=await providerJson(`${zoom.credential?.baseUrl??"https://api.zoom.us"}/v2/users/me/meetings`,{method:"POST",headers:{authorization:`Bearer ${zoom.credential?.accessToken}`,"content-type":"application/json"},body:JSON.stringify({topic:"Photography consultation",type:2,start_time:consultation.get("startsAt"),duration:Math.max(1,Math.round((new Date(String(consultation.get("endsAt"))).valueOf()-new Date(String(consultation.get("startsAt"))).valueOf())/60000)),timezone:consultation.get("timezone"),settings:{waiting_room:true,auto_recording:"none"}})},"ZOOM_CREATE_FAILED");meetingId=String(value.id);joinUrl=text(value.join_url)}await consultationReference.update({meetingId,joinUrl,location:joinUrl??consultation.get("location"),providerState:"meeting_created",updatedAt:new Date().toISOString(),updatedBy:"provider-worker"});consultation=await consultationReference.get()}
  const calendar=await connection(tenantId,"google_calendar");let calendarEventId=String(consultation.get("calendarEventId")??"");let calendarHtmlLink:string|null=consultation.get("calendarHtmlLink")??null;if(!calendarEventId&&calendar.mock){calendarEventId=mockId("gcal",job.id);calendarHtmlLink=`https://calendar.example.test/${calendarEventId}`}else if(!calendarEventId){const calendarId=encodeURIComponent(String(calendar.document.get("selectedResourceId")??"primary"));const providerEventId=createHash("sha256").update(`consultation:${consultationId}`).digest("hex").slice(0,32);const url=`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;const create=await fetch(url,{method:"POST",headers:{authorization:`Bearer ${calendar.credential?.accessToken}`,"content-type":"application/json"},body:JSON.stringify({id:providerEventId,summary:"Photography consultation",description:joinUrl??"StudioCue consultation",start:{dateTime:consultation.get("startsAt"),timeZone:consultation.get("timezone")},end:{dateTime:consultation.get("endsAt"),timeZone:consultation.get("timezone")},extendedProperties:{private:{studioHubConsultationId:consultationId}}})});const value=create.status===409?await providerJson(`${url}/${providerEventId}`,{headers:{authorization:`Bearer ${calendar.credential?.accessToken}`}},"CALENDAR_READ_FAILED"):asRecord(await create.json().catch(()=>({})));if(!create.ok&&create.status!==409)throw new Error(`CALENDAR_CREATE_FAILED:${create.status}`);calendarEventId=text(value.id);calendarHtmlLink=text(value.htmlLink)||null;await consultationReference.update({calendarEventId,calendarHtmlLink,providerState:"calendar_created",updatedAt:new Date().toISOString(),updatedBy:"provider-worker"})}
  await consultationReference.update({meetingId,joinUrl,location:joinUrl??consultation.get("location"),calendarEventId,calendarHtmlLink,providerState:"completed",updatedAt:new Date().toISOString(),updatedBy:"provider-worker"});return{consultationId,meetingId,calendarEventId}}

export async function createDocusignEnvelope(job:DocumentSnapshot){const db=getFirestore();const contractId=String(job.get("contractId"));const reference=db.doc(`contracts/${contractId}`);const contract=await reference.get();if(!contract.exists)throw new Error("CONTRACT_NOT_FOUND");
  if(contract.get("providerState")==="completed")return{contractId,envelopeId:contract.get("providerEnvelopeId")};
  const provider=await connection(String(job.get("tenantId")),"docusign");let envelopeId:string;if(provider.mock)envelopeId=mockId("envelope",job.id);else{const credential=provider.credential;if(!credential?.accountId)throw new Error("DOCUSIGN_ACCOUNT_MISSING");const signers=Array.isArray(contract.get("signers"))?contract.get("signers") as Array<Json>:[];const value=await providerJson(`${credential.baseUrl??"https://demo.docusign.net"}/restapi/v2.1/accounts/${encodeURIComponent(credential.accountId)}/envelopes`,{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,"content-type":"application/json"},body:JSON.stringify({transactionId:createHash("sha256").update(job.id).digest("hex").slice(0,32),templateId:contract.get("templateId"),templateRoles:signers.map(signer=>({name:text(signer.name),email:text(signer.email),roleName:text(signer.role),routingOrder:number(signer.order)})),status:"sent"})},"DOCUSIGN_CREATE_FAILED");envelopeId=text(value.envelopeId)}
  if(!envelopeId)throw new Error("DOCUSIGN_ENVELOPE_ID_MISSING");await reference.update({providerEnvelopeId:envelopeId,status:"sent",sentAt:new Date().toISOString(),providerState:"completed",updatedAt:new Date().toISOString(),updatedBy:"provider-worker"});return{contractId,envelopeId}}

export async function createQuickBooksInvoice(job:DocumentSnapshot){const db=getFirestore();const invoiceId=String(job.get("invoiceId"));const reference=db.doc(`invoiceReferences/${invoiceId}`);const invoice=await reference.get();if(!invoice.exists)throw new Error("INVOICE_NOT_FOUND");
  if(invoice.get("providerState")==="completed")return{invoiceId,providerInvoiceId:invoice.get("providerInvoiceId")};
  const provider=await connection(String(job.get("tenantId")),"quickbooks");let providerInvoiceId:string;let balanceCents=Number(invoice.get("balanceCents"));if(provider.mock)providerInvoiceId=mockId("qbo_invoice",job.id);else{const credential=provider.credential;const realmId=credential?.realmId??String(provider.document.get("providerAccountId")??"");if(!credential||!realmId)throw new Error("QUICKBOOKS_REALM_MISSING");const value=await providerJson(`${credential.baseUrl??"https://sandbox-quickbooks.api.intuit.com"}/v3/company/${encodeURIComponent(realmId)}/invoice?minorversion=75`,{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,"content-type":"application/json","request-id":String(job.get("idempotencyKey")??job.id)},body:JSON.stringify({CustomerRef:{value:invoice.get("providerCustomerId")},DueDate:invoice.get("dueDate"),PrivateNote:`StudioCue ${invoiceId}`,Line:[{Amount:Number(invoice.get("amountCents"))/100,DetailType:"SalesItemLineDetail",Description:String(invoice.get("kind"))}]})},"QUICKBOOKS_CREATE_FAILED");const created=asRecord(value.Invoice);providerInvoiceId=text(created.Id);balanceCents=Math.round(number(created.Balance)*100)}
  if(!providerInvoiceId)throw new Error("QUICKBOOKS_INVOICE_ID_MISSING");const now=new Date().toISOString();await reference.update({providerInvoiceId,balanceCents,status:"sent",providerState:"completed",lastSyncedAt:now,updatedAt:now,updatedBy:"provider-worker"});return{invoiceId,providerInvoiceId}}

async function dropboxFolder(accessToken:string,path:string){
  const create=await fetch("https://api.dropboxapi.com/2/files/create_folder_v2",{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({path,autorename:false})});
  if(create.ok)return asRecord(asRecord(await create.json()).metadata);
  if(create.status!==409)throw new Error(`DROPBOX_FOLDER_FAILED:${create.status}`);
  return providerJson("https://api.dropboxapi.com/2/files/get_metadata",{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({path,include_deleted:false})},"DROPBOX_FOLDER_READ_FAILED");
}

export async function completeBookingResources(job:DocumentSnapshot){const db=getFirestore();const tenantId=String(job.get("tenantId"));const projectId=String(job.get("projectId"));const project=await db.doc(`projects/${projectId}`).get();if(!project.exists)throw new Error("PROJECT_NOT_FOUND");
  if(project.get("bookingProviderState")==="completed")return{projectId,folderIds:project.get("dropboxFolderIds"),eventId:project.get("calendarEventId")};
  const date=String(project.get("eventDate"));const name=String(project.get("name"));const eventType=String(project.get("eventType"));const safe=`${date}_${name}_${eventType}`.replace(/[^a-zA-Z0-9_-]+/g,"_");const dropbox=await connection(tenantId,"dropbox");const configuredRoot=String(dropbox.document.get("selectedResourceId")??"/StudioCue");const root=configuredRoot.startsWith("/")?configuredRoot:`/${configuredRoot}`;const projectRoot=`${root.replace(/\/$/,"")}/${date.slice(0,4)}/${safe}`;const paths=[projectRoot,...["01_Contracts","02_Invoices","03_Client_Details","04_Schedule","05_COI","06_Crew","07_Delivery"].map(folder=>`${projectRoot}/${folder}`)];const folderIds:string[]=[];for(const path of paths){if(dropbox.mock){folderIds.push(mockId("dropbox",path));continue}const value=await dropboxFolder(String(dropbox.credential?.accessToken),path);folderIds.push(text(value.id))}
  const calendar=await connection(tenantId,"google_calendar");let eventId=String(project.get("calendarEventId")??"");if(!eventId&&calendar.mock)eventId=mockId("event",projectId);else if(!eventId){const calendarId=encodeURIComponent(String(calendar.document.get("selectedResourceId")??"primary"));const endDate=new Date(`${date}T00:00:00Z`);endDate.setUTCDate(endDate.getUTCDate()+1);const providerEventId=createHash("sha256").update(`project:${projectId}`).digest("hex").slice(0,32);const url=`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;const create=await fetch(url,{method:"POST",headers:{authorization:`Bearer ${calendar.credential?.accessToken}`,"content-type":"application/json"},body:JSON.stringify({id:providerEventId,summary:`${name} · ${eventType}`,start:{date},end:{date:endDate.toISOString().slice(0,10)},transparency:"opaque",extendedProperties:{private:{studioHubProjectId:projectId}}})});if(create.status===409){const value=await providerJson(`${url}/${providerEventId}`,{headers:{authorization:`Bearer ${calendar.credential?.accessToken}`}},"CALENDAR_READ_FAILED");eventId=text(value.id)}else{const value=asRecord(await create.json().catch(()=>({})));if(!create.ok)throw new Error(`CALENDAR_CREATE_FAILED:${create.status}`);eventId=text(value.id)}}
  const now=new Date().toISOString();const batch=db.batch();batch.update(project.ref,{dropboxRootPath:paths[0],dropboxFolderIds:folderIds,calendarEventId:eventId,bookingProviderState:"completed",updatedAt:now,updatedBy:"provider-worker"});batch.set(db.doc(`emailJobs/booking_confirmation_${projectId}`),{id:`booking_confirmation_${projectId}`,tenantId,projectId,type:"booking_confirmation",status:"queued",attempts:0,createdAt:now,updatedAt:now},{merge:false});await batch.commit();return{projectId,folderIds,eventId}}

export async function uploadDropboxDocument(job:DocumentSnapshot){
  const db=getFirestore();const tenantId=String(job.get("tenantId"));const projectId=String(job.get("projectId"));const documentId=String(job.get("documentId"));
  const [project,document]=await Promise.all([db.doc(`projects/${projectId}`).get(),db.doc(`documents/${documentId}`).get()]);
  if(!project.exists||project.get("tenantId")!==tenantId)throw new Error("PROJECT_NOT_FOUND");
  if(!document.exists||document.get("tenantId")!==tenantId||document.get("projectId")!==projectId)throw new Error("DOCUMENT_NOT_FOUND");
  if(document.get("provider")==="dropbox"&&document.get("providerFileId"))return{documentId,providerFileId:document.get("providerFileId")};
  const source=String(document.get("providerFileId")??"");const match=source.match(/^gs:\/\/([^/]+)\/(.+)$/);if(!match?.[1]||!match[2])throw new Error("DOCUMENT_SOURCE_INVALID");
  const [bytes]=await getStorage().bucket(match[1]).file(match[2]).download();if(bytes.length>25*1024*1024)throw new Error("DROPBOX_UPLOAD_TOO_LARGE");
  const dropbox=await connection(tenantId,"dropbox");const root=String(project.get("dropboxRootPath")??"");if(!root)throw new Error("DROPBOX_PROJECT_ROOT_MISSING");
  const filename=String(document.get("name")??`${documentId}.pdf`).replace(/[\\/]/g,"_");const path=`${root}/${String(job.get("targetFolder")??"03_Client_Details")}/${filename}`.replace(/\/+/g,"/");
  let providerFileId:string;let revision:string|null=null;let canonicalPath=path;
  if(dropbox.mock)providerFileId=mockId("dropbox_file",documentId);else{
    const response=await fetch("https://content.dropboxapi.com/2/files/upload",{method:"POST",headers:{authorization:`Bearer ${dropbox.credential?.accessToken}`,"content-type":"application/octet-stream","Dropbox-API-Arg":JSON.stringify({path,mode:"overwrite",autorename:false,mute:true,strict_conflict:false})},body:new Uint8Array(bytes)});
    const value=asRecord(await response.json().catch(()=>({})));if(!response.ok)throw new Error(`DROPBOX_UPLOAD_FAILED:${response.status}`);
    providerFileId=text(value.id);revision=text(value.rev)||null;canonicalPath=text(value.path_display)||path;
  }
  const now=new Date().toISOString();await document.ref.update({provider:"dropbox",providerFileId,providerRevision:revision,canonicalPath,cloudStorageSource:source,updatedAt:now,updatedBy:"dropbox-worker"});
  return{documentId,providerFileId,canonicalPath};
}
