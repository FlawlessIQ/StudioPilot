import { createHash } from "node:crypto";
import { getFirestore,type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { prepareCrewStaffing } from "../crew/prepare-staffing.js";
import { crewCalendarEventName } from "../crew/calendar-ics.js";
import { buildIntegrationDiagnostics } from "../integrations/diagnostics.js";
import {
  alreadyClientOnly,
  promoteContactTypesToClient,
} from "../contacts/promotion.js";
import {
  docusignUserInfoUrl,
  oauthRefreshTokenUrl,
  quickBooksApiBaseUrl,
  refreshCredentialsInRequestBody,
  refreshNeedsClientCredentials,
  oauthClientPrefix,
  refreshScope,
} from "../integrations/provider-config.js";
import {
  collectBusyIntervals,
  isBusyTimeProvider,
  type BusyInterval,
  type BusyTimeProvider,
  type FreeBusyResult,
} from "../integrations/busy-time.js";
import { GRAPH_BASE_URL, outlookBusyFromGraph } from "../integrations/outlook-calendar.js";
import { appleBusyFromCalDav, isIcloudCalDavUrl } from "../integrations/apple-calendar.js";
import { platformSecret } from "../integrations/platform-secret.js";
import { consumeAiQuota } from "../saas/usage.js";
import { autoInstantiateWorkflow } from "../workflow/commands.js";
import { productEvent } from "./product-events.js";
import {
  invoiceClosedToProviderWork,
  providerReportedInvoice,
} from "../booking/invoice-standing.js";
import { voidInvoiceTask } from "../booking/stopped-billing.js";
import {
  quickBooksAmountCheck,
  quickBooksCustomerCreateBody,
  quickBooksCustomerSparseUpdate,
  quickBooksLinePayload,
  quickBooksTaxMode,
  type QuickBooksContact,
  type QuickBooksTaxMode,
} from "./quickbooks-invoice-lines.js";
import { planQuickBooksInvoiceLines } from "./quickbooks-invoice-plan.js";
import { quickBooksCompany, studioCueInvoiceItemRefs } from "../integrations/quickbooks-items.js";
import { reopenedByProvider, reopenedInvoiceTask } from "../booking/quickbooks-money-events-core.js";
import { providerVoidJobType } from "../booking/invoice-corrections.js";
import { landStudioPaymentAtProvider, studioPaymentFor } from "../booking/invoice-payments.js";

export type Provider="google_calendar"|"outlook_calendar"|"apple_calendar"|"zoom"|"dropbox"|"docusign"|"dropbox_sign"|"quickbooks"|"stripe";
/**
 * A provider credential as stored in Secret Manager.
 *
 * Apple Calendar (CalDAV) has no OAuth: `accessToken` holds the app-specific
 * password and `username` the Apple ID, sent together as HTTP Basic auth. It
 * has no expiry, so refreshCredential passes it straight through.
 */
export type Credential={
  accessToken:string;
  username?:string;
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
    username:text(parsed.username)||undefined,
  };
}
async function refreshCredential(reference:string,provider:Provider,current:Credential):Promise<Credential>{
  if(provider==="apple_calendar")return current;
  if(!current.expiresAt||new Date(current.expiresAt).valueOf()>Date.now()+5*60_000)return current;
  if(!current.refreshToken)throw new Error(`${provider.toUpperCase()}_REAUTHORIZATION_REQUIRED`);
  const params=new URLSearchParams({grant_type:"refresh_token",refresh_token:current.refreshToken});
  const headers:Record<string,string>={"content-type":"application/x-www-form-urlencoded"};
  if(refreshNeedsClientCredentials(provider)){
    const prefix=oauthClientPrefix(provider);
    const clientId=process.env[`${prefix}_CLIENT_ID`];
    // Outlook's secret is read at run time rather than bound at deploy time;
    // integrations/platform-secret.ts says why.
    const clientSecret=provider==="outlook_calendar"
      ?await platformSecret("MICROSOFT_CLIENT_SECRET")
      :process.env[`${prefix}_CLIENT_SECRET`];
    if(!clientId||!clientSecret)throw new Error(`${provider.toUpperCase()}_REFRESH_NOT_CONFIGURED`);
    if(refreshCredentialsInRequestBody(provider)){
      params.set("client_id",clientId);
      params.set("client_secret",clientSecret);
      const scope=refreshScope(provider);
      if(scope)params.set("scope",scope);
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
    const code=caught instanceof Error?caught.message:"CREDENTIAL_FAILED";
    /**
     * Our misconfiguration is not their broken connection.
     *
     * `*_REFRESH_NOT_CONFIGURED` means this Function was deployed without the
     * provider's client id or secret — a deployment fault, with the studio's
     * credential untouched and probably perfectly good. Writing `status:"error"`
     * for it told the studio their integration was broken and to reconnect,
     * which cannot help and throws away a working authorisation.
     *
     * Found 2026-09-21: the reference studio's QuickBooks sat "error /
     * QUICKBOOKS_REFRESH_NOT_CONFIGURED" for three days. The secret is bound on
     * only three of the Functions, and any refresh attempted from another one
     * both fails *and* leaves that mark behind.
     *
     * It still throws, so the caller fails loudly and the log carries the
     * reason at ERROR severity — the connection document just stops carrying
     * the blame.
     */
    if(/_REFRESH_NOT_CONFIGURED$/.test(code)){
      console.error(JSON.stringify({severity:"ERROR",event:"integration.refresh_not_configured",provider,tenantId,detail:"client id/secret missing on this Function; the studio credential was not touched"}));
      throw caught;
    }
    await document.ref.update({status:"error",lastError:code,updatedAt:new Date().toISOString()});
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
    // Reading the default calendar's own record needs only Calendars.Read.
    outlook_calendar:()=>fetch(`${GRAPH_BASE_URL}/me/calendar?$select=id`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json"}}),
    // A Depth:0 PROPFIND on the first chosen calendar: proves the app-specific
    // password still works and the calendar still exists. Only to an iCloud
    // host — the URL comes from the connection document.
    apple_calendar:async()=>{
      const urls=Array.isArray(current.document.get("calendarUrls"))?(current.document.get("calendarUrls") as unknown[]).map(String).filter(isIcloudCalDavUrl):[];
      const target=urls[0];
      if(!target)return new Response(null,{status:404});
      const username=credential.username??text(current.document.get("providerAccountId"));
      return fetch(target,{method:"PROPFIND",redirect:"manual",headers:{authorization:`Basic ${Buffer.from(`${username}:${credential.accessToken}`).toString("base64")}`,depth:"0","content-type":"application/xml; charset=utf-8"},body:'<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>'});
    },
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
  // The QuickBooks probe reads CompanyInfo, which is the same record that
  // heads every invoice a client receives. The body was being discarded on
  // success, so a company file with no company name set kept passing a
  // clean health check while sending clients invoices from "No company
  // name". Nothing was wrong with the connection, which is exactly why
  // nothing reported it.
  let configurationWarning:string|null=null;
  if(provider==="quickbooks"){
    const body=asRecord(await response.json().catch(()=>({})));
    const companyInfo=asRecord(body.CompanyInfo);
    const companyName=text(companyInfo.CompanyName);
    // Only warn on a company record we actually read. A body we could not
    // parse is a reason to say nothing, not to tell every studio their
    // company name is missing.
    if(Object.keys(companyInfo).length>0&&!companyName){
      configurationWarning="QuickBooks has no company name set, so invoices reach your clients headed \"No company name\". Set it in QuickBooks under Settings \u2192 Account and settings \u2192 Company.";
    }
    if(companyName)await current.document.ref.update({providerAccountLabel:companyName}).catch(()=>{});
  }
  const diagnostics=buildIntegrationDiagnostics({...baseDiagnostic,latencyMs,error:null,configurationWarning},now);
  await current.document.ref.update({status:"connected",lastHealthCheckAt:now,lastHealthLatencyMs:latencyMs,diagnosticSeverity:diagnostics.severity,diagnosticRecommendation:diagnostics.recommendedAction,diagnosticFailedJobs7d:diagnostics.failedJobs7d,diagnostics,configurationWarning,lastError:null,updatedAt:now});
  return{provider,status:"connected",mockMode:false,diagnostics};
}
export type { BusyInterval };
type BusyContext={tenantId:string;timeMinIso:string;timeMaxIso:string;studioTimeZone:()=>Promise<string>};
type FreeBusyFetcher=(context:BusyContext)=>Promise<FreeBusyResult>;

async function googleCalendarBusyIntervals({tenantId,timeMinIso,timeMaxIso}:BusyContext):Promise<FreeBusyResult>{
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

/** Outlook / Microsoft 365 through Graph calendarView (a read-only grant). */
async function outlookCalendarBusyIntervals({tenantId,timeMinIso,timeMaxIso,studioTimeZone}:BusyContext):Promise<FreeBusyResult>{
  let current:Awaited<ReturnType<typeof connection>>;
  try{
    current=await connection(tenantId,"outlook_calendar");
  }catch(caught:unknown){
    return{ok:false,reason:caught instanceof Error?caught.message:"OUTLOOK_CALENDAR_NOT_CONNECTED"};
  }
  if(current.mock)return{ok:true,busy:[]};
  const credential=current.credential;
  if(!credential)return{ok:false,reason:"OUTLOOK_CALENDAR_CREDENTIAL_UNAVAILABLE"};
  return outlookBusyFromGraph({accessToken:credential.accessToken,timeMinIso,timeMaxIso,studioTimeZone:await studioTimeZone()});
}

/**
 * Apple Calendar (iCloud) over CalDAV, with the app-specific password from
 * Secret Manager. A refused password marks the connection, so the studio's
 * Integrations page says to reconnect instead of quietly reading nothing.
 */
async function appleCalendarBusyIntervals({tenantId,timeMinIso,timeMaxIso,studioTimeZone}:BusyContext):Promise<FreeBusyResult>{
  let current:Awaited<ReturnType<typeof connection>>;
  try{
    current=await connection(tenantId,"apple_calendar");
  }catch(caught:unknown){
    return{ok:false,reason:caught instanceof Error?caught.message:"APPLE_CALENDAR_NOT_CONNECTED"};
  }
  if(current.mock)return{ok:true,busy:[]};
  const credential=current.credential;
  if(!credential)return{ok:false,reason:"APPLE_CALENDAR_CREDENTIAL_UNAVAILABLE"};
  const appleId=credential.username??text(current.document.get("providerAccountId"));
  const calendarUrls=Array.isArray(current.document.get("calendarUrls"))
    ?(current.document.get("calendarUrls") as unknown[]).map(String)
    :[];
  const result=await appleBusyFromCalDav({appleId,appPassword:credential.accessToken,calendarUrls,timeMinIso,timeMaxIso,studioTimeZone:await studioTimeZone()});
  if(result.skipped?.length){
    console.warn(JSON.stringify({severity:"WARNING",event:"calendar_busy.apple_calendars_skipped",tenantId,skipped:result.skipped}));
  }
  if(!result.ok&&result.authFailed){
    await current.document.ref.update({status:"error",lastError:"APPLE_CALENDAR_AUTH_FAILED",updatedAt:new Date().toISOString()}).catch(()=>{});
  }
  return result.ok?{ok:true,busy:result.busy}:{ok:false,reason:result.reason};
}

/**
 * Every provider that can say when the studio is busy. Adding one is an
 * entry here plus its id in BUSY_TIME_PROVIDERS (integrations/busy-time.ts).
 */
const freeBusyFetchers:Record<BusyTimeProvider,FreeBusyFetcher>={
  google_calendar:googleCalendarBusyIntervals,
  outlook_calendar:outlookCalendarBusyIntervals,
  apple_calendar:appleCalendarBusyIntervals,
};

/**
 * Real busy intervals from every calendar the tenant has connected — Google,
 * Outlook and Apple, in any combination — unioned, for merging into
 * consultation slot generation.
 *
 * Never throws. A provider that fails is logged and skipped; the others still
 * count. `{ok:false}` means nothing connected answered, and callers proceed
 * with no extra busy time rather than fail the whole read — the same contract
 * this had when Google was the only source.
 */
export async function getCalendarBusyIntervals(
  tenantId:string,
  timeMinIso:string,
  timeMaxIso:string,
):Promise<FreeBusyResult&{sources?:BusyTimeProvider[]}>{
  try{
    const db=getFirestore();
    const snapshot=await db.collection("integrationConnections").where("tenantId","==",tenantId).where("status","==","connected").get();
    const providers=snapshot.docs
      .filter((document)=>!document.get("archivedAt"))
      .map((document)=>document.get("provider"))
      .filter(isBusyTimeProvider);
    let timezone:Promise<string>|null=null;
    const studioTimeZone=()=>timezone??=db.doc(`tenants/${tenantId}`).get()
      .then((tenant)=>text(tenant.get("timezone"))||"America/New_York")
      .catch(()=>"America/New_York");
    const context:BusyContext={tenantId,timeMinIso,timeMaxIso,studioTimeZone};
    const collected=await collectBusyIntervals({
      providers,
      fetchers:Object.fromEntries(providers.map((provider)=>[provider,()=>freeBusyFetchers[provider](context)])),
    });
    for(const failure of collected.failures){
      console.warn(JSON.stringify({severity:"WARNING",event:"calendar_busy.provider_skipped",tenantId,provider:failure.provider,reason:failure.reason}));
    }
    return collected.ok
      ?{ok:true,busy:collected.busy,sources:collected.sources}
      :{ok:false,reason:collected.reason};
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
export async function providerJson(url:string,init:RequestInit,code:string):Promise<Json>{const response=await fetch(url,init);const body=asRecord(await response.json().catch(()=>({})));if(!response.ok)throw new Error(`${code}:${response.status}:${providerErrorMessage(body)}`);return body}
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

/**
 * A booking change moved the wedding: the studio's all-day event and each crew
 * member's invite follow it (booking amendments,
 * functions/src/booking/amendment-apply.ts). The events keep their ids, so
 * anyone who accepted sees the same event move rather than a second one.
 */
export async function moveBookingCalendarEvents(job: DocumentSnapshot) {
  const db = getFirestore();
  const tenantId = String(job.get("tenantId"));
  const projectId = String(job.get("projectId"));
  const project = await db.doc(`projects/${projectId}`).get();
  if (!project.exists || project.get("tenantId") !== tenantId) throw new Error("PROJECT_NOT_FOUND");
  const date = String(project.get("eventDate"));
  const moved: string[] = [];
  let calendar: Awaited<ReturnType<typeof connection>>;
  try {
    calendar = await connection(tenantId, "google_calendar");
  } catch {
    // No calendar connected: nothing to move.
    return { projectId, eventDate: date, moved, skipped: "calendar_not_connected" };
  }
  const calendarId = encodeURIComponent(String(calendar.document.get("selectedResourceId") ?? "primary"));
  const patch = async (eventId: string, body: Record<string, unknown>) => {
    if (calendar.mock) return;
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${calendar.credential?.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
    // Gone from the calendar is not a reason to fail the rest.
    if (!response.ok && response.status !== 404 && response.status !== 410)
      throw new Error(`CALENDAR_UPDATE_FAILED:${response.status}`);
  };
  const projectEventId = text(project.get("calendarEventId"));
  if (projectEventId) {
    const end = new Date(`${date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    await patch(projectEventId, { start: { date }, end: { date: end.toISOString().slice(0, 10) } });
    moved.push("studio_event");
  }
  const timeZone = text(project.get("timezone")) || "UTC";
  const assignments = await db
    .collection("crewAssignments")
    .where("tenantId", "==", tenantId)
    .where("projectId", "==", projectId)
    .limit(40)
    .get();
  for (const assignment of assignments.docs) {
    const eventId = text(assignment.get("calendarEventId"));
    if (!eventId) continue;
    await patch(eventId, {
      start: { dateTime: String(assignment.get("arrivalAt")), timeZone },
      end: { dateTime: String(assignment.get("departureAt")), timeZone },
    });
    moved.push(`crew:${assignment.id}`);
  }
  return { projectId, eventDate: date, moved };
}

/**
 * A cancelled wedding off the calendars (crm/commands.ts transitionProject):
 * the studio's all-day event and the invite of each crew member the cancel
 * released. Only consultation events were ever deleted, so a called-off
 * wedding stayed in the studio's Google Calendar and in its crew's.
 *
 * Never an invite belonging to somebody still on the job — the cancel lists
 * the assignments it released, and each is re-read here.
 */
export async function removeBookingCalendarEvents(job: DocumentSnapshot) {
  const db = getFirestore();
  const tenantId = String(job.get("tenantId"));
  const projectId = String(job.get("projectId"));
  const project = await db.doc(`projects/${projectId}`).get();
  if (!project.exists || project.get("tenantId") !== tenantId) throw new Error("PROJECT_NOT_FOUND");
  // Undone before this ran: the wedding is on again, so its events stay.
  if (project.get("state") !== "CANCELLED") return { projectId, removed: [], skipped: "no_longer_cancelled" };
  let calendar: Awaited<ReturnType<typeof connection>>;
  try {
    calendar = await connection(tenantId, "google_calendar");
  } catch {
    return { projectId, removed: [], skipped: "calendar_not_connected" };
  }
  const calendarId = encodeURIComponent(String(calendar.document.get("selectedResourceId") ?? "primary"));
  const remove = async (eventId: string) => {
    if (calendar.mock) return;
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      { method: "DELETE", headers: { authorization: `Bearer ${calendar.credential?.accessToken}` } },
    );
    // Already gone is the state we want.
    if (!response.ok && response.status !== 404 && response.status !== 410)
      throw new Error(`CALENDAR_DELETE_FAILED:${response.status}`);
  };
  const removed: string[] = [];
  const now = new Date().toISOString();
  const projectEventId = text(project.get("calendarEventId"));
  if (projectEventId) {
    await remove(projectEventId);
    await project.ref.update({ calendarEventId: null, calendarRemovedAt: now, updatedAt: now, updatedBy: "provider-worker" });
    removed.push("studio_event");
  }
  const assignmentIds = Array.isArray(job.get("assignmentIds"))
    ? (job.get("assignmentIds") as unknown[]).filter((id): id is string => typeof id === "string" && id !== "")
    : [];
  for (const assignmentId of assignmentIds) {
    const assignment = await db.doc(`crewAssignments/${assignmentId}`).get();
    if (!assignment.exists || assignment.get("tenantId") !== tenantId) continue;
    if (assignment.get("status") !== "cancelled") continue;
    const eventId = text(assignment.get("calendarEventId"));
    if (!eventId) continue;
    await remove(eventId);
    await assignment.ref.update({
      calendarEventId: null,
      calendarInviteLink: null,
      calendarRemovedAt: now,
      updatedAt: now,
      updatedBy: "provider-worker",
    });
    removed.push(`crew:${assignmentId}`);
  }
  return { projectId, removed };
}

/**
 * The studio's all-day event for a booked wedding, in its Google Calendar.
 *
 * Its id is derived from the project, so a second create answers 409 and the
 * event already there is adopted. Google keeps an event that was deleted — by
 * a cancel, say (removeBookingCalendarEvents) — under the same id with status
 * `cancelled`, and a 409 used to adopt that too, leaving the project pointing
 * at an event nobody can see. Confirming it puts it back.
 */
async function putStudioBookingEvent(
  calendar: Awaited<ReturnType<typeof connection>>,
  project: DocumentSnapshot,
): Promise<string> {
  const projectId = project.id;
  if (calendar.mock) return mockId("event", projectId);
  const date = String(project.get("eventDate"));
  const endDate = new Date(`${date}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const calendarId = encodeURIComponent(String(calendar.document.get("selectedResourceId") ?? "primary"));
  const providerEventId = createHash("sha256").update(`project:${projectId}`).digest("hex").slice(0, 32);
  const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
  const authorization = `Bearer ${calendar.credential?.accessToken}`;
  const event = {
    summary: `${String(project.get("name"))} · ${String(project.get("eventType"))}`,
    start: { date },
    end: { date: endDate.toISOString().slice(0, 10) },
    transparency: "opaque",
    extendedProperties: { private: { studioHubProjectId: projectId } },
  };
  const create = await fetch(url, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ id: providerEventId, ...event }),
  });
  if (create.status === 409) {
    const existing = await providerJson(`${url}/${providerEventId}`, { headers: { authorization } }, "CALENDAR_READ_FAILED");
    if (text(existing.status) !== "cancelled") return text(existing.id);
    const restored = await providerJson(
      `${url}/${providerEventId}`,
      {
        method: "PATCH",
        headers: { authorization, "content-type": "application/json" },
        body: JSON.stringify({ ...event, status: "confirmed" }),
      },
      "CALENDAR_RESTORE_FAILED",
    );
    return text(restored.id);
  }
  const value = asRecord(await create.json().catch(() => ({})));
  if (!create.ok) throw new Error(`CALENDAR_CREATE_FAILED:${create.status}`);
  return text(value.id);
}

/** Where a wedding has a studio calendar event: booked, and not yet over. */
const ON_THE_CALENDAR = new Set([
  "BOOKED",
  "PLANNING",
  "READY",
  "EVENT_COMPLETE",
  "POST_PRODUCTION",
  "DELIVERED",
  "REVIEW_REQUESTED",
]);

/**
 * An undone cancel back on the studio's calendar (crm/commands.ts,
 * uncancelProject). The cancel deleted the studio's event for the wedding;
 * undoing it brought the job back and left the calendar empty that day.
 *
 * Only the studio's own event. Crew invites stay released, because the crew
 * themselves were released and are re-offered — their invites come back with
 * their acceptance (addCrewCalendarInvite).
 */
export async function restoreBookingCalendarEvent(job: DocumentSnapshot) {
  const db = getFirestore();
  const tenantId = String(job.get("tenantId"));
  const projectId = String(job.get("projectId"));
  const project = await db.doc(`projects/${projectId}`).get();
  if (!project.exists || project.get("tenantId") !== tenantId) throw new Error("PROJECT_NOT_FOUND");
  const state = String(project.get("state"));
  // Cancelled again before this ran: the removal job's turn, not ours.
  if (!ON_THE_CALENDAR.has(state)) return { projectId, skipped: state === "CANCELLED" ? "cancelled_again" : "not_booked" };
  // The removal never ran (the undo beat it), so the event is still there.
  if (text(project.get("calendarEventId"))) return { projectId, skipped: "already_on_calendar" };
  let calendar: Awaited<ReturnType<typeof connection>>;
  try {
    calendar = await connection(tenantId, "google_calendar");
  } catch (caught: unknown) {
    // Disconnected since: nothing to put back. A broken credential is not
    // that, and fails the job so Today shows it.
    if (caught instanceof Error && caught.message === "GOOGLE_CALENDAR_NOT_CONNECTED")
      return { projectId, skipped: "calendar_not_connected" };
    throw caught;
  }
  const eventId = await putStudioBookingEvent(calendar, project);
  const now = new Date().toISOString();
  await project.ref.update({ calendarEventId: eventId, calendarRestoredAt: now, updatedAt: now, updatedBy: "provider-worker" });
  return { projectId, eventId };
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

/**
 * The meeting-link step could not run for a reason that retrying will not fix:
 * nothing connected, or a connection that must be made again. Anything else
 * (a Zoom outage, a 500) still fails the job so it is retried.
 */
export const ZOOM_UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "ZOOM_NOT_CONNECTED",
  "ZOOM_CREDENTIAL_MISSING",
  "ZOOM_REAUTH_REQUIRED",
]);

/** What the studio is told when a video consultation has no Zoom link. */
export function zoomSkipMessage(code: string): string {
  return code === "ZOOM_NOT_CONNECTED"
    ? "Zoom isn't connected, so no meeting link was made. Send them a video link yourself, or connect Zoom."
    : "Zoom needs reconnecting, so no meeting link was made. Send them a video link yourself, or reconnect Zoom.";
}

export async function createConsultationResources(job: DocumentSnapshot) {
  return createConsultationResourcesWith(job, { db: getFirestore(), connect: connection });
}

/** The same, with its reads and connections passed in — a seam for tests. */
export async function createConsultationResourcesWith(
  job: Pick<DocumentSnapshot, "id" | "get">,
  deps: {
    db: Pick<FirebaseFirestore.Firestore, "doc">;
    connect: (tenantId: string, provider: Provider) => ReturnType<typeof connection>;
  },
) {
  const { db, connect } = deps;
  const consultationId = job.id.replace(/^consultation_/, "");
  const consultationReference = db.doc(`consultations/${consultationId}`);
  let consultation = await consultationReference.get();
  if (!consultation.exists) throw new Error("CONSULTATION_NOT_FOUND");
  const tenantId = String(job.get("tenantId"));
  let meetingId: string | null = consultation.get("meetingId") || null;
  let joinUrl: string | null = consultation.get("joinUrl") || null;
  if (consultation.get("providerState") === "completed")
    return { consultationId, meetingId: consultation.get("meetingId"), calendarEventId: consultation.get("calendarEventId") };

  /**
   * Zoom is the default way to meet, and most studios have not connected it.
   * `connection()` threw ZOOM_NOT_CONNECTED here, outside any try, so the
   * calendar step below never ran, the job dead-lettered, and the consultation
   * sat at `providerState: "queued"` for ever — no link, no calendar event,
   * and nothing telling the studio why. Now a Zoom that cannot be reached is
   * recorded on the consultation, where the calendar shows it, and the rest
   * of the booking carries on; the couple's confirmation says the studio will
   * send the link (booking/consultation-email.ts).
   */
  let meetingSkipReason: string | null = null;
  if (consultation.get("mode") === "zoom" && !meetingId) {
    let zoom: Awaited<ReturnType<typeof connect>> | null = null;
    try {
      zoom = await connect(tenantId, "zoom");
    } catch (caught: unknown) {
      const code = caught instanceof Error ? caught.message : "ZOOM_UNAVAILABLE";
      if (!ZOOM_UNAVAILABLE_CODES.has(code)) throw caught;
      meetingSkipReason = code;
    }
    if (zoom) {
      if (zoom.mock) {
        meetingId = mockId("zoom", job.id);
        joinUrl = `https://zoom.example.test/j/${meetingId}`;
      } else {
        const scopes = Array.isArray(zoom.document.get("scopes")) ? (zoom.document.get("scopes") as unknown[]) : [];
        const summaryEnabled = zoom.document.get("meetingSummaryEnabled") !== false && scopes.includes("meeting:read:summary");
        const value = await providerJson(
          `${zoom.credential?.baseUrl ?? "https://api.zoom.us"}/v2/users/me/meetings`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${zoom.credential?.accessToken}`, "content-type": "application/json" },
            body: JSON.stringify({
              topic: "Photography consultation",
              type: 2,
              start_time: consultation.get("startsAt"),
              duration: Math.max(
                1,
                Math.round(
                  (new Date(String(consultation.get("endsAt"))).valueOf() -
                    new Date(String(consultation.get("startsAt"))).valueOf()) /
                    60000,
                ),
              ),
              timezone: consultation.get("timezone"),
              settings: {
                waiting_room: true,
                auto_recording: "none",
                ...(summaryEnabled ? { auto_start_meeting_summary: true, who_will_receive_summary: 1 } : {}),
              },
            }),
          },
          "ZOOM_CREATE_FAILED",
        );
        meetingId = String(value.id);
        joinUrl = text(value.join_url);
      }
      await consultationReference.update({
        meetingId,
        joinUrl,
        location: joinUrl ?? consultation.get("location"),
        meetingSkipReason: null,
        meetingSkipMessage: null,
        providerState: "meeting_created",
        updatedAt: new Date().toISOString(),
        updatedBy: "provider-worker",
      });
      consultation = await consultationReference.get();
    }
  }

  let calendarEventId = String(consultation.get("calendarEventId") ?? "");
  let calendarHtmlLink: string | null = consultation.get("calendarHtmlLink") ?? null;
  try {
    const calendar = await connect(tenantId, "google_calendar");
    if (!calendarEventId && calendar.mock) {
      calendarEventId = mockId("gcal", job.id);
      calendarHtmlLink = `https://calendar.example.test/${calendarEventId}`;
    } else if (!calendarEventId) {
      const calendarId = encodeURIComponent(String(calendar.document.get("selectedResourceId") ?? "primary"));
      const providerEventId = createHash("sha256").update(`consultation:${consultationId}`).digest("hex").slice(0, 32);
      const url = `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`;
      const create = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${calendar.credential?.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          id: providerEventId,
          summary: "Photography consultation",
          description: joinUrl ?? (meetingSkipReason ? "Video call — send the couple a meeting link." : "StudioCue consultation"),
          start: { dateTime: consultation.get("startsAt"), timeZone: consultation.get("timezone") },
          end: { dateTime: consultation.get("endsAt"), timeZone: consultation.get("timezone") },
          extendedProperties: { private: { studioHubConsultationId: consultationId } },
        }),
      });
      const value =
        create.status === 409
          ? await providerJson(`${url}/${providerEventId}`, { headers: { authorization: `Bearer ${calendar.credential?.accessToken}` } }, "CALENDAR_READ_FAILED")
          : asRecord(await create.json().catch(() => ({})));
      if (!create.ok && create.status !== 409) throw new Error(`CALENDAR_CREATE_FAILED:${create.status}`);
      calendarEventId = text(value.id);
      calendarHtmlLink = text(value.htmlLink) || null;
      await consultationReference.update({
        calendarEventId,
        calendarHtmlLink,
        providerState: "calendar_created",
        updatedAt: new Date().toISOString(),
        updatedBy: "provider-worker",
      });
    }
  } catch (caught: unknown) {
    await consultationReference.update({
      calendarSkipReason: caught instanceof Error ? caught.message : "GOOGLE_CALENDAR_UNAVAILABLE",
      updatedAt: new Date().toISOString(),
      updatedBy: "provider-worker",
    });
  }
  await consultationReference.update({
    meetingId,
    joinUrl,
    location: joinUrl ?? consultation.get("location"),
    calendarEventId,
    calendarHtmlLink,
    ...(meetingSkipReason
      ? { meetingSkipReason, meetingSkipMessage: zoomSkipMessage(meetingSkipReason) }
      : {}),
    providerState: "completed",
    updatedAt: new Date().toISOString(),
    updatedBy: "provider-worker",
  });
  return { consultationId, meetingId, calendarEventId, meetingSkipReason };
}

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

/** What QuickBooks needs to know about the client, from their contact. */
function quickBooksContact(contact:DocumentSnapshot):QuickBooksContact{
  const address=asRecord(contact.get("billingAddress"));
  const email=text(contact.get("email"));
  return {
    firstName:text(contact.get("firstName"))||null,
    lastName:text(contact.get("lastName"))||null,
    displayName:text(contact.get("displayName"))||email,
    email,
    phone:text(contact.get("phone"))||null,
    billingAddress:text(address.line1)&&text(address.city)?{line1:text(address.line1),line2:text(address.line2)||null,city:text(address.city),region:text(address.region)||null,postalCode:text(address.postalCode)||null,country:text(address.country)||null}:null,
  };
}

/**
 * Fill the blanks on a QuickBooks customer the studio already has.
 *
 * Gabe's first step on every invoice is a customer with name, email, phone
 * and address — the address because QuickBooks works out sales tax from it.
 * StudioCue only ever sent a display name, email and phone. A customer it
 * matched or made earlier keeps everything the studio typed in QuickBooks;
 * only empty fields are filled (quickBooksCustomerSparseUpdate). A refusal
 * here never stops the invoice: billing matters more than a tidy record.
 */
async function fillQuickBooksCustomerBlanks(
  base:string,
  realmId:string,
  credential:Credential,
  customerId:string,
  details:QuickBooksContact,
  idempotencyKey:string,
  known?:Record<string,unknown>,
):Promise<void>{
  try{
    const headers={authorization:`Bearer ${credential.accessToken}`,accept:"application/json"};
    const existing=known&&text(known.Id)?known:asRecord((await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/customer/${encodeURIComponent(customerId)}?minorversion=75`,{headers},"QUICKBOOKS_CUSTOMER_READ_FAILED")).Customer);
    const update=quickBooksCustomerSparseUpdate(existing,details);
    if(!update)return;
    await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/customer?minorversion=75`,{method:"POST",headers:{...headers,"content-type":"application/json","request-id":`${idempotencyKey}-custfill`.slice(0,50)},body:JSON.stringify(update)},"QUICKBOOKS_CUSTOMER_UPDATE_FAILED");
  }catch(caught){
    console.warn(JSON.stringify({severity:"WARNING",event:"quickbooks.customer_fill_skipped",customerId,reason:caught instanceof Error?caught.message:String(caught)}));
  }
}

export async function quickBooksCustomerId(
  tenantId:string,
  projectId:string,
  invoice:DocumentSnapshot,
  credential:Credential,
  realmId:string,
  idempotencyKey:string,
):Promise<string>{
  const existing=text(invoice.get("providerCustomerId"));
  const known=existing&&!existing.startsWith("pending_")?existing:"";
  const db=getFirestore();
  const base=quickBooksApiBaseUrl(credential.baseUrl);
  const project=await db.doc(`projects/${projectId}`).get();
  const contactIds=Array.isArray(project.get("clientContactIds"))?project.get("clientContactIds") as unknown[]:[];
  const contactId=contactIds.find((value):value is string=>typeof value==="string");
  if(!contactId){if(known)return known;throw new Error("QUICKBOOKS_CUSTOMER_CONTACT_MISSING");}
  const contact=await db.doc(`contacts/${contactId}`).get();
  if(!contact.exists||contact.get("tenantId")!==tenantId){if(known)return known;throw new Error("QUICKBOOKS_CUSTOMER_CONTACT_MISSING");}
  const details=quickBooksContact(contact);
  // The final carries the retainer's customer; an address added since the
  // retainer still reaches QuickBooks before the taxed invoice is made.
  if(known){await fillQuickBooksCustomerBlanks(base,realmId,credential,known,details,idempotencyKey);return known;}
  const stored=text(asRecord(contact.get("providerIds")).quickbooksCustomerId);
  if(stored){await fillQuickBooksCustomerBlanks(base,realmId,credential,stored,details,idempotencyKey);return stored;}
  const email=details.email;
  const displayName=details.displayName;
  if(!email||!displayName)throw new Error("QUICKBOOKS_CUSTOMER_DETAILS_MISSING");
  const escapedEmail=email.replaceAll("'","\\'");
  const query=encodeURIComponent(`select * from Customer where PrimaryEmailAddr = '${escapedEmail}' maxresults 1`);
  const found=await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/query?query=${query}&minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json"}},"QUICKBOOKS_CUSTOMER_SEARCH_FAILED");
  const customers=asRecord(found.QueryResponse).Customer;
  let matched:Record<string,unknown>|null=Array.isArray(customers)&&text(asRecord(customers[0]).Id)?asRecord(customers[0]):null;
  let customerId=matched?text(matched.Id):"";
  /**
   * The same name, no email match: QuickBooks names must be unique, so
   * creating "Dionne Rhodes" again was refused with "The name supplied
   * already exists" and the retainer never billed (GR, 2026-09-30). A
   * customer of that name with this email or none is this client; one with
   * a different email is someone else, so the new one is named apart.
   */
  if(!customerId){
    const byName=encodeURIComponent(`select * from Customer where DisplayName = '${displayName.replaceAll("'","\\'")}' maxresults 1`);
    const named=await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/query?query=${byName}&minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json"}},"QUICKBOOKS_CUSTOMER_SEARCH_FAILED");
    const match=asRecord((asRecord(named.QueryResponse).Customer as unknown[]|undefined)?.[0]);
    const matchEmail=text(asRecord(match.PrimaryEmailAddr).Address).toLowerCase();
    if(text(match.Id)&&(!matchEmail||matchEmail===email.toLowerCase())){customerId=text(match.Id);matched=match;}
  }
  if(matched&&customerId){
    // The search returned the whole record, so no second read is needed.
    await fillQuickBooksCustomerBlanks(base,realmId,credential,customerId,details,idempotencyKey,matched);
  }
  if(!customerId){
    const create=(name:string,suffix:string)=>providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/customer?minorversion=75`,{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json","content-type":"application/json","request-id":`${idempotencyKey}-customer${suffix}`.slice(0,50)},body:JSON.stringify(quickBooksCustomerCreateBody(details,name))},"QUICKBOOKS_CUSTOMER_CREATE_FAILED");
    let created:Record<string,unknown>;
    try{
      created=await create(displayName,"");
    }catch(caught){
      // Taken by another customer, a vendor or an employee (QuickBooks names
      // are unique across all three): the same person with their email.
      if(!(caught instanceof Error&&/already exists/i.test(caught.message)))throw caught;
      created=await create(`${displayName} (${email})`.slice(0,100),"-2");
    }
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

/**
 * A create job for an invoice StudioCue has already finished with.
 *
 * The studio recorded the payment by hand, a booking change replaced the
 * bill, or the job was called off — all while this job sat queued or waiting
 * to retry. Creating it now would email the couple a bill for money they have
 * paid (or no longer owe) and write `sent` over the record. The job succeeds
 * with nothing done, and the invoice says why.
 */
async function skipClosedInvoice(reference:FirebaseFirestore.DocumentReference,invoice:DocumentSnapshot,job:DocumentSnapshot){
  const now=new Date().toISOString();const reason=`invoice_${String(invoice.get("status"))}`;
  await reference.update({providerSkip:{reason,jobId:job.id,at:now},...(invoice.get("providerState")==="completed"?{}:{providerState:"skipped"}),updatedAt:now,updatedBy:"provider-worker"});
  return{invoiceId:invoice.id,skipped:reason};
}

/**
 * Write what the provider created — unless the invoice closed while we were
 * creating it.
 *
 * The read at the top of a create worker is seconds to minutes older than
 * this write (customer lookups, item lookups, the create itself). A payment
 * recorded in that window used to be overwritten here. Now the provider's ids
 * are still kept — the invoice does exist there — but status and balance stay
 * as the studio left them, and the studio gets a task to void the stray.
 */
async function landProviderInvoice(reference:FirebaseFirestore.DocumentReference,fields:Record<string,unknown>,owed:{status:string;balanceCents?:number}){
  const db=getFirestore();
  return db.runTransaction(async(transaction)=>{
    const current=await transaction.get(reference);
    if(!invoiceClosedToProviderWork(current.get("status"))){transaction.update(reference,{...fields,...owed});return{closedMeanwhile:false}}
    const now=String(fields.updatedAt??new Date().toISOString());
    transaction.update(reference,{...fields,providerSkip:{reason:`closed_while_creating_${String(current.get("status"))}`,at:now}});
    const tenantId=String(current.get("tenantId")??"");const projectId=String(current.get("projectId")??"");
    // Voided in StudioCue while it was being created: the studio has already
    // said it should not exist, so void the stray there too rather than ask
    // them to. A failure of that job still ends in a task
    // (booking/invoice-corrections.ts, recordProviderVoidFailed).
    const voidType=current.get("status")==="voided"?providerVoidJobType(current.get("provider")):null;
    if(voidType&&text(fields.providerInvoiceId)){
      transaction.set(db.doc(`providerJobs/void_${current.id}`),{id:`void_${current.id}`,tenantId,projectId,type:voidType,invoiceId:current.id,providerInvoiceId:fields.providerInvoiceId,idempotencyKey:`void-${current.id}`,status:"queued",attempts:0,createdAt:now,updatedAt:now},{merge:true});
      transaction.update(reference,{providerVoid:{state:"queued",jobId:`void_${current.id}`,at:now}});
      return{closedMeanwhile:true};
    }
    const task=voidInvoiceTask({invoice:current,tenantId,projectId,why:"This invoice was created at the provider just after it was settled or closed in StudioCue.",now,actor:"provider-worker"});
    transaction.set(db.doc(`tasks/${task.id}`),task,{merge:true});
    return{closedMeanwhile:true};
  });
}

export async function createStripeInvoice(job:DocumentSnapshot){const db=getFirestore();const invoiceId=String(job.get("invoiceId"));const reference=db.doc(`invoiceReferences/${invoiceId}`);const invoice=await reference.get();if(!invoice.exists)throw new Error("INVOICE_NOT_FOUND");
  if(invoice.get("providerState")==="completed")return{invoiceId,providerInvoiceId:invoice.get("providerInvoiceId")};
  if(invoiceClosedToProviderWork(invoice.get("status")))return skipClosedInvoice(reference,invoice,job);
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
  if(!providerInvoiceId)throw new Error("STRIPE_INVOICE_ID_MISSING");const now=new Date().toISOString();const landed=await landProviderInvoice(reference,{providerInvoiceId,providerCustomerId,hostedUrl,providerState:"completed",lastSyncedAt:now,updatedAt:now,updatedBy:"provider-worker"},{status:"sent"});return{invoiceId,providerInvoiceId,...landed}}

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
 * Whether this company numbers its own invoices, or expects us to.
 *
 * QuickBooks assigns a sequential DocNumber on create — unless the company
 * has custom transaction numbers switched on, in which case it assigns
 * nothing and the caller is expected to supply one. StudioCue never sent
 * one and never read one back, so on such a company the invoice went out
 * with no number at all: Intuit's own payment email showed the client
 * "Invoice no. null".
 *
 * Asking first is what keeps this respectful. A studio whose books run
 * 1001, 1002, 1003 should keep running 1001, 1002, 1003 — StudioCue has no
 * business injecting its own reference into a numbering sequence that is
 * working. We only supply a number where QuickBooks has declined to.
 *
 * A preferences read we cannot complete returns null, which leaves the
 * numbering to QuickBooks: the same behaviour as every studio whose books
 * are already fine. The same read says how the company handles sales tax
 * (quickBooksTaxMode); null there means "send no tax codes", as before.
 */
async function quickBooksPreferences(
  base:string,
  realmId:string,
  credential:Credential,
):Promise<Record<string,unknown>|null>{
  try{
    const prefs=await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/preferences?minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json"}},"QUICKBOOKS_PREFERENCES_FAILED");
    const record=asRecord(prefs.Preferences);
    return Object.keys(record).length?record:null;
  }catch{
    return null;
  }
}

/** A short, stable reference for a company that numbers nothing itself. */
export function studioCueDocNumber(invoiceId:string):string{
  return `SC-${invoiceId.replace(/^invoice(_attested)?_/,"").slice(0,8).toUpperCase()}`;
}

/** What a QuickBooks invoice actually totals, and the tax on it, in cents. */
function quickBooksInvoiceTotals(record:Record<string,unknown>):{totalCents:number|null;taxCents:number|null}{
  const total=Number(record.TotalAmt);
  const tax=Number(asRecord(record.TxnTaxDetail).TotalTax);
  return {totalCents:Number.isFinite(total)&&record.TotalAmt!==undefined?Math.round(total*100):null,taxCents:Number.isFinite(tax)&&asRecord(record.TxnTaxDetail).TotalTax!==undefined?Math.round(tax*100):null};
}

/**
 * An invoice an earlier attempt already created, found by our own number.
 *
 * This is the guard that was missing when it mattered. StudioCue POSTed an
 * invoice, could not read the reply because the request never asked for
 * JSON, and retried. Every POST had in fact succeeded at Intuit's end, so a
 * studio ended up with six identical $1.00 invoices for one wedding and
 * $6.00 apparently owed. The Request-Id header is documented as the
 * protection against exactly this; it did not dedupe them. I assumed it
 * would, and the books said otherwise.
 *
 * PrivateNote carries the StudioCue id but QuickBooks refuses to filter on
 * it. DocNumber it will filter on — so where we supply the number, we can
 * ask whether an invoice already carries it and adopt rather than
 * duplicate. That covers exactly the companies whose numbering we set,
 * which are the ones where nothing else identifies our invoice.
 */
async function findQuickBooksInvoiceByDocNumber(
  base:string,
  realmId:string,
  credential:Credential,
  docNumber:string,
):Promise<{id:string;balanceCents:number;docNumber:string|null;totalCents:number|null;taxCents:number|null}|null>{
  try{
    const escaped=docNumber.split("'").join("\\'");
    const query=encodeURIComponent("select Id, Balance, DocNumber, TotalAmt from Invoice where DocNumber = '"+escaped+"' maxresults 1");
    const found=await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/query?query=${query}&minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json"}},"QUICKBOOKS_INVOICE_SEARCH_FAILED");
    const invoices=asRecord(found.QueryResponse).Invoice;
    if(!Array.isArray(invoices)||!invoices.length)return null;
    const first=asRecord(invoices[0]);
    const id=text(first.Id);
    return id?{id,balanceCents:Math.round(number(first.Balance)*100),docNumber:text(first.DocNumber)||null,...quickBooksInvoiceTotals(first)}:null;
  }catch{
    // A search we cannot complete must not block the invoice. The worst case
    // is the duplicate this exists to prevent; refusing to invoice at all is
    // worse.
    return null;
  }
}

/**
 * Ask QuickBooks to let the client pay this invoice online, by card and by
 * bank transfer.
 *
 * Never set before, so every invoice StudioCue made was created with online
 * payment off — and an invoice with online payment off has no InvoiceLink,
 * even for a company that has QuickBooks Payments. GR Productions' retainer
 * landed with no pay link and the couple portal said "still syncing" for an
 * invoice that already existed (2026-10-01).
 *
 * Safe for a company without QuickBooks Payments: the flags only say which
 * online methods the invoice accepts, and QuickBooks accepts them on create
 * and simply offers no online payment when the company has none. If a
 * company ever refuses them, the create fails loudly (QUICKBOOKS_CREATE_FAILED)
 * rather than silently — look here first.
 */
export const QUICKBOOKS_ONLINE_PAYMENT_FLAGS = {
  AllowOnlineCreditCardPayment: true,
  AllowOnlineACHPayment: true,
} as const;

/**
 * The shareable link QuickBooks puts behind its own "Review and pay" button.
 *
 * Never fetched before, so hostedUrl was null for every QuickBooks studio
 * while the client portal and the booking page both render a payment link
 * from it. Clients could only pay from QuickBooks' email; lose the email
 * and the portal offered nothing. Stripe populated the equivalent field
 * from day one, which is why this went unnoticed.
 *
 * Absent is not an error — a company without online payments enabled has no
 * link to give, and the email falls back to the portal.
 */
async function quickBooksInvoiceLink(
  base:string,
  realmId:string,
  credential:Credential,
  providerInvoiceId:string,
):Promise<string|null>{
  try{
    const found=await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/invoice/${encodeURIComponent(providerInvoiceId)}?include=invoiceLink&minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json"}},"QUICKBOOKS_INVOICE_LINK_FAILED");
    const link=text(asRecord(found.Invoice).InvoiceLink);
    return link||null;
  }catch{
    return null;
  }
}

/**
 * The retainer email, sent by StudioCue rather than QuickBooks.
 *
 * QuickBooks only emails an invoice when asked, and asking it meant the
 * client received mail in QuickBooks' voice, headed by whatever the company
 * file happened to say — for one studio, "No company name", three times.
 * Nothing about that email was ours: subject, sender, branding and wording
 * all came from their settings.
 *
 * So StudioCue sends it, in the studio's name, through the same branded
 * template every other client email uses. QuickBooks still creates the
 * invoice, owns the payment and reports it back over its webhook; it just
 * no longer speaks to the client. `retainer_invoice` has been written and
 * unused since it was authored — nothing had ever enqueued it.
 */
async function enqueueRetainerEmail(input:{
  db:FirebaseFirestore.Firestore;
  tenantId:string;
  projectId:string;
  invoiceId:string;
  invoiceUrl:string|null;
  email:string;
  /** The invoice's kind. A final bill went out titled "Retainer" until this. */
  kind?:string;
}):Promise<{alreadyDelivered:boolean}>{
  if(!input.email)return {alreadyDelivered:false};
  // Never mail a client twice for one invoice.
  //
  // The job that raises a retainer is retried — by the worker's own backoff,
  // and by a studio pressing Try again. Each pass reached this function, and
  // `set` with merge:false would put a delivered email job back to `queued`,
  // which re-dispatches it. A retry is a StudioCue-side event; the client
  // has no idea it happened and should not receive a second invoice because
  // of it.
  const existing=await input.db.doc(`emailJobs/invoice_${input.invoiceId}`).get();
  // Skipping the send does not make the invoice undelivered. Reporting that
  // it is still awaiting delivery, on a retry, would undo a true "sent" and
  // leave the workspace claiming a client had not been emailed when they
  // had.
  if(existing.exists&&existing.get("status")==="succeeded")return {alreadyDelivered:true};
  const now=new Date().toISOString();
  const appUrl=process.env.NEXT_PUBLIC_APP_URL??"https://studiohub.app";
  await input.db.doc(`emailJobs/invoice_${input.invoiceId}`).set({
    id:`invoice_${input.invoiceId}`,
    tenantId:input.tenantId,
    projectId:input.projectId,
    invoiceId:input.invoiceId,
    type:input.kind==="final"?"final_invoice":"retainer_invoice",
    recipient:input.email,
    // The provider's own pay page when there is one, the portal when there
    // is not. Never nothing: an invoice email with no way to pay is a
    // notification, not an invoice.
    invoiceUrl:input.invoiceUrl??`${appUrl}/client`,
    actionUrl:input.invoiceUrl??`${appUrl}/client`,
    status:"queued",
    attempts:0,
    createdAt:now,
    updatedAt:now,
  },{merge:false});
  return {alreadyDelivered:false};
}

/**
 * Adopt an invoice a previous attempt already created, when we know its id.
 *
 * This was a search on PrivateNote, which carries the StudioCue invoice id.
 * QuickBooks refuses to filter on that field — "property 'PrivateNote' is
 * not queryable" — so the guard 400'd and blocked the create it was meant
 * to protect. Only a handful of Invoice properties are queryable and none
 * of them can carry our id, so there is no search that finds "the invoice
 * StudioCue made for this record".
 *
 * What remains is honest and narrower. If a previous attempt got far enough
 * to record a provider id, read that invoice and adopt it. Beyond that the
 * Request-Id header is the mechanism QuickBooks actually provides for this
 * — it dedupes a repeated request — and the retry path reuses the original
 * job's idempotency key precisely so the header stays the same across
 * attempts.
 *
 * PrivateNote is still stamped on the invoice. It is worth reading when a
 * human reconciles the books even though nothing can query it.
 */
async function adoptQuickBooksInvoice(
  base:string,
  realmId:string,
  credential:Credential,
  providerInvoiceId:string,
):Promise<{id:string;balanceCents:number;docNumber:string|null;totalCents:number|null;taxCents:number|null}|null>{
  if(!providerInvoiceId)return null;
  try{
    const found=await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/invoice/${encodeURIComponent(providerInvoiceId)}?minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json"}},"QUICKBOOKS_INVOICE_READ_FAILED");
    const record=asRecord(found.Invoice);
    const id=text(record.Id);
    return id?{id,balanceCents:Math.round(number(record.Balance)*100),docNumber:text(record.DocNumber)||null,...quickBooksInvoiceTotals(record)}:null;
  }catch{
    // The id we hold may be stale or from another company file. Falling
    // through to a create is safer than failing the job over a read.
    return null;
  }
}

export async function createQuickBooksInvoice(job:DocumentSnapshot){const db=getFirestore();const invoiceId=String(job.get("invoiceId"));const reference=db.doc(`invoiceReferences/${invoiceId}`);const invoice=await reference.get();if(!invoice.exists)throw new Error("INVOICE_NOT_FOUND");
  if(invoice.get("providerState")==="completed")return{invoiceId,providerInvoiceId:invoice.get("providerInvoiceId")};
  if(invoiceClosedToProviderWork(invoice.get("status")))return skipClosedInvoice(reference,invoice,job);
  const tenantId=String(job.get("tenantId"));const provider=await connection(tenantId,"quickbooks");let providerInvoiceId:string;let providerCustomerId=text(invoice.get("providerCustomerId"));let balanceCents=Number(invoice.get("balanceCents"));let hostedUrl:string|null=null;let docNumber:string|null=null;let alreadyDelivered=false;
  const expectedCents=Number(invoice.get("amountCents"));
  // The lines the studio would have typed: retainer × crew and the packages
  // at $0, or packages at full price less the retainer plus tax
  // (quickbooks-invoice-lines.ts). Worked out in mock mode too, so the
  // booking page shows the same breakdown either way.
  const plan=await planQuickBooksInvoiceLines(db,invoice);
  let taxMode:QuickBooksTaxMode="none";
  let providerTotalCents:number|null=null;let providerTaxCents:number|null=null;
  if(provider.mock){providerInvoiceId=mockId("qbo_invoice",job.id);providerCustomerId=providerCustomerId.startsWith("pending_")?mockId("qbo_customer",String(invoice.get("projectId"))):providerCustomerId;providerTotalCents=expectedCents;providerTaxCents=plan.taxCents}else{const credential=provider.credential;const realmId=credential?.realmId??String(provider.document.get("providerAccountId")??"");if(!credential||!realmId)throw new Error("QUICKBOOKS_REALM_MISSING");providerCustomerId=await quickBooksCustomerId(tenantId,String(invoice.get("projectId")),invoice,credential,realmId,String(job.get("idempotencyKey")??job.id));const base=quickBooksApiBaseUrl(credential.baseUrl);const preferences=await quickBooksPreferences(base,realmId,credential);const supplyNumber=asRecord(preferences?.SalesFormsPrefs).CustomTxnNumbers===true;taxMode=plan.itemised?quickBooksTaxMode(preferences):"none";const ourNumber=supplyNumber?studioCueDocNumber(invoiceId):null;const already=await adoptQuickBooksInvoice(base,realmId,credential,text(invoice.get("providerInvoiceId")))??(ourNumber?await findQuickBooksInvoiceByDocNumber(base,realmId,credential,ourNumber):null);if(already){providerInvoiceId=already.id;balanceCents=already.balanceCents;docNumber=already.docNumber;providerTotalCents=already.totalCents;providerTaxCents=already.taxCents}else{const itemKey=String(job.get("idempotencyKey")??job.id);
      // The StudioCue Retainer / Photography package items, set up on the
      // first invoice if the studio hasn't (integrations/quickbooks-items.ts);
      // the single service item as before if that cannot be done.
      const itemRef=await studioCueInvoiceItemRefs({tenantId,company:quickBooksCompany({apiBaseUrl:base,realmId,accessToken:credential.accessToken,request:providerJson}),idempotencyKey:itemKey})??await quickBooksItemRef(base,realmId,credential,itemKey);const requestId=String(job.get("idempotencyKey")??job.id);
      const createInvoice=(online:boolean,mode:QuickBooksTaxMode,suffix:string)=>{const payload=quickBooksLinePayload({lines:plan.lines,taxCents:plan.taxCents,mode,itemRef});return providerJson(`${quickBooksApiBaseUrl(credential.baseUrl)}/v3/company/${encodeURIComponent(realmId)}/invoice?minorversion=75`,{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json","content-type":"application/json","request-id":`${requestId}${suffix}`},body:JSON.stringify({...(ourNumber?{DocNumber:ourNumber}:{}),CustomerRef:{value:providerCustomerId},DueDate:invoice.get("dueDate"),PrivateNote:`StudioCue ${invoiceId}`,...(online?QUICKBOOKS_ONLINE_PAYMENT_FLAGS:{}),Line:payload.Line,...(payload.TxnTaxDetail?{TxnTaxDetail:payload.TxnTaxDetail}:{})})},"QUICKBOOKS_CREATE_FAILED")};
      const refused=(error:unknown)=>String((error as Error)?.message??"").startsWith("QUICKBOOKS_CREATE_FAILED:400:");
      // A refused request (400) created nothing, so asking again cannot
      // duplicate the invoice. First without the online-payment flags (a
      // company that rejected them would otherwise get no retainer invoice at
      // all), then — only if tax codes were sent — without those either:
      // the shape StudioCue sent before tax modes, with StudioCue's tax as a
      // line, so the total is the same and the read-back below still checks it.
      const value=await createInvoice(true,taxMode,"").catch((error:unknown)=>{if(refused(error))return createInvoice(false,taxMode,":offline");throw error;}).catch((error:unknown)=>{if(refused(error)&&taxMode!=="none"){taxMode="none";return createInvoice(false,"none",":plain");}throw error;});
      const created=asRecord(value.Invoice);providerInvoiceId=text(created.Id);balanceCents=Math.round(number(created.Balance)*100);docNumber=text(created.DocNumber)||null;const totals=quickBooksInvoiceTotals(created);providerTotalCents=totals.totalCents;providerTaxCents=totals.taxCents}
    // One place for both paths: whether the invoice was just made or
    // adopted from an earlier attempt, the client still needs the link and
    // the email.
    if(providerInvoiceId){
      hostedUrl=await quickBooksInvoiceLink(base,realmId,credential,providerInvoiceId);
      const delivery=await enqueueRetainerEmail({db,tenantId,projectId:String(invoice.get("projectId")),invoiceId,invoiceUrl:hostedUrl,kind:String(invoice.get("kind")??""),email:await clientEmailFor(db,tenantId,String(invoice.get("projectId")))});alreadyDelivered=delivery.alreadyDelivered;
    }
  }
  if(!providerInvoiceId)throw new Error("QUICKBOOKS_INVOICE_ID_MISSING");const now=new Date().toISOString();
  /**
   * What QuickBooks actually billed, against what StudioCue expected.
   *
   * QuickBooks owns sales tax on the company file, so the invoice it made is
   * read back rather than assumed. A different total is never smoothed over:
   * the record takes QuickBooks' figure (the couple pays that one, and
   * `amount − balance` must stay true for every "paid so far" sum), and the
   * mismatch is kept for the booking page to put in front of the studio.
   */
  const check=providerTotalCents===null?null:quickBooksAmountCheck(expectedCents,providerTotalCents);
  const mismatch=check&&!check.matches&&check.providerTotalCents>0?{expectedCents:check.expectedCents,providerTotalCents:check.providerTotalCents,differenceCents:check.differenceCents,providerTaxCents,taxMode,detectedAt:now}:null;
  if(mismatch)console.warn(JSON.stringify({severity:"WARNING",event:"quickbooks.invoice_total_mismatch",tenantId,invoiceId,...mismatch}));
  const providerLines={lines:plan.lines,taxCents:plan.taxCents,taxMode,itemised:plan.itemised,expectedTotalCents:expectedCents,builtAt:now};
  const providerTotals=providerTotalCents===null?null:{totalCents:providerTotalCents,balanceCents,taxCents:providerTaxCents,readAt:now};
  // The invoice exists at the provider; the client has not been mailed yet.
  // `awaiting_delivery` until the email job reports otherwise, because
  // "sent" is a claim about what reached the client and nothing has yet.
  const landed=await landProviderInvoice(reference,{providerInvoiceId,providerCustomerId,providerState:"completed",...(hostedUrl?{hostedUrl}:{}),providerDocNumber:docNumber,providerLines,providerTotals,providerAmountMismatch:mismatch,...(mismatch?{amountCents:mismatch.providerTotalCents}:{}),lastSyncedAt:now,updatedAt:now,updatedBy:"provider-worker"},{balanceCents,status:provider.mock||alreadyDelivered?"sent":"awaiting_delivery"});
  return{invoiceId,providerInvoiceId,hostedUrl,...landed}}

/**
 * Voiding an invoice at the provider, after the studio voided it in StudioCue
 * (booking/invoice-corrections.ts, voidInvoice).
 *
 * StudioCue's record is already `voided` when this runs; this makes the
 * provider agree, so the couple's emailed link stops asking for money. Each
 * worker reads the invoice first: already void there is success, and money
 * taken there is a refusal — voiding would unapply a real payment, which is
 * the studio's call to make in QuickBooks or Stripe, not ours. A refusal is
 * permanent (a 4xx), so the job dead-letters and the studio gets a task to
 * void it by hand (operations/jobs.ts → recordProviderVoidFailed).
 */
async function markProviderVoided(reference:FirebaseFirestore.DocumentReference,job:DocumentSnapshot,outcome:string){
  const now=new Date().toISOString();
  await reference.update({providerVoid:{state:"completed",jobId:job.id,outcome,at:now},updatedAt:now,updatedBy:"provider-worker"});
}

export async function voidQuickBooksInvoice(job:DocumentSnapshot){const db=getFirestore();const invoiceId=String(job.get("invoiceId"));const reference=db.doc(`invoiceReferences/${invoiceId}`);const invoice=await reference.get();if(!invoice.exists)throw new Error("INVOICE_NOT_FOUND");
  const providerInvoiceId=text(job.get("providerInvoiceId"))||text(invoice.get("providerInvoiceId"));
  if(!providerInvoiceId||providerInvoiceId.startsWith("pending_")){await markProviderVoided(reference,job,"never_created");return{invoiceId,voided:"never_created"}}
  const provider=await connection(String(job.get("tenantId")),"quickbooks");
  if(provider.mock){await markProviderVoided(reference,job,"mock");return{invoiceId,voided:"mock"}}
  const credential=provider.credential;const realmId=credential?.realmId??String(provider.document.get("providerAccountId")??"");if(!credential||!realmId)throw new Error("QUICKBOOKS_REALM_MISSING");
  const base=quickBooksApiBaseUrl(credential.baseUrl);
  // The SyncToken the void needs, and what QuickBooks holds now.
  const found=asRecord((await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/invoice/${encodeURIComponent(providerInvoiceId)}?minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json"}},"QUICKBOOKS_INVOICE_READ_FAILED")).Invoice);
  const total=Math.round(number(found.TotalAmt)*100);const balance=Math.round(number(found.Balance)*100);
  // A voided QuickBooks invoice keeps its lines at zero: total and balance 0.
  if(total===0&&balance===0){await markProviderVoided(reference,job,"already_void");return{invoiceId,voided:"already_void"}}
  if(balance<total)throw new Error(`QUICKBOOKS_INVOICE_HAS_PAYMENT:409:QuickBooks shows a payment of ${((total-balance)/100).toFixed(2)} on this invoice`);
  await providerJson(`${base}/v3/company/${encodeURIComponent(realmId)}/invoice?operation=void&minorversion=75`,{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json","content-type":"application/json","request-id":String(job.get("idempotencyKey")??job.id)},body:JSON.stringify({Id:providerInvoiceId,SyncToken:String(found.SyncToken??"0")})},"QUICKBOOKS_VOID_FAILED");
  await markProviderVoided(reference,job,"voided");
  return{invoiceId,providerInvoiceId,voided:"voided"}}

export async function voidStripeInvoice(job:DocumentSnapshot){const db=getFirestore();const invoiceId=String(job.get("invoiceId"));const reference=db.doc(`invoiceReferences/${invoiceId}`);const invoice=await reference.get();if(!invoice.exists)throw new Error("INVOICE_NOT_FOUND");
  const providerInvoiceId=text(job.get("providerInvoiceId"))||text(invoice.get("providerInvoiceId"));
  if(!providerInvoiceId||providerInvoiceId.startsWith("pending_")){await markProviderVoided(reference,job,"never_created");return{invoiceId,voided:"never_created"}}
  const provider=await connection(String(job.get("tenantId")),"stripe");
  if(provider.mock){await markProviderVoided(reference,job,"mock");return{invoiceId,voided:"mock"}}
  const credential=provider.credential;if(!credential)throw new Error("STRIPE_CREDENTIAL_MISSING");
  const url=`https://api.stripe.com/v1/invoices/${encodeURIComponent(providerInvoiceId)}`;
  const current=await providerJson(url,{headers:{authorization:`Bearer ${credential.accessToken}`}},"STRIPE_INVOICE_READ_FAILED");
  const status=text(current.status);
  if(status==="void"){await markProviderVoided(reference,job,"already_void");return{invoiceId,voided:"already_void"}}
  if(status==="paid"||number(current.amount_paid)>0)throw new Error("STRIPE_INVOICE_HAS_PAYMENT:409:Stripe shows a payment on this invoice");
  // A draft is deleted, not voided: Stripe only voids a finalized invoice.
  if(status==="draft")await providerJson(url,{method:"DELETE",headers:{authorization:`Bearer ${credential.accessToken}`}},"STRIPE_INVOICE_DELETE_FAILED");
  else await providerJson(`${url}/void`,{method:"POST",headers:{authorization:`Bearer ${credential.accessToken}`,"content-type":"application/x-www-form-urlencoded","idempotency-key":String(job.get("idempotencyKey")??job.id)}},"STRIPE_VOID_FAILED");
  const outcome=status==="draft"?"deleted_draft":"voided";
  await markProviderVoided(reference,job,outcome);
  return{invoiceId,providerInvoiceId,voided:outcome}}

export async function reconcileQuickBooksInvoice(job:DocumentSnapshot){const db=getFirestore();const invoiceId=String(job.get("invoiceId"));const reference=db.doc(`invoiceReferences/${invoiceId}`);const invoice=await reference.get();if(!invoice.exists)throw new Error("INVOICE_NOT_FOUND");const providerInvoiceId=String(job.get("providerInvoiceId")??invoice.get("providerInvoiceId")??"");if(!providerInvoiceId)throw new Error("QUICKBOOKS_INVOICE_ID_MISSING");const operation=String(job.get("operation")??"").toLowerCase();let status:string;let balanceCents:number;
  if(["delete","deleted","void","voided"].includes(operation)){status="voided";balanceCents=0}else{const provider=await connection(String(job.get("tenantId")),"quickbooks");if(provider.mock){status=String(invoice.get("status")??"sent");balanceCents=Number(invoice.get("balanceCents")??0)}else{const credential=provider.credential;const realmId=credential?.realmId??String(job.get("realmId")??provider.document.get("providerAccountId")??"");if(!credential||!realmId)throw new Error("QUICKBOOKS_REALM_MISSING");const value=await providerJson(`${quickBooksApiBaseUrl(credential.baseUrl)}/v3/company/${encodeURIComponent(realmId)}/invoice/${encodeURIComponent(providerInvoiceId)}?minorversion=75`,{headers:{authorization:`Bearer ${credential.accessToken}`,accept:"application/json","content-type":"application/json"}},"QUICKBOOKS_INVOICE_READ_FAILED");const current=asRecord(value.Invoice);balanceCents=Math.max(0,Math.round(number(current.Balance)*100));const totalCents=Math.max(0,Math.round(number(current.TotalAmt)*100));status=balanceCents===0?"paid":balanceCents<totalCents?"partially_paid":"sent"}}
  // A payment the studio recorded by hand, or a bill StudioCue closed, is not
  // undone by QuickBooks re-reading a balance it never saw paid. Only its own
  // paid or voided wins (invoice-standing.ts, providerReportedInvoice).
  const decided=providerReportedInvoice({current:{status:invoice.get("status"),completionAuthority:invoice.get("completionAuthority"),balanceCents:invoice.get("balanceCents"),studioPayments:invoice.get("studioPayments")},reported:{status,balanceCents}});status=decided.status;balanceCents=decided.balanceCents;
  const now=new Date().toISOString();const batch=db.batch();
  // Paid here, owing again there: a payment removed or voided in QuickBooks.
  // The studio hears about it on Today (booking/quickbooks-money-events-core.ts).
  if(reopenedByProvider({before:{status:invoice.get("status"),balanceCents:invoice.get("balanceCents")},after:{status,balanceCents}})){const task=reopenedInvoiceTask({invoiceId,tenantId:String(invoice.get("tenantId")??""),projectId:String(invoice.get("projectId")??""),kind:invoice.get("kind"),docNumber:invoice.get("providerDocNumber"),balanceCents,currency:invoice.get("currency"),now});batch.set(db.doc(`tasks/${task.id}`),task,{merge:true})}batch.update(reference,{status,balanceCents,...(decided.keptReason?{providerReportKept:{reason:decided.keptReason,at:now}}:{}),lastProviderEventId:String(job.get("idempotencyKey")??job.id),lastSyncedAt:String(job.get("occurredAt")??now),providerState:"completed",updatedAt:now,updatedBy:"quickbooks-reconciliation"});const webhookEventId=String(job.get("webhookEventId")??"");if(webhookEventId)batch.update(db.doc(`webhookEvents/${webhookEventId}`),{status:"processed",processedAt:now});await batch.commit();return{invoiceId,providerInvoiceId,status,balanceCents}}

/**
 * A payment the studio recorded in StudioCue (booking/invoice-payments.ts),
 * recorded at the provider so its balance agrees: the one the couple's link
 * asks for, and the one every sync reads back.
 *
 * Each worker checks the provider first: a payment already there (a retry
 * after a lost response) is adopted, never made twice, and a payment larger
 * than the provider's balance is refused — something else already took that
 * money there, and the studio is asked to look (a 409 dead-letters the job;
 * operations/jobs.ts → recordProviderPaymentFailed raises the task).
 */
async function studioPaymentJob(job: DocumentSnapshot) {
  const db = getFirestore();
  const invoice = await db.doc(`invoiceReferences/${text(job.get("invoiceId"))}`).get();
  if (!invoice.exists || invoice.get("tenantId") !== job.get("tenantId")) throw new Error("INVOICE_NOT_FOUND");
  const payment = studioPaymentFor(invoice, text(job.get("paymentId")));
  const providerInvoiceId = text(job.get("providerInvoiceId")) || text(invoice.get("providerInvoiceId"));
  if (!providerInvoiceId || providerInvoiceId.startsWith("pending_"))
    throw new Error("PROVIDER_INVOICE_ID_MISSING:409:The invoice was never created there");
  return { db, invoice, payment, providerInvoiceId };
}

const cents = (value: unknown) => Math.max(0, Math.round(number(value) * 100));

export async function recordQuickBooksPayment(job: DocumentSnapshot) {
  const { db, invoice, payment, providerInvoiceId } = await studioPaymentJob(job);
  if (!payment) return { invoiceId: invoice.id, skipped: "payment_not_on_invoice" };
  if (asRecord(payment.provider).state === "completed") return { invoiceId: invoice.id, skipped: "already_recorded" };
  const amountCents = Number(payment.amountCents);
  const provider = await connection(text(job.get("tenantId")), "quickbooks");
  if (provider.mock) {
    await landStudioPaymentAtProvider(db, job, { providerPaymentId: mockId("qbo_payment", job.id), result: "mock", reported: null });
    return { invoiceId: invoice.id, recorded: "mock" };
  }
  const credential = provider.credential;
  const realmId = credential?.realmId ?? text(provider.document.get("providerAccountId"));
  if (!credential || !realmId) throw new Error("QUICKBOOKS_REALM_MISSING");
  const company = `${quickBooksApiBaseUrl(credential.baseUrl)}/v3/company/${encodeURIComponent(realmId)}`;
  const headers = { authorization: `Bearer ${credential.accessToken}`, accept: "application/json" };
  const readInvoice = async () =>
    asRecord(
      (await providerJson(`${company}/invoice/${encodeURIComponent(providerInvoiceId)}?minorversion=75`, { headers }, "QUICKBOOKS_INVOICE_READ_FAILED"))
        .Invoice,
    );
  const reportedFrom = (found: Json) => {
    const balanceCents = cents(found.Balance);
    const totalCents = cents(found.TotalAmt);
    return { status: balanceCents === 0 ? "paid" : balanceCents < totalCents ? "partially_paid" : "sent", balanceCents };
  };
  const found = await readInvoice();
  // Already there: a payment linked to this invoice carrying this payment's
  // id in its note. Payment by Id is a filter QuickBooks accepts (see
  // quickBooksPaymentHistory below).
  const linkedPaymentIds = (Array.isArray(found.LinkedTxn) ? found.LinkedTxn : [])
    .map(asRecord)
    .filter((linked) => text(linked.TxnType) === "Payment")
    .map((linked) => text(linked.TxnId))
    .filter(Boolean)
    .slice(0, 50);
  if (linkedPaymentIds.length) {
    const statement = `select * from Payment where Id in (${linkedPaymentIds.map((id) => `'${id.replaceAll("'", "\\'")}'`).join(",")}) maxresults 50`;
    const rows = asRecord(
      (await providerJson(`${company}/query?query=${encodeURIComponent(statement)}&minorversion=75`, { headers }, "QUICKBOOKS_PAYMENT_SEARCH_FAILED"))
        .QueryResponse,
    ).Payment;
    const existing = (Array.isArray(rows) ? rows.map(asRecord) : []).find((row) => text(row.PrivateNote).includes(String(payment.id)));
    if (existing) {
      await landStudioPaymentAtProvider(db, job, { providerPaymentId: text(existing.Id) || null, result: "already_there", reported: reportedFrom(found) });
      return { invoiceId: invoice.id, providerPaymentId: text(existing.Id), recorded: "already_there" };
    }
  }
  const balanceCents = cents(found.Balance);
  if (amountCents > balanceCents)
    throw new Error(
      `QUICKBOOKS_PAYMENT_EXCEEDS_BALANCE:409:QuickBooks shows ${(balanceCents / 100).toFixed(2)} left on this invoice, less than the ${(amountCents / 100).toFixed(2)} recorded`,
    );
  const customerId = text(asRecord(found.CustomerRef).value) || text(invoice.get("providerCustomerId"));
  if (!customerId) throw new Error("QUICKBOOKS_CUSTOMER_MISSING:409:The invoice has no customer in QuickBooks");
  const reference = text(payment.reference).slice(0, 21);
  // `requestid` is QuickBooks' idempotency key: a retried job is the same
  // request, and QuickBooks answers it with the payment it already made.
  const requestId = encodeURIComponent(text(job.get("idempotencyKey")) || job.id);
  const created = asRecord(
    (
      await providerJson(
        `${company}/payment?minorversion=75&requestid=${requestId}`,
        {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({
            CustomerRef: { value: customerId },
            TotalAmt: amountCents / 100,
            ...(/^\d{4}-\d{2}-\d{2}$/.test(text(payment.paidAt)) ? { TxnDate: text(payment.paidAt) } : {}),
            ...(reference ? { PaymentRefNum: reference } : {}),
            PrivateNote: `StudioCue ${String(payment.id)} · ${text(payment.method)}`.slice(0, 4000),
            Line: [{ Amount: amountCents / 100, LinkedTxn: [{ TxnId: providerInvoiceId, TxnType: "Invoice" }] }],
          }),
        },
        "QUICKBOOKS_PAYMENT_RECORD_FAILED",
      )
    ).Payment,
  );
  // The balance is QuickBooks' again, read after its own arithmetic.
  await landStudioPaymentAtProvider(db, job, {
    providerPaymentId: text(created.Id) || null,
    result: "recorded",
    reported: reportedFrom(await readInvoice()),
  });
  return { invoiceId: invoice.id, providerPaymentId: text(created.Id), recorded: "recorded" };
}

/**
 * Stripe has no out-of-band part payment on an open invoice:
 * `paid_out_of_band` settles the whole of it. So a part payment is a credit
 * note for the amount — it lowers what the couple's link asks for, and its
 * memo says the money came outside Stripe — and a payment that clears the
 * rest marks the invoice paid out of band. See
 * features/booking/invoice-payments.ts.
 */
export async function recordStripePayment(job: DocumentSnapshot) {
  const { db, invoice, payment, providerInvoiceId } = await studioPaymentJob(job);
  if (!payment) return { invoiceId: invoice.id, skipped: "payment_not_on_invoice" };
  if (asRecord(payment.provider).state === "completed") return { invoiceId: invoice.id, skipped: "already_recorded" };
  const amountCents = Number(payment.amountCents);
  const provider = await connection(text(job.get("tenantId")), "stripe");
  if (provider.mock) {
    await landStudioPaymentAtProvider(db, job, { providerPaymentId: mockId("stripe_credit_note", job.id), result: "mock", reported: null });
    return { invoiceId: invoice.id, recorded: "mock" };
  }
  const credential = provider.credential;
  if (!credential) throw new Error("STRIPE_CREDENTIAL_MISSING");
  const auth = { authorization: `Bearer ${credential.accessToken}` };
  const url = `https://api.stripe.com/v1/invoices/${encodeURIComponent(providerInvoiceId)}`;
  const readInvoice = () => providerJson(url, { headers: auth }, "STRIPE_INVOICE_READ_FAILED");
  const reportedFrom = (current: Json) => {
    const remaining = Math.max(0, number(current.amount_remaining));
    return {
      status:
        text(current.status) === "void"
          ? "voided"
          : remaining === 0
            ? "paid"
            : number(current.amount_paid) > 0 || number(current.pre_payment_credit_notes_amount) > 0
              ? "partially_paid"
              : "sent",
      balanceCents: remaining,
    };
  };
  const current = await readInvoice();
  const status = text(current.status);
  if (status === "paid") {
    await landStudioPaymentAtProvider(db, job, { providerPaymentId: null, result: "already_paid", reported: reportedFrom(current) });
    return { invoiceId: invoice.id, recorded: "already_paid" };
  }
  if (status !== "open") throw new Error(`STRIPE_INVOICE_NOT_OPEN:409:Stripe shows this invoice as ${status || "unknown"}`);
  // Already there: a credit note on this invoice carrying this payment's id.
  const notes = await providerJson(
    `https://api.stripe.com/v1/credit_notes?invoice=${encodeURIComponent(providerInvoiceId)}&limit=100`,
    { headers: auth },
    "STRIPE_CREDIT_NOTE_LIST_FAILED",
  );
  const existing = (Array.isArray(notes.data) ? notes.data.map(asRecord) : []).find(
    (note) => text(asRecord(note.metadata).studiocue_payment_id) === String(payment.id) && text(note.status) !== "void",
  );
  if (existing) {
    await landStudioPaymentAtProvider(db, job, { providerPaymentId: text(existing.id) || null, result: "already_there", reported: reportedFrom(await readInvoice()) });
    return { invoiceId: invoice.id, providerPaymentId: text(existing.id), recorded: "already_there" };
  }
  const remaining = Math.max(0, number(current.amount_remaining));
  if (amountCents > remaining)
    throw new Error(
      `STRIPE_PAYMENT_EXCEEDS_BALANCE:409:Stripe shows ${(remaining / 100).toFixed(2)} left on this invoice, less than the ${(amountCents / 100).toFixed(2)} recorded`,
    );
  const form = { ...auth, "content-type": "application/x-www-form-urlencoded", "idempotency-key": text(job.get("idempotencyKey")) || job.id };
  let providerPaymentId: string | null = null;
  let result: string;
  if (amountCents === remaining) {
    await providerJson(`${url}/pay`, { method: "POST", headers: form, body: new URLSearchParams({ paid_out_of_band: "true" }) }, "STRIPE_PAID_OUT_OF_BAND_FAILED");
    result = "paid_out_of_band";
  } else {
    const ref = text(payment.reference);
    const memo = `Paid outside Stripe on ${text(payment.paidAt)} by ${text(payment.method)}${ref ? ` (ref ${ref})` : ""}`.slice(0, 500);
    const note = await providerJson(
      "https://api.stripe.com/v1/credit_notes",
      {
        method: "POST",
        headers: form,
        body: new URLSearchParams({
          invoice: providerInvoiceId,
          amount: String(amountCents),
          memo,
          "metadata[studiocue_payment_id]": String(payment.id),
          "metadata[studiocue_invoice_id]": invoice.id,
        }),
      },
      "STRIPE_CREDIT_NOTE_FAILED",
    );
    providerPaymentId = text(note.id) || null;
    result = "credit_note";
  }
  await landStudioPaymentAtProvider(db, job, { providerPaymentId, result, reported: reportedFrom(await readInvoice()) });
  return { invoiceId: invoice.id, providerPaymentId, recorded: result };
}

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
  /**
   * The job's "crew_plan" step: work out who this booking still has to hire
   * and write the plan, so the studio approves a shortlist instead of building
   * one.
   *
   * Beside the workflow step and for the same reason — **before** the
   * provider-state early return. Placed after it, this ran only on the one
   * pass that completed the provider side effects: a retry after a partial
   * failure returned early and the plan was never prepared, silently, because
   * its own failure is swallowed. It is idempotent in its own right (an
   * existing plan is left alone), so running it on every pass is safe.
   *
   * Its failure never fails the booking — a wedding is booked whether or not
   * its staffing could be worked out.
   */
  let crewPlan: Awaited<ReturnType<typeof prepareCrewStaffing>> | { skipped: string };
  try {
    crewPlan = await prepareCrewStaffing({ tenantId, projectId, actorId: "booking-orchestrator", now: new Date().toISOString() });
  } catch (caught: unknown) {
    crewPlan = { skipped: caught instanceof Error ? caught.message : "CREW_PLAN_FAILED" };
  }
  if(project.get("bookingProviderState")==="completed")return{projectId,folderIds:project.get("dropboxFolderIds"),eventId:project.get("calendarEventId"),workflow,crewPlan};
  const date=String(project.get("eventDate"));const name=String(project.get("name"));const eventType=String(project.get("eventType"));const safe=`${date}_${name}_${eventType}`.replace(/[^a-zA-Z0-9_-]+/g,"_");let folderIds:string[]=[];let projectRootPath:string|null=null;const sideEffectSkips:Record<string,string>={};try{const dropbox=await connection(tenantId,"dropbox");const configuredRoot=String(dropbox.document.get("selectedResourceId")??"/StudioCue");const root=configuredRoot.startsWith("/")?configuredRoot:`/${configuredRoot}`;const projectRoot=`${root.replace(/\/$/,"")}/${date.slice(0,4)}/${safe}`;projectRootPath=projectRoot;const paths=[projectRoot,...["01_Contracts","02_Invoices","03_Client_Details","04_Schedule","05_COI","06_Crew","07_Delivery"].map(folder=>`${projectRoot}/${folder}`)];for(const path of paths){if(dropbox.mock){folderIds.push(mockId("dropbox",path));continue}const value=await dropboxFolder(String(dropbox.credential?.accessToken),path);folderIds.push(text(value.id))}}catch(caught:unknown){folderIds=[];projectRootPath=null;sideEffectSkips.dropbox=caught instanceof Error?caught.message:"DROPBOX_UNAVAILABLE"}
  let eventId=String(project.get("calendarEventId")??"");try{const calendar=await connection(tenantId,"google_calendar");if(!eventId)eventId=await putStudioBookingEvent(calendar,project)}catch(caught:unknown){sideEffectSkips.calendar=caught instanceof Error?caught.message:"GOOGLE_CALENDAR_UNAVAILABLE"}
  const now=new Date().toISOString();
  // P22: promote the booked couple from prospect to client so they appear in
  // the Clients directory (where re-invite already lives). Nothing did this, so
  // a booked couple was reachable only through their project. Done here in the
  // post-booking side-effects worker — never in the evidence-controlled booking
  // transaction — and idempotent: a contact that is already a client is skipped.
  const clientContactIds = Array.isArray(project.get("clientContactIds"))
    ? (project.get("clientContactIds") as unknown[]).filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      )
    : [];
  const contactSnaps = clientContactIds.length
    ? await db.getAll(...clientContactIds.map((id) => db.doc(`contacts/${id}`)))
    : [];
  const batch=db.batch();
  batch.update(project.ref,{dropboxRootPath:projectRootPath,dropboxFolderIds:folderIds,calendarEventId:eventId,bookingProviderState:"completed",bookingSideEffectSkips:Object.keys(sideEffectSkips).length?sideEffectSkips:null,updatedAt:now,updatedBy:"provider-worker"});
  for (const snap of contactSnaps) {
    if (!snap.exists) continue;
    const existingTypes = Array.isArray(snap.get("contactTypes"))
      ? (snap.get("contactTypes") as unknown[]).map(String)
      : [];
    if (alreadyClientOnly(existingTypes)) continue;
    batch.update(snap.ref, {
      contactTypes: promoteContactTypesToClient(existingTypes),
      updatedAt: now,
      updatedBy: "provider-worker",
    });
  }
  // An imported booking was booked long before StudioCue, so it never gets
  // "You're booked" — whether this runs while it is quiet or after the studio
  // brings the couple in and asks for the calendar and folders.
  if(!project.get("importedAt"))batch.set(db.doc(`emailJobs/booking_confirmation_${projectId}`),{id:`booking_confirmation_${projectId}`,tenantId,projectId,type:"booking_confirmation",status:"queued",attempts:0,createdAt:now,updatedAt:now},{merge:false});await batch.commit();return{projectId,folderIds,eventId,workflow,crewPlan}}

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
  const projectName = crewCalendarEventName({
    name: project.get("name"),
    eventTypeLabel: project.get("eventTypeLabel"),
    eventType: project.get("eventType"),
  });
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

/**
 * Take a withdrawn crew member's Google Calendar invite back.
 *
 * `addCrewCalendarInvite` puts the event on the studio's calendar with the
 * crew member as an attendee (`sendUpdates=all`), so it stays in their diary
 * until the event itself is deleted — the way a cancelled consultation's
 * event is removed. Queued by withdrawAssignment in
 * functions/src/crew/commands.ts. 404 and 410 mean it is already gone, which
 * is the goal.
 */
export async function removeCrewCalendarInvite(job: DocumentSnapshot) {
  const db = getFirestore();
  const assignmentId = String(job.get("assignmentId") ?? "");
  const reference = db.doc(`crewAssignments/${assignmentId}`);
  const assignment = await reference.get();
  /**
   * Withdrawn on the way to deleting the job (crew/withdraw-for-job.ts): the
   * assignment went with the job, so the job carries the event id itself.
   * Nobody can be "still accepted" on a job that no longer exists.
   */
  const deletedWithJob = !assignment.exists && Boolean(text(job.get("calendarEventId")));
  if (!assignment.exists && !deletedWithJob) throw new Error("ASSIGNMENT_NOT_FOUND");
  // Never take down the invite of somebody who is on the job.
  if (assignment.get("status") === "accepted")
    return { assignmentId, skipped: "still_accepted" };
  const calendarEventId = deletedWithJob
    ? text(job.get("calendarEventId"))
    : text(assignment.get("calendarEventId"));
  if (!calendarEventId) return { assignmentId, skipped: "no_calendar_event" };
  const tenantId = String(job.get("tenantId"));
  const calendar = await connection(tenantId, "google_calendar");
  if (!calendar.mock) {
    const calendarId = encodeURIComponent(
      String(calendar.document.get("selectedResourceId") ?? "primary"),
    );
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${encodeURIComponent(calendarEventId)}?sendUpdates=all`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${calendar.credential?.accessToken}` },
      },
    );
    if (!response.ok && response.status !== 404 && response.status !== 410)
      throw new Error(`CALENDAR_DELETE_FAILED:${response.status}`);
  }
  if (deletedWithJob) return { assignmentId, removed: calendarEventId };
  await reference.update({
    calendarEventId: null,
    calendarInviteLink: null,
    calendarRemovedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: "provider-worker",
  });
  return { assignmentId, removed: calendarEventId };
}

/**
 * What QuickBooks already knows a couple has paid, for importing a booking
 * made before StudioCue.
 *
 * Read-only: finds each client by email, reads their invoices, and reads the
 * payments those invoices link to. Nothing is created in QuickBooks and
 * nothing is recorded in StudioCue — the result prefills the import, which a
 * studio member checks and submits.
 *
 * Every filter is one QuickBooks is known to accept, because a query on one it
 * doesn't answers 400 and the whole lookup fails silently for the studio:
 * Customer by PrimaryEmailAddr and Invoice by CustomerRef are already relied
 * on above, and a Payment is fetched by Id, which every entity filters on.
 * tests/quickbooks-query-fields.test.ts holds all three to that list.
 *
 * A returning client's QuickBooks history includes every job they ever booked,
 * so the caller must say these payments need checking against this booking.
 */
export async function quickBooksPaymentHistory(
  tenantId: string,
  emails: readonly string[],
): Promise<{
  mock: boolean;
  clients: Array<{
    email: string;
    customer: { id: string; name: string } | null;
    invoicedCents: number;
    openCents: number;
    invoiceCount: number;
    payments: Array<{ id: string; amountCents: number; paidOn: string }>;
  }>;
}> {
  const provider = await connection(tenantId, "quickbooks");
  const unique = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))].slice(0, 200);
  if (provider.mock || !provider.credential)
    return {
      mock: true,
      clients: unique.map((email) => ({
        email,
        customer: null,
        invoicedCents: 0,
        openCents: 0,
        invoiceCount: 0,
        payments: [],
      })),
    };
  const credential = provider.credential;
  const realmId = credential.realmId ?? String(provider.document.get("providerAccountId") ?? "");
  if (!realmId) throw new Error("QUICKBOOKS_REALM_MISSING");
  const base = quickBooksApiBaseUrl(credential.baseUrl);
  const headers = { authorization: `Bearer ${credential.accessToken}`, accept: "application/json" };
  const query = async (statement: string, failure: string) =>
    asRecord(
      (
        await providerJson(
          `${base}/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent(statement)}&minorversion=75`,
          { headers },
          failure,
        )
      ).QueryResponse,
    );
  const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);
  const quote = (value: string) => value.replaceAll("'", "\\'");

  const clients = [];
  for (const email of unique) {
    const customers = (await query(`select * from Customer where PrimaryEmailAddr = '${quote(email)}' maxresults 1`, "QUICKBOOKS_CUSTOMER_SEARCH_FAILED")).Customer;
    const customer = Array.isArray(customers) ? asRecord(customers[0]) : {};
    const customerId = text(customer.Id);
    if (!customerId) {
      clients.push({ email, customer: null, invoicedCents: 0, openCents: 0, invoiceCount: 0, payments: [] });
      continue;
    }
    const invoiceRows = (await query(`select * from Invoice where CustomerRef = '${quote(customerId)}' maxresults 100`, "QUICKBOOKS_INVOICE_SEARCH_FAILED")).Invoice;
    const invoices = Array.isArray(invoiceRows) ? invoiceRows.map(asRecord) : [];
    const paymentIds = [
      ...new Set(
        invoices.flatMap((invoice) =>
          (Array.isArray(invoice.LinkedTxn) ? invoice.LinkedTxn : [])
            .map(asRecord)
            .filter((linked) => text(linked.TxnType) === "Payment")
            .map((linked) => text(linked.TxnId))
            .filter(Boolean),
        ),
      ),
    ].slice(0, 50);
    let payments: Array<{ id: string; amountCents: number; paidOn: string }> = [];
    if (paymentIds.length) {
      const paymentRows = (await query(`select * from Payment where Id in (${paymentIds.map((id) => `'${quote(id)}'`).join(",")}) maxresults 50`, "QUICKBOOKS_PAYMENT_SEARCH_FAILED")).Payment;
      payments = (Array.isArray(paymentRows) ? paymentRows.map(asRecord) : [])
        .map((payment) => ({
          id: text(payment.Id),
          amountCents: cents(payment.TotalAmt),
          paidOn: text(payment.TxnDate).slice(0, 10),
        }))
        .filter((payment) => payment.id && payment.amountCents > 0 && /^\d{4}-\d{2}-\d{2}$/.test(payment.paidOn))
        .sort((left, right) => left.paidOn.localeCompare(right.paidOn));
    }
    clients.push({
      email,
      customer: { id: customerId, name: text(customer.DisplayName) || email },
      invoicedCents: invoices.reduce((sum, invoice) => sum + cents(invoice.TotalAmt), 0),
      openCents: invoices.reduce((sum, invoice) => sum + cents(invoice.Balance), 0),
      invoiceCount: invoices.length,
      payments,
    });
  }
  return { mock: false, clients };
}
