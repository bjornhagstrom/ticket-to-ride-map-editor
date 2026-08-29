"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, BusFront, Check, ChevronDown, CircleDot, Download, Link2, MapPinPlus, Minus, MousePointer2, Plus, Printer, Redo2, RotateCcw, Trash2, Undo2, Upload } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { colorLabels, H, initialMap, type MapData, type Point, type Route, type RouteType, routeColors, routeTypeMeta, STORAGE_KEY, type StopType, stopTypeMeta, W } from "./map-data";

type Tool = "select" | "stop" | "route";
const cloneMap = (data: MapData): MapData => JSON.parse(JSON.stringify(data));
const stopById = (data: MapData, id: string) => data.stops.find((stop) => stop.id === id);
const pointsFor = (data: MapData, route: Route): Point[] => {
  const a = stopById(data, route.a); const b = stopById(data, route.b);
  return a && b ? [a, ...(route.points ?? []), b] : [];
};
const pathFromPoints = (points:Point[]) => points.map((point,index)=>`${index?"L":"M"}${point.x},${point.y}`).join(" ");
function parallelPoints(data:MapData,route:Route):Point[]{
  const siblings=data.routes.filter(item=>(item.a===route.a&&item.b===route.b)||(item.a===route.b&&item.b===route.a));
  const points=pointsFor(data,route);if(siblings.length<2||points.length<2)return points;
  const index=siblings.findIndex(item=>item.id===route.id);const direction=route.a.localeCompare(route.b)<=0?1:-1;const offset=(index-(siblings.length-1)/2)*26*direction;
  const shifted=(point:Point,from:Point,to:Point,distance:number)=>{const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy)||1;return{x:point.x-dy/length*distance,y:point.y+dx/length*distance};};
  if(points.length===2){const [a,b]=points;const nearA={x:a.x+(b.x-a.x)*.16,y:a.y+(b.y-a.y)*.16};const nearB={x:a.x+(b.x-a.x)*.84,y:a.y+(b.y-a.y)*.84};return[a,shifted(nearA,a,b,offset),shifted(nearB,a,b,offset),b];}
  return points.map((point,i)=>i===0||i===points.length-1?point:shifted(point,points[i-1],points[i+1],offset));
}
const orient = (a: Point, b: Point, c: Point) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const intersects = (a:Point,b:Point,c:Point,d:Point) => {
  const o1=orient(a,b,c), o2=orient(a,b,d), o3=orient(c,d,a), o4=orient(c,d,b);
  return ((o1>0&&o2<0)||(o1<0&&o2>0)) && ((o3>0&&o4<0)||(o3<0&&o4>0));
};
function crossingPairs(data: MapData) {
  const routes=data.routes.filter((route)=>route.type!=="rail"&&route.type!=="trail"); const found:Array<[Route,Route]>=[];
  for(let i=0;i<routes.length;i++) for(let j=i+1;j<routes.length;j++) {
    const a=routes[i],b=routes[j]; if([a.a,a.b].some(id=>id===b.a||id===b.b)) continue;
    const ap=pointsFor(data,a),bp=pointsFor(data,b); let hit=false;
    for(let x=0;x<ap.length-1&&!hit;x++) for(let y=0;y<bp.length-1;y++) if(intersects(ap[x],ap[x+1],bp[y],bp[y+1])){hit=true;break;}
    if(hit)found.push([a,b]);
  }
  return found;
}
function pointAlong(points:Point[], fraction:number):Point&{angle:number}{
  const lengths=points.slice(1).map((q,i)=>Math.hypot(q.x-points[i].x,q.y-points[i].y));const total=lengths.reduce((a,b)=>a+b,0);let target=total*fraction;
  for(let i=0;i<lengths.length;i++){if(target<=lengths[i]){const t=lengths[i]?target/lengths[i]:0;return{x:points[i].x+(points[i+1].x-points[i].x)*t,y:points[i].y+(points[i+1].y-points[i].y)*t,angle:Math.atan2(points[i+1].y-points[i].y,points[i+1].x-points[i].x)*180/Math.PI};}target-=lengths[i];}
  return{...(points.at(-1)??{x:0,y:0}),angle:0};
}
function canvasPoint(event:React.PointerEvent<SVGSVGElement>):Point {
  const rect=event.currentTarget.getBoundingClientRect();
  return{x:Math.max(18,Math.min(W-18,(event.clientX-rect.left)*W/rect.width)),y:Math.max(18,Math.min(H-18,(event.clientY-rect.top)*H/rect.height))};
}

