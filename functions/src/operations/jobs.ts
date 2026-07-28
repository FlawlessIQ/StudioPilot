import { getFirestore,type DocumentSnapshot } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createConsultationResources,createDocusignEnvelope,createQuickBooksInvoice,completeBookingResources,uploadDropboxDocument } from "./provider-runtime.js";
import { runAiJob,runPdfJob } from "./ai-pdf.js";
import { captureOperationalError } from "./observability.js";

type Result=Record<string,unknown>;
const retryDelay=(attempt:number)=>Math.min(6*60*60*1000,30_000*2**Math.max(0,attempt-1));
async function claim(document:DocumentSnapshot){return getFirestore().runTransaction(async transaction=>{const current=await transaction.get(document.ref);if(!current.exists||!["queued","retry_scheduled"].includes(String(current.get("status"))))return false;transaction.update(document.ref,{status:"running",attempts:Number(current.get("attempts")??0)+1,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});return true})}
async function finish(document:DocumentSnapshot,run:()=>Promise<Result>){if(!await claim(document))return;try{const result=await run();await document.ref.update({status:"succeeded",result,error:null,completedAt:new Date().toISOString(),updatedAt:new Date().toISOString()})}catch(caught:unknown){const current=await document.ref.get();const attempts=Number(current.get("attempts")??1);const message=caught instanceof Error?caught.message:"JOB_FAILED";const code=message.split(":")[0]??"JOB_FAILED";await document.ref.update({status:attempts>=5?"dead_letter":"retry_scheduled",error:{code,message,retryable:attempts<5},nextAttemptAt:attempts>=5?null:new Date(Date.now()+retryDelay(attempts)).toISOString(),updatedAt:new Date().toISOString()});await captureOperationalError(code,{collection:document.ref.parent.id,jobId:document.id,status:attempts>=5?"dead_letter":"retry_scheduled"})}}
async function providerJob(document:DocumentSnapshot){const type=String(document.get("type"));if(type==="create_consultation_resources")return createConsultationResources(document);if(type==="create_docusign_envelope")return createDocusignEnvelope(document);if(type==="create_quickbooks_invoice")return createQuickBooksInvoice(document);if(type==="complete_booking_side_effects")return completeBookingResources(document);if(type==="upload_dropbox_document")return uploadDropboxDocument(document);throw new Error("UNSUPPORTED_PROVIDER_JOB")}

