export const postProductionProjects = [
  {id:"wedding-delivered",project:"Nora & James Ellis",type:"Wedding",event:"Jun 20",step:"Client downloaded",progress:88,target:"Delivered Jul 18",owner:"Conor",risk:"Review workflow open"},
  {id:"corporate",project:"Northstar Annual Summit",type:"Corporate",event:"Sep 4",step:"Editing started",progress:38,target:"Sep 18",owner:"Reese",risk:"On track"},
  {id:"wedding-risk",project:"Avery & Sam",type:"Wedding",event:"Aug 8",step:"Backup complete",progress:14,target:"Sep 19",owner:"Jamie",risk:"Cull due tomorrow"},
] as const;
export const deliveryRecords = [
  {project:"Nora & James Ellis",provider:"Manual gallery",delivered:"Jul 18",status:"Downloaded",expires:"Jul 18, 2027"},
  {project:"Hearthwell Brand Library",provider:"Pixieset-ready adapter",delivered:"Jul 22",status:"Viewed",expires:"Oct 22"},
  {project:"Westbridge Leadership Team",provider:"Manual gallery",delivered:"Jul 24",status:"Sent",expires:"Aug 24"},
] as const;
export const reviewRequests = [
  {project:"Nora & James Ellis",destination:"Google",status:"Clicked",sent:"Jul 21",next:"Reminder Jul 28",fact:"Click recorded; posting unconfirmed"},
  {project:"Hearthwell Brand Library",destination:"Google",status:"Delivered",sent:"Jul 25",next:"Reminder Aug 1",fact:"Delivery evidence only"},
  {project:"Sofia & Miles Carter",destination:"WeddingWire",status:"Scheduled",sent:"Aug 25",next:"3 days after delivery",fact:"Stops after confirmation"},
] as const;
export const reportMetrics = [
  {label:"Booking conversion",value:"42%",detail:"+4.8% vs prior period"},
  {label:"Average booking value",value:"$6,840",detail:"QuickBooks-synced references"},
  {label:"Event readiness",value:"86%",detail:"For events in selected period"},
  {label:"Automation reliability",value:"98.7%",detail:"1,284 successful runs"},
] as const;
export const reportBars = [
  {label:"Venue referral",value:84,count:18},
  {label:"Client referral",value:66,count:14},
  {label:"Organic search",value:48,count:10},
  {label:"Planner referral",value:38,count:8},
] as const;
