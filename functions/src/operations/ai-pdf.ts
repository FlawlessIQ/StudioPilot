import { createHash } from "node:crypto";
import { getFirestore,type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { runStudioImportAnalysis } from "../studio-import/extraction.js";

type Json=Record<string,unknown>;
const record=(value:unknown):Json=>typeof value==="object"&&value!==null&&!Array.isArray(value)?value as Json:{};
const string=(value:unknown)=>typeof value==="string"?value:"";
async function metadataToken(path:string,header="Metadata-Flavor"){const response=await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/${path}`,{headers:{[header]:"Google"}});if(!response.ok)throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");return record(await response.json())}
async function cloudAccessToken(){const value=await metadataToken("token");const token=string(value.access_token);if(!token)throw new Error("GOOGLE_RUNTIME_IDENTITY_UNAVAILABLE");return token}
async function cloudRunIdentityToken(audience:string){const response=await fetch(`http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(audience)}&format=full`,{headers:{"Metadata-Flavor":"Google"}});if(!response.ok)throw new Error("PDF_SERVICE_IDENTITY_UNAVAILABLE");return response.text()}
const money=(value:unknown,currency:string)=>new Intl.NumberFormat("en-US",{style:"currency",currency}).format(Number(value)/100);

async function runLeadIntakeAnalysis(job:DocumentSnapshot){
  const db=getFirestore();
  const leadId=string(job.get("leadId"))||job.id.replace(/^lead_intake_/,"");
  const lead=await db.doc(`leads/${leadId}`).get();
  if(!lead.exists)throw new Error("LEAD_NOT_FOUND");
  const missing=Array.isArray(lead.get("missingInformation"))?lead.get("missingInformation") as unknown[]:[];
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
    const location=process.env.VERTEX_AI_LOCATION??"us-east4";
    const model=process.env.VERTEX_AI_EXTRACTION_MODEL;
    if(!project||!model)throw new Error("VERTEX_AI_NOT_CONFIGURED");
    const token=await cloudAccessToken();
    const facts={
      eventType:lead.get("eventTypeLabel"),
      eventDate:lead.get("eventDate"),
      venue:lead.get("venue"),
      city:lead.get("city"),
      estimatedGuestCount:lead.get("estimatedGuestCount"),
      servicesRequested:lead.get("servicesRequested"),
      budgetRange:lead.get("budgetRange"),
      referralSource:lead.get("referralSource"),
      message:lead.get("message"),
      availabilityStatus:lead.get("availabilityStatus"),
      knownMissingInformation:missing,
    };
    const response=await fetch(`https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,{
      method:"POST",
      headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify({
        systemInstruction:{parts:[{text:"You summarize photography inquiries and draft a warm studio reply using only supplied facts. Never invent pricing, availability, dates, venues, or client preferences. Never claim the date is available unless availabilityStatus says available. Missing information and questions are suggestions for a human consultation. The reply is an unsent draft requiring studio approval."}]},
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
  const missingInformation=Array.isArray(analysis.missingInformation)?analysis.missingInformation.map(String).filter(Boolean).slice(0,12):missing.map(String);
  const suggestedConsultationQuestions=Array.isArray(analysis.suggestedConsultationQuestions)?analysis.suggestedConsultationQuestions.map(String).filter(Boolean).slice(0,8):[];
  const now=new Date().toISOString();
  const replySubject=string(analysis.replySubject)||`Thank you for your ${string(lead.get("eventTypeLabel"))||"photography"} inquiry`;
  const replyBody=string(analysis.replyBody);
  const confidence=missingInformation.length===0?0.93:0.82;
  const actionId=`ai_reply_${leadId}`;
  const batch=db.batch();
  batch.update(lead.ref,{
    aiSummary:summary||lead.get("aiSummary")||null,
    missingInformation,
    suggestedConsultationQuestions,
    aiAnalyzedAt:now,
    updatedAt:now,
    updatedBy:"vertex-ai-worker",
  });
  batch.set(db.doc(`aiActions/${actionId}`),{
    id:actionId,
    tenantId:job.get("tenantId"),
    projectId:null,
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
    structuredOutput:{subject:replySubject,body:replyBody,recipientEmail:lead.get("email"),suggestedConsultationQuestions},
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
  if(job.get("humanReviewRequired")!==true)throw new Error("AI_HUMAN_REVIEW_GUARD_MISSING");
  const projectId=string(consultation.get("projectId"));
  const [project,packages]=await Promise.all([
    db.doc(`projects/${projectId}`).get(),
    db.collection("packages").where("tenantId","==",job.get("tenantId")).where("active","==",true).limit(50).get(),
  ]);
  if(!project.exists||project.get("tenantId")!==job.get("tenantId"))throw new Error("PROJECT_NOT_FOUND");
  const packageFacts=packages.docs.map(document=>({
    id:document.id,
    name:document.get("name"),
    description:document.get("description"),
    basePriceCents:document.get("basePriceCents"),
    currency:document.get("currency"),
    includedCoverageMinutes:document.get("includedCoverageMinutes"),
    includedPhotographers:document.get("includedPhotographers"),
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
    const location=process.env.VERTEX_AI_LOCATION??"us-east4";
    const model=process.env.VERTEX_AI_EXTRACTION_MODEL;
    if(!vertexProject||!model)throw new Error("VERTEX_AI_NOT_CONFIGURED");
    const token=await cloudAccessToken();
    const response=await fetch(`https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(vertexProject)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,{
      method:"POST",
      headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},
      body:JSON.stringify({
        systemInstruction:{parts:[{text:"Analyze wedding photography consultation notes using only supplied project facts and the exact active package catalog. Summarize stated priorities, missing information, and follow-up questions. Recommend only a supplied package id or null. Do not invent pricing, discounts, availability, deliverables, legal terms, or client agreement. Draft a short proposal introduction in the studio's professional voice. All outputs require human review."}]},
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
      generatedAt:now,
    },
    aiReviewedAt:now,
    updatedAt:now,
    updatedBy:"vertex-ai-worker",
  });
  const summaryActionId=`ai_consultation_${consultationId}`;
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
  const packageActionId=`ai_package_${consultationId}`;
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
  const proposalActionId=`ai_proposal_${consultationId}`;
  const termsSummary=recommended?string(recommended.get("terms")):"";
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
  const facts={
    project:{name:project.get("name"),eventType:project.get("eventType"),eventDate:project.get("eventDate"),venueName:project.get("venueName"),city:project.get("city")},
    questionnaire:fields.map(field=>({id:string(field.id),label:string(field.label),required:Boolean(field.required),answer:answers[string(field.id)]??null})),
    deterministicallyMissingRequired:deterministicMissing,
  };
  let analysis:Json;
  if(process.env.PROVIDER_MOCK_MODE==="true"){
    analysis={summary:"Questionnaire submitted and ready for studio review.",missingInformation:deterministicMissing,contradictions:[],planningRisks:[],suggestedQuestions:deterministicMissing.map(value=>`Can you confirm ${value}?`)};
  }else{
    const projectId=process.env.VERTEX_AI_PROJECT_ID;
    const location=process.env.VERTEX_AI_LOCATION??"us-east4";
    const model=process.env.VERTEX_AI_EXTRACTION_MODEL;
    if(!projectId||!model)throw new Error("VERTEX_AI_NOT_CONFIGURED");
    const token=await cloudAccessToken();
    const vertex=await fetch(`https://${location}-aiplatform.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`,{method:"POST",headers:{authorization:`Bearer ${token}`,"content-type":"application/json"},body:JSON.stringify({
      systemInstruction:{parts:[{text:"Review a photography planning questionnaire using only supplied facts. Identify missing information, possible contradictions, operational planning risks, and suggested follow-up questions. Do not invent dates, contacts, prices, legal conclusions, approvals, or completion states. Every result is advisory and requires studio review."}]},
      contents:[{role:"user",parts:[{text:JSON.stringify(facts)}]}],
      generationConfig:{temperature:0,responseMimeType:"application/json",responseSchema:{type:"OBJECT",properties:{summary:{type:"STRING"},missingInformation:{type:"ARRAY",items:{type:"STRING"}},contradictions:{type:"ARRAY",items:{type:"STRING"}},planningRisks:{type:"ARRAY",items:{type:"STRING"}},suggestedQuestions:{type:"ARRAY",items:{type:"STRING"}}},required:["summary","missingInformation","contradictions","planningRisks","suggestedQuestions"]}},
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
  const warnings=[
    ...missingInformation.map((message)=>({code:"MISSING_INFORMATION",severity:"warning",message,field:null})),
    ...aiReview.contradictions.map((message)=>({code:"POSSIBLE_CONTRADICTION",severity:"warning",message,field:null})),
  ];
  const batch=db.batch();
  batch.update(response.ref,{aiReview,aiReviewedAt:now,updatedAt:now,updatedBy:"vertex-ai-worker"});
  batch.set(db.doc(`aiActions/${actionId}`),{
    id:actionId,
    tenantId:job.get("tenantId"),
    projectId,
    actorId:"vertex-ai-worker",
    title:"Review questionnaire planning flags",
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
  await batch.commit();
  return{responseId,actionId,missingCount:missingInformation.length,riskCount:aiReview.planningRisks.length,humanReviewRequired:true};
}

export async function runAiJob(job:DocumentSnapshot){if(String(job.get("type"))==="studio_import_extraction")return runStudioImportAnalysis(job);if(String(job.get("type"))==="lead_intake_analysis")return runLeadIntakeAnalysis(job);if(String(job.get("type"))==="consultation_analysis")return runConsultationAnalysis(job);if(String(job.get("type"))==="questionnaire_analysis")return runQuestionnaireAnalysis(job);if(String(job.get("type"))!=="coi_extraction")throw new Error("UNSUPPORTED_AI_JOB");const db=getFirestore();const requestId=job.id.replace(/^coi_/,"");const insurance=await db.doc(`insuranceRequests/${requestId}`).get();if(!insurance.exists)throw new Error("INSURANCE_REQUEST_NOT_FOUND");if(job.get("humanApprovalRequired")!==true)throw new Error("AI_HUMAN_REVIEW_GUARD_MISSING");if(insurance.get("scanStatus")!=="clean")throw new Error("COI_FILE_NOT_CLEARED");let extraction:Json;
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