async function recipientFor(document:DocumentSnapshot){const direct=document.get("recipient");if(typeof direct==="string"&&direct)return direct;const projectId=String(document.get("projectId")??"");if(!projectId)throw new Error("EMAIL_RECIPIENT_MISSING");const db=getFirestore();const project=await db.doc(`projects/${projectId}`).get();const ids=project.get("clientContactIds");const contactId=Array.isArray(ids)?ids[0]:null;if(typeof contactId!=="string")throw new Error("EMAIL_RECIPIENT_MISSING");const contact=await db.doc(`contacts/${contactId}`).get();const email=contact.get("email");if(typeof email!=="string")throw new Error("EMAIL_RECIPIENT_MISSING");return email}
async function sendEmail(document:DocumentSnapshot):Promise<Result>{
  const recipient=await recipientFor(document);const type=String(document.get("type"));const projectId=String(document.get("projectId")??"");
  const subjects:Record<string,string>={
    staff_invitation:"You’re invited to a StudioHub workspace",
    client_invitation:"Your secure StudioHub client portal is ready",
    crew_invitation:"Photography assignment invitation",
    booking_confirmation:"Your photography project is booked",
    review_request:"A quick review request",
    coi_request:"Certificate of insurance request",
    coi_correction:"Certificate of insurance correction requested",
    coi_venue_delivery:"Approved certificate of insurance",
  };
  const requirement=asEmailRecord(document.get("requirement"));
  const bodies:Record<string,string>={
    staff_invitation:`A studio invited you to its StudioHub workspace. Accept the invitation: ${String(document.get("inviteUrl")??"")}`,
    client_invitation:`Your photography project portal is ready. Activate secure access with your verified email: ${String(document.get("inviteUrl")??"")}`,
    crew_invitation:`A photography assignment is ready for your review. Open the secure invitation: ${String(document.get("inviteUrl")??"")}`,
    booking_confirmation:"Your booking requirements passed and your client portal is active.",
    review_request:`Thank you for working with us. Share your experience: ${String(document.get("destinationUrl")??"")}`,
    coi_request:`Please provide a certificate of insurance for ${String(requirement.venueLegalName??"the venue")} on ${String(requirement.eventDate??"the event date")}. Certificate holder: ${String(requirement.certificateHolder??"see requirements")}. Due: ${String(requirement.dueDate??"as soon as possible")}. Reply to this message with one PDF attachment.`,
    coi_correction:`A reviewed certificate requires correction. Reason: ${String(document.get("reason")??"Please contact the studio.")}. Reply with one corrected PDF attachment.`,
    coi_venue_delivery:`The studio reviewed and approved the attached certificate of insurance for ${String(document.get("venueName")??"your venue")}.`,
  };
  if(process.env.EMAIL_DELIVERY_MODE!=="live"){
    const messageId=`mock_email_${document.id}`;
    await saveMessage(document,recipient,subjects[type]??"StudioHub notification",messageId,"mock");
    return{messageId,deliveryMode:"mock"};
  }
  const apiKey=process.env.SENDGRID_API_KEY;const from=process.env.SENDGRID_FROM_EMAIL;
  if(!apiKey||!from)throw new Error("SENDGRID_NOT_CONFIGURED");
  const payload:Record<string,unknown>={
    personalizations:[{to:[{email:recipient}],custom_args:{studioHubJobId:document.id,projectId}}],
    from:{email:from},
    subject:subjects[type]??"StudioHub notification",
    content:[{type:"text/plain",value:bodies[type]??"A StudioHub project update is available."}],
  };
  const replyAddress=document.get("replyAddress");
  if(typeof replyAddress==="string"&&replyAddress)payload.reply_to={email:replyAddress};
  if(type==="coi_venue_delivery"){
    const documentId=String(document.get("documentId")??"");
    const fileDocument=await getFirestore().doc(`documents/${documentId}`).get();
    const reference=String(fileDocument.get("cloudStorageSource")??fileDocument.get("providerFileId")??"");
    const match=reference.match(/^gs:\/\/([^/]+)\/(.+)$/);
    const bucketName=match?.[1];const objectName=match?.[2];
    if(!bucketName||!objectName)throw new Error("COI_ATTACHMENT_REFERENCE_INVALID");
    const [bytes]=await getStorage().bucket(bucketName).file(objectName).download();
    if(bytes.length>15*1024*1024)throw new Error("COI_ATTACHMENT_TOO_LARGE");
    payload.attachments=[{content:bytes.toString("base64"),type:"application/pdf",filename:String(fileDocument.get("name")??"certificate-of-insurance.pdf"),disposition:"attachment"}];
  }
  const response=await fetch("https://api.sendgrid.com/v3/mail/send",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify(payload)});
  if(!response.ok)throw new Error(`SENDGRID_SEND_FAILED:${response.status}`);
  const messageId=response.headers.get("x-message-id")??`sendgrid_${document.id}`;
  await saveMessage(document,recipient,subjects[type]??"StudioHub notification",messageId,"live");
  if(type==="review_request"&&document.get("reviewRequestId"))await getFirestore().doc(`reviewRequests/${String(document.get("reviewRequestId"))}`).update({status:"sent",sentAt:new Date().toISOString(),messageId,updatedAt:new Date().toISOString(),updatedBy:"email-worker"});
  return{messageId};
}
function asEmailRecord(value:unknown):Record<string,unknown>{return typeof value==="object"&&value!==null&&!Array.isArray(value)?value as Record<string,unknown>:{}}
async function saveMessage(document:DocumentSnapshot,recipient:string,subject:string,messageId:string,deliveryMode:"live"|"mock"){
  const now=new Date().toISOString();
  await getFirestore().doc(`messages/${document.id}`).set({
    id:document.id,
    tenantId:document.get("tenantId"),
    projectId:document.get("projectId")??null,
    direction:"outbound",
    channel:"email",
    templateKey:document.get("type"),
    recipient,
    subject,
    provider:"sendgrid",
    providerMessageId:messageId,
    deliveryMode,
    deliveryStatus:deliveryMode==="live"?"sent":"mock",
    visibility:"studio",
    sentAt:now,
    createdAt:now,
    updatedAt:now,
    createdBy:"email-worker",
    updatedBy:"email-worker",
    archivedAt:null,
  },{merge:true});
}

async function due(collectionName:string){const db=getFirestore();const now=new Date().toISOString();const [queued,retries]=await Promise.all([db.collection(collectionName).where("status","==","queued").limit(20).get(),db.collection(collectionName).where("status","==","retry_scheduled").where("nextAttemptAt","<=",now).limit(20).get()]);return[...queued.docs,...retries.docs]}
export const operationsJobScheduler=onSchedule({
  schedule:"every 1 minutes",
  timeZone:"UTC",
  retryCount:0,
  secrets:[
    "SENDGRID_API_KEY",
    "GOOGLE_CALENDAR_CLIENT_SECRET",
    "ZOOM_CLIENT_SECRET",
    "DROPBOX_CLIENT_SECRET",
  ],
},async()=>{for(const document of await due("providerJobs"))await finish(document,()=>providerJob(document));for(const document of await due("emailJobs"))await finish(document,()=>sendEmail(document));for(const document of await due("aiJobs"))await finish(document,()=>runAiJob(document));for(const document of await due("pdfJobs"))await finish(document,()=>runPdfJob(document))});