export function MapEditor(){
  const [data,setData]=useState<MapData>(initialMap); const [ready,setReady]=useState(false); const [saved,setSaved]=useState(true);
  const [tool,setTool]=useState<Tool>("select"); const [stopType,setStopType]=useState<StopType>("city"); const [routeType,setRouteType]=useState<RouteType>("city"); const [routeColor,setRouteColor]=useState("neutral");
  const [routeStart,setRouteStart]=useState<string|null>(null); const [selectedStop,setSelectedStop]=useState<string|null>(null); const [selectedRoute,setSelectedRoute]=useState<string|null>(null);
  const [past,setPast]=useState<MapData[]>([]); const [future,setFuture]=useState<MapData[]>([]); const [danger,setDanger]=useState<"reset"|"delete"|null>(null);
  const dragRef=useRef<string|null>(null); const dragWaypointRef=useRef<{routeId:string;index:number}|null>(null); const fileRef=useRef<HTMLInputElement>(null);
  useEffect(()=>{queueMicrotask(()=>{try{const stored=localStorage.getItem(STORAGE_KEY);if(stored)setData(JSON.parse(stored));}catch{}setReady(true);});},[]);
  useEffect(()=>{if(!ready)return;localStorage.setItem(STORAGE_KEY,JSON.stringify(data));const timer=window.setTimeout(()=>setSaved(true),0);return()=>window.clearTimeout(timer);},[data,ready]);
  const crossings=useMemo(()=>crossingPairs(data),[data]); const selectedS=data.stops.find(s=>s.id===selectedStop); const selectedR=data.routes.find(r=>r.id===selectedRoute);
  const change=(fn:(draft:MapData)=>MapData)=>setData(previous=>{setPast(history=>[...history,cloneMap(previous)].slice(-40));setFuture([]);setSaved(false);return fn(cloneMap(previous));});
  const undo=()=>{const previous=past.at(-1);if(!previous)return;setFuture(items=>[cloneMap(data),...items]);setData(previous);setPast(items=>items.slice(0,-1));};
  const redo=()=>{const next=future[0];if(!next)return;setPast(items=>[...items,cloneMap(data)]);setData(next);setFuture(items=>items.slice(1));};
  const chooseStop=(id:string)=>{
    if(tool==="route"){
      if(!routeStart){setRouteStart(id);return;} if(routeStart===id){setRouteStart(null);return;}
      change(draft=>{draft.routes.push({id:`r-${Date.now()}`,a:routeStart,b:id,length:2,type:routeType,color:routeColor});return draft;}); setRouteStart(null); return;
    }
    setSelectedStop(id);setSelectedRoute(null);
  };
  const onCanvasDown=(event:React.PointerEvent<SVGSVGElement>)=>{
    const target=event.target as SVGElement; if(target!==event.currentTarget&&!target.classList.contains("map-bg"))return;
    if(tool!=="stop"){setSelectedStop(null);setSelectedRoute(null);return;}
    const point=canvasPoint(event); change(draft=>{draft.stops.push({id:`s-${Date.now()}`,name:"Ny hållplats",type:stopType,...point});return draft;});
  };
  const onCanvasMove=(event:React.PointerEvent<SVGSVGElement>)=>{const point=canvasPoint(event);if(dragWaypointRef.current){const target=dragWaypointRef.current;setData(current=>({...current,routes:current.routes.map(route=>route.id===target.routeId?{...route,points:(route.points??[]).map((item,index)=>index===target.index?point:item)}:route)}));setSaved(false);return;}if(!dragRef.current)return;setData(current=>({...current,stops:current.stops.map(stop=>stop.id===dragRef.current?{...stop,...point}:stop)}));setSaved(false);};
  const deleteSelected=()=>{change(draft=>{if(selectedRoute)draft.routes=draft.routes.filter(route=>route.id!==selectedRoute);if(selectedStop){draft.stops=draft.stops.filter(stop=>stop.id!==selectedStop);draft.routes=draft.routes.filter(route=>route.a!==selectedStop&&route.b!==selectedStop);}return draft;});setSelectedRoute(null);setSelectedStop(null);setDanger(null);};
  const exportMap=()=>{const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=`${data.name.replace(/[^a-z0-9åäö]+/gi,"-").toLowerCase()}.json`;link.click();URL.revokeObjectURL(url);};
  const importMap=(file?:File)=>{if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const incoming=JSON.parse(String(reader.result));if(!Array.isArray(incoming.stops)||!Array.isArray(incoming.routes))throw new Error();change(()=>incoming);setSelectedRoute(null);setSelectedStop(null);}catch{window.alert("Filen kunde inte läsas som en kartvariant.");}};reader.readAsText(file);};

  return <main className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark"><BusFront/></span><div><p>Ticket to Ride · Örebro</p><h1>Kartverkstad</h1></div></div>
      <div className="map-title"><Label htmlFor="map-name" className="sr-only">Variantens namn</Label><Input id="map-name" value={data.name} onChange={event=>change(draft=>({...draft,name:event.target.value}))}/><span className="save-state"><Check/>{saved?"Sparad lokalt":"Sparar…"}</span></div>
      <div className="header-actions"><Button variant="ghost" size="icon" aria-label="Ångra" disabled={!past.length} onClick={undo}><Undo2/></Button><Button variant="ghost" size="icon" aria-label="Gör om" disabled={!future.length} onClick={redo}><Redo2/></Button><Button variant="outline" size="sm" onClick={()=>fileRef.current?.click()}><Upload/>Importera</Button><input ref={fileRef} hidden type="file" accept="application/json" onChange={event=>importMap(event.target.files?.[0])}/><Button variant="outline" size="sm" onClick={()=>window.print()}><Printer/>Skriv ut 2×A4</Button><Button size="sm" onClick={exportMap}><Download/>Exportera</Button></div>
    </header>
    <div className="workspace">
      <aside className="tools-panel panel">
        <div className="panel-heading"><span>Verktyg</span><small>Arbeta direkt på kartan</small></div>
        <div className="tool-list">
          <ToolButton active={tool==="select"} icon={<MousePointer2/>} title="Markera & flytta" note="Dra hållplatser, redigera objekt" onClick={()=>{setTool("select");setRouteStart(null);}}/>
          <ToolButton active={tool==="stop"} icon={<MapPinPlus/>} title="Ny hållplats" note="Klicka på kartan för att placera" onClick={()=>{setTool("stop");setRouteStart(null);}}/>
          {tool==="stop"&&<div className="tool-options"><Label>Typ av hållplats</Label><NativeSelect value={stopType} onChange={event=>setStopType(event.target.value as StopType)}>{Object.entries(stopTypeMeta).map(([key,meta])=><NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>}
          <ToolButton active={tool==="route"} icon={<Link2/>} title="Ny linje" note={routeStart?`Start: ${stopById(data,routeStart)?.name} · välj slut`:"Klicka på två hållplatser"} onClick={()=>{setTool("route");setRouteStart(null);}}/>
          {tool==="route"&&<div className="tool-options grid-two"><div><Label>Linjetyp</Label><NativeSelect value={routeType} onChange={event=>setRouteType(event.target.value as RouteType)}>{Object.entries(routeTypeMeta).map(([key,meta])=><NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div><div><Label>Färg</Label><NativeSelect value={routeColor} onChange={event=>setRouteColor(event.target.value)}>{Object.keys(routeColors).map(key=><NativeSelectOption key={key} value={key}>{colorLabels[key]}</NativeSelectOption>)}</NativeSelect></div></div>}
        </div>
        <div className={cn("crossing-card",crossings.length&&"has-warning")}><div className="crossing-icon">{crossings.length?<AlertTriangle/>:<Check/>}</div><div><strong>{crossings.length?`${crossings.length} korsning${crossings.length===1?"":"ar"}`:"Inga korsningar"}</strong><p>{crossings.length?"mellan byggbara linjer":"Ruttnätet är geometriskt rent"}</p></div></div>
        <div className="legend"><p className="eyebrow">Hållplatstyper</p>{Object.entries(stopTypeMeta).map(([key,meta])=><div key={key}><i style={{background:meta.fill,borderColor:meta.stroke}}/>{meta.label}</div>)}</div>
        <Button variant="ghost" className="reset-button" onClick={()=>setDanger("reset")}><RotateCcw/>Återställ till v0.2</Button>
      </aside>
      <section className="map-wrap">
        <div className="map-status"><Badge variant="secondary">{data.stops.length} hållplatser</Badge><Badge variant="secondary">{data.routes.length} linjer</Badge><span>Dra hållplatser för att prova nya nät</span></div>
        <svg className={cn("map-canvas",`tool-${tool}`)} viewBox={`0 0 ${W} ${H}`} onPointerDown={onCanvasDown} onPointerMove={onCanvasMove} onPointerUp={()=>{dragRef.current=null;dragWaypointRef.current=null;}} onPointerLeave={()=>{dragRef.current=null;dragWaypointRef.current=null;}}>
          <MapArtwork data={data} selectedRoute={selectedRoute} selectedStop={selectedStop} routeStart={routeStart} onRoute={id=>{setSelectedRoute(id);setSelectedStop(null);setTool("select");}} onStop={id=>{chooseStop(id);if(tool==="select")dragRef.current=id;}} onWaypoint={(routeId,index)=>{dragWaypointRef.current={routeId,index};}}/>
        </svg>
      </section>
      <aside className="properties panel">
        <div className="panel-heading"><span>Egenskaper</span><small>{selectedR?"Linje markerad":selectedS?"Hållplats markerad":"Markera något på kartan"}</small></div>
        {!selectedR&&!selectedS&&<div className="empty-state"><CircleDot/><p>Här kan du byta namn, typ, färg och antal bussplatser.</p></div>}
        {selectedS&&<div className="property-form"><div><Label htmlFor="stop-name">Namn</Label><Input id="stop-name" value={selectedS.name} onChange={event=>change(draft=>{const stop=stopById(draft,selectedS.id);if(stop)stop.name=event.target.value;return draft;})}/></div><div><Label>Hållplatstyp</Label><NativeSelect value={selectedS.type} onChange={event=>change(draft=>{const stop=stopById(draft,selectedS.id);if(stop)stop.type=event.target.value as StopType;return draft;})}>{Object.entries(stopTypeMeta).map(([key,meta])=><NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div><Button variant="destructive" onClick={()=>setDanger("delete")}><Trash2/>Ta bort hållplats</Button><p className="delete-note">Anslutna linjer tas också bort.</p></div>}
        {selectedR&&<div className="property-form"><div className="route-names"><span>{stopById(data,selectedR.a)?.name}</span><ChevronDown/><span>{stopById(data,selectedR.b)?.name}</span></div><div><Label>Linjetyp</Label><NativeSelect value={selectedR.type} onChange={event=>change(draft=>{const route=draft.routes.find(item=>item.id===selectedR.id);if(route)route.type=event.target.value as RouteType;return draft;})}>{Object.entries(routeTypeMeta).map(([key,meta])=><NativeSelectOption key={key} value={key}>{meta.label}</NativeSelectOption>)}</NativeSelect></div>{selectedR.type!=="rail"&&selectedR.type!=="trail"&&<><div><Label>Färg</Label><NativeSelect value={selectedR.color} onChange={event=>change(draft=>{const route=draft.routes.find(item=>item.id===selectedR.id);if(route)route.color=event.target.value;return draft;})}>{Object.keys(routeColors).map(key=><NativeSelectOption key={key} value={key}>{colorLabels[key]}</NativeSelectOption>)}</NativeSelect></div><div><Label>Platser för bussar</Label><div className="length-stepper"><Button variant="outline" size="icon" aria-label="Minska" disabled={selectedR.length<=1} onClick={()=>change(draft=>{const route=draft.routes.find(item=>item.id===selectedR.id);if(route)route.length=Math.max(1,route.length-1);return draft;})}><Minus/></Button><strong>{selectedR.length}</strong><Button variant="outline" size="icon" aria-label="Öka" disabled={selectedR.length>=8} onClick={()=>change(draft=>{const route=draft.routes.find(item=>item.id===selectedR.id);if(route)route.length=Math.min(8,route.length+1);return draft;})}><Plus/></Button></div><p className="helper">Ändringen syns direkt på linjen.</p></div></>}<Button variant="destructive" onClick={()=>setDanger("delete")}><Trash2/>Ta bort linje</Button></div>}
      </aside>
    </div>
    <AlertDialog open={danger!==null} onOpenChange={open=>!open&&setDanger(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{danger==="reset"?"Återställa arbetskartan?":"Ta bort markerat objekt?"}</AlertDialogTitle><AlertDialogDescription>{danger==="reset"?"Din lokalt sparade variant ersätts med Örebro v0.2. Exportera först om du vill behålla den.":selectedStop?"Hållplatsen och alla anslutna linjer tas bort.":"Linjen tas bort från kartan."}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Avbryt</AlertDialogCancel><AlertDialogAction onClick={()=>{if(danger==="reset"){change(()=>cloneMap(initialMap));setSelectedRoute(null);setSelectedStop(null);setDanger(null);}else deleteSelected();}}>Fortsätt</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <div className="print-pages" aria-hidden="true">
      <section className="print-page"><div className="print-caption"><strong>{data.name}</strong><span>Vänster del · sammanfoga vid mittmarkeringarna</span></div><svg viewBox={`0 0 ${W/2+12} ${H}`}><MapArtwork data={data} print/></svg></section>
      <section className="print-page"><div className="print-caption"><strong>{data.name}</strong><span>Höger del · sammanfoga vid mittmarkeringarna</span></div><svg viewBox={`${W/2-12} 0 ${W/2+12} ${H}`}><MapArtwork data={data} print/></svg></section>
    </div>
  </main>;
}

function MapArtwork({data,selectedRoute,selectedStop,routeStart,onRoute,onStop,onWaypoint,print=false}:{data:MapData;selectedRoute?:string|null;selectedStop?:string|null;routeStart?:string|null;onRoute?:(id:string)=>void;onStop?:(id:string)=>void;onWaypoint?:(routeId:string,index:number)=>void;print?:boolean}){
  return <>
    <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0L0 0 0 24" fill="none" stroke="#6b675f" strokeOpacity=".11"/></pattern><filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity=".18"/></filter></defs>
    <rect className="map-bg" width={W} height={H} fill="#f7f1e5"/><rect className="map-bg" width={W} height={H} fill="url(#grid)"/><path className="lake" d="M815 241C900 200 1046 220 1098 270L1098 590C1040 575 1012 518 963 494C916 470 897 408 840 366C805 340 790 287 815 241Z"/><text x="985" y="285" className="water-label">HJÄLMAREN</text><path d="M230 78C286 110 318 185 330 286" className="hill-line"/><text x="220" y="92" className="terrain-label">KILSBERGEN</text>
    {data.routes.map(route=>{const meta=routeTypeMeta[route.type];const points=parallelPoints(data,route);const path=pathFromPoints(points);const infrastructure=route.type==="rail"||route.type==="trail";const routeColor=route.type==="city"||route.type==="region"?(route.color==="neutral"?"#736d64":routeColors[route.color]):meta.stroke;return <g key={route.id} className={cn("route-group",route.id===selectedRoute&&"selected")} onPointerDown={onRoute?event=>{event.stopPropagation();onRoute(route.id);}:undefined}>
      <path d={path} className="route-hit"/><path d={path} className={cn("route-guide",infrastructure&&"infrastructure")} fill="none" stroke={routeColor} strokeWidth={infrastructure?(route.type==="rail"?4:5):3} strokeDasharray={meta.dash} strokeLinecap="round" strokeLinejoin="round"/>
      {!infrastructure&&Array.from({length:route.length},(_,index)=>{const position=pointAlong(points,(index+.5)/route.length);return <g key={index} className="wagon-slot" transform={`translate(${position.x},${position.y}) rotate(${position.angle})`} filter={print?undefined:"url(#shadow)"}><rect className="wagon-slot-outline" x={-13} y={-7} width="26" height="14" rx="4"/><rect x={-12} y={-6} width="24" height="12" rx="3" fill="#fffaf0" stroke={routeColor} strokeWidth="3"/></g>;})}
    </g>;})}
    {data.stops.map(stop=>{const meta=stopTypeMeta[stop.type];const active=stop.id===selectedStop||stop.id===routeStart;return <g key={stop.id} className={cn("stop",active&&"active")} transform={`translate(${stop.x},${stop.y})`} onPointerDown={onStop?event=>{event.stopPropagation();onStop(stop.id);}:undefined}><circle r={active?12:9} fill={meta.fill} stroke={meta.stroke} strokeWidth={active?4:3}/>{stop.type==="rail"&&<rect x={-4} y={-4} width="8" height="8" fill={meta.stroke}/>}<text x={stop.x>900?-14:14} y={stop.y>620?-13:-12} textAnchor={stop.x>900?"end":"start"}>{stop.name}</text></g>;})}
    {!print&&selectedRoute&&data.routes.find(route=>route.id===selectedRoute)?.points?.map((point,index)=><g key={index} className="waypoint-handle" transform={`translate(${point.x},${point.y})`} onPointerDown={event=>{event.stopPropagation();onWaypoint?.(selectedRoute,index);}}><circle className="waypoint-hit" r="19"/><rect x="-8" y="-8" width="16" height="16" rx="3" transform="rotate(45)"/><circle r="3"/></g>)}
    {print&&<g className="join-marks"><path d={`M${W/2} 0v18M${W/2} ${H-18}v18`}/><path d={`M${W/2-8} 9h16M${W/2-8} ${H-9}h16`}/></g>}
  </>;
}

function ToolButton({active,icon,title,note,onClick}:{active:boolean;icon:React.ReactNode;title:string;note:string;onClick:()=>void}){return <button className={cn("tool-button",active&&"active")} onClick={onClick}><span>{icon}</span><div><strong>{title}</strong><small>{note}</small></div></button>;}
