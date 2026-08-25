import { createHash } from "node:crypto";
import { getFirestore,type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { buildIntegrationDiagnostics } from "../integrations/diagnostics.js";
import {
  docusignUserInfoUrl,
  oauthRefreshTokenUrl,
  quickBooksApiBaseUrl,
  refreshCredentialsInRequestBody,
  refreshNeedsClientCredentials,
} from "../integrations/provider-config.js";
import { consumeAiQuota } from "../saas/usage.js";
import { autoInstantiateWorkflow } from "../workflow/commands.js";
import { productEvent } from "./product-events.js";

export type Provider="google_calendar"|"zoom"|"dropbox"|"docusign"|"dropbox_sign"|"quickbooks"|"stripe";
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
async function refreshCredential(reference:string,provider:Provider,current:Credential):Promise<Credential>{
  if(!current.expiresAt||new Date(current.expiresAt).valueOf()>Date.now()+5*60_000)return current;
  if(!current.refreshToken)throw new Error(`${provider.toUpperCase()}_REAUTHORIZATION_REQUIRED`);
  const params=new URLSearchParams({grant_type:"refresh_token",refresh_token:current.refreshToken});
  const headers:Record<string,string>={"content-type":"application/x-www-form-urlencoded"};
  if(refreshNeedsClientCredentials(provider)){
    const prefix=clientPrefix(provider);
    const clientId=process.env[`${prefix}_CLIENT_ID`];
    const clientSecret=process.env[`${prefix}_CLIENT_SECRET`];
    if(!clientId||!clientSecret)throw new Error(`${provider.toUpperCase()}_REFRESH_NOT_CONFIGURED`);
    if(refreshCredentialsInRequestBody(provider)){
      params.set("client_id",clientId);
      params.set("client_secret",clientSecret);
    }else{
      headers.authorization=`Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    }
  }
  const response=await fetch(oauthRefreshTokenUrl(provider),{method:"POST",headers,body:params});
  const body=asRecord(await response.json().catch(()=>({})));
  const accessToken=text(body.access_token);
  if(!response.ok||!accessToken){
    // Providers explain refusals in the body. Intuit's "invalid_grant /
    // Incorrect Token type or clientID" is how a credential granted under a
    // previous client id presents itself, and collapsing that to a bare
    // *_TOKEN_REFRESH_FAILED left no way to tell a dead credential from a blip.
    const reason=text(body.error)||`http_${response.status}`;
    console.error(JSON.stringify({severity:"ERROR",event:"integration.token_refresh_failed",provider,status:response.status,reason,detail:text(body.error_description).slice(0,300)}));
    // invalid_grant is terminal — that refresh token will never work again, so
    // the studio has to reconnect. Other failures may be transient.
    throw new Error(reason==="invalid_grant"?`${provider.toUpperCase()}_REAUTH_REQUIRED`:`${provider.toUpperCase()}_TOKEN_REFRESH_FAILED`);
  }
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
export async function connection(tenantId:string,provider:Provider){
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
  const startedAt=Date.now();
  let current:Awaited<ReturnType<typeof connection>>;
  try{
    current=await connection(tenantId,provider);
  }catch(caught:unknown){
    // A credential that cannot be loaded or refreshed used to throw here before
    // anything was written, so the connection document kept whatever it last
    // said. That is how QuickBooks sat displaying a stale 403 from an earlier
    // probe while the real problem was a refresh token that no longer belonged
    // to the configured client id. Record the actual reason.
    const code=caught instanceof Error?caught.message:`${provider.toUpperCase()}_CREDENTIAL_UNAVAILABLE`;
    const failedAt=new Date().toISOString();
    await getFirestore().doc(`integrationConnections/${tenantId}_${provider}`).set({
      status:"error",
      lastError:code,
      lastHealthCheckAt:failedAt,
      lastHealthLatencyMs:Date.now()-startedAt,
      diagnosticSeverity:"blocked",
      diagnosticRecommendation:code.endsWith("_REAUTH_REQUIRED")
        ?"Reconnect the provider: its refresh token is no longer valid."
        :"Reconnect the provider and confirm the app still has the required permissions.",
      updatedAt:failedAt,
    },{merge:true});
    throw caught;
  }
  const now=new Date().toISOString();
  const db=getFirestore();
  const since=new Date(Date.now()-7*24*60*60_000).toISOString();
  const [webhookSnapshot,jobSnapshot]=await Promise.all([
    db.collection("webhookEvents").where("tenantId","==",tenantId).limit(200).get(),
    db.collection("providerJobs").where("tenantId","==",tenantId).limit(200).get(),
  ]);
  const providerMatches=(value:DocumentSnapshot)=>{
    const source=String(value.get("provider")??value.get("source")??value.get("type")??"");
    return source.includes(provider);
  };
  const webhookEvents=webhookSnapshot.docs
    .filter(providerMatches)
    .filter((item)=>String(item.get("createdAt")??item.get("receivedAt")??"")>=since);
  const failedJobs=jobSnapshot.docs
    .filter(providerMatches)
    .filter((item)=>String(item.get("updatedAt")??item.get("createdAt")??"")>=since)
    .filter((item)=>["failed","dead_letter"].includes(String(item.get("status"))));
  const scopes=Array.isArray(current.document.get("scopes"))
    ? (current.document.get("scopes") as unknown[]).filter((scope):scope is string=>typeof scope==="string")
    : [];
  const baseDiagnostic={
    provider,
    credentialPresent:current.mock||Boolean(current.document.get("encryptedCredentialRef")),
    tokenExpiresAt:current.credential?.expiresAt??null,
    scopes,
    webhookEvents7d:webhookEvents.length,
    failedJobs7d:failedJobs.length,
    lastWebhookAt:webhookEvents
      .map((item)=>String(item.get("receivedAt")??item.get("createdAt")??""))
      .sort()
      .at(-1)??null,
    lastReconciledAt:text(current.document.get("lastReconciledAt"))||null,
  };
  if(current.mock){
    const diagnostics=buildIntegrationDiagnostics({
      ...baseDiagnostic,
      latencyMs:Date.now()-startedAt,
      error:null,
    },now);
    await current.document.ref.update({lastHealthCheckAt:now,lastHealthLatencyMs:diagnostics.latencyMs,diagnosticSeverity:diagnostics.severity,diagnosticRecommendation:diagnostics.recommendedAction,diagnosticFailedJobs7d:diagnostics.failedJobs7d,diagnostics,lastError:null,updatedAt:now});
    return{provider,status:"connected",mockMode:true,diagnostics};
  }
  const credential=current.credential;
  if(!credential)throw new Error("CREDENTIAL_UNAVAILABLE");
  const probes:Record<Provider,()=>Promise<Response>>={
    // A one-minute freeBusy query, not calendarList: this probe only needs to
    // prove the token still works and the calendar is reachable, and freeBusy is
    // authorized by calendar.freebusy. calendarList would force the much broader
    // calendar.readonly scope to be requested for a health check alone.
    google_calendar:()=>fetch("https://www.googleapis.com/calendar/v3/freeBusy",{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,"content-type":"application/json"},body:JSON.stringify({timeMin:new Date().toISOString(),timeMax:new Date(Date.now()+60_000).toISOString(),items:[{id:String(current.document.get("selectedResourceId")??"primary")}]})}),
    zoom:()=>fetch("https://api.zoom.us/v2/users/me/meetings?page_size=1",{headers:{authorization:`Bearer ${credential.accessToken}`}}),
    dropbox:()=>fetch("https://api.dropboxapi.com/2/files/list_folder",{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,"content-type":"application/json"},body:JSON.stringify({path:"",recursive:false,include_deleted:false,limit:1})}),
    docusign:()=>fetch(docusignUserInfoUrl(),{headers:{authorization:`Bearer ${credential.accessToken}`}}),
    dropbox_sign:()=>fetch("https://api.hellosign.com/v3/account",{headers:{authorization:`Bearer ${credential.accessToken}`}}),
    stripe:()=>fetch("https://api.stripe.com/v1/account",{headers:{authorization:`Bearer ${credential.accessToken}`}}),
    quickbooks:()=>fetch(`${quickBooksApiBaseUrl(credential.baseUrl)}/v3/company/${encodeURIComponent(credential.realmId??String(current.document.get("providerAccountId")??""))}/companyinfo/${encodeURIComponent(credential.realmId??String(current.document.get("providerAccountId")??""))}?minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json"}}),
  };
  const response=await probes[provider]();
  const latencyMs=Date.now()-startedAt;
  if(!response.ok){
    const code=`${provider.toUpperCase()}_HEALTH_FAILED:${response.status}`;
    // The provider's own body says *why* — Intuit's 403 for a realm on the wrong
    // host, Docusign's consent_required, and so on. Discarding it left only a
    // bare status code, which is what made the QuickBooks 403 undiagnosable from
    // the outside. Log it server-side; the connection document keeps the short
    // code, since tenant admins can read that and a raw provider body should not
    // land there.
    const detail=await response.text().then((body)=>body.slice(0,600)).catch(()=>"<unreadable>");
    console.error(JSON.stringify({severity:"ERROR",event:"integration.health_failed",provider,status:response.status,tenantId,detail}));
    const diagnostics=buildIntegrationDiagnostics({...baseDiagnostic,latencyMs,error:code},now);
    await current.document.ref.update({status:"error",lastHealthCheckAt:now,lastHealthLatencyMs:latencyMs,diagnosticSeverity:diagnostics.severity,diagnosticRecommendation:diagnostics.recommendedAction,diagnosticFailedJobs7d:diagnostics.failedJobs7d,diagnostics,lastError:code,updatedAt:now});
    throw new Error(code);
  }
  const diagnostics=buildIntegrationDiagnostics({...baseDiagnostic,latencyMs,error:null},now);
  await current.document.ref.update({status:"connected",lastHealthCheckAt:now,lastHealthLatencyMs:latencyMs,diagnosticSeverity:diagnostics.severity,diagnosticRecommendation:diagnostics.recommendedAction,diagnosticFailedJobs7d:diagnostics.failedJobs7d,diagnostics,lastError:null,updatedAt:now});
  return{provider,status:"connected",mockMode:false,diagnostics};
}
export type BusyInterval={start:string;end:string};
type FreeBusyResult={ok:true;busy:BusyInterval[]}|{ok:false;reason:string};
type FreeBusyFetcher=(tenantId:string,timeMinIso:string,timeMaxIso:string)=>Promise<FreeBusyResult>;

async function googleCalendarBusyIntervals(tenantId:string,timeMinIso:string,timeMaxIso:string):Promise<FreeBusyResult>{
  let current:Awaited<ReturnType<typeof connection>>;
  try{
    current=await connection(tenantId,"google_calendar");
  }catch(caught:unknown){
    return{ok:false,reason:caught instanceof Error?caught.message:"GOOGLE_CALENDAR_NOT_CONNECTED"};
  }
  if(current.mock)return{ok:true,busy:[]};
  const credential=current.credential;
  if(!credential)return{ok:false,reason:"GOOGLE_CALENDAR_CREDENTIAL_UNAVAILABLE"};
  const calendarId=String(current.document.get("selectedResourceId")??"primary");
  const response=await fetch("https://www.googleapis.com/calendar/v3/freeBusy",{
    method:"POST",
    headers:{authorization:`Bearer ${credential.accessToken}`,"content-type":"application/json"},
    body:JSON.stringify({timeMin:timeMinIso,timeMax:timeMaxIso,items:[{id:calendarId}]}),
  });
  if(!response.ok)return{ok:false,reason:`GOOGLE_CALENDAR_FREEBUSY_FAILED:${response.status}`};
  const body=asRecord(await response.json().catch(()=>({})));
  const entry=asRecord(asRecord(body.calendars)[calendarId]);
  const busyRaw=Array.isArray(entry.busy)?entry.busy as unknown[]:[];
  const busy=busyRaw
    .map((value)=>asRecord(value))
    .map((value)=>({start:text(value.start),end:text(value.end)}))
    .filter((interval)=>interval.start&&interval.end);
  return{ok:true,busy};
}

// Provider-pluggable so a future Outlook freebusy fetcher is one map entry,
// not a rewrite — mirrors this file's existing `probes` map convention.
const freeBusyFetchers:Partial<Record<Provider,FreeBusyFetcher>>={
  google_calendar:googleCalendarBusyIntervals,
};

/**
 * Real busy intervals from the tenant's connected calendar provider, for
 * merging into consultation slot generation. Never throws — an unconnected
 * or failing provider degrades to `{ok:false, reason}` so callers can
 * proceed with `busy=[]` rather than fail the whole read.
 */
export async function getCalendarBusyIntervals(
  tenantId:string,
  timeMinIso:string,
  timeMaxIso:string,
  provider:Provider="google_calendar",
):Promise<FreeBusyResult>{
  const fetcher=freeBusyFetchers[provider];
  if(!fetcher)return{ok:false,reason:`${provider.toUpperCase()}_FREEBUSY_UNSUPPORTED`};
  try{
    return await fetcher(tenantId,timeMinIso,timeMaxIso);
  }catch(caught:unknown){
    return{ok:false,reason:caught instanceof Error?caught.message:"FREEBUSY_FAILED"};
  }
}

/**
 * QuickBooks does not use either error shape this understood.
 *
 * It answers a rejected write with `{Fault:{Error:[{Message,Detail,code}]}}`,
 * which matched neither `body.error.message` nor `body.message`, so every
 * QuickBooks failure was recorded as the literal string "PROVIDER_ERROR".
 * A studio whose retainer was refused got `QUICKBOOKS_CREATE_FAILED:400:
 * PROVIDER_ERROR` — the status and nothing else — and so did whoever had
 * to work out why. Detail is the field that says what was actually wrong.
 */
function providerErrorMessage(body:Record<string,unknown>):string{const fault=asRecord(body.Fault);const errors=Array.isArray(fault.Error)?fault.Error:[];const first=asRecord(errors[0]);const detail=text(first.Detail)||text(first.Message);if(detail)return detail.replace(/\s+/g," ").slice(0,300);return text(asRecord(body.error).message)||text(body.message)||"PROVIDER_ERROR"}
async function providerJson(url:string,init:RequestInit,code:string):Promise<Json>{const response=await fetch(url,init);const body=asRecord(await response.json().catch(()=>({})));if(!response.ok)throw new Error(`${code}:${response.status}:${providerErrorMessage(body)}`);return body}
const mockId=(scope:string,id:string)=>`mock_${scope}_${createHash("sha256").update(id).digest("hex").slice(0,16)}`;

// Cancel and reschedule are the write-back half of the calendar integration.
// Until August 19, 2026 the runtime only ever created events: a studio could
// cancel nothing, and an event deleted in Google left StudioCue still showing
// the slot booked and the client confirmed.
//
// Both handlers read consultationId from the job document rather than parsing it
// out of the job id, which is how createConsultationResources does it — a
// prefix-strip that only works because that job is named after its consultation.
async function consultationFor(job: DocumentSnapshot) {
  const consultationId = text(job.get("consultationId"));
  if (!consultationId) throw new Error("CONSULTATION_ID_MISSING");
  const reference = getFirestore().doc(`consultations/${consultationId}`);
  const consultation = await reference.get();
  if (!consultation.exists) throw new Error("CONSULTATION_NOT_FOUND");
  return { consultationId, reference, consultation };
}

export async function cancelConsultationResources(job: DocumentSnapshot) {
  const { consultationId, reference, consultation } = await consultationFor(job);
  const tenantId = String(job.get("tenantId"));
  const calendarEventId = text(consultation.get("calendarEventId"));
  const meetingId = text(consultation.get("meetingId"));
  const removed: string[] = [];

  if (meetingId) {
    const zoom = await connection(tenantId, "zoom");
    if (!zoom.mock) {
      const response = await fetch(
        `${zoom.credential?.baseUrl ?? "https://api.zoom.us"}/v2/meetings/${encodeURIComponent(meetingId)}`,
        { method: "DELETE", headers: { authorization: `Bearer ${zoom.credential?.accessToken}` } },
      );
      // 404 means Zoom has already forgotten the meeting, which is the state we
      // are trying to reach — treat it as success so a retry cannot fail.
      if (!response.ok && response.status !== 404)
        throw new Error(`ZOOM_DELETE_FAILED:${response.status}`);
    }
    removed.push("zoom");
  }

  if (calendarEventId) {
    const calendar = await connection(tenantId, "google_calendar");
    if (!calendar.mock) {
      const calendarId = encodeURIComponent(
        String(calendar.document.get("selectedResourceId") ?? "primary"),
      );
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(calendarEventId)}?sendUpdates=all`,
        { method: "DELETE", headers: { authorization: `Bearer ${calendar.credential?.accessToken}` } },
      );
      // 410 Gone is Google's answer for an event already deleted, 404 for one it
      // cannot find. Both mean the desired end state already holds.
      if (!response.ok && response.status !== 404 && response.status !== 410)
        throw new Error(`CALENDAR_DELETE_FAILED:${response.status}`);
    }
    removed.push("google_calendar");
  }

  await reference.update({
    providerState: "cancelled",
    joinUrl: null,
    updatedAt: new Date().toISOString(),
    updatedBy: "provider-worker",
  });
  return { consultationId, removed };
}

export async function rescheduleConsultationResources(job: DocumentSnapshot) {
  const { consultationId, reference, consultation } = await consultationFor(job);
  const tenantId = String(job.get("tenantId"));
  const startsAt = String(consultation.get("startsAt"));
  const endsAt = String(consultation.get("endsAt"));
  const timezone = String(consultation.get("timezone"));
  const calendarEventId = text(consultation.get("calendarEventId"));
  const meetingId = text(consultation.get("meetingId"));
  const moved: string[] = [];

  if (meetingId) {
    const zoom = await connection(tenantId, "zoom");
    if (!zoom.mock) {
      const minutes = Math.max(
        1,
        Math.round((new Date(endsAt).valueOf() - new Date(startsAt).valueOf()) / 60000),
      );
      const response = await fetch(
        `${zoom.credential?.baseUrl ?? "https://api.zoom.us"}/v2/meetings/${encodeURIComponent(meetingId)}`,
        {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${zoom.credential?.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ start_time: startsAt, duration: minutes, timezone }),
        },
      );
      if (!response.ok) throw new Error(`ZOOM_UPDATE_FAILED:${response.status}`);
    }
    moved.push("zoom");
  }

  if (calendarEventId) {
    const calendar = await connection(tenantId, "google_calendar");
    if (!calendar.mock) {
      const calendarId = encodeURIComponent(
        String(calendar.document.get("selectedResourceId") ?? "primary"),
      );
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(calendarEventId)}?sendUpdates=all`,
        {
          method: "PATCH",
          headers: {
            authorization: `Bearer ${calendar.credential?.accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            start: { dateTime: startsAt, timeZone: timezone },
            end: { dateTime: endsAt, timeZone: timezone },
          }),
        },
      );
      if (!response.ok) throw new Error(`CALENDAR_UPDATE_FAILED:${response.status}`);
    }
    moved.push("google_calendar");
  }

  await reference.update({
    providerState: "rescheduled",
    updatedAt: new Date().toISOString(),
    updatedBy: "provider-worker",
  });
  return { consultationId, startsAt, endsAt, moved };
}

export async function createConsultationResources(job:DocumentSnapshot){const db=getFirestore();const consultationId=job.id.replace(/^consultation_/,"");const consultationReference=db.doc(`consultations/${consultationId}`);let consultation=await consultationReference.get();if(!consultation.exists)throw new Error("CONSULTATION_NOT_FOUND");const tenantId=String(job.get("tenantId"));let meetingId:string|null=consultation.get("meetingId")||null;let joinUrl:string|null=consultation.get("joinUrl")||null;
  if(consultation.get("providerState")==="completed")return{consultationId,meetingId:consultation.get("meetingId"),calendarEventId:consultation.get("calendarEventId")};
  if(consultation.get("mode")==="zoom"&&!meetingId){const zoom=await connection(tenantId,"zoom");if(zoom.mock){meetingId=mockId("zoom",job.id);joinUrl=`https://zoom.example.test/j/${meetingId}`}else{const scopes=Array.isArray(zoom.document.get("scopes"))?zoom.document.get("scopes") as unknown[]:[];const summaryEnabled=zoom.document.get("meetingSummaryEnabled")!==false&&scopes.includes("meeting:read:summary");const value=await providerJson(`${zoom.credential?.baseUrl??"https://api.zoom.us"}/v2/users/me/meetings`,{method:"POST",headers:{authorization:`Bearer ${zoom.credential?.accessToken}`,"content-type":"application/json"},body:JSON.stringify({topic:"Photography consultation",type:2,start_time:consultation.get("startsAt"),duration:Math.max(1,Math.round((new Date(String(consultation.get("endsAt"))).valueOf()-new Date(String(consultation.get("startsAt"))).valueOf())/60000)),timezone:consultation.get("timezone"),settings:{waiting_room:true,auto_recording:"none",...(summaryEnabled?{auto_start_meeting_summary:true,who_will_receive_summary:1}:{})}})},"ZOOM_CREATE_FAILED");meetingId=String(value.id);joinUrl=text(value.join_url)}await consultationReference.update({meetingId,joinUrl,location:joinUrl??consultation.get("location"),providerState:"meeting_created",updatedAt:new Date().toISOString(),updatedBy:"provider-worker"});consultation=await consultationReference.get()}
  const calendar=await connection(tenantId,"google_calendar");let calendarEventId=String(consultation.get("calendarEventId")??"");let calendarHtmlLink:string|null=consultation.get("calendarHtmlLink")??null;if(!calendarEventId&&calendar.mock){calendarEventId=mockId("gcal",job.id);calendarHtmlLink=`https://calendar.example.test/${calendarEventId}`}else if(!calendarEventId){const calendarId=encodeURIComponent(String(calendar.document.get("selectedResourceId")??"primary"));const providerEventId=createHash("sha256").update(`consultation:${consultationId}`).digest("hex").slice(0,32);const url=`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;const create=await fetch(url,{method:"POST",headers:{authorization:`Bearer ${calendar.credential?.accessToken}`,"content-type":"application/json"},body:JSON.stringify({id:providerEventId,summary:"Photography consultation",description:joinUrl??"StudioCue consultation",start:{dateTime:consultation.get("startsAt"),timeZone:consultation.get("timezone")},end:{dateTime:consultation.get("endsAt"),timeZone:consultation.get("timezone")},extendedProperties:{private:{studioHubConsultationId:consultationId}}})});const value=create.status===409?await providerJson(`${url}/${providerEventId}`,{headers:{authorization:`Bearer ${calendar.credential?.accessToken}`}},"CALENDAR_READ_FAILED"):asRecord(await create.json().catch(()=>({})));if(!create.ok&&create.status!==409)throw new Error(`CALENDAR_CREATE_FAILED:${create.status}`);calendarEventId=text(value.id);calendarHtmlLink=text(value.htmlLink)||null;await consultationReference.update({calendarEventId,calendarHtmlLink,providerState:"calendar_created",updatedAt:new Date().toISOString(),updatedBy:"provider-worker"})}
  await consultationReference.update({meetingId,joinUrl,location:joinUrl??consultation.get("location"),calendarEventId,calendarHtmlLink,providerState:"completed",updatedAt:new Date().toISOString(),updatedBy:"provider-worker"});return{consultationId,meetingId,calendarEventId}}

export function zoomSummaryText(value: Json): string {
  const details = Array.isArray(value.summary_details)
    ? value.summary_details
        .map(asRecord)
        .map((detail) => {
          const label = text(detail.summary_label) || text(detail.label);
          const summary = text(detail.summary) || text(detail.content);
          return [label, summary].filter(Boolean).join(": ");
        })
        .filter(Boolean)
    : [];
  const nextSteps = Array.isArray(value.next_steps)
    ? value.next_steps.map((step) =>
        typeof step === "string"
          ? step
          : text(asRecord(step).next_step) || text(asRecord(step).content),
      ).filter(Boolean)
    : [];
  return [
    text(value.summary_overview),
    ...details,
    ...(nextSteps.length ? [`Next steps: ${nextSteps.join("; ")}`] : []),
  ].filter(Boolean).join("\n\n").trim();
}

export async function captureZoomMeetingSummary(job: DocumentSnapshot) {
  const db = getFirestore();
  const tenantId = String(job.get("tenantId") ?? "");
  const projectId = String(job.get("projectId") ?? "");
  const consultationId = String(job.get("consultationId") ?? "");
  const meetingId = String(job.get("meetingId") ?? "");
  if (!tenantId || !projectId || !consultationId || !meetingId)
    throw new Error("ZOOM_SUMMARY_CONTEXT_MISSING");
  const zoom = await connection(tenantId, "zoom");
  if (zoom.mock || !zoom.credential) throw new Error("ZOOM_SUMMARY_NOT_LIVE");
  const response = await fetch(
    `https://api.zoom.us/v2/meetings/${encodeURIComponent(meetingId)}/meeting_summary`,
    { headers: { authorization: `Bearer ${zoom.credential.accessToken}` } },
  );
  if (!response.ok) throw new Error(`ZOOM_SUMMARY_FETCH_FAILED:${response.status}`);
  const providerSummary = asRecord(await response.json());
  const summary = zoomSummaryText(providerSummary);
  if (!summary) throw new Error("ZOOM_SUMMARY_EMPTY");
  const consultationReference = db.doc(`consultations/${consultationId}`);
  const projectReference = db.doc(`projects/${projectId}`);
  const aiJobReference = db.doc(`aiJobs/consultation_${consultationId}`);
  const receiptReference = db.doc(`actionReceipts/zoom_capture_${consultationId}`);
  const now = new Date().toISOString();
  await db.runTransaction(async (transaction) => {
    const [consultation, project, existingAiJob] = await Promise.all([
      transaction.get(consultationReference),
      transaction.get(projectReference),
      transaction.get(aiJobReference),
    ]);
    if (!consultation.exists || consultation.get("tenantId") !== tenantId)
      throw new Error("CONSULTATION_NOT_FOUND");
    if (!project.exists || project.get("tenantId") !== tenantId)
      throw new Error("PROJECT_NOT_FOUND");
    if (!existingAiJob.exists)
      await consumeAiQuota(transaction, db, tenantId, now);
    transaction.update(consultationReference, {
      status: "completed",
      internalNotes: summary,
      providerSummary: {
        provider: "zoom",
        meetingId,
        summaryTitle: text(providerSummary.summary_title) || null,
        capturedAt: now,
      },
      captureState: "captured",
      completedAt: consultation.get("completedAt") ?? now,
      aiReview: { status: "queued", humanReviewRequired: true },
      updatedAt: now,
      updatedBy: "zoom-summary-worker",
    });
    if (project.get("state") === "CONSULTATION") {
      transaction.update(projectReference, {
        nextAction: "Review consultation brief and package recommendation",
        updatedAt: now,
        updatedBy: "zoom-summary-worker",
      });
    }
    if (!existingAiJob.exists) {
      transaction.create(aiJobReference, {
        id: aiJobReference.id,
        tenantId,
        projectId,
        consultationId,
        type: "consultation_analysis",
        status: "queued",
        attempts: 0,
        humanReviewRequired: true,
        source: "zoom_meeting_summary",
        createdAt: now,
        updatedAt: now,
      });
    }
    transaction.set(receiptReference, {
      id: receiptReference.id,
      tenantId,
      projectId,
      title: "Zoom consultation captured",
      summary:
        "StudioCue imported the Zoom meeting summary and queued a grounded consultation brief, package recommendation, and proposal draft for review.",
      status: "completed",
      source: "zoom_capture",
      affectedEntityType: "consultation",
      affectedEntityId: consultationId,
      providerEvidence: {
        provider: "zoom",
        meetingId,
        webhookEventId: job.get("idempotencyKey") ?? null,
      },
      reversible: true,
      retryable: false,
      canCancel: false,
      canRetry: false,
      attempts: 1,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
      createdBy: "zoom-summary-worker",
      updatedBy: "zoom-summary-worker",
      archivedAt: null,
    }, { merge: true });
  });
  const event = productEvent({
    tenantId,
    projectId,
    actorId: "zoom-summary-worker",
    actorType: "system",
    name: "consultation.capture_completed",
    occurredAt: now,
    correlationId: String(job.get("idempotencyKey") ?? job.id),
    sourceEntityType: "consultation",
    sourceEntityId: consultationId,
    properties: {
      workflowStep: true,
      executionMode: "automatic",
      humanRole: "none",
      provider: "zoom",
      generatedReviewActions: 3,
    },
  });
  await db.doc(`productEvents/${event.id}`).set(event, { merge: false });
  return { consultationId, projectId, meetingId, captureState: "captured" };
}

export async function createDocusignEnvelope(job:DocumentSnapshot){const db=getFirestore();const contractId=String(job.get("contractId"));const reference=db.doc(`contracts/${contractId}`);const contract=await reference.get();if(!contract.exists)throw new Error("CONTRACT_NOT_FOUND");
  if(contract.get("providerState")==="completed")return{contractId,envelopeId:contract.get("providerEnvelopeId")};
  const provider=await connection(String(job.get("tenantId")),"docusign");let envelopeId:string;if(provider.mock)envelopeId=mockId("envelope",job.id);else{const credential=provider.credential;if(!credential?.accountId)throw new Error("DOCUSIGN_ACCOUNT_MISSING");const signers=Array.isArray(contract.get("signers"))?contract.get("signers") as Array<Json>:[];const value=await providerJson(`${credential.baseUrl??"https://demo.docusign.net"}/restapi/v2.1/accounts/${encodeURIComponent(credential.accountId)}/envelopes`,{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,"content-type":"application/json"},body:JSON.stringify({transactionId:createHash("sha256").update(job.id).digest("hex").slice(0,32),templateId:contract.get("templateId"),templateRoles:signers.map(signer=>({name:text(signer.name),email:text(signer.email),roleName:text(signer.role),routingOrder:number(signer.order)})),status:"sent"})},"DOCUSIGN_CREATE_FAILED");envelopeId=text(value.envelopeId)}
  if(!envelopeId)throw new Error("DOCUSIGN_ENVELOPE_ID_MISSING");await reference.update({providerEnvelopeId:envelopeId,status:"sent",sentAt:new Date().toISOString(),providerState:"completed",updatedAt:new Date().toISOString(),updatedBy:"provider-worker"});return{contractId,envelopeId}}

// Uses Dropbox Sign's send_with_template endpoint — the template-based
// equivalent of createDocusignEnvelope's templateRoles call, matching the
// pre-configured-template model our contracts already assume via
// contract.templateId. Endpoint + auth confirmed against
// developers.hellosign.com's rendered API docs during this change.
export async function createDropboxSignRequest(job:DocumentSnapshot){const db=getFirestore();const contractId=String(job.get("contractId"));const reference=db.doc(`contracts/${contractId}`);const contract=await reference.get();if(!contract.exists)throw new Error("CONTRACT_NOT_FOUND");
  if(contract.get("providerState")==="completed")return{contractId,envelopeId:contract.get("providerEnvelopeId")};
  const provider=await connection(String(job.get("tenantId")),"dropbox_sign");let signatureRequestId:string;if(provider.mock)signatureRequestId=mockId("signature_request",job.id);else{const credential=provider.credential;if(!credential)throw new Error("DROPBOX_SIGN_ACCOUNT_MISSING");const signers=Array.isArray(contract.get("signers"))?contract.get("signers") as Array<Json>:[];
    // Test mode exists because a Dropbox Sign account without a paid API
    // plan answers 402 to every live send, so the booking chain cannot be
    // exercised at all. A test-mode request goes through the real API and
    // fires the real webhooks, but the document is watermarked and the
    // signature is NOT legally binding — which is why it is a per-tenant
    // flag that the UI shouts about rather than an environment variable
    // nobody would see.
    const testMode=provider.document.get("testMode")===true;
    const value=await providerJson("https://api.hellosign.com/v3/signature_request/send_with_template",{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,"content-type":"application/json"},body:JSON.stringify({template_ids:[contract.get("templateId")],subject:"Please sign your StudioCue contract",...(testMode?{test_mode:1}:{}),signers:signers.map(signer=>({role:text(signer.role),name:text(signer.name),email_address:text(signer.email)}))})},"DROPBOX_SIGN_CREATE_FAILED");signatureRequestId=text(asRecord(value.signature_request).signature_request_id)}
  if(!signatureRequestId)throw new Error("DROPBOX_SIGN_REQUEST_ID_MISSING");await reference.update({providerEnvelopeId:signatureRequestId,status:"sent",sentAt:new Date().toISOString(),providerState:"completed",testMode:provider.mock?false:provider.document.get("testMode")===true,updatedAt:new Date().toISOString(),updatedBy:"provider-worker"});return{contractId,envelopeId:signatureRequestId}}

async function quickBooksCustomerId(
  tenantId:string,
  projectId:string,
  invoice:DocumentSnapshot,
  credential:Credential,
  realmId:string,
  idempotencyKey:string,
):Promise<string>{
  const existing=text(invoice.get("providerCustomerId"));
  if(existing&&!existing.startsWith("pending_"))return existing;
  const db=getFirestore();
  const project=await db.doc(`projects/${projectId}`).get();
  const contactIds=Array.isArray(project.get("clientContactIds"))?project.get("clientContactIds") as unknown[]:[];
  const contactId=contactIds.find((value):value is string=>typeof value==="string");
  if(!contactId)throw new Error("QUICKBOOKS_CUSTOMER_CONTACT_MISSING");
  const contact=await db.doc(`contacts/${contactId}`).get();
  if(!contact.exists||contact.get("tenantId")!==tenantId)throw new Error("QUICKBOOKS_CUSTOMER_CONTACT_MISSING");
  const stored=text(asRecord(contact.get("providerIds")).quickbooksCustomerId);
  if(stored)return stored;
  const email=text(contact.get("email"));
  const displayName=text(contact.get("displayName"))||email;
  if(!email||!displayName)throw new Error("QUICKBOOKS_CUSTOMER_DETAILS_MISSING");
  const base=quickBooksApiBaseUrl(credential.baseUrl);
  const escapedEmail=email.replaceAll("'","\\'");
  const query=encodeURIComponent(`select * from Customer where PrimaryEmailAddr = '${escapedEmail}' maxresults 1`);
  const found=await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/query?query=${query}&minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json"}},"QUICKBOOKS_CUSTOMER_SEARCH_FAILED");
  const customers=asRecord(found.QueryResponse).Customer;
  let customerId=Array.isArray(customers)?text(asRecord(customers[0]).Id):"";
  if(!customerId){
    const created=await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/customer?minorversion=75`,{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json","content-type":"application/json","request-id":`${idempotencyKey}-customer`.slice(0,50)},body:JSON.stringify({DisplayName:displayName,PrimaryEmailAddr:{Address:email},...(text(contact.get("phone"))?{PrimaryPhone:{FreeFormNumber:text(contact.get("phone"))}}:{})})},"QUICKBOOKS_CUSTOMER_CREATE_FAILED");
    customerId=text(asRecord(created.Customer).Id);
  }
  if(!customerId)throw new Error("QUICKBOOKS_CUSTOMER_ID_MISSING");
  await contact.ref.update({providerIds:{...asRecord(contact.get("providerIds")),quickbooksCustomerId:customerId},updatedAt:new Date().toISOString(),updatedBy:"quickbooks-worker"});
  return customerId;
}

/**
 * A QuickBooks sales line needs an item, and StudioCue never sent one.
 *
 * The invoice body declared `DetailType:"SalesItemLineDetail"` and then
 * omitted the `SalesItemLineDetail` object that detail type exists to
 * carry, so QuickBooks rejected every retainer with a 400 — which the
 * runtime recorded as "PROVIDER_ERROR", so the studio saw an invoice
 * marked sent, a balance outstanding, and no email anywhere.
 *
 * Preference order is deliberate: an existing service item is reused, and
 * only a company with none gets one created. Studios reconcile in
 * QuickBooks, and an integration that quietly grows items in their chart
 * is a worse neighbour than one that uses what is already there.
 */
async function quickBooksItemRef(
  base:string,
  realmId:string,
  credential:Credential,
  idempotencyKey:string,
):Promise<{value:string;name?:string}>{
  const headers={authorization:`Bearer ${credential.accessToken}`,accept:"application/json"};
  const query=encodeURIComponent("select Id, Name from Item where Type = 'Service' and Active = true maxresults 1");
  const found=await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/query?query=${query}&minorversion=75`,{headers},"QUICKBOOKS_ITEM_SEARCH_FAILED");
  const items=asRecord(found.QueryResponse).Item;
  if(Array.isArray(items)&&items.length){
    const item=asRecord(items[0]);
    return {value:text(item.Id),name:text(item.Name)||undefined};
  }
  // A brand new company file can genuinely have no service item. Creating
  // one needs an income account to post to, so find that first.
  const accountQuery=encodeURIComponent("select Id from Account where AccountType = 'Income' and Active = true maxresults 1");
  const accounts=await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/query?query=${accountQuery}&minorversion=75`,{headers},"QUICKBOOKS_ACCOUNT_SEARCH_FAILED");
  const accountList=asRecord(accounts.QueryResponse).Account;
  const incomeAccountId=Array.isArray(accountList)?text(asRecord(accountList[0]).Id):"";
  if(!incomeAccountId)throw new Error("QUICKBOOKS_INCOME_ACCOUNT_MISSING");
  const created=await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/item?minorversion=75`,{method:"POST",headers:{...headers,"content-type":"application/json","request-id":`${idempotencyKey}-item`.slice(0,50)},body:JSON.stringify({Name:"Photography services",Type:"Service",IncomeAccountRef:{value:incomeAccountId}})},"QUICKBOOKS_ITEM_CREATE_FAILED");
  const item=asRecord(created.Item);
  const itemId=text(item.Id);
  if(!itemId)throw new Error("QUICKBOOKS_ITEM_ID_MISSING");
  return {value:itemId,name:text(item.Name)||undefined};
}

// Stripe's REST API takes application/x-www-form-urlencoded bodies (not
// JSON, unlike every other provider in this file) and has no single
// "create invoice" call — an invoice is an empty shell that draws in
// invoice items, then gets finalized to become payable and get a
// hosted_invoice_url. Auth is the connected account's own OAuth
// access_token as a Bearer credential (Standard Connect accounts don't
// need a separate Stripe-Account header the way platform-key calls do).
async function stripeCustomerId(
  tenantId:string,
  projectId:string,
  invoice:DocumentSnapshot,
  credential:Credential,
  idempotencyKey:string,
):Promise<string>{
  const existing=text(invoice.get("providerCustomerId"));
  if(existing&&!existing.startsWith("pending_"))return existing;
  const db=getFirestore();
  const project=await db.doc(`projects/${projectId}`).get();
  const contactIds=Array.isArray(project.get("clientContactIds"))?project.get("clientContactIds") as unknown[]:[];
  const contactId=contactIds.find((value):value is string=>typeof value==="string");
  if(!contactId)throw new Error("STRIPE_CUSTOMER_CONTACT_MISSING");
  const contact=await db.doc(`contacts/${contactId}`).get();
  if(!contact.exists||contact.get("tenantId")!==tenantId)throw new Error("STRIPE_CUSTOMER_CONTACT_MISSING");
  const stored=text(asRecord(contact.get("providerIds")).stripeCustomerId);
  if(stored)return stored;
  const email=text(contact.get("email"));
  const displayName=text(contact.get("displayName"))||email;
  if(!email||!displayName)throw new Error("STRIPE_CUSTOMER_DETAILS_MISSING");
  const found=await providerJson(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=1`,{headers:{authorization:`Bearer ${credential.accessToken}`}},"STRIPE_CUSTOMER_SEARCH_FAILED");
  const existingCustomers=Array.isArray(found.data)?found.data as Array<Json>:[];
  let customerId=text(asRecord(existingCustomers[0]).id);
  if(!customerId){
    const created=await providerJson("https://api.stripe.com/v1/customers",{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,"content-type":"application/x-www-form-urlencoded","idempotency-key":`${idempotencyKey}-customer`},body:new URLSearchParams({email,name:displayName})},"STRIPE_CUSTOMER_CREATE_FAILED");
    customerId=text(created.id);
  }
  if(!customerId)throw new Error("STRIPE_CUSTOMER_ID_MISSING");
  await contact.ref.update({providerIds:{...asRecord(contact.get("providerIds")),stripeCustomerId:customerId},updatedAt:new Date().toISOString(),updatedBy:"stripe-worker"});
  return customerId;
}

export async function createStripeInvoice(job:DocumentSnapshot){const db=getFirestore();const invoiceId=String(job.get("invoiceId"));const reference=db.doc(`invoiceReferences/${invoiceId}`);const invoice=await reference.get();if(!invoice.exists)throw new Error("INVOICE_NOT_FOUND");
  if(invoice.get("providerState")==="completed")return{invoiceId,providerInvoiceId:invoice.get("providerInvoiceId")};
  const tenantId=String(job.get("tenantId"));const idempotencyKey=String(job.get("idempotencyKey")??job.id);const provider=await connection(tenantId,"stripe");let providerInvoiceId:string;let hostedUrl:string|null;let providerCustomerId=text(invoice.get("providerCustomerId"));
  if(provider.mock){providerInvoiceId=mockId("stripe_invoice",job.id);providerCustomerId=providerCustomerId.startsWith("pending_")?mockId("stripe_customer",String(invoice.get("projectId"))):providerCustomerId;hostedUrl=`https://invoice.example.test/${providerInvoiceId}`}
  else{
    const credential=provider.credential;if(!credential)throw new Error("STRIPE_ACCOUNT_MISSING");
    providerCustomerId=await stripeCustomerId(tenantId,String(invoice.get("projectId")),invoice,credential,idempotencyKey);
    await providerJson("https://api.stripe.com/v1/invoiceitems",{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,"content-type":"application/x-www-form-urlencoded","idempotency-key":`${idempotencyKey}-item`},body:new URLSearchParams({customer:providerCustomerId,amount:String(invoice.get("amountCents")),currency:String(invoice.get("currency")).toLowerCase(),description:`StudioCue ${String(invoice.get("kind"))} — ${invoiceId}`})},"STRIPE_INVOICE_ITEM_FAILED");
    const dueDate=Math.floor(new Date(`${String(invoice.get("dueDate"))}T00:00:00Z`).valueOf()/1000);
    const created=await providerJson("https://api.stripe.com/v1/invoices",{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,"content-type":"application/x-www-form-urlencoded","idempotency-key":idempotencyKey},body:new URLSearchParams({customer:providerCustomerId,collection_method:"send_invoice",due_date:String(dueDate),"metadata[tenantId]":tenantId,"metadata[invoiceId]":invoiceId})},"STRIPE_INVOICE_CREATE_FAILED");
    const finalized=await providerJson(`https://api.stripe.com/v1/invoices/${encodeURIComponent(text(created.id))}/finalize`,{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,"content-type":"application/x-www-form-urlencoded"}},"STRIPE_INVOICE_FINALIZE_FAILED");
    providerInvoiceId=text(finalized.id);hostedUrl=text(finalized.hosted_invoice_url)||null;
  }
  if(!providerInvoiceId)throw new Error("STRIPE_INVOICE_ID_MISSING");const now=new Date().toISOString();await reference.update({providerInvoiceId,providerCustomerId,hostedUrl,status:"sent",providerState:"completed",lastSyncedAt:now,updatedAt:now,updatedBy:"provider-worker"});return{invoiceId,providerInvoiceId}}

