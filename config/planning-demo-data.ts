export const questionnaires = [
  {project:"Maya & Theo Johnson",template:"Wedding Planning v4",progress:82,due:"Jul 28",status:"In progress",missing:"Family photo list"},
  {project:"Sofia & Miles Carter",template:"Wedding Planning v4",progress:100,due:"Complete",status:"Submitted",missing:"None"},
  {project:"Northstar Annual Summit",template:"Corporate Brief v2",progress:64,due:"Aug 8",status:"In progress",missing:"Final shot list"},
] as const;
export const vendors = [
  {company:"The Foundry",contact:"Elena Cruz",type:"Venue",projects:4,action:"COI review"},
  {company:"Gather & Grace",contact:"Morgan Bell",type:"Planner",projects:3,action:"Timeline confirmation"},
  {company:"Harborlight Risk",contact:"Jamie Chen",type:"Insurance agent",projects:5,action:"Correction requested"},
  {company:"Silverline Films",contact:"Dev Patel",type:"Videographer",projects:2,action:"Schedule shared"},
] as const;
export const coiCases = [
  {project:"Maya & Theo Johnson",venue:"The Foundry",status:"Under review",due:"Jul 28",issues:["Additional insured wording differs","Primary/noncontributory confirmed"],decision:"Human review required"},
  {project:"Sofia & Miles Carter",venue:"Cedar Lakes Estate",status:"Approved",due:"Complete",issues:[],decision:"Approved by Conor"},
  {project:"Northstar Annual Summit",venue:"Pier 60",status:"Correction required",due:"Jul 27",issues:["General liability limit below requirement"],decision:"Correction sent"},
] as const;
export const scheduleItems = [
  {time:"11:30 AM",end:"12:15 PM",title:"Details & establishing photographs",location:"The Boro Hotel",crew:"Conor",visibility:"Studio + crew"},
  {time:"12:15 PM",end:"1:30 PM",title:"Getting ready coverage",location:"The Boro Hotel",crew:"Conor · Jordan",visibility:"Shared"},
  {time:"1:45 PM",end:"2:15 PM",title:"First look",location:"Gantry Plaza",crew:"Conor · Jordan",visibility:"Shared"},
  {time:"2:15 PM",end:"3:10 PM",title:"Wedding party & family portraits",location:"Gantry Plaza",crew:"Conor · Jordan",visibility:"Shared"},
  {time:"4:30 PM",end:"5:10 PM",title:"Ceremony",location:"The Foundry",crew:"Conor · Jordan",visibility:"Shared"},
  {time:"5:15 PM",end:"6:10 PM",title:"Cocktail hour",location:"The Foundry",crew:"Jordan",visibility:"Shared"},
  {time:"6:15 PM",end:"9:30 PM",title:"Reception coverage",location:"The Foundry",crew:"Conor · Jordan",visibility:"Shared"},
] as const;
