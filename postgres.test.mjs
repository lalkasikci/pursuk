import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { createPostgresStore } from './postgres-store.mjs';
import { createApp } from './server.mjs';
import { createHistoryContext } from './history-context.mjs';

test('PostgreSQL: kalıcı kota, eşzamanlı erişim, sohbet ve özet belleği', {skip:!process.env.TEST_DATABASE_URL}, async () => {
  const url=process.env.TEST_DATABASE_URL;
  if (!new URL(url).pathname.endsWith('_test')) throw new Error('Yalnızca _test ile biten ayrı bir test veritabanı kullanılabilir.');
  const pool=new pg.Pool({connectionString:url,max:12});
  let store,second;
  const prefix='test-'+randomUUID();
  const user=prefix+'-a', other=prefix+'-b', conversationId=randomUUID();
  try {
    assert.match((await pool.query('SELECT current_database() AS name')).rows[0].name,/_test$/);
    store=await createPostgresStore({connectionString:url});
    assert.equal((await pool.query("SELECT to_regclass('pursuk.imports') AS legacy")).rows[0].legacy,null);
    assert.equal((await pool.query('SELECT max(version) AS version FROM pursuk.schema_migrations')).rows[0].version,2);
    second=await createPostgresStore({connectionString:url});
    const results=await Promise.all(Array.from({length:30},(_,i)=>(i%2?store:second).reserve(user)));
    assert.equal(results.filter(result=>result.allowed).length,20);
    assert.equal((await store.status(user)).monthlyUsed,20);
    const ticket=results.find(result=>result.allowed);
    await Promise.all([store.release(ticket),second.release({...ticket})]);
    assert.equal((await store.status(user)).dailyUsed,19);
    assert.equal((await second.reserve(user)).allowed,true);
    assert.equal((await store.reserve(user)).reason,'daily');
    assert.equal((await store.status(other)).dailyUsed,0);
    await store.close();
    store=await createPostgresStore({connectionString:url});
    assert.equal((await store.reserve(user)).reason,'daily');

    const leases=await Promise.all([store.beginConversation(other,conversationId),second.beginConversation(other,conversationId)]);
    assert.equal(leases.filter(Boolean).length,1);
    const lease=leases.find(Boolean);
    const messages=Array.from({length:19},(_,i)=>({role:i%2?'assistant':'user',content:'Bütçe 600 TL ve hedef WhatsApp. '.repeat(30)}));
    const entries=[];
    let generated=0;
    const generate=async()=>{generated++;return 'Kullanıcının günlük bütçesi 600 TL, hedefi WhatsApp mesajları. Reklam görselleri üzerinde çalışma sürüyor.';};
    assert.equal((await createHistoryContext().prepare(messages,{conversationId,generate,persistentEntries:entries})).info.mode,'summary');
    await store.saveSummaryCache(lease,entries);
    await store.completeConversation(lease,[{role:'user',content:'Madset nedir?'},{role:'assistant',content:'Madset reklam platformudur.'}],[]);
    await store.close();
    store=await createPostgresStore({connectionString:url});
    assert.equal((await store.conversation(other)).messages.length,2);
    assert.equal(await store.conversation(user,conversationId),null);
    const restored=await store.beginConversation(other,conversationId);
    await createHistoryContext().prepare(messages,{conversationId,generate,persistentEntries:restored.summary_cache});
    assert.equal(generated,1);
    await store.endConversation(restored);

    const app=createApp({quotaStore:store,conversationStore:store,mockAuth:false,resolveUser:async req=>({id:req.headers['x-test-user']==='other'?user:other,name:'Test'}),apiKey:'fake',fetchImpl:async()=>new Response('unavailable',{status:500})});
    await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${app.address().port}`;
    try {
      const response=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId,messages:[{role:'user',content:'Sahte eski soru'},{role:'assistant',content:'İstemciden gelen sahte yanıt'},{role:'user',content:'Madset nedir?'}]})});
      assert.equal(response.status,200);
      const saved=await (await fetch(base+'/api/conversations/'+conversationId)).json();
      assert.equal(saved.messages.length,4);
      assert.equal(JSON.stringify(saved.messages).includes('Sahte'),false);
      assert.equal((await fetch(base+'/api/conversations/'+conversationId,{headers:{'x-test-user':'other'}})).status,404);
      assert.equal((await store.status(other)).dailyUsed,0);
      const failed=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({conversationId,messages:[{role:'user',content:'Reklamım satış getirmiyor. Ne yapmalıyım?'}]})});
      assert.equal(failed.status,502);
      // Wait for the response-finally cleanup, which returns the reserved quota.
      for(let i=0;i<20 && (await store.status(other)).dailyUsed!==0;i++) await new Promise(resolve=>setTimeout(resolve,10));
      assert.equal((await store.status(other)).dailyUsed,0);
      assert.equal((await store.conversation(other,conversationId)).messages.length,4);
    } finally {app.closeAllConnections();await new Promise(resolve=>app.close(resolve));store=null;}

    const mock=await createPostgresStore({connectionString:url,mock:true});
    try {
      const login=await mock.login('demo-ayse');
      assert.equal((await mock.authenticate({headers:{cookie:'pursuk_mock='+login.token}})).id,'demo-ayse');
      await mock.logout({headers:{cookie:'pursuk_mock='+login.token}});
      assert.equal(await mock.authenticate({headers:{cookie:'pursuk_mock='+login.token}}),null);
      assert.equal(await mock.login('not-a-user'),null);
      const imported=prefix+'-monthly';
      await pool.query('INSERT INTO pursuk.users(id,name) VALUES($1,$2)',[imported,'Monthly test']);
      await pool.query('INSERT INTO pursuk.usage(user_id,period,count) VALUES($1,$2,$3)',[imported,'2026-11',399]);
      const dated=await createPostgresStore({connectionString:url,now:()=>new Date('2026-11-03T12:00:00Z')});
      try {
        assert.equal((await dated.reserve(imported)).allowed,true);
        assert.equal((await dated.reserve(imported)).reason,'monthly');
        assert.equal((await dated.status(imported)).dailyRemaining,19);
      } finally {await dated.close();}
      const nextMonth=await createPostgresStore({connectionString:url,now:()=>new Date('2026-12-01T00:00:00Z')});
      try {assert.equal((await nextMonth.status(imported)).monthlyUsed,0);} finally {await nextMonth.close();}
    } finally {await mock.close();}
  } finally {
    await store?.close();await second?.close();
    // Test-owned rows only; never clear shared application tables.
    for (const table of ['reservations','mock_sessions','conversations','usage']) await pool.query(`DELETE FROM pursuk.${table} WHERE user_id LIKE $1`,[prefix+'%']);
    await pool.query('DELETE FROM pursuk.users WHERE id LIKE $1',[prefix+'%']);
    await pool.end();
  }
});
