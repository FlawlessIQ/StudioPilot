import { getFirestore,type DocumentSnapshot } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createConsultationResources,createDocusignEnvelope,createQuickBooksInvoice,completeBookingResources } from "./provider-runtime.js";
import { runAiJob,runPdfJob } from "./ai-pdf.js";
import { captureOperationalError } from "./observability.js";

type Result=Record<string,unknown>;
const retryDelay=(attempt:number)=>Math.min(6*60*60*1000,30_000*2**Math.max(0,attempt-1));
async function claim(document:DocumentSnapshot){return getFirestore().runTransaction(async transaction=>{const current=await transaction.get(document.ref);if(!current.exists||!["queued","retry_scheduled"].includes(String(current.get("status"))))return false;transaction.update(document.ref,{status:"running",attempts:Number(current.get("attempts")??0)+1,startedAt:new Date().toISOString(),updatedAt:new Date().toISOString()});return true})}
async function finish(document:DocumentSnapshot,run:()=>Promise<Result>){if(!await claim(document))return;try{const result=await run();await document.ref.update({status:"succeeded",result,error:null,completedAt:new Date().toISOString(),updatedAt:new Date().toISOString()})}catch(caught:unknown){const current=await document.ref.get();const attempts=Number(current.get("attempts")??1);const message=caught instanceof Error?caught.message:"JOB_FAILED";const code=message.split(":")[0]??"JOB_FAILED";await document.ref.update({status:attempts>=5?"dead_letter":"retry_scheduled",error:{code,message,retryable:attempts<5},nextAttemptAt:attempts>=5?null:new Date(Date.now()+retryDelay(attempts)).toISOString(),updatedAt:new Date().toISOString()});await captureOperationalError(code,{collection:document.ref.parent.id,jobId:document.id,status:attempts>=5?"dead_letter":"retry_scheduled"})}}
async function providerJob(document:DocumentSnapshot){const type=String(document.get("type"));if(type==="create_consultation_resources")return createConsultationResources(document);if(type==="create_docusign_envelope")return createDocusignEnvelope(document);if(type==="create_quickbooks_invoice")return createQuickBooksInvoice(document);if(type==="complete_booking_side_effects")return completeBookingResources(document);throw new Error("UNSUPPORTED_PROVIDER_JOB")}

async function recipientFor(document:DocumentSnapshot){const direct=document.get("recipient");if(typeof direct==="string"&&direct)return direct;const projectId=String(document.get("projectId")??"");if(!projectId)throw new Error("EMAIL_RECIPIENT_MISSING");const db=getFirestore();const project=await db.doc(`projects/${projectId}`).get();const ids=project.get("clientContactIds");const contactId=Array.isArray(ids)?ids[0]:null;if(typeof contactId!=="string")throw new Error("EMAIL_RECIPIENT_MISSING");const contact=await db.doc(`contacts/${contactId}`).get();const email=contact.get("email");if(typeof email!=="string")throw new Error("EMAIL_RECIPIENT_MISSING");return email}
async function sendEmail(document:DocumentSnapshot):Promise<Result>{if(process.env.PROVIDER_MOCK_MODE==="true")return{messageId:`mock_email_${document.id}`};const apiKey=process.env.SENDGRID_API_KEY;const from=process.env.SENDGRID_FROM_EMAIL;if(!apiKey||!from)throw new Error("SENDGRID_NOT_CONFIGURED");const recipient=await recipientFor(document);const type=String(document.get("type"));const projectId=String(document.get("projectId")??"");const subject=type==="crew_invitation"?"Photography assignment invitation":type==="booking_confirmation"?"Your photography project is booked":"A quick review request";const body=type==="crew_invitation"?"A photography assignment is ready for your review in StudioHub.":type==="booking_confirmation"?"Your booking requirements passed and your client portal is active.":`Thank you for working with us. Share your experience: ${String(document.get("destinationUrl")??"")}`;const response=await fetch("https://api.sendgrid.com/v3/mail/send",{method:"POST",headers:{authorization:`Bearer ${apiKey}`,"content-type":"application/json"},body:JSON.stringify({personalizations:[{to:[{email:recipient}],custom_args:{studioHubJobId:document.id,projectId}}],from:{email:from},subject,content:[{type:"text/plain",value:body}]})});if(!response.ok)throw new Error(`SENDGRID_SEND_FAILED:${response.status}`);const messageId=response.headers.get("x-message-id")??`sendgrid_${document.id}`;if(type==="review_request"&&document.get("reviewRequestId"))await getFirestore().doc(`reviewRequests/${String(document.get("reviewRequestId"))}`).update({status:"sent",sentAt:new Date().toISOString(),messageId,updatedAt:new Date().toISOString(),updatedBy:"email-worker"});return{messageId}}

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
    "DOCUSIGN_CLIENT_SECRET",
    "QUICKBOOKS_CLIENT_SECRET",
    "SENTRY_DSN",
  ],
},async()=>{for(const document of await due("providerJobs"))await finish(document,()=>providerJob(document));for(const document of await due("emailJobs"))await finish(document,()=>sendEmail(document));for(const document of await due("aiJobs"))await finish(document,()=>runAiJob(document));for(const document of await due("pdfJobs"))await finish(document,()=>runPdfJob(document))});
