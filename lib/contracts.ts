export const statuses = ['Pendiente', 'En curso', 'Hecha'] as const;
export const priorities = ['Baja', 'Media', 'Alta'] as const;
export type Draft = {title:string;status:typeof statuses[number];priority:typeof priorities[number]};
export type Task = Draft & {id:string;is_example:number;version:number;created_at:string;updated_at:string};
export const emptyDraft:Draft = {title:'',status:'Pendiente',priority:'Media'};
export function validateDraft(d: Partial<Draft>) {
 const errors:Record<string,string>={};
 if(typeof d.title!=='string'||!d.title.trim()||Array.from(d.title.trim()).length>160)errors.title='Escribe un título de entre 1 y 160 caracteres.';
 if(!statuses.includes(d.status!))errors.status='Elige un estado válido.';
 if(!priorities.includes(d.priority!))errors.priority='Elige una prioridad válida.';
 return errors;
}
export type Operation = {key:string;action:'create'|'update'|'delete';id?:string;version?:number;title?:string;status?:Draft['status'];priority?:Draft['priority']};