/** The client address a provider invoice should be delivered to. */
async function clientEmailFor(
  db:FirebaseFirestore.Firestore,
  tenantId:string,
  projectId:string,
):Promise<string>{
  const project=await db.doc(`projects/${projectId}`).get();
  const contactIds=Array.isArray(project.get("clientContactIds"))?project.get("clientContactIds") as unknown[]:[];
  for(const contactId of contactIds){
    if(typeof contactId!=="string")continue;
    const contact=await db.doc(`contacts/${contactId}`).get();
    if(!contact.exists||contact.get("tenantId")!==tenantId)continue;
    const email=text(contact.get("email"));
    if(email.includes("@"))return email;
  }
  return "";
}

/**
 * Creating a QuickBooks invoice does not send it.
 *
 * This is why no retainer email has ever arrived: the integration POSTed an
 * invoice, marked it "sent", and stopped. QuickBooks only emails an invoice
 * when asked, through a separate endpoint, and nothing here ever asked. The
 * studio watched for an email that was never going to come, and the
 * workspace agreed with them that it had been sent.
 *
 * Failing to send is not the same as failing to invoice. The invoice exists
 * and is correct, so this reports the outcome rather than throwing: the
 * record says whether the client was actually emailed, and the studio can
 * send it from QuickBooks if not.
 */
