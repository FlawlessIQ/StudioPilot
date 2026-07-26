"use client";
import { useState } from "react";
import { Copy, GripVertical, MapPin, Users } from "lucide-react";
import { scheduleItems as initialItems } from "@/config/planning-demo-data";

type EditorItem = { time:string; end:string; title:string; location:string; crew:string; visibility:string };
export function ScheduleEditor(){
  const [items,setItems]=useState<EditorItem[]>([...initialItems]);
  const [dragging,setDragging]=useState<number|null>(null);
  const move=(from:number,to:number)=>{if(from===to)return;setItems(current=>{const next=[...current];const [picked]=next.splice(from,1);if(picked)next.splice(to,0,picked);return next})};
  const duplicate=(index:number)=>setItems(current=>{const source=current[index];if(!source)return current;const next=[...current];next.splice(index+1,0,{...source,title:`${source.title} (copy)`});return next});
  return <><section className="panel timeline-builder" aria-label="Schedule editor">{items.map((i,index)=><article draggable onDragStart={()=>setDragging(index)} onDragOver={event=>event.preventDefault()} onDrop={()=>{if(dragging!==null)move(dragging,index);setDragging(null)}} key={`${i.title}-${index}`}><span className="timeline-time"><strong>{i.time}</strong><small>{i.end}</small></span><i/><span><strong>{i.title}</strong><small><MapPin size={13}/>{i.location}</small></span><span><Users size={14}/>{i.crew}</span><small>{i.visibility}</small><span className="timeline-actions"><button type="button" onClick={()=>duplicate(index)} aria-label={`Duplicate ${i.title}`}><Copy size={14}/></button><GripVertical size={16} aria-label="Drag to reorder"/></span></article>)}</section><p className="source-note">Draft interactions stay local in preview. Publishing through the Planning Functions endpoint validates conflicts and creates a new immutable version.</p></>
}
