export const planCards=[
  {key:"solo",name:"Solo",monthly:"$59",yearly:"$590",users:"1 internal user",ai:"500 AI actions",highlight:false},
  {key:"studio",name:"Studio",monthly:"$129",yearly:"$1,290",users:"5 internal users",ai:"2,500 AI actions",highlight:true},
  {key:"multi_brand",name:"Multi-Brand",monthly:"$249",yearly:"$2,490",users:"15 internal users",ai:"7,500 AI actions",highlight:false},
] as const;
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
