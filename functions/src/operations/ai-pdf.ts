import { isSalesConsultation } from "../booking/consultation-purpose.js";
import { normalizeUnitLabel, quantityText } from "../packages/unit-label.js";
import { mcScriptLine, type McScript } from "../planning/mc-script.js";
import { contractPdfInput, storeSealedContract } from "../contracts/seal.js";
import { US_ENGLISH_PART } from "../ai/language.js";
import { enrichCapturedLead } from "../intake/enrich.js";
import { convertInquiryToJob } from "../intake/convert.js";
import { withInquiryLink } from "../intake/inquiry-link.js";
import { createHash } from "node:crypto";
import { consumeAiQuota } from "../saas/usage.js";
import { gatherAnswerFacts } from "../communications/answer-facts.js";
import { getFirestore,type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { runStudioImportAnalysis } from "../studio-import/extraction.js";
import { productEvent } from "./product-events.js";
import { coverageMatches, holderMatches, limitDollars, sameCalendarDate } from "./certificate-review.js";
import {
  describeCoverage,
  resolveCoverage,
} from "../packages/coverage.js";
import { vertexEndpoint } from "../ai/vertex-endpoint.js";
import { resolveTenantBrand } from "../branding/tenant-brand.js";
import { separateGreeting, signWithStudio } from "../ai/reply-format.js";
import { inquiryReplySystemInstruction } from "../ai/studio-voice.js";
import { dayFieldsFor, normaliseInquiryFormConfig, resolveInquiryEventType } from "../intake/inquiry-form-config.js";
import { retainerFromSchedule } from "../booking/agreed-retainer.js";
import { runOfShowDocument } from "../planning/run-of-show-doc.js";
import { crewLabels } from "../planning/crew-labels.js";
import { eventZone } from "../planning/day-clock.js";
import { itemCrewIds } from "../planning/item-crew.js";
import { proposalTermsFor } from "../proposals/default-terms.js";
import { briefActionIds, briefRunOf } from "../booking/brief-rerun.js";
import { detailsForLine, packageDetails } from "../packages/inclusions.js";
import { isCataloguePackage } from "../packages/one-off.js";
import { proposalPdfAdjustments, proposalPdfPaymentAmount, proposalPdfSalesTax } from "../proposals/pdf-adjustments.js";
import { TRADE_LABELS, tradeProfile, tradeVocab } from "../trades/trades.js";

/**
 * Fit a field to the PDF service's limit (cloud-run/pdf/main.py). The service
 * refuses an over-long field outright, so one long package description or
 * terms summary failed the whole proposal PDF (H2, M7).
 */
export function clipForPdf(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

type Json=Record<string,unknown>;
const record=(value:unknown):Json=>typeof value==="object"&&value!==null&&!Array.isArray(value)?value as Json:{};
const string=(value:unknown)=>typeof value==="string"?value:"";
async function metadataToken(path:string,header="Metadata-Flavor"){const response=await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/${path}`,{headers:{[header]:"Google"}});if(!response.ok)throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");return record(await response.json())}
async function cloudAccessToken(){const value=await metadataToken("token");const token=string(value.access_token);if(!token)throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");return token}
async function cloudRunIdentityToken(audience:string){const response=await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`,{headers:{"Metadata-Flavor":"Google"}});if(!response.ok)throw new Error("PDF_SERVICE_IDENTITY_UNAVAILABLE");return response.text()}
const money=(value:unknown,currency:string)=>new Intl.NumberFormat("en-US",{style:"currency",currency}).format(Number(value)/100);

/** Which "missing" items the studio's form actually asked this inquiry. */
async function inquiryAskedFor(db:FirebaseFirestore.Firestore,lead:DocumentSnapshot):Promise<{matches:(item:string)=>boolean}>{
  const settings=await db.doc(`leadCaptureSettings/${string(lead.get("tenantId"))}`).get().catch(()=>null);
  const config=normaliseInquiryFormConfig(settings?.get("inquiryForm"));
  const {type}=resolveInquiryEventType(config,{eventTypeKey:lead.get("eventTypeKey"),eventType:lead.get("eventTypeLabel")});
  const day=dayFieldsFor(type);
  return{
    matches:(item:string)=>{
      if(!day.venue&&/venue/i.test(item))return false;
      if(!day.guests&&/guest/i.test(item))return false;
      if(!config.askBudget&&/budget/i.test(item))return false;
      if(day.eventDate==="hidden"&&/\bdate\b/i.test(item))return false;
      return true;
    },
  };
}

async function runLeadIntakeAnalysis(job:DocumentSnapshot){
  const db=getFirestore();
  const leadId=string(job.get("leadId"))||job.id.replace(/^lead_intake_/,"");
  const initial=await db.doc(`leads/${leadId}`).get();
  if(!initial.exists)throw new Error("LEAD_NOT_FOUND");
  // A captured inquiry first has its empty fields filled from its message
  // (functions/src/intake/enrich.ts), so the summary and the reply draft work
  // from the fuller lead. A no-op for leads from the public form.
  await enrichCapturedLead(db,initial,{mock:process.env.PROVIDER_MOCK_MODE==="true",accessToken:cloudAccessToken});
  // Reading the message may have found the date the form didn't carry; an
  // inquiry with a date is a job (intake/convert.ts). A no-op otherwise.
  const enriched=await db.doc(`leads/${leadId}`).get();
  if(!string(enriched.get("projectId"))&&string(enriched.get("eventDate"))){
    await convertInquiryToJob(db,{tenantId:string(enriched.get("tenantId")),leadId,now:new Date().toISOString()});
  }
  const lead=await db.doc(`leads/${leadId}`).get();
  const missing=Array.isArray(lead.get("missingInformation"))?lead.get("missingInformation") as unknown[]:[];
  // Read before drafting: the studio's voice and its "how your first reply
  // should go" shape the reply (ai/studio-voice.ts), and its name signs it.
  const tenant=await db.doc(`tenants/${string(lead.get("tenantId"))}`).get();
  // What the studio's form asked this kind of inquiry: a gap it never asked
  // about is not something to chase (inquiry-form-config.ts).
  const askedFor=await inquiryAskedFor(db,lead);
  let analysis:Json;
  if(process.env.PROVIDER_MOCK_MODE==="true"){
    analysis={
      summary:string(lead.get("aiSummary"))||"Inquiry received and ready for studio review.",
      missingInformation:missing.map(String),
      suggestedConsultationQuestions:Array.isArray(lead.get("suggestedConsultationQuestions"))?lead.get("suggestedConsultationQuestions"):[],
      replySubject:`Thank you for your ${string(lead.get("eventTypeLabel"))||"photography"} inquiry`,
      replyBody:`Hi ${string(lead.get("firstName"))||"there"},\n\nThank you for reaching out. I would love to learn more about what matters most to you and your plans for ${string(lead.get("eventDate"))||"your event date"}.\n\nThe next step is a short consultation so we can confirm the details and make sure the experience is a great fit.\n\nWarmly,`,
    };
  }else{
    const project=process.env.VERTEX_AI_PROJECT_ID;
    const model=process.env.VERTEX_AI_EXTRACTION_MODEL;
    if(!project||!model)throw new Error("VERTEX_AI_NOT_CONFIGURED");
    const token=await cloudAccessToken();
    // Only what the inquiry holds: empty wedding fields went in as nulls and
    // came back as "Check BudgetRange, Venue" on a family session, and a
    // null partner became "you, your partner, and your two kids" (walk,
    // 2026-10-03). `kindOfWork` says what the job is.
    const facts=Object.fromEntries(Object.entries({
      kindOfWork:lead.get("eventKind")??null,
      clientFirstName:lead.get("firstName"),
      clientPartnerName:lead.get("partnerName"),
      eventType:lead.get("eventTypeLabel"),
      eventDate:lead.get("eventDate"),
      venue:lead.get("venue"),
      city:lead.get("city"),
      estimatedGuestCount:lead.get("estimatedGuestCount"),
      servicesRequested:lead.get("servicesRequested"),
      budgetRange:lead.get("budgetRange"),
      referralSource:lead.get("referralSource"),
      // The studio's own questions on its inquiry form, with what was answered.
      customAnswers:Array.isArray(lead.get("customAnswers"))?lead.get("customAnswers"):[],
      message:lead.get("message"),
      availabilityStatus:lead.get("availabilityStatus"),
      knownMissingInformation:missing,
    }).filter(([,value])=>value!==null&&value!==undefined&&value!==""&&!(Array.isArray(value)&&value.length===0)));
    const response=await fetch(vertexEndpoint(project, model),{
      method:"POST",
      headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify({
        // The rules as they have always been, then the studio's own
        // preferences, quoted — style guidance that cannot override them.
        systemInstruction:{parts:[{text:inquiryReplySystemInstruction({voice:tenant.get("copilotVoice"),firstReply:tenant.get("firstReplyInstructions"),trade:tenant.get("trade")})},US_ENGLISH_PART]},
        contents:[{role:"user",parts:[{text:JSON.stringify(facts)}]}],
        generationConfig:{
          temperature:0,
          responseMimeType:"application/json",
          responseSchema:{
            type:"OBJECT",
            properties:{
              summary:{type:"STRING"},
              missingInformation:{type:"ARRAY",items:{type:"STRING"}},
              suggestedConsultationQuestions:{type:"ARRAY",items:{type:"STRING"}},
              replySubject:{type:"STRING"},
              replyBody:{type:"STRING"},
            },
            required:["summary","missingInformation","suggestedConsultationQuestions","replySubject","replyBody"],
          },
        },
      }),
    });
    if(!response.ok)throw new Error(`VERTEX_AI_FAILED:${response.status}`);
    const body=record(await response.json());
    const candidates=Array.isArray(body.candidates)?body.candidates:[];
    const content=record(record(candidates[0]).content);
    const parts=Array.isArray(content.parts)?content.parts:[];
    const output=string(record(parts[0]).text);
    if(!output)throw new Error("VERTEX_AI_EMPTY_OUTPUT");
    analysis=record(JSON.parse(output));
  }
  const summary=string(analysis.summary);
  const missingInformation=(Array.isArray(analysis.missingInformation)?analysis.missingInformation.map(String).filter(Boolean).slice(0,12):missing.map(String))
    .filter((item)=>askedFor.matches(item))
    .map((item)=>item.replace(/([a-z])([A-Z])/g,(_,a:string,b:string)=>`${a} ${b.toLowerCase()}`));
  const suggestedConsultationQuestions=Array.isArray(analysis.suggestedConsultationQuestions)?analysis.suggestedConsultationQuestions.map(String).filter(Boolean).slice(0,8):[];
  const now=new Date().toISOString();
  const replySubject=string(analysis.replySubject)||`Thank you for your ${string(lead.get("eventTypeLabel"))||"photography"} inquiry`;
  // The prompt's own "Dear Maya," example is copied and run on into the first
  // sentence; the greeting gets its own line before anyone reviews it.
  // The couple's own link — their details, then a time to talk — closes the
  // reply, added here rather than asked of the model, which must never
  // invent a link (intake/inquiry-link.ts). No hours set: no link, and the
  // draft says why so Today can.
  // "Warmly," then nothing: the prompt leaves the name to us (reply-format.ts).
  const signed=signWithStudio(separateGreeting(string(analysis.replyBody)),resolveTenantBrand(tenant.data(),"").brandName);
  const linked=await withInquiryLink(db,{tenantId:string(lead.get("tenantId")),leadId,body:signed,now:new Date().toISOString()});
  const replyBody=linked.body;
  const confidence=missingInformation.length===0?0.93:0.82;
  const actionId=`ai_reply_${leadId}`;
  // A "maybe" gets its summary but no drafted reply: sent, a reply to a
  // newsletter or a vendor is worse than none. Confirming it re-runs this job
  // (crm updateLead), and the reply is drafted then.
  const heldAsMaybe=lead.get("needsConfirmation")===true;
  const batch=db.batch();
  batch.update(lead.ref,{
    aiSummary:summary||lead.get("aiSummary")||null,
    missingInformation,
    suggestedConsultationQuestions,
    aiAnalyzedAt:now,
    updatedAt:now,
    updatedBy:"vertex-ai-worker",
  });
  if(!heldAsMaybe)batch.set(db.doc(`aiActions/${actionId}`),{
    id:actionId,
    tenantId:job.get("tenantId"),
    // On the job when the inquiry already is one, so the draft sits with it.
    projectId:string(lead.get("projectId"))||null,
    actorId:"vertex-ai-worker",
    title:`Reply to ${string(lead.get("displayName"))||"new inquiry"}`,
    capability:"inquiry_reply_draft",
    authorityBoundary:"draft_requires_review",
    status:"review_required",
    modelProvider:"google_vertex_ai",
    modelVersion:process.env.PROVIDER_MOCK_MODE==="true"?"deterministic-mock":process.env.VERTEX_AI_EXTRACTION_MODEL,
    instructionVersion:"inquiry-reply-v1",
    outputSchemaVersion:"inquiry-reply-v1",
    sourceReferences:[{entityType:"lead",entityId:leadId,versionId:null,label:"Original inquiry",locator:"lead.message"}],
    // leadId and contactId travel with the reply so, once approved, it is sent
    // on the lead's own thread and the couple's answer comes back to it.
    structuredOutput:{subject:replySubject,body:replyBody,recipientEmail:lead.get("email"),recipientName:lead.get("displayName")??null,leadId,contactId:lead.get("primaryContactId")??null,suggestedConsultationQuestions,bookingLinkIncluded:linked.linked},
    confidence:{overall:confidence,label:confidence>=0.9?"high":"medium",uncertainFields:missingInformation},
    validation:{status:replyBody?"passed":"failed",issues:replyBody?[]:[{code:"EMPTY_REPLY",severity:"blocking",message:"The reply draft is empty.",field:"body"}]},
    decision:null,
    downstreamCommand:{commandType:"create_communication_draft",commandId:`reply_${leadId}`,executedAt:null},
    usage:{inputTokens:0,outputTokens:0,estimatedCostMicros:0,latencyMs:0,estimatedMinutesSaved:8},
    failure:null,
    snoozedUntil:null,
    createdAt:now,
    updatedAt:now,
    createdBy:"vertex-ai-worker",
    updatedBy:"vertex-ai-worker",
    archivedAt:null,
  },{merge:true});
  await batch.commit();
  return{leadId,missingInformationCount:missingInformation.length,questionCount:suggestedConsultationQuestions.length,replyActionId:actionId};
}

async function runConsultationAnalysis(job:DocumentSnapshot){
  const db=getFirestore();
  const consultationId=string(job.get("consultationId"));
  const consultation=await db.doc(`consultations/${consultationId}`).get();
  if(!consultation.exists)throw new Error("CONSULTATION_NOT_FOUND");
  if(consultation.get("tenantId")!==job.get("tenantId"))throw new Error("FORBIDDEN");
  if(consultation.get("status")!=="completed")throw new Error("CONSULTATION_NOT_COMPLETED");
  // Never a brief from the final details call (booking/consultation-purpose.ts).
  // Nor from a makeup or hair trial.
  if(!isSalesConsultation(consultation.data()))return{consultationId,skipped:"final_details_call"};
  if(job.get("humanReviewRequired")!==true)throw new Error("AI_HUMAN_REVIEW_GUARD_MISSING");
  // A newer run was asked for since this job was queued (booking/brief-rerun.ts):
  // its actions are the current ones, and writing this run's would bring back
  // a brief made from notes the studio has since changed.
  const run=briefRunOf(job.get("briefRun"));
  if(briefRunOf(consultation.get("briefRun"))!==run)return{consultationId,skipped:"superseded_by_newer_brief",briefRun:run};
  const actionIds=briefActionIds(consultationId,run);
  const projectId=string(consultation.get("projectId"));
  const [project,packages]=await Promise.all([
    db.doc(`projects/${projectId}`).get(),
    db.collection("packages").where("tenantId","==",job.get("tenantId")).where("active","==",true).limit(50).get(),
  ]);
  if(!project.exists||project.get("tenantId")!==job.get("tenantId"))throw new Error("PROJECT_NOT_FOUND");
  // The studio's catalogue, plus a one-off written for this job; never
  // another couple's one-off (features/packages/one-off.ts).
  const packageFacts=packages.docs.filter(document=>isCataloguePackage(document.data(),{projectId})).map(document=>({
    id:document.id,
    name:document.get("name"),
    description:document.get("description"),
    basePriceCents:document.get("basePriceCents"),
    currency:document.get("currency"),
    includedCoverageMinutes:document.get("includedCoverageMinutes"),
    includedPhotographers:document.get("includedPhotographers"),
    coverage:describeCoverage(resolveCoverage(document.data())),
    includedDeliverables:document.get("includedDeliverables"),
    includedTravelArea:document.get("includedTravelArea"),
    terms:document.get("terms"),
  }));
  const facts={
    project:{id:project.id,name:project.get("name"),eventType:project.get("eventType"),eventDate:project.get("eventDate"),venueName:project.get("venueName"),city:project.get("city")},
    consultationNotes:consultation.get("internalNotes"),
    packages:packageFacts,
  };
  let analysis:Json;
  if(process.env.PROVIDER_MOCK_MODE==="true"){
    const recommended=packageFacts[0];
    analysis={
      summary:string(consultation.get("internalNotes"))||"Consultation completed.",
      priorities:[],
      missingInformation:[],
      packageId:recommended?.id??null,
      packageRationale:recommended?`${String(recommended.name)} is the first active package available for human review.`:"No active package is available.",
      fitGaps:recommended?[]:["Create or activate a package."],
      proposalIntroduction:"Thank you for sharing what matters most for your celebration. This draft reflects the priorities discussed during your consultation.",
      followUpQuestions:[],
      confidence:recommended?0.82:0.45,
    };
  }else{
    const vertexProject=process.env.VERTEX_AI_PROJECT_ID;
    const model=process.env.VERTEX_AI_EXTRACTION_MODEL;
    if(!vertexProject||!model)throw new Error("VERTEX_AI_NOT_CONFIGURED");
    const token=await cloudAccessToken();
    const response=await fetch(vertexEndpoint(vertexProject, model),{
      method:"POST",
      headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify({
        systemInstruction:{parts:[{text:"Analyze photography consultation notes using only supplied project facts and the exact active package catalog. Summarize stated priorities, missing information, and follow-up questions. Recommend only a supplied package id or null. Do not invent pricing, discounts, availability, deliverables, legal terms, or client agreement. Draft a short proposal introduction in the studio's professional voice. All outputs require human review."},US_ENGLISH_PART]},
        contents:[{role:"user",parts:[{text:JSON.stringify(facts)}]}],
        generationConfig:{temperature:0,responseMimeType:"application/json",responseSchema:{type:"OBJECT",properties:{
          summary:{type:"STRING"},
          priorities:{type:"ARRAY",items:{type:"STRING"}},
          missingInformation:{type:"ARRAY",items:{type:"STRING"}},
          packageId:{type:"STRING",nullable:true},
          packageRationale:{type:"STRING"},
          fitGaps:{type:"ARRAY",items:{type:"STRING"}},
          proposalIntroduction:{type:"STRING"},
          followUpQuestions:{type:"ARRAY",items:{type:"STRING"}},
          confidence:{type:"NUMBER"},
        },required:["summary","priorities","missingInformation","packageId","packageRationale","fitGaps","proposalIntroduction","followUpQuestions","confidence"]}},
      }),
    });
    if(!response.ok)throw new Error(`VERTEX_AI_FAILED:${response.status}`);
    const payload=record(await response.json());
    const candidates=Array.isArray(payload.candidates)?payload.candidates:[];
    const parts=Array.isArray(record(record(candidates[0]).content).parts)?record(record(candidates[0]).content).parts as unknown[]:[];
    const output=string(record(parts[0]).text);
    if(!output)throw new Error("VERTEX_AI_EMPTY_OUTPUT");
    analysis=record(JSON.parse(output));
  }
  const requestedPackageId=string(analysis.packageId);
  const recommended=packages.docs.find(document=>document.id===requestedPackageId)??null;
  const list=(value:unknown,limit=20)=>Array.isArray(value)?value.map(String).map(item=>item.trim()).filter(Boolean).slice(0,limit):[];
  const confidence=Math.max(0,Math.min(1,Number(analysis.confidence??0)));
  const missingInformation=list(analysis.missingInformation,20);
  const validationIssues:Array<Json>=[
    ...(!recommended?[{code:"PACKAGE_RECOMMENDATION_REQUIRED",severity:"blocking",message:"AI did not select an active package.",field:"packageId"}]:[]),
    ...(confidence<0.8?[{code:"LOW_CONFIDENCE",severity:"blocking",message:"Confirm the consultation summary and package fit.",field:null}]:[]),
  ];
  const now=new Date().toISOString();
  const modelVersion=process.env.PROVIDER_MOCK_MODE==="true"?"deterministic-mock":string(process.env.VERTEX_AI_EXTRACTION_MODEL);
  const base={
    tenantId:job.get("tenantId"),
    projectId,
    // Which preparation this is, so the booking page shows the current one.
    consultationId,
    briefRun:run,
    actorId:"vertex-ai-worker",
    modelProvider:"google_vertex_ai",
    modelVersion,
    instructionVersion:"consultation-booking-v1",
    outputSchemaVersion:"consultation-booking-v1",
    confidence:{overall:confidence,label:confidence>=0.9?"high":confidence>=0.7?"medium":"low",uncertainFields:missingInformation},
    decision:null,
    usage:{inputTokens:0,outputTokens:0,estimatedCostMicros:0,latencyMs:0,estimatedMinutesSaved:25},
    failure:null,
    snoozedUntil:null,
    createdAt:now,
    updatedAt:now,
    createdBy:"vertex-ai-worker",
    updatedBy:"vertex-ai-worker",
    archivedAt:null,
  };
  const sourceReferences=[
    {entityType:"consultation",entityId:consultationId,versionId:null,label:"Consultation notes",locator:"internalNotes"},
    {entityType:"project",entityId:projectId,versionId:null,label:String(project.get("name")??"Project"),locator:"project facts"},
  ];
  const batch=db.batch();
  batch.update(consultation.ref,{
    aiReview:{
      status:"ready",
      summary:string(analysis.summary),
      priorities:list(analysis.priorities,20),
      missingInformation,
      packageId:recommended?.id??null,
      packageRationale:string(analysis.packageRationale),
      fitGaps:list(analysis.fitGaps,20),
      proposalIntroduction:string(analysis.proposalIntroduction),
      followUpQuestions:list(analysis.followUpQuestions,20),
      confidence,
      humanReviewRequired:true,
      briefRun:run,
      generatedAt:now,
    },
    aiReviewedAt:now,
    updatedAt:now,
    updatedBy:"vertex-ai-worker",
  });
  const summaryActionId=actionIds.summary;
  batch.set(db.doc(`aiActions/${summaryActionId}`),{
    ...base,
    id:summaryActionId,
    title:"Confirm consultation brief",
    capability:"consultation_summary",
    authorityBoundary:"human_approval_required",
    status:"review_required",
    sourceReferences,
    structuredOutput:{summary:string(analysis.summary),priorities:list(analysis.priorities,20),missingInformation,followUpQuestions:list(analysis.followUpQuestions,20)},
    validation:{status:confidence>=0.8?"passed":"failed",issues:validationIssues.filter(issue=>issue.code==="LOW_CONFIDENCE")},
    downstreamCommand:null,
  },{merge:true});
  const packageActionId=actionIds.package;
  batch.set(db.doc(`aiActions/${packageActionId}`),{
    ...base,
    id:packageActionId,
    title:"Review package recommendation",
    capability:"package_recommendation",
    authorityBoundary:"human_approval_required",
    status:"review_required",
    sourceReferences:[...sourceReferences,...(recommended?[{entityType:"package",entityId:recommended.id,versionId:String(recommended.get("version")??1),label:String(recommended.get("name")??"Package"),locator:"active package catalog"}]:[])],
    structuredOutput:{packageId:recommended?.id??null,packageName:recommended?.get("name")??null,rationale:string(analysis.packageRationale),fitGaps:list(analysis.fitGaps,20),basePriceCents:recommended?.get("basePriceCents")??null,currency:recommended?.get("currency")??null},
    validation:{status:validationIssues.length?"failed":"passed",issues:validationIssues},
    downstreamCommand:{commandType:"select_package_snapshot",commandId:`select_${projectId}`,executedAt:null},
  },{merge:true});
  const proposalActionId=actionIds.proposal;
  // A package with no terms written drafts with the default wording, not a
  // failed draft (GR, 2026-09-30); the studio edits it before sending.
  const termsSummary=recommended?proposalTermsFor(recommended.get("terms"),(await getFirestore().doc(`tenants/${String(job.get("tenantId"))}`).get()).get("trade")):"";
  batch.set(db.doc(`aiActions/${proposalActionId}`),{
    ...base,
    id:proposalActionId,
    title:"Prepare proposal draft",
    capability:"proposal_draft",
    authorityBoundary:"human_approval_required",
    status:"review_required",
    sourceReferences:[...sourceReferences,...(recommended?[{entityType:"package",entityId:recommended.id,versionId:String(recommended.get("version")??1),label:String(recommended.get("name")??"Package"),locator:"approved terms and pricing"}]:[])],
    structuredOutput:{packageId:recommended?.id??null,notes:string(analysis.proposalIntroduction),termsSummary,expiresInDays:14,retainerDueInDays:7,balanceDueDaysBeforeEvent:30},
    validation:{status:recommended&&termsSummary?"passed":"failed",issues:[...(!recommended?[{code:"PACKAGE_REQUIRED",severity:"blocking",message:"Approve a package before drafting the proposal.",field:"packageId"}]:[]),...(!termsSummary?[{code:"APPROVED_TERMS_REQUIRED",severity:"blocking",message:"The recommended package has no approved terms.",field:"termsSummary"}]:[])]},
    downstreamCommand:{commandType:"create_proposal_draft",commandId:`proposal_${projectId}`,executedAt:null},
  },{merge:true});
  await batch.commit();
  return{consultationId,projectId,summaryActionId,packageActionId,proposalActionId,recommendedPackageId:recommended?.id??null,humanReviewRequired:true};
}

async function runQuestionnaireAnalysis(job:DocumentSnapshot){
  const db=getFirestore();
  const responseId=string(job.get("responseId"))||job.id.replace(/^questionnaire_/,"");
  const response=await db.doc(`questionnaireResponses/${responseId}`).get();
  if(!response.exists)throw new Error("QUESTIONNAIRE_RESPONSE_NOT_FOUND");
  if(response.get("status")!=="submitted")throw new Error("QUESTIONNAIRE_NOT_SUBMITTED");
  if(job.get("humanReviewRequired")!==true)throw new Error("AI_HUMAN_REVIEW_GUARD_MISSING");
  const [template,project]=await Promise.all([
    db.doc(`questionnaireTemplates/${String(response.get("templateId"))}`).get(),
    db.doc(`projects/${String(response.get("projectId"))}`).get(),
  ]);
  if(!template.exists)throw new Error("QUESTIONNAIRE_TEMPLATE_NOT_FOUND");
  const sections=Array.isArray(template.get("sections"))?template.get("sections") as unknown[]:[];
  const fields=sections.flatMap(section=>{
    const value=record(section);
    return Array.isArray(value.fields)?value.fields.map(record):[];
  }).filter(field=>field.internalOnly!==true&&field.type!=="information");
  const answers=record(response.get("answers"));
  const deterministicMissing=fields
    .filter(field=>field.required===true)
    .filter(field=>{
      const answer=answers[string(field.id)];
      return answer===null||answer===undefined||answer===""||(Array.isArray(answer)&&answer.length===0);
    })
    .map(field=>string(field.label)||string(field.id));
  const categorizedFacts=fields.flatMap(field=>{
    const fieldId=string(field.id);
    const label=string(field.label);
    const answer=answers[fieldId];
    if(answer===null||answer===undefined||answer===""||(Array.isArray(answer)&&answer.length===0))return[];
    const normalized=`${fieldId} ${label}`.toLowerCase();
    const category=/family|formal|portrait|group|shot list/.test(normalized)?"family_formals":
      /vendor|planner|coordinator|dj|florist|venue contact|cater/.test(normalized)?"vendors":
      /time|timeline|schedule|coverage|ceremony|reception|first look/.test(normalized)?"schedule":
      /location|address|travel|parking|access|transport/.test(normalized)?"logistics":"preferences";
    return[{fieldId,label,category,value:answer,source:{entityType:"questionnaire_response",entityId:responseId,locator:`answers.${fieldId}`}}];
  });
  const facts={
    project:{name:project.get("name"),eventType:project.get("eventType"),eventDate:project.get("eventDate"),venueName:project.get("venueName"),city:project.get("city")},
    questionnaire:fields.map(field=>({id:string(field.id),label:string(field.label),required:Boolean(field.required),answer:answers[string(field.id)]??null})),
    categorizedPlanningFacts:categorizedFacts,
    deterministicallyMissingRequired:deterministicMissing,
  };
  let analysis:Json;
  if(process.env.PROVIDER_MOCK_MODE==="true"){
    analysis={summary:"Questionnaire submitted and ready for studio review.",missingInformation:deterministicMissing,contradictions:[],planningRisks:[],suggestedQuestions:deterministicMissing.map(value=>`Can you confirm ${value}?`),followupSubject:`A few planning details for ${string(project.get("name"))||"your event"}`,followupBody:deterministicMissing.length?`Thanks for completing the planning questionnaire. Could you help us confirm the remaining details below?\n\n${deterministicMissing.map(value=>`• ${value}`).join("\n")}`:"Thanks for completing the planning questionnaire. We have the details we need to begin preparing your photography timeline."};
  }else{
    const projectId=process.env.VERTEX_AI_PROJECT_ID;
    const model=process.env.VERTEX_AI_EXTRACTION_MODEL;
    if(!projectId||!model)throw new Error("VERTEX_AI_NOT_CONFIGURED");
    const token=await cloudAccessToken();
    const vertex=await fetch(vertexEndpoint(projectId, model),{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({
      systemInstruction:{parts:[{text:"Review a photography planning questionnaire using only supplied facts. Identify missing information, possible contradictions, operational planning risks, and suggested follow-up questions. Also draft a concise, warm follow-up email that asks only the necessary supplied follow-up questions; its body must not include a greeting or sign-off. Do not invent dates, contacts, prices, legal conclusions, approvals, or completion states. Every result is advisory and requires studio review."},US_ENGLISH_PART]},
      contents:[{role:"user",parts:[{text:JSON.stringify(facts)}]}],
      generationConfig:{temperature:0,responseMimeType:"application/json",responseSchema:{type:"OBJECT",properties:{summary:{type:"STRING"},missingInformation:{type:"ARRAY",items:{type:"STRING"}},contradictions:{type:"ARRAY",items:{type:"STRING"}},planningRisks:{type:"ARRAY",items:{type:"STRING"}},suggestedQuestions:{type:"ARRAY",items:{type:"STRING"}},followupSubject:{type:"STRING"},followupBody:{type:"STRING"}},required:["summary","missingInformation","contradictions","planningRisks","suggestedQuestions","followupSubject","followupBody"]}},
    })});
    if(!vertex.ok)throw new Error(`VERTEX_AI_FAILED:${vertex.status}`);
    const payload=record(await vertex.json());
    const candidates=Array.isArray(payload.candidates)?payload.candidates:[];
    const parts=Array.isArray(record(record(candidates[0]).content).parts)?record(record(candidates[0]).content).parts as unknown[]:[];
    const output=string(record(parts[0]).text);
    if(!output)throw new Error("VERTEX_AI_EMPTY_OUTPUT");
    analysis=record(JSON.parse(output));
  }
  const list=(value:unknown,limit:number)=>Array.isArray(value)?value.map(String).map(item=>item.trim()).filter(Boolean).slice(0,limit):[];
  const missingInformation=Array.from(new Set([...deterministicMissing,...list(analysis.missingInformation,20)])).slice(0,20);
  const now=new Date().toISOString();
  const aiReview={
    status:"ready",
    summary:string(analysis.summary)||"Questionnaire submitted for review.",
    missingInformation,
    contradictions:list(analysis.contradictions,12),
    planningRisks:list(analysis.planningRisks,12),
    suggestedQuestions:list(analysis.suggestedQuestions,12),
    humanReviewRequired:true,
    generatedAt:now,
    modelMode:process.env.PROVIDER_MOCK_MODE==="true"?"mock":"vertex",
  };
  const actionId=`ai_questionnaire_${responseId}`;
  const projectId=String(response.get("projectId"));
  const clientContactIds=Array.isArray(project.get("clientContactIds"))?project.get("clientContactIds") as unknown[]:[];
  const clientContactId=string(clientContactIds[0]);
  const clientContact=clientContactId?await db.doc(`contacts/${clientContactId}`).get():null;
  const followupSubject=string(analysis.followupSubject)||`A few planning details for ${string(project.get("name"))||"your event"}`;
  const followupBody=string(analysis.followupBody)||missingInformation.map(value=>`Could you confirm ${value}?`).join("\n");
  const planningPackage={
    status:"ready_for_review",
    sourceResponseId:responseId,
    facts:categorizedFacts,
    groupedFacts:{
      schedule:categorizedFacts.filter(item=>item.category==="schedule"),
      familyFormals:categorizedFacts.filter(item=>item.category==="family_formals"),
      vendors:categorizedFacts.filter(item=>item.category==="vendors"),
      logistics:categorizedFacts.filter(item=>item.category==="logistics"),
      preferences:categorizedFacts.filter(item=>item.category==="preferences"),
    },
    conflicts:[...aiReview.contradictions,...aiReview.planningRisks],
    missingInformation,
    suggestedQuestions:aiReview.suggestedQuestions,
    generatedAt:now,
    humanReviewRequired:true,
  };
  const warnings=[
    ...missingInformation.map((message)=>({code:"MISSING_INFORMATION",severity:"warning",message,field:null})),
    ...aiReview.contradictions.map((message)=>({code:"POSSIBLE_CONTRADICTION",severity:"warning",message,field:null})),
  ];
  const batch=db.batch();
  batch.update(response.ref,{aiReview,planningPackage,aiReviewedAt:now,updatedAt:now,updatedBy:"vertex-ai-worker"});
  batch.set(db.doc(`aiActions/${actionId}`),{
    id:actionId,
    tenantId:job.get("tenantId"),
    projectId,
    actorId:"vertex-ai-worker",
    title:`Review planning flags: ${String(response.get("templateName")??"Questionnaire")}`,
    capability:"questionnaire_review",
    authorityBoundary:"human_approval_required",
    status:"review_required",
    modelProvider:process.env.PROVIDER_MOCK_MODE==="true"?"mock":"vertex_ai",
    modelVersion:process.env.VERTEX_AI_EXTRACTION_MODEL??"mock-questionnaire-v1",
    instructionVersion:"questionnaire-review-v2",
    outputSchemaVersion:"questionnaire-review-v2",
    sourceReferences:[
      {entityType:"questionnaire_response",entityId:responseId,versionId:String(response.get("templateVersion")??1),label:String(response.get("templateName")??"Questionnaire"),locator:"submitted answers"},
      {entityType:"project",entityId:projectId,versionId:null,label:String(project.get("name")??"Project"),locator:"verified project facts"},
    ],
    structuredOutput:aiReview,
    confidence:{overall:missingInformation.length?0.82:0.93,label:missingInformation.length?"medium":"high",uncertainFields:[...missingInformation,...aiReview.contradictions].slice(0,20)},
    validation:{status:"passed",issues:warnings},
    decision:null,
    downstreamCommand:null,
    usage:{inputTokens:0,outputTokens:0,estimatedCostMicros:0,latencyMs:0,estimatedMinutesSaved:20},
    failure:null,
    createdAt:now,
    updatedAt:now,
    createdBy:"vertex-ai-worker",
    updatedBy:"vertex-ai-worker",
    archivedAt:null,
  },{merge:true});
  if(followupBody&&clientContact?.exists&&string(clientContact.get("email"))){
    const followupActionId=`ai_planning_followup_${responseId}`;
    batch.set(db.doc(`aiActions/${followupActionId}`),{
      id:followupActionId,
      tenantId:job.get("tenantId"),
      projectId,
      actorId:"vertex-ai-worker",
      title:`Approve follow-up: ${String(response.get("templateName")??"Questionnaire")}`,
      capability:"planning_followup_draft",
      authorityBoundary:"human_approval_required",
      status:"review_required",
      modelProvider:process.env.PROVIDER_MOCK_MODE==="true"?"mock":"vertex_ai",
      modelVersion:process.env.VERTEX_AI_EXTRACTION_MODEL??"mock-questionnaire-v1",
      instructionVersion:"planning-followup-v1",
      outputSchemaVersion:"communication-draft-v1",
      sourceReferences:[{entityType:"questionnaire_response",entityId:responseId,versionId:String(response.get("templateVersion")??1),label:String(response.get("templateName")??"Questionnaire"),locator:"planning gaps"}],
      structuredOutput:{subject:followupSubject,body:followupBody,recipientEmail:clientContact.get("email"),recipientName:clientContact.get("displayName")??null,contactId:clientContact.id,projectName:project.get("name")??null},
      confidence:{overall:missingInformation.length?0.86:0.94,label:missingInformation.length?"medium":"high",uncertainFields:missingInformation.slice(0,20)},
      validation:{status:"passed",issues:warnings},
      decision:null,
      downstreamCommand:null,
      usage:{inputTokens:0,outputTokens:0,estimatedCostMicros:0,latencyMs:0,estimatedMinutesSaved:8},
      failure:null,
      createdAt:now,
      updatedAt:now,
      createdBy:"vertex-ai-worker",
      updatedBy:"vertex-ai-worker",
      archivedAt:null,
    },{merge:true});
  }
  const preparedEvent=productEvent({tenantId:String(job.get("tenantId")),projectId,actorId:"vertex-ai-worker",actorType:"system",name:"planning.package_prepared",occurredAt:now,correlationId:responseId,sourceEntityType:"questionnaireResponse",sourceEntityId:responseId,properties:{factCount:categorizedFacts.length,missingCount:missingInformation.length,conflictCount:planningPackage.conflicts.length,followupPrepared:Boolean(followupBody&&clientContact?.exists)}});
  batch.set(db.doc(`productEvents/${preparedEvent.id}`),preparedEvent,{merge:true});
  await batch.commit();
  return{responseId,actionId,missingCount:missingInformation.length,riskCount:aiReview.planningRisks.length,humanReviewRequired:true};
}


/**
 * Draft a reply to a client message, on arrival, with no user present.
 *
 * The questions StudioCue can answer from its own records never reach here —
 * communications/prepared-answers.ts handles those deterministically. This is
 * for the rest: the ones that need judgement, where a studio owner opening the
 * thread should find something already written.
 *
 * Quota is charged to the tenant, which is how consumeAiQuota already works — it
 * takes a tenantId and no user. The action is written with a system actor and
 * still requires human review, so nothing about the approval boundary changes;
 * only who started the drafting.
 */
async function runInboundReplyDraft(job: DocumentSnapshot) {
  const db = getFirestore();
  const tenantId = String(job.get("tenantId"));
  const conversationId = String(job.get("conversationId"));
  const conversation = await db.doc(`conversations/${conversationId}`).get();
  if (!conversation.exists) throw new Error("CONVERSATION_NOT_FOUND");
  if (conversation.get("tenantId") !== tenantId) throw new Error("TENANT_MISMATCH");

  const history = await db
    .collection("messages")
    .where("conversationId", "==", conversationId)
    .orderBy("createdAt", "desc")
    .limit(10)
    .get();
  const ordered = history.docs.reverse().map((document) => ({
    from: document.get("direction") === "inbound" ? "client" : "studio",
    at: string(document.get("createdAt")),
    body: string(document.get("body") ?? document.get("bodyPreview")).slice(0, 1500),
  }));
  const facts = await gatherAnswerFacts(db, {
    tenantId,
    projectId: (conversation.get("projectId") as string | null) ?? null,
  });

  const now = new Date().toISOString();
  const actionId = `ai_inbound_${conversationId}_${job.id}`.slice(0, 200);

  let draft = {
    subject: string(conversation.get("subject")) || "Re: your photography",
    body: "",
    missingInformation: [] as string[],
  };

  if (process.env.PROVIDER_MOCK_MODE === "true") {
    draft.body = "Thanks for getting back to me — I'll follow up shortly.";
    draft.missingInformation = ["Mock mode: no model was called."];
  } else {
    const project = process.env.VERTEX_AI_PROJECT_ID;
    const model =
      process.env.VERTEX_AI_MESSAGE_MODEL ?? process.env.VERTEX_AI_SCHEDULE_MODEL;
    if (!project || !model) throw new Error("VERTEX_AI_NOT_CONFIGURED");
    const token = await cloudAccessToken();
    const response = await fetch(
      vertexEndpoint(project, model),
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "Draft one reply from a photography studio to its client, answering their most recent message. Use only the supplied facts. Never invent prices, dates, times, links or promises — put anything you would need to guess in missingInformation instead. Do not restate the thread. Never mention AI. Plain text, short paragraphs. A person reviews this before it is sent.",
              },
              US_ENGLISH_PART,
            ],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: JSON.stringify({ conversation: ordered, facts }) }],
            },
          ],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                subject: { type: "STRING" },
                body: { type: "STRING" },
                missingInformation: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["subject", "body", "missingInformation"],
            },
          },
        }),
      },
    );
    if (!response.ok) throw new Error(`VERTEX_AI_FAILED:${response.status}`);
    const body = record(await response.json());
    const candidates = Array.isArray(body.candidates) ? body.candidates : [];
    const content = record(record(candidates[0]).content);
    const parts = Array.isArray(content.parts) ? content.parts : [];
    const output = string(record(parts[0]).text);
    if (!output) throw new Error("VERTEX_AI_EMPTY_OUTPUT");
    const parsed = record(JSON.parse(output));
    draft = {
      subject: string(parsed.subject) || draft.subject,
      body: string(parsed.body),
      missingInformation: Array.isArray(parsed.missingInformation)
        ? parsed.missingInformation.map(String).slice(0, 8)
        : [],
    };
  }
  if (!draft.body) throw new Error("AI_DRAFT_EMPTY");
  // Still at the inquiry stage with no call booked: the answer carries the
  // couple's link, so replying by email leads to the same page the first
  // reply did.
  const inquiryLeadId = string(conversation.get("leadId"));
  const inquiryProjectId = string(conversation.get("projectId"));
  const inquiryProject = inquiryProjectId ? await db.doc(`projects/${inquiryProjectId}`).get() : null;
  let bookingLinkIncluded = false;
  if (inquiryLeadId && (!inquiryProject || inquiryProject.get("state") === "LEAD")) {
    const linked = await withInquiryLink(db, { tenantId, leadId: inquiryLeadId, body: draft.body, now });
    draft.body = linked.body;
    bookingLinkIncluded = linked.linked;
  }
  const participant = record(conversation.get("participant"));

  // Quota and the action land together, so a charged action always exists and an
  // uncharged one never does.
  await db.runTransaction(async (transaction) => {
    await consumeAiQuota(transaction, db, tenantId, now);
    transaction.set(db.doc(`aiActions/${actionId}`), {
      id: actionId,
      tenantId,
      projectId: (conversation.get("projectId") as string | null) ?? null,
      conversationId,
      actorId: "system_inbound_draft",
      actorType: "system",
      title: "Review reply to client message",
      capability: "inquiry_reply_draft",
      authorityBoundary: "draft_requires_review",
      status: "review_required",
      modelProvider: process.env.PROVIDER_MOCK_MODE === "true" ? "studiocue" : "vertex_ai",
      modelVersion:
        process.env.VERTEX_AI_MESSAGE_MODEL ??
        process.env.VERTEX_AI_SCHEDULE_MODEL ??
        "vertex",
      instructionVersion: "inbound_reply_v1",
      outputSchemaVersion: "message_draft_output_v1",
      // Who it goes to and which inquiry it answers travel with it, as they do
      // on a first reply: without them an approved draft had no recipient and
      // stopped at "approved, not sent", and Today could not put it on the
      // couple's card.
      sourceReferences: inquiryLeadId
        ? [{ entityType: "lead", entityId: inquiryLeadId, versionId: null, label: "Their reply", locator: "conversation" }]
        : [],
      structuredOutput: {
        trigger: "inbound_reply",
        subject: draft.subject,
        body: draft.body,
        highlights: [],
        recipientEmail: string(participant.email) || null,
        recipientName: string(participant.name) || null,
        contactId: string(participant.contactId) || null,
        leadId: inquiryLeadId || null,
        bookingLinkIncluded,
      },
      confidence: {
        overall: draft.missingInformation.length ? 0.6 : 0.85,
        label: draft.missingInformation.length ? "medium" : "high",
        uncertainFields: draft.missingInformation,
      },
      validation: { status: "passed", issues: [] },
      decision: null,
      downstreamCommand: null,
      createdAt: now,
      updatedAt: now,
      createdBy: "system_inbound_draft",
      updatedBy: "system_inbound_draft",
    }, { merge: true });
  });

  return { actionId, drafted: true };
}

