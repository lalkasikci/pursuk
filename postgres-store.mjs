import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { periods, quotaStatus, quotaMessages, mockAccounts } from './quota-policy.mjs';
const digest = value => createHash('sha256').update(value).digest('hex');
const cookieToken = req => (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('pursuk_mock='))?.slice(12);

export async function createPostgresStore({ connectionString = process.env.DATABASE_URL, mock = false, now = () => new Date(), pool: providedPool, schema = 'pursuk' } = {}) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error('Geçersiz veritabanı şeması.');
  if (!connectionString && !providedPool) throw new Error('DATABASE_URL gerekli. PostgreSQL bağlantısını .env.local dosyasına ekleyin.');
  const pool = providedPool || new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, statement_timeout: 10000 });
  pool.on('error', () => console.error('PostgreSQL bağlantısı kesildi; sonraki istekte yeniden denenecek.'));
  async function transaction(run) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await run(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  async function ensureUser(client, id, name = id) {
    await client.query(`INSERT INTO ${schema}.users(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING`, [id,name]);
  }
  async function readStatus(userId, client = pool) {
    const {day,month} = periods(now());
    const result = await client.query(`SELECT period,count FROM ${schema}.usage WHERE user_id=$1 AND period=ANY($2::text[])`, [userId,[day,month]]);
    const counts = Object.fromEntries(result.rows.map(row => [row.period,row.count]));
    return quotaStatus(day,month,counts[day] || 0,counts[month] || 0);
  }
  async function lockUser(client,id) {
    await ensureUser(client,id);
    await client.query(`SELECT id FROM ${schema}.users WHERE id=$1 FOR UPDATE`,[id]);
  }
  try {
    const directory=new URL('./migrations/',import.meta.url);
    const files=(await readdir(directory)).filter(file=>/^\d+_[a-z_]+\.sql$/.test(file)).sort();
    await transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(741384217)');
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}; CREATE TABLE IF NOT EXISTS ${schema}.schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
      const applied=new Set((await client.query(`SELECT version FROM ${schema}.schema_migrations`)).rows.map(row=>row.version));
      for(const file of files) {
        const version=Number(file.split('_')[0]);
        if(applied.has(version)) continue;
        const sql=(await readFile(new URL(file,directory),'utf8')).replaceAll('pursuk.',schema+'.').replace('SCHEMA IF NOT EXISTS pursuk;','SCHEMA IF NOT EXISTS '+schema+';');
        await client.query(sql);
        await client.query(`INSERT INTO ${schema}.schema_migrations(version) VALUES($1) ON CONFLICT DO NOTHING`,[version]);
      }
    });
    if (mock) await transaction(async client => {
      const {day,month} = periods(now());
      for (const account of mockAccounts) {
        const inserted = await client.query(`INSERT INTO ${schema}.users(id,name,is_mock) VALUES($1,$2,true) ON CONFLICT DO NOTHING RETURNING id`,[account.id,account.name]);
        if (inserted.rowCount) await client.query(`INSERT INTO ${schema}.usage(user_id,period,count) VALUES($1,$2,$3),($1,$4,$5) ON CONFLICT DO NOTHING`,[account.id,day,account.daily,month,account.monthly]);
      }
    });
  } catch (error) { if (!providedPool) await pool.end(); throw error; }
  return {
    persistent: true,
    status: readStatus,
    async reserve(userId) {
      return transaction(async client => {
        await lockUser(client,userId);
        const quota = await readStatus(userId,client);
        const reason = quota.monthlyRemaining === 0 ? 'monthly' : quota.dailyRemaining === 0 ? 'daily' : null;
        if (reason) return {allowed:false,reason,error:quotaMessages[reason],quota};
        const id = randomUUID();
        await client.query(`INSERT INTO ${schema}.usage(user_id,period,count) VALUES($1,$2,1),($1,$3,1) ON CONFLICT(user_id,period) DO UPDATE SET count=${schema}.usage.count+1`,[userId,quota.day,quota.month]);
        await client.query(`INSERT INTO ${schema}.reservations(id,user_id,day,month,state) VALUES($1,$2,$3,$4,'pending')`,[id,userId,quota.day,quota.month]);
        return {allowed:true,id,userId,day:quota.day,month:quota.month};
      });
    },
    async release(ticket) {
      if (!ticket?.allowed) return;
      await transaction(async client => {
        await lockUser(client,ticket.userId);
        const changed = await client.query(`UPDATE ${schema}.reservations SET state='released' WHERE id=$1 AND user_id=$2 AND state='pending' RETURNING day,month`,[ticket.id,ticket.userId]);
        if (changed.rowCount) await client.query(`UPDATE ${schema}.usage SET count=count-1 WHERE user_id=$1 AND period=ANY($2::text[]) AND count>0`,[ticket.userId,[changed.rows[0].day,changed.rows[0].month]]);
      });
    },
    async commit(ticket) {
      if (ticket?.allowed) await pool.query(`UPDATE ${schema}.reservations SET state='completed' WHERE id=$1 AND user_id=$2 AND state='pending'`,[ticket.id,ticket.userId]);
    },
    async accounts() { return mock ? (await pool.query(`SELECT id,name FROM ${schema}.users WHERE is_mock=true ORDER BY id`)).rows : []; },
    async login(id) {
      if (!mock) return null;
      const user = (await pool.query(`SELECT id,name FROM ${schema}.users WHERE id=$1 AND is_mock=true`,[id])).rows[0];
      if (!user) return null;
      const token = randomBytes(32).toString('hex');
      await pool.query(`DELETE FROM ${schema}.mock_sessions WHERE expires_at<=$1`,[now()]);
      await pool.query(`INSERT INTO ${schema}.mock_sessions VALUES($1,$2,$3)`,[digest(token),id,new Date(now().getTime()+8*3600000)]);
      return {user,token};
    },
    async authenticate(req) {
      if (!mock) return null;
      const token = cookieToken(req);
      if (!/^[a-f0-9]{64}$/.test(token || '')) return null;
      return (await pool.query(`SELECT u.id,u.name FROM ${schema}.mock_sessions s JOIN ${schema}.users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>$2`,[digest(token),now()])).rows[0] || null;
    },
    async logout(req) { const token = cookieToken(req); if (token) await pool.query(`DELETE FROM ${schema}.mock_sessions WHERE token_hash=$1`,[digest(token)]); },
    async conversation(userId,id) {
      const query = id ? `SELECT id,messages,choices FROM ${schema}.conversations WHERE user_id=$1 AND id=$2` : `SELECT id,messages,choices FROM ${schema}.conversations WHERE user_id=$1 AND jsonb_array_length(messages)>0 ORDER BY updated_at DESC LIMIT 1`;
      return (await pool.query(query,id ? [userId,id] : [userId])).rows[0] || null;
    },
    async beginConversation(userId,id) {
      return transaction(async client => {
        await ensureUser(client,userId);
        await client.query(`INSERT INTO ${schema}.conversations(user_id,id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[userId,id]);
        const token = randomUUID();
        const result = await client.query(`UPDATE ${schema}.conversations SET lease_id=$3,lease_until=now()+interval '3 minutes' WHERE user_id=$1 AND id=$2 AND (lease_until IS NULL OR lease_until<now()) RETURNING messages,choices,summary_cache`,[userId,id,token]);
        return result.rowCount ? {...result.rows[0],userId,id,token} : null;
      });
    },
    async saveSummaryCache(lease,entries) {
      const result = await pool.query(`UPDATE ${schema}.conversations SET summary_cache=$4::jsonb WHERE user_id=$1 AND id=$2 AND lease_id=$3`,[lease.userId,lease.id,lease.token,JSON.stringify(entries)]);
      if (!result.rowCount) throw new Error('Sohbet oturumu değişti.');
    },
    async completeConversation(lease,messages,choices,ticket) {
      await transaction(async client => {
        const saved = await client.query(`UPDATE ${schema}.conversations SET messages=$4::jsonb,choices=$5::jsonb,lease_id=NULL,lease_until=NULL,updated_at=now() WHERE user_id=$1 AND id=$2 AND lease_id=$3 RETURNING id`,[lease.userId,lease.id,lease.token,JSON.stringify(messages),JSON.stringify(choices)]);
        if (!saved.rowCount) throw new Error('Sohbet oturumu değişti.');
        if (ticket?.allowed) {
          const updated = await client.query(`UPDATE ${schema}.reservations SET state='completed' WHERE id=$1 AND user_id=$2 AND state='pending' RETURNING id`,[ticket.id,lease.userId]);
          if (!updated.rowCount) throw new Error('Mesaj hakkı doğrulanamadı.');
        }
      });
    },
    async endConversation(lease) { if (lease) await pool.query(`UPDATE ${schema}.conversations SET lease_id=NULL,lease_until=NULL WHERE user_id=$1 AND id=$2 AND lease_id=$3`,[lease.userId,lease.id,lease.token]); },
    close: () => providedPool ? Promise.resolve() : pool.end()
  };
}
