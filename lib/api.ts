import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { database } from './db';
import { validateDraft, statuses, type Draft } from './contracts';
const cookieName='atlas_session';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
const fail=(error:string,status:number,extra={})=>json({error,...extra},status);
function trusted(origin:string|null){return !!origin&&[process.env.APP_ORIGIN,process.env.VERCEL_URL?`https://${process.env.VERCEL_URL}`:null].includes(origin)}
async function owner(req:NextRequest){const token=req.cookies.get(cookieName)?.value;if(!token)return null;const db=await database();const r=await db.execute({sql:'SELECT workspace_id FROM sessions WHERE token_hash=?',args:[hash(token)]});return r.rows[0]?.workspace_id as string|undefined}
function taskRecord(row:Record<string,unknown>){const {workspace_id: _owner,...task}=row;void _owner;return task}
export async function handle(req:NextRequest){
 try{
 if(req.method==='POST'&&!trusted(req.headers.get('origin')))return fail('Origen no autorizado.',403);
 const path=req.nextUrl.pathname.split('/').filter(Boolean).slice(1);
 const db=await database();
 let workspace=await owner(req);
 if(path[0]==='session'&&req.method==='POST'){
 if(workspace)return json({ready:true});
 const token=randomBytes(32).toString('hex');workspace=randomUUID();const now=new Date().toISOString();const tx=await db.transaction('write');
 try{
 await tx.execute({sql:'INSERT INTO workspaces(id,created_at) VALUES(?,?)',args:[workspace,now]});
 await tx.execute({sql:'INSERT INTO sessions(token_hash,workspace_id,created_at) VALUES(?,?,?)',args:[hash(token),workspace,now]});
 const examples=[['Organizar los documentos personales','Pendiente','Media'],['Preparar la lista de la compra','En curso','Alta'],['Ordenar el escritorio','Hecha','Baja']];
 for(let i=0;i<examples.length;i++){const time=new Date(Date.parse(now)-i).toISOString();await tx.execute({sql:'INSERT INTO tasks(id,workspace_id,title,status,priority,is_example,version,created_at,updated_at) VALUES(?,?,?,?,?,1,1,?,?)',args:[randomUUID(),workspace,...examples[i],time,time]})}
 await tx.execute({sql:'INSERT INTO seed_markers(workspace_id,created_at) VALUES(?,?)',args:[workspace,now]});await tx.commit();
 }catch(e){await tx.rollback();throw e}finally{tx.close()}
 const response=json({ready:true});const secure=process.env.APP_ORIGIN?.startsWith('https://')??false;
 response.cookies.set(cookieName,token,{httpOnly:true,secure,sameSite:secure?'none':'lax',partitioned:secure,path:'/',maxAge:60*60*24*365});return response;
 }
 if(!workspace)return fail('La sesión no está disponible. Permite las cookies y vuelve a intentar.',401);
 if(path[0]==='operations'&&path.length===2&&req.method==='GET'){
 const r=await db.execute({sql:'SELECT result FROM operations WHERE workspace_id=? AND key=?',args:[workspace,path[1]]});return r.rows[0]?json(JSON.parse(r.rows[0].result as string)):fail('Resultado aún no disponible.',404);
 }
 if(path[0]!=='tasks')return fail('Recurso no accesible.',404);
 if(req.method==='GET'){
 if(path.length===2){const r=await db.execute({sql:'SELECT * FROM tasks WHERE workspace_id=? AND id=?',args:[workspace,path[1]]});return r.rows[0]?json({task:taskRecord(r.rows[0])}):fail('Recurso no accesible.',404)}
 const q=(req.nextUrl.searchParams.get('q')||'').normalize('NFC').toLocaleLowerCase('es');const status=req.nextUrl.searchParams.get('status')||'Todos';
 if(status!=='Todos'&&!statuses.includes(status as Draft['status']))return fail('Elige un estado válido.',400,{fields:{status:'Elige un estado válido.'}});
 const like='%'+q.replace(/[\\%_]/g,'\\$&')+'%';
 const r=await db.execute({sql:`SELECT * FROM tasks WHERE workspace_id=? AND lower(replace(replace(replace(replace(replace(replace(replace(title,'Á','á'),'É','é'),'Í','í'),'Ó','ó'),'Ú','ú'),'Ü','ü'),'Ñ','ñ')) LIKE ? ESCAPE '\\' AND (?='Todos' OR status=?) ORDER BY created_at DESC,id DESC`,args:[workspace,like,status,status]});return json({tasks:r.rows.map(taskRecord)});
 }
 let data;try{data=await req.json()}catch{return fail('JSON no válido.',400)}
 if(!data||typeof data!=='object'||Array.isArray(data))return fail('Solicitud no válida.',400);
 const action=path.length===1?'create':path[2];if(!['create','update','delete'].includes(action))return fail('Recurso no accesible.',404);
 const fields=action==='delete'?['key','version']:['key','version','title','status','priority'];if(Object.keys(data).some(k=>!fields.includes(k)))return fail('Campo no permitido.',400);
 if(typeof data.key!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(data.key))return fail('Clave de operación no válida.',400);
 if(action!=='create'&&(!Number.isInteger(data.version)||data.version<1))return fail('Versión no válida.',400);
 if(action!=='delete'){const errors=validateDraft(data);if(Object.keys(errors).length)return fail('Revisa los campos.',400,{fields:errors})}
 const payload=JSON.stringify({id:action==='create'?null:path[1],version:action==='create'?null:data.version,...(action==='delete'?{}:{title:data.title.trim().normalize('NFC'),status:data.status,priority:data.priority})});
 const tx=await db.transaction('write');
 try{
 const old=await tx.execute({sql:'SELECT action,payload,result FROM operations WHERE workspace_id=? AND key=?',args:[workspace,data.key]});
 if(old.rows[0]){await tx.rollback();return old.rows[0].action===action&&old.rows[0].payload===payload?json(JSON.parse(old.rows[0].result as string)):fail('La clave pertenece a otro envío.',409,{code:'key_conflict'})}
 let current;
 if(action!=='create'){
 const r=await tx.execute({sql:'SELECT * FROM tasks WHERE workspace_id=? AND id=?',args:[workspace,path[1]]});current=r.rows[0];
 if(!current){await tx.rollback();return fail('Recurso no accesible.',404)}
 if(current.version!==data.version){await tx.rollback();return fail('La tarea cambió desde tu última lectura.',409,{code:'version_conflict',current:taskRecord(current)})}
 }
 const id=action==='create'?randomUUID():path[1],now=new Date().toISOString();
 if(action==='create')await tx.execute({sql:'INSERT INTO tasks(id,workspace_id,title,status,priority,is_example,version,created_at,updated_at) VALUES(?,?,?,?,?,0,1,?,?)',args:[id,workspace,data.title.trim().normalize('NFC'),data.status,data.priority,now,now]});
 if(action==='update')await tx.execute({sql:'UPDATE tasks SET title=?,status=?,priority=?,version=version+1,updated_at=? WHERE id=? AND workspace_id=? AND version=?',args:[data.title.trim().normalize('NFC'),data.status,data.priority,now,id,workspace,data.version]});
 if(action==='delete')await tx.execute({sql:'DELETE FROM tasks WHERE id=? AND workspace_id=? AND version=?',args:[id,workspace,data.version]});
 const result=action==='delete'?{deleted:id}:{task:taskRecord((await tx.execute({sql:'SELECT * FROM tasks WHERE id=? AND workspace_id=?',args:[id,workspace]})).rows[0])};
 await tx.execute({sql:"INSERT INTO operations(workspace_id,key,action,payload,state,result,created_at) VALUES(?,?,?,?,'confirmed',?,?)",args:[workspace,data.key,action,payload,JSON.stringify(result),now]});await tx.commit();return json(result);
 }catch(e){await tx.rollback();throw e}finally{tx.close()}
 }catch{return fail('No se pudo verificar el resultado. Puedes reintentar o recuperar el envío.',503)}
}