export async function runAiJob(job:DocumentSnapshot){if(String(job.get("type"))==="inbound_reply_draft")return runInboundReplyDraft(job);if(String(job.get("type"))==="studio_import_extraction")return runStudioImportAnalysis(job);if(String(job.get("type"))==="lead_intake_analysis")return runLeadIntakeAnalysis(job);if(String(job.get("type"))==="consultation_analysis")return runConsultationAnalysis(job);if(String(job.get("type"))==="questionnaire_analysis")return runQuestionnaireAnalysis(job);if(String(job.get("type"))!=="coi_extraction")throw new Error("UNSUPPORTED_AI_JOB");const db=getFirestore();const requestId=job.id.replace(/^coi_/,"");const insurance=await db.doc(`insuranceRequests/${requestId}`).get();if(!insurance.exists)throw new Error("INSURANCE_REQUEST_NOT_FOUND");if(job.get("humanApprovalRequired")!==true)throw new Error("AI_HUMAN_REVIEW_GUARD_MISSING");if(insurance.get("scanStatus")!=="clean")throw new Error("COI_FILE_NOT_CLEARED");let extraction:Json;
  if(process.env.PROVIDER_MOCK_MODE==="true"){extraction={certificateHolder:"Development extraction",eventDate:null,coverageTypes:[],limits:{},additionalInsuredWording:null,waiverOfSubrogation:null,primaryNoncontributory:null,confidence:0,missingFields:["Live Vertex AI configuration"]}}else{const project=process.env.VERTEX_AI_PROJECT_ID;const model=process.env.VERTEX_AI_EXTRACTION_MODEL;if(!project||!model)throw new Error("VERTEX_AI_NOT_CONFIGURED");const token=await cloudAccessToken();const object=string(insurance.get("temporaryObject"));const parts:Array<Json>=[{text:"Extract factual certificate-of-insurance fields. Do not decide legal sufficiency or approval. Return JSON only and use null for unknown values. certificateHolder is the holder's name as printed, without its address. Limits are whole US dollars as numbers; generalLiability is the general liability each-occurrence limit."}];if(object.startsWith("gs://"))parts.push({fileData:{mimeType:"application/pdf",fileUri:object}});const response=await fetch(vertexEndpoint(project, model),{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts}],generationConfig:{temperature:0,responseMimeType:"application/json",responseSchema:{type:"OBJECT",properties:{certificateHolder:{type:"STRING",nullable:true},eventDate:{type:"STRING",nullable:true},coverageTypes:{type:"ARRAY",items:{type:"STRING"}},limits:{type:"OBJECT",properties:{generalLiability:{type:"NUMBER",nullable:true,description:"General liability, each occurrence, in US dollars"},generalAggregate:{type:"NUMBER",nullable:true,description:"General liability, general aggregate, in US dollars"},damageToPremises:{type:"NUMBER",nullable:true,description:"Damage to rented premises, each occurrence, in US dollars"},productsCompletedOperations:{type:"NUMBER",nullable:true},personalAdvertisingInjury:{type:"NUMBER",nullable:true},medicalExpense:{type:"NUMBER",nullable:true},automobileCombinedSingleLimit:{type:"NUMBER",nullable:true},umbrellaEachOccurrence:{type:"NUMBER",nullable:true},workersCompensationEachAccident:{type:"NUMBER",nullable:true}}},additionalInsuredWording:{type:"STRING",nullable:true},waiverOfSubrogation:{type:"STRING",nullable:true},primaryNoncontributory:{type:"STRING",nullable:true},confidence:{type:"NUMBER"},missingFields:{type:"ARRAY",items:{type:"STRING"}}},required:["coverageTypes","limits","confidence","missingFields"]}}})});if(!response.ok)throw new Error(`VERTEX_AI_FAILED:${response.status}`);const body=record(await response.json());const candidates=Array.isArray(body.candidates)?body.candidates:[];const content=record(record(candidates[0]).content);const responseParts=Array.isArray(content.parts)?content.parts:[];const output=string(record(responseParts[0]).text);if(!output)throw new Error("VERTEX_AI_EMPTY_OUTPUT");extraction=record(JSON.parse(output))}
  const requirement=await db.doc(`insuranceRequirements/${String(insurance.get("requirementId"))}`).get();if(!requirement.exists)throw new Error("INSURANCE_REQUIREMENT_NOT_FOUND");
  const normalize=(value:unknown)=>String(value??"").trim().toLowerCase().replace(/\s+/g," ");
  const discrepancies:Array<Json>=[];
  // The holder box is the name then the address; the name must lead it.
  if(!holderMatches(requirement.get("certificateHolder"),extraction.certificateHolder))discrepancies.push({field:"certificateHolder",expected:String(requirement.get("certificateHolder")??""),extracted:String(extraction.certificateHolder??""),severity:"blocking"});
  // Not a string compare: "2027-05-15" and "15 May 2027" are the same day, and
  // flagging that as blocking sends a studio to their agent for nothing.
  if(!sameCalendarDate(requirement.get("eventDate"),extraction.eventDate))discrepancies.push({field:"eventDate",expected:String(requirement.get("eventDate")??""),extracted:String(extraction.eventDate??""),severity:"blocking"});
  const expectedCoverage=Array.isArray(requirement.get("coverageTypes"))?requirement.get("coverageTypes") as unknown[]:[];
  const actualCoverage=Array.isArray(extraction.coverageTypes)?extraction.coverageTypes:[];
  for(const coverage of expectedCoverage)if(!coverageMatches(coverage,actualCoverage))discrepancies.push({field:"coverageTypes",expected:String(coverage),extracted:actualCoverage.map(String).join(", "),severity:"blocking"});
  const expectedLimits=record(requirement.get("requiredLimits"));const actualLimits=record(extraction.limits);
  // Requirements are stored in cents and certificates state dollars, so the
  // raw comparison could never pass: $1,000,000 of cover read as short of
  // "200000000". Both sides are read as dollars before they are weighed.
  for(const [key,expected] of Object.entries(expectedLimits)){const required=limitDollars(expected,true);const carried=limitDollars(actualLimits[key]);if(required!==null&&(carried===null||carried<required))discrepancies.push({field:`requiredLimits.${key}`,expected:String(expected),extracted:String(actualLimits[key]??""),severity:"blocking"})}
  if(requirement.get("additionalInsuredWording")&& !normalize(extraction.additionalInsuredWording).includes(normalize(requirement.get("additionalInsuredWording"))))discrepancies.push({field:"additionalInsuredWording",expected:String(requirement.get("additionalInsuredWording")),extracted:String(extraction.additionalInsuredWording??""),severity:"warning"});
  if(requirement.get("waiverOfSubrogation")===true&&!normalize(extraction.waiverOfSubrogation).includes("yes")&&!normalize(extraction.waiverOfSubrogation).includes("true"))discrepancies.push({field:"waiverOfSubrogation",expected:"Required",extracted:String(extraction.waiverOfSubrogation??""),severity:"warning"});
  if(requirement.get("primaryNoncontributory")===true&&!normalize(extraction.primaryNoncontributory).includes("yes")&&!normalize(extraction.primaryNoncontributory).includes("true"))discrepancies.push({field:"primaryNoncontributory",expected:"Required",extracted:String(extraction.primaryNoncontributory??""),severity:"warning"});
  const now=new Date().toISOString();await insurance.ref.update({status:"under_review",extractedData:extraction,aiExtraction:extraction,discrepancies,aiExtractedAt:now,humanDecision:"pending",updatedAt:now,updatedBy:"vertex-ai-worker"});return{requestId,status:"under_review",discrepancyCount:discrepancies.length,humanApprovalRequired:true}}

