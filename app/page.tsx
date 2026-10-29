'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { withBrowserSession } from "@/lib/constructor-browser-session";
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Plus, Search, Pencil, Trash2, X, CheckCircle2, AlertCircle, ListTodo, LockKeyhole, RotateCcw, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import branding from '@/branding.json';
import Image from 'next/image';
import { statuses,priorities,emptyDraft,validateDraft,type Draft,type Task,type Operation } from '@/lib/contracts';
declare global { interface Window { constructorTrack?: (event:string)=>void } }
type Submission={source?:'row';op:Operation;draft:Draft;target:string;known?:Task};
type Feedback={kind:'pending'|'success'|'uncertain'|'conflict'|'error';text?:string;submission?:Submission;current?:Task};
let startup:Promise<boolean>|null=null;
const start=()=>startup??=(withBrowserSession(()=>fetch('/api/session',{method:'POST'}).then(r=>r.ok)).finally(()=>{startup=null}));
const draftOf=(t:Draft):Draft=>({title:t.title,status:t.status,priority:t.priority});
const same=(a:Draft,b:Draft)=>JSON.stringify(a)===JSON.stringify(b);
async function readJSON(response:Response){const data=await response.json();return {response,data}}
const operationUrl=(o:Operation)=>o.action==='create'?'/api/tasks':`/api/tasks/${o.id}/${o.action}`;
const operationBody=(o:Operation)=>{const {action:_action,id:_id,...body}=o;void _action;void _id;return body};
function ComparedTitle({value,baseline}:{value:string;baseline:string}){
 if(value===baseline)return <>{value}</>;
 let start=0,end=0;
 while(start<Math.min(value.length,baseline.length)&&value[start]===baseline[start])start++;
 while(end<Math.min(value.length,baseline.length)-start&&value[value.length-1-end]===baseline[baseline.length-1-end])end++;
 return <>{value.slice(0,start)}<mark className="conflict-difference">{value.slice(start,value.length-end)}</mark>{end?value.slice(-end):''}</>;
}
function ConflictComparison({draft,known,current}:{draft:Draft;known?:Task;current:Task}){
 const snapshots: [string,Draft][]=[['Tu borrador',draft],...(known?[['Última confirmación',known] as [string,Draft]]:[]),['Versión actual',current]];
 const sharedTitle=snapshots.every(([,value])=>value.title===draft.title);
 const sharedStatus=snapshots.every(([,value])=>value.status===draft.status);
 const sharedPriority=snapshots.every(([,value])=>value.priority===draft.priority);
 return <>
 {(sharedTitle||sharedStatus||sharedPriority)&&<div className="conflict-shared">
 <p className="font-medium">{known?'En las tres versiones:':'En ambas versiones:'}</p>
 {sharedTitle&&<p className="conflict-value" data-conflict-field="title">{draft.title}</p>}
 {(sharedStatus||sharedPriority)&&<p className="conflict-meta">{sharedStatus&&<>Estado: <span data-conflict-field="status">{draft.status}</span></>}{sharedStatus&&sharedPriority&&' · '}{sharedPriority&&<>Prioridad: <span data-conflict-field="priority">{draft.priority}</span></>}</p>}
 </div>}
 <dl className="conflict-snapshots" data-enum-only={sharedTitle && sharedStatus!==sharedPriority}>{snapshots.map(([label,value])=><div key={label}><dt className="font-semibold">{label}</dt><dd>
 {!sharedTitle&&<span className="conflict-value" data-conflict-field="title"><ComparedTitle value={value.title} baseline={known?.title||''}/></span>}
 <div className="conflict-enums">{!sharedStatus&&<span className="conflict-value">Estado: <span data-conflict-field="status" className={value.status!==known?.status?'conflict-difference':''}>{value.status}</span></span>}{!sharedStatus&&!sharedPriority&&' '}
 {!sharedPriority&&<span className="conflict-value">Prioridad: <span data-conflict-field="priority" className={value.priority!==known?.priority?'conflict-difference':''}>{value.priority}</span></span>}</div>
 {sharedTitle&&sharedStatus&&sharedPriority&&<span className="conflict-meta">Mismos valores compartidos.</span>}
 </dd></div>)}</dl>
 </>;
}
export default function Home(){
 const [tasks,setTasks]=useState<Task[]>([]),[ready,setReady]=useState(false),[loading,setLoading]=useState(true),[loadError,setLoadError]=useState('');
 const [q,setQ]=useState(''),[filter,setFilter]=useState('Todos');
 const [editor,setEditor]=useState<{id:string;known?:Task}|null>(null),[draft,setDraft]=useState<Draft>(emptyDraft),[errors,setErrors]=useState<Record<string,string>>({});
 const [feedback,setFeedback]=useState<Record<string,Feedback>>({}),[unresolved,setUnresolved]=useState<Submission[]>([]),[allowNew,setAllowNew]=useState(false);
 const [deleting,setDeleting]=useState<Task|null>(null);
 const titleRef=useRef<HTMLTextAreaElement>(null),newRef=useRef<HTMLButtonElement>(null),cancelRef=useRef<HTMLButtonElement>(null),deleteTrigger=useRef<HTMLElement|null>(null),afterDelete=useRef<string|null>(null);
 const requestNumber=useRef(0),abort=useRef<AbortController|null>(null),draftRef=useRef(draft),editorRef=useRef(editor),busyRef=useRef(new Set<string>());
 const workbenchRef=useRef<HTMLDivElement>(null);
 const unresolvedDrafts=useRef(new Map<string,{editor:NonNullable<typeof editor>;draft:Draft}>());
 useLayoutEffect(()=>{
  const title=titleRef.current;if(!title)return;
  const resize=()=>{title.style.height='0px';title.style.height=`${Math.max(68,title.scrollHeight+2)}px`};
  resize();window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
 },[draft.title,editor?.id]);
 useLayoutEffect(()=>{
  const surface=workbenchRef.current;if(!surface||!editor)return;
  const row=surface.querySelector<HTMLElement>('[data-selected="true"]');
  const heading=surface.querySelector<HTMLElement>('[data-editor-heading]');
  const aside=surface.querySelector('aside');
  if(!row||!heading||!aside)return;
  const connect=()=>{
   const box=surface.getBoundingClientRect(),r=row.getBoundingClientRect(),h=heading.getBoundingClientRect(),a=aside.getBoundingClientRect();
   surface.style.setProperty('--guide-x',`${window.innerWidth>=1000?a.left-box.left-2:0}px`);
   surface.style.setProperty('--guide-top',`${h.top+h.height/2-box.top-1}px`);
   surface.style.setProperty('--guide-height',`${Math.max(0,r.top+r.height/2-h.top-h.height/2)}px`);
  };
  connect();const observer=new ResizeObserver(connect);[surface,row,heading,aside].forEach(el=>observer.observe(el));
  return()=>observer.disconnect();
 },[editor,tasks]);
 useLayoutEffect(()=>{draftRef.current=draft;editorRef.current=editor},[draft,editor]);
 const load=useCallback(async()=>{
 const n=++requestNumber.current;abort.current?.abort();const controller=new AbortController();abort.current=controller;setLoading(true);
 try{const {response,data}=await readJSON(await fetch(`/api/tasks?q=${encodeURIComponent(q)}&status=${encodeURIComponent(filter)}`,{signal:controller.signal}));if(n!==requestNumber.current)return;if(!response.ok)throw Error(data.error);setTasks(data.tasks);setLoadError('')}
 catch(e){if(n===requestNumber.current&&!(e instanceof DOMException&&e.name==='AbortError'))setLoadError('No se pudo actualizar la lista. Conservamos los últimos resultados.')}
 finally{if(n===requestNumber.current)setLoading(false)}
 },[q,filter]);
 const currentLoad=useRef(load);
 useLayoutEffect(()=>{currentLoad.current=load},[load]);
 const boot=useCallback(async()=>{setLoading(true);try{if(!await start())throw Error();const check=await fetch('/api/tasks');if(!check.ok)throw Error();setTasks((await check.json()).tasks);setReady(true);setLoadError('')}catch{setLoadError('No se pudo abrir tu espacio. Comprueba la conexión y permite las cookies para continuar.')}finally{setLoading(false)}},[]);
 useEffect(()=>{
 const restore=()=>{const params=new URLSearchParams(location.search);setQ(params.get('q')||'');const status=params.get('status');setFilter(statuses.includes(status as Draft['status'])?status!:'Todos')};
 const timer=setTimeout(()=>{restore();void boot()},0);
 window.addEventListener('popstate',restore);
 return()=>{clearTimeout(timer);window.removeEventListener('popstate',restore)};
 },[boot]);
 useEffect(()=>{if(!ready)return;const sequence=requestNumber;const timer=setTimeout(()=>{
 const url=new URL(location.href);if(q)url.searchParams.set('q',q);else url.searchParams.delete('q');if(filter!=='Todos')url.searchParams.set('status',filter);else url.searchParams.delete('status');
 if(url.href!==location.href)history.pushState(null,'',url);
 void load();
 },200);return()=>{clearTimeout(timer);sequence.current++;abort.current?.abort()}},[ready,load,q,filter]);
 const note=(target:string,value:Feedback|undefined)=>setFeedback(p=>{const next={...p};if(value)next[target]=value;else delete next[target];return next});
 const retainUnresolvedDraft=()=>{const active=editorRef.current;if(active&&unresolved.some(s=>s.target===active.id))unresolvedDrafts.current.set(active.id,{editor:active,draft:{...draftRef.current}})};
 const openEditor=(task?:Task)=>{if(busyRef.current.size)return;retainUnresolvedDraft();if(!task)window.constructorTrack?.('Task creation opened');const retained=unresolvedDrafts.current.get(task?.id||'new');unresolvedDrafts.current.delete(task?.id||'new');setEditor(retained?.editor||(task?{id:task.id,known:task}:{id:'new'}));setDraft(retained?.draft||(task?draftOf(task):{...emptyDraft}));setErrors({});setAllowNew(false);requestAnimationFrame(()=>titleRef.current?.focus())};
 const closeEditor=()=>{if(editorRef.current&&busyRef.current.has(editorRef.current.id))return;retainUnresolvedDraft();setEditor(null);setErrors({});newRef.current?.focus()};
 function integrate(result:{task?:Task;deleted?:string},submission:Submission){
 const {task,deleted}=result;requestNumber.current++;abort.current?.abort();
 if(task){setTasks(prev=>{const exists=prev.some(t=>t.id===task.id);return exists?prev.map(t=>t.id===task.id?task:t):[task,...prev]});
 const active=editorRef.current;
 if(active&&(active.id===submission.target||active.id===task.id)){
 setEditor({id:task.id,known:task});
 const live=draftRef.current;
 if(submission.source==='row'){setDraft(d=>({...d,...(d.status===submission.known?.status?{status:task.status}:{})}))}
 else if(same(live,submission.draft))setDraft(draftOf(task));
 note(task.id,{kind:'success',text:(submission.source==='row'?same(live,draftOf(submission.known!)):same(live,submission.draft))?undefined:'Envío original confirmado. Tus cambios posteriores siguen en el borrador.'});
 }
 }
 if(deleted){const index=tasks.findIndex(t=>t.id===deleted);afterDelete.current=tasks[index+1]?.id||tasks[index-1]?.id||'new';setTasks(p=>p.filter(t=>t.id!==deleted));if(editorRef.current?.id===deleted)setEditor(null);setDeleting(null)}
 const retained=unresolvedDrafts.current.get(submission.target);
 const retainedDraft=retained&&task?(submission.source==='row'?{...retained.draft,...(retained.draft.status===submission.known?.status?{status:task.status}:{})}:same(retained.draft,submission.draft)?draftOf(task):retained.draft):undefined;
 if(retainedDraft&&task)unresolvedDrafts.current.set(submission.target,{editor:{id:task.id,known:task},draft:retainedDraft});
 if(deleted)unresolvedDrafts.current.delete(submission.target);
 setUnresolved(p=>p.filter(s=>s.op.key!==submission.op.key));setAllowNew(false);if(submission.target==='new')note('new',undefined);if(!task||editorRef.current?.id!==submission.target)note(submission.target,{kind:'success',text:deleted?'Tarea eliminada.':retainedDraft&&task&&!same(retainedDraft,draftOf(task))?'Envío original confirmado. Tus cambios posteriores siguen en el borrador.':undefined});void currentLoad.current();
 }
 async function send(submission:Submission){
 if(busyRef.current.has(submission.target))return;busyRef.current.add(submission.target);note(submission.target,{kind:'pending',text:submission.op.action==='delete'?'Eliminando…':`Guardando…${submission.op.status&&submission.op.status!==submission.known?.status?' Estado solicitado: '+submission.op.status+'.':''}`});
 try{
 const {response,data}=await readJSON(await fetch(operationUrl(submission.op),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(operationBody(submission.op)),signal:AbortSignal.timeout(15000)}));
 if(response.ok&&((data.task&&typeof data.task.id==='string'&&Number.isInteger(data.task.version))||(data.deleted&&data.deleted===submission.op.id))){integrate(data,submission);return}
 if(response.status===409&&data.current){note(submission.target,{kind:'conflict',submission,current:data.current});return}
 if(response.status>=400&&response.status<500){note(submission.target,{kind:'error',text:data.error||'No se pudo completar la acción.'});if(data.fields&&editorRef.current?.id===submission.target){setErrors(data.fields);focusInvalidTitle()}return}
 throw Error('unverified');
 }catch{note(submission.target,{kind:'uncertain',submission});setUnresolved(p=>p.some(s=>s.op.key===submission.op.key)?p:[...p,submission]);setAllowNew(false)}finally{busyRef.current.delete(submission.target)}
 }
 async function recover(submission:Submission){
 if(busyRef.current.has(submission.target))return;busyRef.current.add(submission.target);note(submission.target,{kind:'pending',text:'Recuperando el envío original…'});
 try{const {response,data}=await readJSON(await fetch(`/api/operations/${submission.op.key}`));if(response.ok&&(data.task||data.deleted)){integrate(data,submission);return}if(response.status===404){busyRef.current.delete(submission.target);await send(submission);return}throw Error()}
 catch{note(submission.target,{kind:'uncertain',submission})}finally{busyRef.current.delete(submission.target)}
 }
 function focusInvalidTitle(){
 requestAnimationFrame(()=>{
 const title=titleRef.current;if(!title)return;
 title.focus({preventScroll:true});
 const summary=title.closest('form')?.querySelector('[data-validation-summary]');
 const top=(summary||title).getBoundingClientRect().top;
 if(top<24||title.getBoundingClientRect().bottom>window.innerHeight-24)window.scrollBy({top:top-24,behavior:'instant'});
 });
 }
 function submit(overwrite?:Task){
 if(!editor||(!overwrite&&feedback[editor.id]?.kind==='conflict'))return;const invalid=validateDraft(draft);setErrors(invalid);if(Object.keys(invalid).length){if(feedback[editor.id]?.kind!=='conflict')note(editor.id,undefined);focusInvalidTitle();return}
 if(unresolved.some(s=>s.target===editor.id)&&!allowNew){note(editor.id,{kind:'uncertain',submission:unresolved.find(s=>s.target===editor.id)});return}
 const known=overwrite||editor.known;
 const op:Operation={key:crypto.randomUUID(),action:known?'update':'create',...(known?{id:known.id,version:known.version}:{}),...draft};
 void send({op,draft:{...draft},target:editor.id,known});
 }
 function changeStatus(task:Task,status:Draft['status']){if(status===task.status)return;const next={...draftOf(task),status};void send({source:'row',op:{key:crypto.randomUUID(),action:'update',id:task.id,version:task.version,...next},draft:editor?.id===task.id?{...draft}:next,target:task.id,known:task})}
 function editField<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(d=>({...d,[key]:value}));if(editor&&feedback[editor.id]?.kind==='success')note(editor.id,undefined)}
 function discardConflict(target:string,current:Task){setTasks(p=>p.map(t=>t.id===current.id?current:t));if(editor?.id===target){setEditor({id:current.id,known:current});setDraft(draftOf(current));setErrors({})}if(deleting?.id===target)setDeleting(current);note(target,undefined)}
 function overwriteConflict(f:Feedback){if(!f.current||!f.submission)return;const s=f.submission;if(editor?.id===s.target&&s.op.action!=='delete'){submit(f.current);return}void send({...s,known:f.current,op:{...s.op,key:crypto.randomUUID(),version:f.current.version}})}
 function FilterExit(){return <div className="text-ink"><p>Esta tarea ya no coincide con los filtros. Sigue abierta aquí.</p><Button type="button" variant="link" className="btn px-0" onClick={clear}>Limpiar filtros</Button></div>}
 function FeedbackView({target,compact=false,filteredOut=false}:{target:string;compact?:boolean;filteredOut?:boolean}){
 const f=feedback[target];const pending=unresolved.filter(s=>s.target===target);if(!f&&!pending.length&&!filteredOut)return null;
 return <div className="space-y-3" data-feedback={target}>
 {f?.kind==='pending'&&<div role="status" className="pending-notice border-input bg-background text-ink"><span className="flex items-start gap-2 font-medium"><LoaderCircle size={16} className="mt-0.5 motion-safe:animate-spin shrink-0"/>{f.text}</span><p className="mt-1 text-[13px] leading-[18px]">Espera la confirmación antes de continuar.</p></div>}
 {f?.kind==='success'&&<div role="status" className={`${compact?'text-base leading-6':'notice border-[#8CBBA0] bg-[#F2F8F3]'} text-success`}><span className="flex items-center gap-2 font-semibold"><CheckCircle2 size={18} className="shrink-0"/>{f.text==='Tarea eliminada.'?'Tarea eliminada.':f.text?.startsWith('Envío original')?'Envío original confirmado':'Cambios guardados'}</span>{f.text?.startsWith('Envío original')&&<p className="mt-1">Tus cambios posteriores siguen en el borrador.</p>}{filteredOut&&<div className="mt-2"><FilterExit/></div>}</div>}
 {f?.kind==='error'&&<div role="alert" className="notice border-destructive bg-[#FFF5F5]"><p className="flex gap-2"><AlertCircle size={18}/>{f.text}</p><Button variant="outline" type="button" className="btn quiet mt-3" onClick={()=>{note(target,undefined);void load()}}>Actualizar lista</Button></div>}
 {pending.map(s=><div key={s.op.key} role="alert" className="notice uncertain-panel border-warning bg-[#FFF8ED]" data-uncertain><p className="flex items-center gap-2 font-semibold text-warning"><AlertCircle className="shrink-0" size={18}/>Resultado sin confirmar</p><p className="mt-2">No pudimos confirmar el envío. Recupera el resultado original antes de guardar otra vez.</p><div className="original-submission" data-original-submission><p className="text-[13px] leading-[18px] font-medium">Envío original</p><p data-submitted-title className="mt-1 break-words">{s.op.title??s.draft.title}</p><p className="mt-1 text-sm">Estado: <span data-submitted-status>{s.op.status??s.draft.status}</span> · Prioridad: <span data-submitted-priority>{s.op.priority??s.draft.priority}</span></p></div><Button type="button" className="btn mt-3 w-full whitespace-normal" disabled={f?.kind==='pending'} onClick={()=>void recover(s)}>Recuperar resultado</Button>{s.op.action!=='delete'&&<details className="mt-2"><summary className="flex min-h-11 cursor-pointer items-center text-sm underline underline-offset-4">Guardar como un envío distinto</summary><p className="my-2">Un nuevo envío no cancela el anterior. Primero puedes recuperar el original para evitar duplicados.</p><Button variant="outline" type="button" className="btn quiet w-full whitespace-normal" onClick={()=>setAllowNew(true)}>Iniciar un envío distinto</Button>{allowNew&&<p className="mt-2">El siguiente guardado tendrá una clave nueva. La recuperación original sigue disponible.</p>}</details>}</div>)}
 {f?.kind==='conflict'&&f.current&&f.submission&&<div role="alert" className="conflict-panel border-warning bg-surface" data-conflict><p className="flex items-center gap-2 font-semibold text-warning"><AlertCircle className="shrink-0" size={18}/>Esta tarea ha cambiado</p><p className="mt-1">Compara y elige cómo continuar.</p><ConflictComparison draft={editor?.id===target?draft:f.submission.draft} known={f.submission.known} current={f.current}/><div className="mt-3 grid gap-2"><Button type="button" className="btn px-2 whitespace-normal" onClick={()=>discardConflict(target,f.current!)}>Usar la versión actual</Button><Button variant="outline" type="button" className="btn quiet px-2 whitespace-normal" onClick={()=>overwriteConflict(f)}>Sobrescribir explícitamente</Button></div></div>}
 {filteredOut&&f?.kind!=='success'&&<div className="notice border-input bg-background"><FilterExit/></div>}
 </div>
 }
 const busy=editor?feedback[editor.id]?.kind==='pending':false;
 const switchingBlocked=Object.values(feedback).some(f=>f.kind==='pending');
 const conflict=editor?feedback[editor.id]?.kind==='conflict':false;
 const outside=editor?.known&&(q||filter!=='Todos')&&!tasks.some(t=>t.id===editor.id)&&!loading;
 const clear=()=>{setQ('');setFilter('Todos')};
 return <main className="mx-auto max-w-[1168px] px-4 pb-8 sm:px-6">
 <header className="flex min-h-[88px] items-center justify-between gap-3 max-sm:min-h-[72px]">
 <h1 className="flex items-center gap-2 text-[26px] leading-8 font-semibold max-sm:gap-1 max-sm:text-[24px] max-sm:leading-7"><Image unoptimized data-brand-logo src={branding.logoImageUrl||'/brand-mark.svg'} width={36} height={36} alt="" className="h-9 w-9 max-sm:h-7 max-sm:w-7"/>{branding.logoText}</h1>
 <Button ref={newRef} className="btn max-sm:px-3" disabled={!ready||switchingBlocked} onClick={()=>openEditor()}><Plus size={17}/><span>Nueva tarea</span></Button>
 </header>
 <div ref={workbenchRef} className={`relative grid overflow-visible rounded-sm border bg-surface ${editor?'min-[1000px]:grid-cols-[minmax(0,1fr)_360px]':''}`}>
 {editor&&tasks.some(t=>t.id===editor.id)&&<div aria-hidden="true" className="selection-guide"/>}
 <section aria-label="Lista de tareas" className="min-w-0">
 <div className="filter-band border-b px-5 py-4 max-sm:px-4">
 <div className="filter-toolbar" data-active-filters={!!q||filter!=='Todos'}>
 <div className="filter-search"><div className="filter-search-label mb-2 text-[13px] leading-[18px]"><label htmlFor="task-search" className="shrink-0 font-medium">Buscar tareas</label><p className="task-count text-muted-foreground" aria-live="polite">{loading?'Actualizando…':loadError?`${tasks.length} ${tasks.length===1?'resultado anterior':'resultados anteriores'}`:`${tasks.length} ${tasks.length===1?'tarea':'tareas'}`}</p></div><div className="relative"><Search size={17} className="pointer-events-none absolute top-[14px] left-3 text-muted-foreground"/><input id="task-search" aria-label="Buscar por título" placeholder="Buscar por título…" value={q} onChange={e=>setQ(e.target.value)} className="control w-full pl-10"/></div></div>
 <div><label htmlFor="task-filter" className="mb-2 block text-[13px] leading-[18px] font-medium">Estado</label><select id="task-filter" aria-label="Filtrar por estado" value={filter} onChange={e=>setFilter(e.target.value)} className="control w-full"><option value="Todos">Todos los estados</option>{statuses.map(s=><option key={s}>{s}</option>)}</select></div>
 {(q||filter!=='Todos')&&<Button variant="ghost" className="btn self-end px-3 text-muted-foreground hover:text-primary" onClick={clear}>Limpiar filtros</Button>}
 </div>
 {loadError&&<div className="notice mt-4 flex flex-wrap items-center gap-3 border-destructive bg-[#FFF5F5]" role="alert"><p className="flex min-w-[180px] flex-1 items-start gap-2"><AlertCircle size={18} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true"/><span>{loadError}</span></p><Button variant="outline" className="btn quiet" onClick={()=>void (ready?load():boot())}><RotateCcw size={16}/>Reintentar</Button>{!ready&&<a className="inline-flex min-h-11 items-center underline" href="/" target="_blank" rel="noreferrer">Abrir directamente</a>}</div>}
 </div>
 {!!tasks.length&&<div className={`task-grid ${!editor?'task-grid-wide':''} !hidden border-b px-5 py-3 text-[13px] font-medium text-muted-foreground min-[1000px]:!grid`} aria-hidden="true"><span>Título</span><span>Estado</span><span>Prioridad</span><span>Acciones</span></div>}
 <div aria-busy={loading}>
 {tasks.map(task=>{const f=feedback[task.id],selected=editor?.id===task.id;return <article key={task.id} data-task-id={task.id} data-selected={selected} aria-label={task.title} className={`relative border-b px-5 py-4 max-sm:px-4 ${selected?'bg-[#FAF8FD] before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-selection min-[1000px]:before:left-auto min-[1000px]:before:right-0':''}`}>
 <div className={`task-grid ${!editor?'task-grid-wide':''}`}>
 <div className="task-heading"><h2 className="break-words text-base leading-6">{task.title}</h2>{task.is_example===1&&<span className="example-label mt-1 inline-block rounded-sm bg-[#EEEDEB] px-2 py-0.5 text-[13px] leading-[18px] text-muted-foreground">Ejemplo</span>}</div>
 <span className={`task-priority rounded-sm border px-2 py-1 text-[13px] leading-[18px] font-medium ${task.priority==='Alta'?'border-ink/50 bg-background text-ink font-semibold':'border-[#DADDD6] bg-background text-ink'}`}>{task.priority}</span>
 <div className="task-controls">
 <div className="task-state"><select aria-label={`Estado de ${task.title}`} value={task.status} disabled={f?.kind==='pending'||f?.kind==='conflict'||unresolved.some(s=>s.target===task.id)} onChange={e=>changeStatus(task,e.target.value as Draft['status'])} className="control w-full">{statuses.map(s=><option key={s}>{s}</option>)}</select><div aria-hidden="true" className="status-marker-track"><span className="status-stop"/><span className="status-stop"/><span className="status-stop"/><span data-status-marker className="status-marker absolute top-0 left-0 h-3 w-[7px] rounded-[1px] bg-primary" style={{transform:`translateX(${statuses.indexOf(task.status)*12}px)`}}/></div></div>
 <div className="task-actions gap-1"><Button variant="ghost" className="btn px-2 text-sm max-sm:px-1.5" disabled={switchingBlocked} onClick={()=>openEditor(task)} aria-label={`Editar ${task.title}`}><Pencil size={14}/><span>Editar</span></Button><Button data-delete={task.id} variant="ghost" className="btn px-2 text-sm text-destructive hover:bg-[#FFF1F1] max-sm:px-1.5" disabled={f?.kind==='pending'||f?.kind==='conflict'||unresolved.some(s=>s.target===task.id)} onClick={e=>{deleteTrigger.current=e.currentTarget;setDeleting(task)}} aria-label={`Eliminar ${task.title}`}><Trash2 size={14}/><span>Eliminar</span></Button></div>
 </div>
 </div>
 {!selected&&f&&<div className="mt-3">{FeedbackView({target:task.id,compact:true})}</div>}
 </article>})}
 {!tasks.length&&<div className="px-5 py-8 max-sm:px-4"><h2 className="text-lg font-semibold">{!ready?loading?'Abriendo tu espacio…':'Tu espacio no está disponible':q||filter!=='Todos'?'Sin coincidencias':'Aún no hay tareas'}</h2><p className="mt-2 max-w-sm text-base leading-6 text-muted-foreground">{!ready?'Tus tareas aparecerán aquí cuando termine la conexión.':q||filter!=='Todos'?'No hay tareas que coincidan con estos filtros.':editor?'Completa el formulario para crear tu primera tarea.':'Empieza con un pendiente. Puedes cambiar su estado cuando avances.'}</p>{ready&&!editor&&!q&&filter==='Todos'&&<Button variant="link" className="btn mt-3 px-0" onClick={()=>openEditor()}>Nueva tarea</Button>}</div>}
 </div>
 <footer className="list-footer px-5 py-3 text-[13px] leading-[18px] text-muted-foreground max-sm:px-4">
 {!!tasks.length&&<p className="flex items-start gap-2"><ListTodo size={16} className="shrink-0 text-brand"/><span>Más recientes primero. Cambiar el estado no cambia el orden.</span></p>}
 <details className={tasks.length?'mt-1':''}><summary className="min-h-11 w-fit cursor-pointer content-center rounded-sm font-medium underline underline-offset-4"><LockKeyhole size={14} className="mx-1 inline-block text-brand" aria-hidden="true"/>Tu espacio personal · cookies</summary><p className="max-w-[510px] pb-1">Este navegador recuerda tu espacio mientras conserves sus cookies. Si las borras, perderás el acceso.</p></details>
 </footer>
 </section>
 {editor&&<aside aria-label="Editor de tarea" className="relative -order-1 min-w-0 border-b p-6 min-[1000px]:order-none min-[1000px]:border-b-0 min-[1000px]:border-l max-sm:p-4">
 {!tasks.some(t=>t.id===editor.id)&&<span aria-hidden="true" className="selection-guide-local"/>}
 <div className="mb-2 flex items-center justify-between gap-3"><h2 data-editor-heading className={`text-xl font-semibold ${editor.known?'max-sm:text-[13px] max-sm:leading-[18px] max-sm:font-medium':''}`}>{editor.known?'Editar tarea':'Nueva tarea'}</h2><Button variant="ghost" className="btn px-2 text-muted-foreground" disabled={busy} onClick={closeEditor}><X size={15}/>Cerrar</Button></div>
 <p className="mb-4 break-words text-[13px] leading-[18px] text-muted-foreground">{editor.known?<>Tarea seleccionada: <span data-confirmed-title className="font-medium max-sm:text-lg max-sm:leading-6">{editor.known.title}</span></>:'Un título claro es un buen comienzo.'}</p>
 <form noValidate onSubmit={e=>{e.preventDefault();submit()}} className="space-y-4">
 {Object.keys(errors).length>0&&<div role="alert" data-validation-summary className="notice border-destructive bg-[#FFF5F5]"><p className="flex gap-2 font-semibold"><AlertCircle size={18}/>Revisa el título</p><a href="#task-title" onClick={e=>{e.preventDefault();titleRef.current?.focus()}} className="mt-2 block underline underline-offset-4">{errors.title}</a></div>}
 <div><label htmlFor="task-title" className="mb-2 block text-sm font-medium">Título <span className="text-destructive">*</span></label><Textarea ref={titleRef} id="task-title" value={draft.title} onChange={e=>editField('title',e.target.value)} aria-invalid={!!errors.title} aria-describedby={errors.title?'title-error title-count':'title-count'} className="min-h-[68px] resize-none overflow-hidden rounded-sm bg-surface text-base leading-6 aria-invalid:border-destructive" placeholder="¿Qué tienes pendiente?"/><div className="mt-2 flex justify-between text-[13px] leading-[18px] text-muted-foreground"><span id="title-count">{Array.from(draft.title).length} / 160 caracteres</span><span>Obligatorio</span></div>{errors.title&&<p id="title-error" className="mt-2 text-sm text-destructive">{errors.title}</p>}</div>
 <div className="grid gap-4 min-[720px]:max-[999px]:grid-cols-2">
 <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium">Estado <span className="text-destructive">*</span></legend><div className="grid grid-cols-3">{statuses.map(s=><label key={s} className={`relative flex min-h-11 cursor-pointer items-center justify-center gap-1.5 border px-1 py-2 text-sm leading-5 font-medium ${draft.status===s?'z-10 border-primary bg-accent text-primary':'border-input bg-surface'}`}><input type="radio" name="status" value={s} checked={draft.status===s} onChange={()=>editField('status',s)} className="sr-only peer"/><span aria-hidden="true" className="absolute inset-0 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"/><span aria-hidden="true" className="option-marker"/><span>{s}</span></label>)}</div></fieldset>
 <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium">Prioridad <span className="text-destructive">*</span></legend><div className="grid grid-cols-3">{priorities.map(p=><label key={p} className={`relative flex min-h-11 cursor-pointer items-center justify-center gap-1.5 border px-1 py-2 text-sm leading-5 font-medium ${draft.priority===p?'z-10 border-primary bg-accent text-primary':'border-input bg-surface'}`}><input type="radio" name="priority" value={p} checked={draft.priority===p} onChange={()=>editField('priority',p)} className="sr-only peer"/><span aria-hidden="true" className="absolute inset-0 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary"/><span aria-hidden="true" className="option-marker"/><span>{p}</span></label>)}</div></fieldset>
 </div>
 {FeedbackView({target:editor.id,filteredOut:!!outside})}
 <div className="flex gap-2 pt-1">{!conflict&&<Button type="submit" className="btn min-w-0 flex-1 whitespace-normal" disabled={busy||!!(unresolved.some(s=>s.target===editor.id)&&!allowNew)}>{busy?'Guardando…':editor.known?'Guardar cambios':'Crear tarea'}</Button>}<Button type="button" variant="outline" className={`btn quiet ${conflict?'w-full':''}`} disabled={busy} onClick={closeEditor}>{unresolved.some(s=>s.target===editor.id)?'Cerrar editor':'Cancelar'}</Button></div>
 </form>
 </aside>}
 </div>
 {unresolved.filter(s=>s.target!==editor?.id&&!tasks.some(t=>t.id===s.target)&&s.target!=='new').map(s=><div key={s.op.key} className="mt-4">{FeedbackView({target:s.target})}</div>)}
 {editor?.id!=='new'&&unresolved.some(s=>s.target==='new')&&<div className="mt-4">{FeedbackView({target:'new'})}</div>}
 <AlertDialog.Root open={!!deleting} onOpenChange={open=>{if(!open&&deleting&&feedback[deleting.id]?.kind!=='pending'&&!unresolved.some(s=>s.target===deleting.id))setDeleting(null)}}>
 <AlertDialog.Portal><AlertDialog.Overlay className="fixed inset-0 z-40 bg-[#232823]/35"/><AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90dvh] w-[calc(100%-32px)] max-w-[460px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-sm border bg-surface p-6 shadow-xl" onOpenAutoFocus={e=>{e.preventDefault();cancelRef.current?.focus()}} onCloseAutoFocus={e=>{e.preventDefault();if(afterDelete.current){const next=afterDelete.current;afterDelete.current=null;requestAnimationFrame(()=>{const el=document.querySelector<HTMLButtonElement>(`[data-delete="${next}"]`);(el||newRef.current)?.focus()})}else deleteTrigger.current?.focus()}} onEscapeKeyDown={e=>{if(deleting&&(feedback[deleting.id]?.kind==='pending'||unresolved.some(s=>s.target===deleting.id)))e.preventDefault()}}>
 <AlertDialog.Title className="flex items-center gap-2 text-xl font-semibold"><Trash2 size={20} aria-hidden="true" className="shrink-0 text-destructive"/>¿Eliminar tarea?</AlertDialog.Title><AlertDialog.Description asChild><div className="mt-4 text-base leading-6"><p className="border-l-2 border-destructive pl-3 font-medium [overflow-wrap:anywhere]">{deleting?.title}</p><p className="mt-3 text-muted-foreground">Esta acción es irreversible. La tarea se eliminará de tu espacio.</p></div></AlertDialog.Description>
 {deleting&&feedback[deleting.id]&&feedback[deleting.id].kind!=='success'&&<div className="mt-4">{FeedbackView({target:deleting.id})}</div>}
 <div className="mt-6 flex justify-end gap-3"><AlertDialog.Cancel asChild><Button variant="outline" ref={cancelRef} className="btn quiet" disabled={!!deleting&&(feedback[deleting.id]?.kind==='pending'||unresolved.some(s=>s.target===deleting.id))}>Cancelar</Button></AlertDialog.Cancel><Button className="btn bg-destructive text-white hover:bg-[#8D1F2D]" disabled={!!deleting&&(feedback[deleting.id]?.kind==='pending'||unresolved.some(s=>s.target===deleting.id))} onClick={()=>{if(deleting)void send({op:{key:crypto.randomUUID(),action:'delete',id:deleting.id,version:deleting.version},draft:draftOf(deleting),target:deleting.id,known:deleting})}}>{deleting&&feedback[deleting.id]?.kind==='pending'?'Eliminando…':'Eliminar tarea'}</Button></div>
 </AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>
 </main>
}
