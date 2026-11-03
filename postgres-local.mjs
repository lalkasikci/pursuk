import { spawnSync } from 'node:child_process';
import { readFile, writeFile, access, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

function run(executable,args) {
  const result = spawnSync(executable,args,{stdio:'ignore',windowsHide:true,timeout:60000});
  if (result.status !== 0) throw new Error('Yerel PostgreSQL başlatılamadı. .postgres-data/server.log dosyasını kontrol edin.');
}
export async function startLocalPostgres(root = fileURLToPath(new URL('./',import.meta.url))) {
  let config;
  try { config = JSON.parse(await readFile(join(root,'.postgres-local.json'),'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const status = spawnSync(join(config.bin,'pg_ctl.exe'),['status','-D',config.data],{windowsHide:true,stdio:'ignore'});
  if (status.status !== 0) run(join(config.bin,'pg_ctl.exe'),['start','-D',config.data,'-l',join(config.data,'server.log'),'-o',`-p ${config.port} -h 127.0.0.1`,'-w']);
}
export async function setupLocalPostgres(root) {
  const bin = 'C:\\Program Files\\PostgreSQL\\17\\bin';
  await access(join(bin,'initdb.exe'));
  await mkdir(root,{recursive:true});
  const data = join(root,'.postgres-data');
  const configPath = join(root,'.postgres-local.json');
  let config;
  try { config=JSON.parse(await readFile(configPath,'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const port = 54329;
  const password = config?.adminPassword || randomBytes(32).toString('hex');
  const appPassword = config?.appPassword || randomBytes(32).toString('hex');
  const temporary = await mkdtemp(join(tmpdir(),'pursuk-pg-'));
  try {
    const passwordPath = join(temporary,'password');
    await writeFile(passwordPath,password,{mode:0o600});
    if (!config) run(join(bin,'initdb.exe'),['-D',data,'-U','pursuk_admin',`--pwfile=${passwordPath}`,'--auth=scram-sha-256','--encoding=UTF8','--locale=C']);
    await writeFile(configPath,JSON.stringify({bin,data,port,adminPassword:password,appPassword},null,2),{mode:0o600});
    await startLocalPostgres(root);
    const admin = new pg.Client({host:'127.0.0.1',port,user:'pursuk_admin',password,database:'postgres',connectionTimeoutMillis:5000});
    await admin.connect();
    try {
      // Both values are generated hex strings, never user-provided SQL identifiers.
      if (!(await admin.query("SELECT 1 FROM pg_roles WHERE rolname='pursuk_app'")).rowCount) await admin.query(`CREATE ROLE pursuk_app LOGIN PASSWORD '${appPassword}'`);
      if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='pursuk'")).rowCount) await admin.query('CREATE DATABASE pursuk OWNER pursuk_app');
      if (!(await admin.query("SELECT 1 FROM pg_database WHERE datname='pursuk_test'")).rowCount) await admin.query('CREATE DATABASE pursuk_test OWNER pursuk_app');
    } finally { await admin.end(); }
    const envPath = join(root,'.env.local');
    let env = '';
    try { env = await readFile(envPath,'utf8'); } catch (error) { if(error.code !== 'ENOENT') throw error; }
    const line = `DATABASE_URL=postgresql://pursuk_app:${appPassword}@127.0.0.1:${port}/pursuk`;
    if (!/^DATABASE_URL=/m.test(env)) env+='\n'+line+'\n';
    if (!/^TEST_DATABASE_URL=/m.test(env)) env+='\n'+line.replace('DATABASE_URL=','TEST_DATABASE_URL=').replace(/\/pursuk$/,'/pursuk_test')+'\n';
    await writeFile(envPath,env,{mode:0o600});
    console.log('Pursuk için ayrı PostgreSQL veritabanı oluşturuldu. Bağlantı .env.local içine kaydedildi.');
  } finally { await rm(temporary,{recursive:true,force:true}); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[3] || fileURLToPath(new URL('./',import.meta.url)));
  try {
    if (process.argv[2] === 'setup') await setupLocalPostgres(root);
    else if (process.argv[2] === 'stop') {
      const config = JSON.parse(await readFile(join(root,'.postgres-local.json'),'utf8'));
      run(join(config.bin,'pg_ctl.exe'),['stop','-D',config.data,'-m','fast','-w']);
      console.log('Yerel PostgreSQL durduruldu.');
    } else await startLocalPostgres(root);
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