/**
 * The run of show as the page a studio hands out (planning/run-of-show-doc.ts):
 * the wedding's own times, where everyone is, and who covers what, with the
 * crew named the way the studio writes them (P1, V1).
 */
async function runOfShowFor(db:FirebaseFirestore.Firestore,schedule:DocumentSnapshot,items:Array<Json>){
  const tenantId=String(schedule.get("tenantId"));
  const projectId=String(schedule.get("projectId"));
  const [project,assignments]=await Promise.all([
    db.doc(`projects/${projectId}`).get(),
    db.collection("crewAssignments").where("tenantId","==",tenantId).where("projectId","==",projectId).where("status","==","accepted").get(),
  ]);
  const labels=crewLabels(assignments.docs.map(assignment=>({
    id:String(assignment.get("crewProfileId")??assignment.id),
    role:String(assignment.get("role")??""),
    order:String(assignment.get("acceptedAt")??assignment.get("createdAt")??""),
  })));
  return runOfShowDocument({
    items:items.map(item=>({
      startAt:String(item.startAt),
      endAt:String(item.endAt),
      title:String(item.title??""),
      location:typeof item.location==="string"?item.location:null,
      // A DJ's MC script rides on the line's note: the song, what's said, and how to say the names.
      notes:[typeof item.notes==="string"?item.notes:null,mcScriptLine(item.mc as Partial<McScript>|undefined)].filter(Boolean).join(" · ")||null,
      crewIds:itemCrewIds(item as {crewIds?:unknown;photographerIds?:unknown}),
    })),
    timeZone:eventZone(schedule.get("timezone"),project.get("timezone")),
    version:Number(schedule.get("version")??1),
    publishedAt:typeof schedule.get("publishedAt")==="string"?schedule.get("publishedAt"):schedule.get("createdAt")??null,
    project:{name:project.get("name")??null,eventDate:project.get("eventDate")??null,eventType:project.get("eventType")??project.get("eventTypeId")??null},
    crewLabels:new Map([...labels.values()].map(label=>[label.id,label.label])),
  });
}

