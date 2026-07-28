export const systemHealth=[
  {component:"QuickBooks Online",status:"Healthy",latency:"142 ms",failures:0},
  {component:"Docusign",status:"Healthy",latency:"181 ms",failures:0},
  {component:"Dropbox",status:"Healthy",latency:"96 ms",failures:0},
  {component:"SendGrid",status:"Degraded",latency:"890 ms",failures:2},
] as const;
export const failedJobs=[
  {id:"job-SG-1842",tenant:"Alder & Muse",provider:"SendGrid",action:"Review request",attempts:5,status:"Dead letter"},
  {id:"job-QB-918",tenant:"Fieldhouse Sports",provider:"QuickBooks",action:"Invoice reconcile",attempts:3,status:"Retry scheduled"},
  {id:"job-DB-441",tenant:"Morrow Wedding Co.",provider:"Dropbox",action:"Schedule upload",attempts:2,status:"Retry scheduled"},
] as const;
