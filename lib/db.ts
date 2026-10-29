import 'server-only';
import { createClient } from '@libsql/client';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const db = createClient({url:process.env.TURSO_DATABASE_URL!,authToken:process.env.TURSO_AUTH_TOKEN});
let ready:Promise<void>|undefined;
export async function database(){
 if(!ready)ready=readFile(path.join(process.cwd(),'migrations/001_initial.sql'),'utf8').then(sql=>db.executeMultiple(sql)).catch(e=>{ready=undefined;throw e});
 await ready;return db;
}