async function sendQuickBooksInvoice(
  base:string,
  realmId:string,
  credential:Credential,
  providerInvoiceId:string,
  email:string,
):Promise<{sent:boolean;error:string|null}>{
  if(!email)return {sent:false,error:"NO_CLIENT_EMAIL"};
  try{
    await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/invoice/${encodeURIComponent(providerInvoiceId)}/send?sendTo=${encodeURIComponent(email)}&minorversion=75`,{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json","content-type":"application/octet-stream"}},"QUICKBOOKS_SEND_FAILED");
    return {sent:true,error:null};
  }catch(caught:unknown){
    return {sent:false,error:caught instanceof Error?caught.message.slice(0,300):"QUICKBOOKS_SEND_FAILED"};
  }
}

/**
 * An invoice this job already created, found by the note it stamps on it.
 *
 * QuickBooks answered the create in XML because the request never asked for
 * JSON, so the reply was unreadable and the job retried a POST that had
 * probably already worked. The Request-Id header is supposed to make that
 * safe, but "supposed to" is thin cover for duplicate invoices in a
 * studio's books, and a job whose response we could not read is exactly
 * when the guard is worth having. PrivateNote carries the StudioCue id, so
 * an invoice this job made is findable no matter what came back.
 */
async function existingQuickBooksInvoice(
  base:string,
  realmId:string,
  credential:Credential,
  invoiceId:string,
):Promise<{id:string;balanceCents:number}|null>{
  const query=encodeURIComponent(`select Id, Balance from Invoice where PrivateNote = 'StudioCue ${invoiceId.replaceAll("'","\\'")}' maxresults 1`);
  const found=await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/query?query=${query}&minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json"}},"QUICKBOOKS_INVOICE_SEARCH_FAILED");
  const invoices=asRecord(found.QueryResponse).Invoice;
  if(!Array.isArray(invoices)||!invoices.length)return null;
  const first=asRecord(invoices[0]);
  const id=text(first.Id);
  return id?{id,balanceCents:Math.round(number(first.Balance)*100)}:null;
}

export async function createQuickBooksInvoice(job:DocumentSnapshot){const db=getFirestore();const invoiceId=String(job.get("invoiceId"));const reference=db.doc(`invoiceReferences/${invoiceId}`);const invoice=await reference.get();if(!invoice.exists)throw new Error("INVOICE_NOT_FOUND");
  if(invoice.get("providerState")==="completed")return{invoiceId,providerInvoiceId:invoice.get("providerInvoiceId")};
  const tenantId=String(job.get("tenantId"));const provider=await connection(tenantId,"quickbooks");let providerInvoiceId:string;let providerCustomerId=text(invoice.get("providerCustomerId"));let balanceCents=Number(invoice.get("balanceCents"));let sendOutcome:{sent:boolean;error:string|null}={sent:false,error:"MOCK_MODE"};if(provider.mock){providerInvoiceId=mockId("qbo_invoice",job.id);providerCustomerId=providerCustomerId.startsWith("pending_")?mockId("qbo_customer",String(invoice.get("projectId"))):providerCustomerId}else{const credential=provider.credential;const realmId=credential?.realmId??String(provider.document.get("providerAccountId")??"");if(!credential||!realmId)throw new Error("QUICKBOOKS_REALM_MISSING");providerCustomerId=await quickBooksCustomerId(tenantId,String(invoice.get("projectId")),invoice,credential,realmId,String(job.get("idempotencyKey")??job.id));const base=quickBooksApiBaseUrl(credential.baseUrl);const already=await existingQuickBooksInvoice(base,realmId,credential,invoiceId);if(already){providerInvoiceId=already.id;balanceCents=already.balanceCents;sendOutcome=await sendQuickBooksInvoice(base,realmId,credential,already.id,await clientEmailFor(db,tenantId,String(invoice.get("projectId"))))}else{const itemRef=await quickBooksItemRef(base,realmId,credential,String(job.get("idempotencyKey")??job.id));const value=await providerJson(`${quickBooksApiBaseUrl(credential.baseUrl)}/v3/company/${encodeURIComponent(realmId)}/invoice?minorversion=75`,{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json","content-type":"application/json","request-id":String(job.get("idempotencyKey")??job.id)},body:JSON.stringify({CustomerRef:{value:providerCustomerId},DueDate:invoice.get("dueDate"),PrivateNote:`StudioCue ${invoiceId}`,Line:[{Amount:Number(invoice.get("amountCents"))/100,DetailType:"SalesItemLineDetail",Description:String(invoice.get("kind")),SalesItemLineDetail:{ItemRef:itemRef,Qty:1,UnitPrice:Number(invoice.get("amountCents"))/100}}]})},"QUICKBOOKS_CREATE_FAILED");const created=asRecord(value.Invoice);providerInvoiceId=text(created.Id);balanceCents=Math.round(number(created.Balance)*100);if(providerInvoiceId)sendOutcome=await sendQuickBooksInvoice(base,realmId,credential,providerInvoiceId,await clientEmailFor(db,tenantId,String(invoice.get("projectId"))))}}
  if(!providerInvoiceId)throw new Error("QUICKBOOKS_INVOICE_ID_MISSING");const now=new Date().toISOString();
  // "sent" now means the client was emailed. An invoice QuickBooks holds but
  // never delivered is `awaiting_delivery`, not sent — calling that sent is
  // what had a studio waiting on an email nobody had asked QuickBooks for.
  const delivered=provider.mock||sendOutcome.sent;
  await reference.update({providerInvoiceId,providerCustomerId,balanceCents,status:delivered?"sent":"awaiting_delivery",providerState:"completed",emailedAt:sendOutcome.sent?now:null,deliveryError:delivered?null:sendOutcome.error,lastSyncedAt:now,updatedAt:now,updatedBy:"provider-worker"});
  return{invoiceId,providerInvoiceId,emailed:sendOutcome.sent}}

export async function reconcileQuickBooksInvoice(job:DocumentSnapshot){const db=getFirestore();const invoiceId=String(job.get("invoiceId"));const reference=db.doc(`invoiceReferences/${invoiceId}`);const invoice=await reference.get();if(!invoice.exists)throw new Error("INVOICE_NOT_FOUND");const providerInvoiceId=String(job.get("providerInvoiceId")??invoice.get("providerInvoiceId")??"");if(!providerInvoiceId)throw new Error("QUICKBOOKS_INVOICE_ID_MISSING");const operation=String(job.get("operation")??"").toLowerCase();let status:string;let balanceCents:number;
  if(["delete","deleted","void","voided"].includes(operation)){status="voided";balanceCents=0}else{const provider=await connection(String(job.get("tenantId")),"quickbooks");if(provider.mock){status=String(invoice.get("status")??"sent");balanceCents=Number(invoice.get("balanceCents")??0)}else{const credential=provider.credential;const realmId=credential?.realmId??String(job.get("realmId")??provider.document.get("providerAccountId")??"");if(!credential||!realmId)throw new Error("QUICKBOOKS_REALM_MISSING");const value=await providerJson(`${quickBooksApiBaseUrl(credential.baseUrl)}/v3/company/${encodeURIComponent(realmId)}/invoice/${encodeURIComponent(providerInvoiceId)}?minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json","content-type":"application/json"}},"QUICKBOOKS_INVOICE_READ_FAILED");const current=asRecord(value.Invoice);balanceCents=Math.max(0,Math.round(number(current.Balance)*100));const totalCents=Math.max(0,Math.round(number(current.TotalAmt)*100));status=balanceCents===0?"paid":balanceCents<totalCents?"partially_paid":"sent"}}
  const now=new Date().toISOString();const batch=db.batch();batch.update(reference,{status,balanceCents,lastProviderEventId:String(job.get("idempotencyKey")??job.id),lastSyncedAt:String(job.get("occurredAt")??now),providerState:"completed",updatedAt:now,updatedBy:"quickbooks-reconciliation"});const webhookEventId=String(job.get("webhookEventId")??"");if(webhookEventId)batch.update(db.doc(`webhookEvents/${webhookEventId}`),{status:"processed",processedAt:now});await batch.commit();return{invoiceId,providerInvoiceId,status,balanceCents}}

async function dropboxFolder(accessToken:string,path:string){
  const create=await fetch("https://api.dropboxapi.com/2/files/create_folder_v2",{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({path,autorename:false})});
  if(create.ok)return asRecord(asRecord(await create.json()).metadata);
  if(create.status!==409)throw new Error(`DROPBOX_FOLDER_FAILED:${create.status}`);
  return providerJson("https://api.dropboxapi.com/2/files/get_metadata",{method:"POST",headers:{authorization:`Bearer ${accessToken}`,"content-type":"application/json"},body:JSON.stringify({path,include_deleted:false})},"DROPBOX_FOLDER_READ_FAILED");
}

export async function completeBookingResources(job:DocumentSnapshot){const db=getFirestore();const tenantId=String(job.get("tenantId"));const projectId=String(job.get("projectId"));const project=await db.doc(`projects/${projectId}`).get();if(!project.exists)throw new Error("PROJECT_NOT_FOUND");
  // The job's declared "workflow"/"checkpoints" steps: start the planning
  // workflow so readiness engages. Idempotent, and runs before the
  // provider-state early return so a retry after a partial failure still
  // instantiates. A skip (no template configured) never fails the booking.
  const workflow=await autoInstantiateWorkflow({tenantId,projectId,actorId:"booking-orchestrator"});
  if(project.get("bookingProviderState")==="completed")return{projectId,folderIds:project.get("dropboxFolderIds"),eventId:project.get("calendarEventId"),workflow};
  const date=String(project.get("eventDate"));const name=String(project.get("name"));const eventType=String(project.get("eventType"));const safe=`${date}_${name}_${eventType}`.replace(/[^a-zA-Z0-9_-]+/g,"_");const dropbox=await connection(tenantId,"dropbox");const configuredRoot=String(dropbox.document.get("selectedResourceId")??"/StudioCue");const root=configuredRoot.startsWith("/")?configuredRoot:`/${configuredRoot}`;const projectRoot=`${root.replace(/\/$/,"")}/${date.slice(0,4)}/${safe}`;const paths=[projectRoot,...["01_Contracts","02_Invoices","03_Client_Details","04_Schedule","05_COI","06_Crew","07_Delivery"].map(folder=>`${projectRoot}/${folder}`)];const folderIds:string[]=[];for(const path of paths){if(dropbox.mock){folderIds.push(mockId("dropbox",path));continue}const value=await dropboxFolder(String(dropbox.credential?.accessToken),path);folderIds.push(text(value.id))}
  const calendar=await connection(tenantId,"google_calendar");let eventId=String(project.get("calendarEventId")??"");if(!eventId&&calendar.mock)eventId=mockId("event",projectId);else if(!eventId){const calendarId=encodeURIComponent(String(calendar.document.get("selectedResourceId")??"primary"));const endDate=new Date(`${date}T00:00:00Z`);endDate.setUTCDate(endDate.getUTCDate()+1);const providerEventId=createHash("sha256").update(`project:${projectId}`).digest("hex").slice(0,32);const url=`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;const create=await fetch(url,{method:"POST",headers:{authorization:`Bearer ${calendar.credential?.accessToken}`,"content-type":"application/json"},body:JSON.stringify({id:providerEventId,summary:`${name} · ${eventType}`,start:{date},end:{date:endDate.toISOString().slice(0,10)},transparency:"opaque",extendedProperties:{private:{studioHubProjectId:projectId}}})});if(create.status===409){const value=await providerJson(`${url}/${providerEventId}`,{headers:{authorization:`Bearer ${calendar.credential?.accessToken}`}},"CALENDAR_READ_FAILED");eventId=text(value.id)}else{const value=asRecord(await create.json().catch(()=>({})));if(!create.ok)throw new Error(`CALENDAR_CREATE_FAILED:${create.status}`);eventId=text(value.id)}}
  const now=new Date().toISOString();const batch=db.batch();batch.update(project.ref,{dropboxRootPath:paths[0],dropboxFolderIds:folderIds,calendarEventId:eventId,bookingProviderState:"completed",updatedAt:now,updatedBy:"provider-worker"});batch.set(db.doc(`emailJobs/booking_confirmation_${projectId}`),{id:`booking_confirmation_${projectId}`,tenantId,projectId,type:"booking_confirmation",status:"queued",attempts:0,createdAt:now,updatedAt:now},{merge:false});await batch.commit();return{projectId,folderIds,eventId,workflow}}

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

/**
 * Crew calendar closure: when a cascade offer is accepted, invite the crew
 * member to a Google Calendar event carrying the assignment window and a link
 * to the current schedule in their portal. Mock connections produce
 * deterministic mock events so development never contacts Google.
 */
export async function addCrewCalendarInvite(job: DocumentSnapshot) {
  const db = getFirestore();
  const assignmentId = String(job.get("assignmentId") ?? "");
  const reference = db.doc(`crewAssignments/${assignmentId}`);
  const assignment = await reference.get();
  if (!assignment.exists) throw new Error("ASSIGNMENT_NOT_FOUND");
  if (assignment.get("status") !== "accepted")
    return { assignmentId, skipped: "not_accepted" };
  const existingEventId = String(assignment.get("calendarEventId") ?? "");
  if (existingEventId) return { assignmentId, calendarEventId: existingEventId };
  const tenantId = String(job.get("tenantId"));
  const projectId = String(assignment.get("projectId") ?? "");
  const project = await db.doc(`projects/${projectId}`).get();
  const projectName = text(project.get("name")) || "Photography event";
  const profileId = String(assignment.get("crewProfileId") ?? "");
  const profile = profileId
    ? await db.doc(`crewProfiles/${profileId}`).get()
    : null;
  const attendeeEmail =
    profile && profile.exists ? text(profile.get("email")) : "";
  const calendar = await connection(tenantId, "google_calendar");
  let calendarEventId: string;
  let calendarHtmlLink: string | null = null;
  if (calendar.mock) {
    calendarEventId = mockId("gcal_crew", job.id);
    calendarHtmlLink = `https://calendar.example.test/${calendarEventId}`;
  } else {
    const calendarId = encodeURIComponent(
      String(calendar.document.get("selectedResourceId") ?? "primary"),
    );
    const providerEventId = createHash("sha256")
      .update(`crew_assignment:${assignmentId}`)
      .digest("hex")
      .slice(0, 32);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events?sendUpdates=all`;
    const create = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${calendar.credential?.accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        id: providerEventId,
        summary: `${text(assignment.get("role")) || "Crew"} · ${projectName}`,
        description:
          "Your StudioCue assignment. The current schedule is always in your crew portal: /crew",
        start: {
          dateTime: assignment.get("arrivalAt"),
          timeZone: text(project.get("timezone")) || "UTC",
        },
        end: {
          dateTime: assignment.get("departureAt"),
          timeZone: text(project.get("timezone")) || "UTC",
        },
        attendees: attendeeEmail ? [{ email: attendeeEmail }] : [],
        extendedProperties: {
          private: { studioHubCrewAssignmentId: assignmentId },
        },
      }),
    });
    if (create.status === 409) {
      const value = await providerJson(
        `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${providerEventId}`,
        {
          headers: {
            authorization: `Bearer ${calendar.credential?.accessToken}`,
          },
        },
        "CALENDAR_READ_FAILED",
      );
      calendarEventId = text(value.id);
      calendarHtmlLink = text(value.htmlLink) || null;
    } else {
      const value = asRecord(await create.json().catch(() => ({})));
      if (!create.ok) throw new Error(`CALENDAR_CREATE_FAILED:${create.status}`);
      calendarEventId = text(value.id);
      calendarHtmlLink = text(value.htmlLink) || null;
    }
  }
  await reference.update({
    calendarEventId,
    calendarInviteLink: calendarHtmlLink,
    calendarStatus: "invited",
    calendarInvitedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: "provider-worker",
  });
  return { assignmentId, calendarEventId };
}
