import { createHash } from "node:crypto";
import { getFirestore,type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

type Json=Record<string,unknown>;
const record=(value:unknown):Json=>typeof value==="object"&&value!==null&&!Array.isArray(value)?value as Json:{};
const string=(value:unknown)=>typeof value==="string"?value:"";
async function metadataToken(path:string,header="Metadata-Flavor"){const response=await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/${path}`,{headers:{[header]:"Google"}});if(!response.ok)throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");return record(await response.json())}
async function cloudAccessToken(){const value=await metadataToken("token");const token=string(value.access_token);if(!token)throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");return token}
async function cloudRunIdentityToken(audience:string){const response=await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`,{headers:{"Metadata-Flavor":"Google"}});if(!response.ok)throw new Error("PDF_SERVICE_IDENTITY_UNAVAILABLE");return response.text()}
const money=(value:unknown,currency:string)=>new Intl.NumberFormat("en-US",{style:"currency",currency}).format(Number(value)/100);

export async function runAiJob(job:DocumentSnapshot){if(String(job.get("type"))!=="coi_extraction")throw new Error("UNSUPPORTED_AI_JOB");const db=getFirestore();const requestId=job.id.replace(/^coi_/,"");const insurance=await db.doc(`insuranceRequests/${requestId}`).get();if(!insurance.exists)throw new Error("INSURANCE_REQUEST_NOT_FOUND");if(job.get("humanApprovalRequired")!==true)throw new Error("AI_HUMAN_REVIEW_GUARD_MISSING");if(insurance.get("scanStatus")!=="clean")throw new Error("COI_FILE_NOT_CLEARED");let extraction:Json;
  if(process.env.PROVIDER_MOCK_MODE==="true"){extraction={certificateHolder:"Development extraction",eventDate:null,coverageTypes:[],limits:{},additionalInsuredWording:null,waiverOfSubrogation:null,primaryNoncontributory:null,confidence:0,missingFields:["Live Vertex AI configuration"]}}else{const project=process.env.VERTEX_AI_PROJECT_ID;const location=process.env.VERTEX_AI_LOCATION??"us-central1";const model=process.env.VERTEX_AI_EXTRACTION_MODEL;if(!project||!model)throw new Error("VERTEX_AI_NOT_CONFIGURED");const token=await cloudAccessToken();const object=string(insurance.get("temporaryObject"));const parts:Array<Json>=[{text:"Extract factual certificate-of-insurance fields. Do not decide legal sufficiency or approval. Return JSON only and use null for unknown values."}];if(object.startsWith("gs://"))parts.push({fileData:{mimeType:"application/pdf",fileUri:object}});const response=await fetch(`https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts}],generationConfig:{temperature:0,responseMimeType:"application/json",responseSchema:{type:"OBJECT",properties:{certificateHolder:{type:"STRING",nullable:true},eventDate:{type:"STRING",nullable:true},coverageTypes:{type:"ARRAY",items:{type:"STRING"}},limits:{type:"OBJECT"},additionalInsuredWording:{type:"STRING",nullable:true},waiverOfSubrogation:{type:"STRING",nullable:true},primaryNoncontributory:{type:"STRING",nullable:true},confidence:{type:"NUMBER"},missingFields:{type:"ARRAY",items:{type:"STRING"}}},required:["coverageTypes","limits","confidence","missingFields"]}}})});if(!response.ok)throw new Error(`VERTEX_AI_FAILED:${response.status}`);const body=record(await response.json());const candidates=Array.isArray(body.candidates)?body.candidates:[];const content=record(record(candidates[0]).content);const responseParts=Array.isArray(content.parts)?content.parts:[];const output=string(record(responseParts[0]).text);if(!output)throw new Error("VERTEX_AI_EMPTY_OUTPUT");extraction=record(JSON.parse(output))}
  const requirement=await db.doc(`insuranceRequirements/${String(insurance.get("requirementId"))}`).get();if(!requirement.exists)throw new Error("INSURANCE_REQUIREMENT_NOT_FOUND");
  const normalize=(value:unknown)=>String(value??"").trim().toLowerCase().replace(/\s+/g," ");
  const discrepancies:Array<Json>=[];
  const compare=(field:string,expected:unknown,actual:unknown,severity:"info"|"warning"|"blocking"="warning")=>{if(normalize(expected)!==normalize(actual))discrepancies.push({field,expected:String(expected??""),extracted:String(actual??""),severity})};
  compare("certificateHolder",requirement.get("certificateHolder"),extraction.certificateHolder,"blocking");
  compare("eventDate",requirement.get("eventDate"),extraction.eventDate,"blocking");
  const expectedCoverage=Array.isArray(requirement.get("coverageTypes"))?requirement.get("coverageTypes") as unknown[]:[];
  const actualCoverage=Array.isArray(extraction.coverageTypes)?extraction.coverageTypes:[];
  for(const coverage of expectedCoverage)if(!actualCoverage.some(actual=>normalize(actual)===normalize(coverage)))discrepancies.push({field:"coverageTypes",expected:String(coverage),extracted:actualCoverage.map(String).join(", "),severity:"blocking"});
  const expectedLimits=record(requirement.get("requiredLimits"));const actualLimits=record(extraction.limits);
  for(const [key,expected] of Object.entries(expectedLimits)){const actual=Number(actualLimits[key]??0);if(!Number.isFinite(actual)||actual<Number(expected))discrepancies.push({field:`requiredLimits.${key}`,expected:String(expected),extracted:String(actualLimits[key]??""),severity:"blocking"})}
  if(requirement.get("additionalInsuredWording")&& !normalize(extraction.additionalInsuredWording).includes(normalize(requirement.get("additionalInsuredWording"))))discrepancies.push({field:"additionalInsuredWording",expected:String(requirement.get("additionalInsuredWording")),extracted:String(extraction.additionalInsuredWording??""),severity:"warning"});
  if(requirement.get("waiverOfSubrogation")===true&&!normalize(extraction.waiverOfSubrogation).includes("yes")&&!normalize(extraction.waiverOfSubrogation).includes("true"))discrepancies.push({field:"waiverOfSubrogation",expected:"Required",extracted:String(extraction.waiverOfSubrogation??""),severity:"warning"});
  if(requirement.get("primaryNoncontributory")===true&&!normalize(extraction.primaryNoncontributory).includes("yes")&&!normalize(extraction.primaryNoncontributory).includes("true"))discrepancies.push({field:"primaryNoncontributory",expected:"Required",extracted:String(extraction.primaryNoncontributory??""),severity:"warning"});
  const now=new Date().toISOString();await insurance.ref.update({status:"under_review",extractedData:extraction,aiExtraction:extraction,discrepancies,aiExtractedAt:now,humanDecision:"pending",updatedAt:now,updatedBy:"vertex-ai-worker"});return{requestId,status:"under_review",discrepancyCount:discrepancies.length,humanApprovalRequired:true}}

async function pdfInput(job:DocumentSnapshot){const db=getFirestore();const tenant=await db.doc(`tenants/${String(job.get("tenantId"))}`).get();const tenantName=String(tenant.get("brandName")??tenant.get("businessName")??"Studio");const generatedAt=new Date().toISOString();const type=String(job.get("type"));if(type==="proposal_pdf"){
    const proposal=await db.doc(`proposals/${String(job.get("proposalId"))}`).get();
    if(!proposal.exists)throw new Error("PROPOSAL_NOT_FOUND");
    const pricing=record(proposal.get("pricingSnapshot"));
    const lines=Array.isArray(pricing.lineItems)?pricing.lineItems:[];
    const paymentSchedule=Array.isArray(proposal.get("paymentSchedule"))?proposal.get("paymentSchedule") as unknown[]:[];
    const currency=string(pricing.currency)||"USD";
    const packageName=string(pricing.packageName)||"Photography collection";
    const normalizedLines=lines.length>0?lines:[{description:packageName,totalCents:pricing.subtotalCents}];
    return{
      endpoint:"proposals",
      entity:proposal,
      payload:{
        tenant_name:tenantName,
        project_id:String(proposal.get("projectId")),
        proposal_id:proposal.id,
        version:Number(proposal.get("version")),
        client_name:string(record(proposal.get("clientSnapshot")).displayName),
        event_summary:Object.values(record(proposal.get("eventSnapshot"))).filter(value=>typeof value==="string"&&value).join(" · "),
        package_name:packageName,
        package_description:"Photography coverage and deliverables as selected.",
        introduction:string(proposal.get("notes")),
        terms_summary:string(proposal.get("termsSummary")),
        line_items:normalizedLines.map(value=>{const line=record(value);return{description:string(line.description)||packageName,amount:money(line.totalCents,currency)}}),
        payment_schedule:paymentSchedule.map(value=>{const item=record(value);return{label:string(item.label)||"Payment",amount:money(item.amountCents,currency),due_date:item.dueDate?String(item.dueDate).slice(0,10):null}}),
        total:money(pricing.totalCents,currency),
        retainer:money(pricing.retainerCents,currency),
        balance:money(Number(pricing.totalCents)-Number(pricing.retainerCents),currency),
        expires_on:String(proposal.get("expiresAt")).slice(0,10),
        generated_at:generatedAt,
      },
    }}
  if(type==="schedule_pdf"){const schedule=await db.doc(`schedules/${String(job.get("scheduleId"))}`).get();if(!schedule.exists)throw new Error("SCHEDULE_NOT_FOUND");const items=Array.isArray(schedule.get("items"))?schedule.get("items") as Array<Json>:[];return{endpoint:"schedules",entity:schedule,payload:{tenant_name:tenantName,project_id:String(schedule.get("projectId")),schedule_id:schedule.id,version:Number(schedule.get("version")),timezone:String(schedule.get("timezone")),items:items.map(item=>({start:String(item.startAt),end:String(item.endAt),title:String(item.title),location:String(item.location??"")})),generated_at:generatedAt}}}
  if(type==="closeout_pdf"){const closeout=await db.doc(`projectCloseouts/${String(job.get("closeoutId"))}`).get();if(!closeout.exists)throw new Error("CLOSEOUT_NOT_FOUND");const project=await db.doc(`projects/${String(closeout.get("projectId"))}`).get();const requirements=Array.isArray(closeout.get("requirements"))?closeout.get("requirements") as Array<Json>:[];return{endpoint:"closeouts",entity:closeout,payload:{tenant_name:tenantName,project_id:String(closeout.get("projectId")),closeout_id:closeout.id,project_name:String(project.get("name")??closeout.get("projectId")),requirements:requirements.map(item=>({label:String(item.label),complete:Boolean(item.complete),evidence_id:item.evidenceId??null})),generated_at:generatedAt}}}
  throw new Error("UNSUPPORTED_PDF_JOB")}

export async function runPdfJob(job:DocumentSnapshot){
  const service=process.env.PDF_SERVICE_URL;
  if(!service)throw new Error("PDF_SERVICE_NOT_CONFIGURED");
  const input=await pdfInput(job);
  const audience=service.replace(/\/$/,"");
  const token=process.env.FUNCTIONS_EMULATOR==="true"?"":await cloudRunIdentityToken(audience);
  const response=await fetch(`${audience}/v1/${input.endpoint}/pdf`,{
    method:"POST",
    headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`}:{})},
    body:JSON.stringify(input.payload),
  });
  if(!response.ok)throw new Error(`PDF_GENERATION_FAILED:${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(bytes.length<100||bytes.subarray(0,4).toString()!=="%PDF")throw new Error("INVALID_GENERATED_PDF");
  const tenantId=String(job.get("tenantId"));
  const projectId=String(job.get("projectId"));
  const isProposal=String(job.get("type"))==="proposal_pdf";
  const visibility=isProposal?"studio":"shared";
  const path=`tenants/${tenantId}/projects/${projectId}/generated/${job.id}.pdf`;
  await getStorage().bucket().file(path).save(bytes,{
    contentType:"application/pdf",
    resumable:false,
    metadata:{metadata:{scanStatus:"clean",visibility,trustedGenerator:"studiohub-pdf"}},
  });
  const hash=createHash("sha256").update(bytes).digest("hex");
  const now=new Date().toISOString();
  const documentId=`generated_${job.id}`;
  const generatedName=isProposal
    ?`${String(input.entity.get("eventSnapshot")?.name??"project").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase()||"project"}-proposal-v${Number(input.entity.get("version")??1)}.pdf`
    :`${job.id}.pdf`;
  const db=getFirestore();
  const batch=db.batch();
  batch.set(db.doc(`documents/${documentId}`),{
    id:documentId,
    tenantId,
    projectId,
    provider:"cloud_storage",
    providerFileId:path,
    providerRevision:null,
    canonicalPath:path,
    name:generatedName,
    contentType:"application/pdf",
    sizeBytes:bytes.length,
    sha256:hash,
    visibility,
    status:"available",
    createdAt:now,
    updatedAt:now,
    createdBy:"pdf-worker",
    updatedBy:"pdf-worker",
    archivedAt:null,
  });
  const field=isProposal
    ?"pdfDocumentId"
    :String(job.get("type"))==="schedule_pdf"
      ?"pdfDocumentId"
      :"summaryDocumentId";
  batch.update(input.entity.ref,{
    [field]:documentId,
    ...(isProposal?{pdfState:"ready"}:{}),
    updatedAt:now,
    updatedBy:"pdf-worker",
  });
  await batch.commit();
  return{documentId,path,sizeBytes:bytes.length,sha256:hash,visibility};
}