async function pdfInput(job:DocumentSnapshot){const db=getFirestore();const tenant=await db.doc(`tenants/${String(job.get("tenantId"))}`).get();const tenantName=String(tenant.get("brandName")??tenant.get("businessName")??"Studio");const generatedAt=new Date().toISOString();const type=String(job.get("type"));
  // A signed StudioCue contract and its certificate. See ../contracts/seal.ts.
  if(type==="contract_pdf")return contractPdfInput(db,job,tenantName);
  if(type==="proposal_pdf"){
    const proposal=await db.doc(`proposals/${String(job.get("proposalId"))}`).get();
    if(!proposal.exists)throw new Error("PROPOSAL_NOT_FOUND");
    const pricing=record(proposal.get("pricingSnapshot"));
    const lines=Array.isArray(pricing.lineItems)?pricing.lineItems:[];
    const paymentSchedule=Array.isArray(proposal.get("paymentSchedule"))?proposal.get("paymentSchedule") as unknown[]:[];
    const currency=string(pricing.currency)||"USD";
    const packageName=string(pricing.packageName)||"Coverage collection";
    /**
     * What trade this proposal is actually selling.
     *
     * The document said PHOTOGRAPHY PROPOSAL on every proposal ever generated,
     * including the reference studio's Gold Cinematic Package — ten hours of
     * videography, drone and gimbal, under a header that contradicted it. The
     * package snapshot already records `includedCoverage` as {role,count}[], so
     * the label is a fact we hold rather than a guess.
     */
    // Every package on the proposal, because a photo + video job is both and
    // the header has to say so.
    const snapshotIds=[
      string(proposal.get("packageSnapshotId")),
      ...(Array.isArray(proposal.get("additionalPackageSnapshotIds"))
        ?(proposal.get("additionalPackageSnapshotIds") as unknown[]).map(value=>String(value))
        :[]),
    ].filter(Boolean).slice(0,4);
    const snapshots=(await Promise.all(
      snapshotIds.map(id=>db.doc(`packageSnapshots/${id}`).get()),
    )).filter(document=>document.exists);
    // Each package's "what's included", from its snapshot, so the document
    // lists every package's bullets and not one package's paragraph.
    const details=packageDetails(snapshots.map(document=>({id:document.id,data:record(document.data())})));
    const coverageRoles=new Set(
      snapshots.flatMap(document=>
        (Array.isArray(document.get("includedCoverage"))?document.get("includedCoverage") as unknown[]:[])
          .map(entry=>string(record(entry).role).toLowerCase())
          .filter(Boolean),
      ),
    );
    // A DJ's, makeup artist's or hair stylist's own word: "MAKEUP QUOTE" (trades.ts).
    const pdfTrade=tradeProfile(tenant.get("trade"));
    const documentKind=
      pdfTrade.family!=="photo"
        ?`${TRADE_LABELS[pdfTrade.trade].toUpperCase()} ${tradeVocab(pdfTrade.trade).proposal.toUpperCase()}`
      :coverageRoles.has("videographer")&&coverageRoles.has("photographer")
        ?"PHOTOGRAPHY & VIDEO PROPOSAL"
        :coverageRoles.has("videographer")
          ?"VIDEOGRAPHY PROPOSAL"
          :coverageRoles.has("photographer")
            ?"PHOTOGRAPHY PROPOSAL"
            // No coverage recorded is not evidence of photography.
            :"PROPOSAL";
    const coverageWord=
      documentKind==="VIDEOGRAPHY PROPOSAL"?"Video"
        :documentKind==="PHOTOGRAPHY & VIDEO PROPOSAL"?"Photography and video"
          :documentKind==="PHOTOGRAPHY PROPOSAL"?"Photography"
            :"Coverage";
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
        package_name:clipForPdf(packageName,160),
        document_kind:documentKind,
        // The studio's own mark, from the same place every branded email
        // takes it. Empty is fine: the renderer falls back to the wordmark.
        logo_url:string(record(tenant.get("emailBranding")).logoUrl)||string(tenant.get("logoUrl"))||"",
        package_description:pdfTrade.family!=="photo"?"Services and what's included, as selected.":`${coverageWord} coverage and deliverables as selected.`,
        introduction:clipForPdf(string(proposal.get("notes")),3000),
        terms_summary:clipForPdf(string(proposal.get("termsSummary")),3000),
        // The package lines, then the discount and tax that take their sum to
        // the total printed under them (UAT F1).
        line_items:[
          ...normalizedLines.slice(0,48).map(value=>{const line=record(value);
          // "Bridesmaid makeup — 6 people × $150": a per-person extra says how many (unit-label.ts).
          const counted=line.kind==="add_on"&&(Number(line.quantity)>1||normalizeUnitLabel(line.unitLabel))?` — ${quantityText(Number(line.quantity)||1,line.unitLabel)} × ${money(line.unitPriceCents,currency)}`:"";
          return{description:clipForPdf((string(line.description)||packageName)+counted,240),amount:money(line.totalCents,currency),details:detailsForLine(details,string(line.description)).slice(0,30).map(item=>clipForPdf(item,300))}}),
          ...proposalPdfAdjustments(pricing).map(item=>({description:item.description,amount:item.cents<0?`−${money(-item.cents,currency)}`:money(item.cents,currency),details:[]})),
        ],
        // The last payment reads "plus sales tax" when QuickBooks adds it on the final invoice.
        payment_schedule:paymentSchedule.slice(0,20).map((value,index,shown)=>{const item=record(value);return{label:clipForPdf(string(item.label)||"Payment",120),amount:proposalPdfPaymentAmount(pricing,money(item.amountCents,currency),index===shown.length-1&&shown.length===paymentSchedule.length),due_date:item.dueDate?String(item.dueDate).slice(0,10):null}}),
        total:money(pricing.totalCents,currency),
        // Pre-tax "plus sales tax": the estimate is printed under the Total,
        // not added in (renderers before this ignore both fields).
        total_label:proposalPdfSalesTax(pricing,currency).totalLabel,
        after_total:proposalPdfSalesTax(pricing,currency).afterTotal,
        // The retainer the schedule on the same page asks for: an override
        // showed two different retainers in one PDF (H2, M7).
        retainer:money(retainerFromSchedule(paymentSchedule,Number(pricing.retainerCents)),currency),
        balance:proposalPdfPaymentAmount(pricing,money(Math.max(0,Number(pricing.totalCents)-retainerFromSchedule(paymentSchedule,Number(pricing.retainerCents))),currency),true),
        expires_on:String(proposal.get("expiresAt")).slice(0,10),
        generated_at:generatedAt,
      },
      packageDetails:details,
    }}
  if(type==="schedule_pdf"){
    const schedule=await db.doc(`schedules/${String(job.get("scheduleId"))}`).get();
    if(!schedule.exists)throw new Error("SCHEDULE_NOT_FOUND");
    const items=Array.isArray(schedule.get("items"))?schedule.get("items") as Array<Json>:[];
    const document=await runOfShowFor(db,schedule,items);
    return{endpoint:"schedules",entity:schedule,fileName:document.fileName,payload:{
      tenant_name:tenantName,
      project_id:String(schedule.get("projectId")),
      schedule_id:schedule.id,
      version:Number(schedule.get("version")),
      timezone:String(schedule.get("timezone")),
      // As before, for a PDF service that predates `document`.
      items:items.map(item=>({start:String(item.startAt),end:String(item.endAt),title:String(item.title),location:String(item.location??"")})),
      generated_at:generatedAt,
      document:{title:document.title,subtitle:document.subtitle,studio:tenantName,facts:document.facts,rows:document.rows,footer:document.footer},
    }}}
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
  // The signed copy has its own home, record and email; it is never a
  // generic "generated" document.
  if(String(job.get("type"))==="contract_pdf")return storeSealedContract(getFirestore(),job,input.entity,bytes);
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
    ?`${String(input.entity.get("eventSnapshot")?.name??"project").replace(/[^a-z0-9]+/gi,"-").replace(/^-|-$/g,"").toLowerCase()||"project"}-${tradeVocab((await getFirestore().doc(`tenants/${tenantId}`).get()).get("trade")).proposal.toLowerCase()}-v${Number(input.entity.get("version")??1)}.pdf`
    // "replytest-couple-wedding-run-of-show-v1.pdf", not the job's id.
    :"fileName" in input&&typeof input.fileName==="string"&&input.fileName?input.fileName:`${job.id}.pdf`;
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
    // Filled in for a proposal written before packageDetails existed, so the
    // couple's page lists what each package includes (GR, 2026-09-30).
    ...(isProposal&&"packageDetails" in input&&Array.isArray(input.packageDetails)?{packageDetails:input.packageDetails}:{}),
    updatedAt:now,
    updatedBy:"pdf-worker",
  });
  await batch.commit();
  return{documentId,path,sizeBytes:bytes.length,sha256:hash,visibility};
}
