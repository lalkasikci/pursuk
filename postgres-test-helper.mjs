import { after } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createPostgresStore } from './postgres-store.mjs';

const closing = new Set();
after(async () => { await Promise.all([...closing]); });

export async function createTestStore(options={}) {
  const connectionString=process.env.TEST_DATABASE_URL;
  if (!connectionString || !new URL(connectionString).pathname.endsWith('_test')) throw new Error('Testler için ayrı TEST_DATABASE_URL gerekli; veritabanı adı _test ile bitmelidir. npm test kullanın.');
  const pool=new pg.Pool({connectionString,max:10,connectionTimeoutMillis:5000,statement_timeout:10000});
  const schema='test_'+randomUUID().replaceAll('-','');
  let cleanup;
  try {
    const name=(await pool.query('SELECT current_database() AS name')).rows[0].name;
    if (!name.endsWith('_test')) throw new Error('Uygulama veritabanında test çalıştırılmaz.');
    const store=await createPostgresStore({...options,pool,schema});
    store.reopen=()=>createPostgresStore({...options,pool,schema});
    store.close=()=> {
      if (!cleanup) {
        cleanup=(async()=>{try {await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);} finally {await pool.end();}})();
        closing.add(cleanup);
      }
      return cleanup;
    };
    return store;
  } catch(error) {await pool.end();throw error;}
}
