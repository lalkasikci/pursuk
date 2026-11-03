import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestStore } from './postgres-test-helper.mjs';
import { periods } from './quota-policy.mjs';
import { createApp } from './server.mjs';

test('gün ve ay Türkiye gece yarısında değişir; günlük sıfırlanırken aylık birikir', async () => {
  let time = new Date('2026-11-03T20:59:59Z');
  const store = await createTestStore({ now: () => time });
  try {
    for (let i=0;i<20;i++) assert.equal((await store.reserve('a')).allowed, true);
    assert.equal((await store.reserve('a')).reason, 'daily');
    assert.equal((await store.status('b')).dailyUsed, 0);
    time = new Date('2026-11-03T21:00:00Z');
    assert.equal((await store.status('a')).dailyUsed, 0);
    assert.equal((await store.status('a')).monthlyUsed, 20);
    assert.equal((await store.reserve('a')).allowed, true);
    time = new Date('2026-11-30T21:00:00Z');
    assert.deepEqual(periods(time), { day: '2026-12-01', month: '2026-12' });
    assert.equal((await store.status('a')).monthlyUsed, 0);
  } finally { await store.close(); }
});

test('aylık 400 günlük hak kalsa da engeller; iade iki kere uygulanmaz', async () => {
  let time = new Date('2026-11-01T12:00:00Z');
  const store = await createTestStore({ now: () => time });
  try {
    for (let day=1;day<=20;day++) {
      time = new Date(`2026-11-${String(day).padStart(2,'0')}T12:00:00Z`);
      for (let i=0;i<20;i++) assert.equal((await store.reserve('a')).allowed, true);
    }
    time = new Date('2026-11-21T12:00:00Z');
    assert.equal((await store.status('a')).dailyRemaining, 20);
    assert.equal((await store.reserve('a')).reason, 'monthly');
    const ticket = await store.reserve('b');
    await store.release(ticket); await store.release(ticket);
    assert.equal((await store.status('b')).dailyUsed, 0);
    assert.equal((await store.status('b')).monthlyUsed, 0);
  } finally { await store.close(); }
});

test('kota ve test oturumu yeni depoda korunur; başlangıç verisi tekrarlanmaz', async () => {
  const store = await createTestStore({mock:true});
  try {
    const login = await store.login('demo-gunluk');
    assert.equal((await store.reserve('demo-gunluk')).allowed,true);
    const reopened = await store.reopen();
    try {
      assert.equal((await reopened.reserve('demo-gunluk')).reason,'daily');
      assert.equal((await reopened.authenticate({headers:{cookie:`pursuk_mock=${login.token}`}})).id,'demo-gunluk');
    } finally {await reopened.close();}
  } finally {await store.close();}
});

async function withApp(options, run) {
  const app = createApp(options);
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.address().port}`;
  try { await run(base); } finally { app.closeAllConnections(); await new Promise(resolve => app.close(resolve)); await options.quotaStore.close(); }
}
const data = { messages: [{ role: 'user', content: 'Madset nedir?' }] };
const post = (base, path, body, cookie='') => fetch(base+path, { method:'POST', headers:{'Content-Type':'application/json', Cookie:cookie}, body: JSON.stringify(body) });
async function login(base,id) {
  const response = await post(base,'/api/mock/login',{accountId:id});
  assert.equal(response.status,200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('giriş zorunludur; yeni sohbet ve sahte kimlik kotayı sıfırlamaz; eşzamanlı son hak bir kez kullanılır', async () => {
  await withApp({ mockAuth:true, quotaStore:await createTestStore({mock:true}), apiKey:'' }, async base => {
    assert.equal((await post(base,'/api/chat', {...data,userId:'demo-ayse'})).status,401);
    const cookie = await login(base,'demo-gunluk');
    const results = await Promise.all(Array.from({length:5},()=>post(base,'/api/chat',{...data,userId:'demo-ayse'},cookie)));
    assert.equal(results.filter(result=>result.status===200).length,1);
    assert.equal(results.filter(result=>result.status===429).length,4);
    assert.equal((await (await post(base,'/api/chat',data,cookie)).json()).code,'quota_daily');
    const secondSession = await login(base,'demo-gunluk');
    assert.equal((await post(base,'/api/chat',data,secondSession)).status,429);
    const other = await login(base,'demo-deniz');
    assert.equal((await post(base,'/api/chat',data,other)).status,200);
    const monthly = await login(base,'demo-aylik');
    assert.equal((await post(base,'/api/chat',{...data,stream:true},monthly)).status,200);
    assert.equal((await (await post(base,'/api/chat',data,monthly)).json()).code,'quota_monthly');
    await post(base,'/api/mock/logout',{},other);
    assert.equal((await post(base,'/api/chat',data,other)).status,401);
  });
});

test('test modu kapalıysa örnek hesap uçları yoktur ve doğrulanmış hesap olmadan sohbet açılamaz', async () => {
  await withApp({ mockAuth:false, quotaStore:await createTestStore() }, async base => {
    assert.equal((await fetch(base+'/api/mock/accounts')).status,404);
    assert.equal((await post(base,'/api/mock/login',{accountId:'demo-ayse'})).status,404);
    assert.equal((await post(base,'/api/chat',data)).status,401);
  });
});

test('Claude hatası, bozuk istek ve yarım kalan akış kullanıcının hakkını tüketmez', async () => {
  const quotaStore = await createTestStore({mock:true});
  let stream = false;
  await withApp({ mockAuth:true, quotaStore, apiKey:'fake', fetchImpl: async () => stream ? new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"kısmi"}}\n\n'));c.close();}})) : new Response('',{status:500}) }, async base => {
    const cookie = await login(base,'demo-ayse');
    assert.equal((await post(base,'/api/chat',{messages:[]},cookie)).status,400);
    const question = {messages:[{role:'user',content:'Reklamım satış getirmiyor, nasıl iyileştiririm?'}]};
    assert.equal((await post(base,'/api/chat',question,cookie)).status,502);
    for(let i=0;i<30 && (await quotaStore.status('demo-ayse')).dailyUsed;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal((await quotaStore.status('demo-ayse')).dailyUsed,0);
    stream = true;
    const result = await post(base,'/api/chat',{...question,stream:true},cookie);
    assert.match(await result.text(), /Yanıt tamamlanamadı/);
    for(let i=0;i<30 && (await quotaStore.status('demo-ayse')).dailyUsed;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal((await quotaStore.status('demo-ayse')).dailyUsed,0);
  });
});

test('sunucu kapanırken devam eden hak iadesi bitmeden PostgreSQL kapatılmaz', async () => {
  const store=await createTestStore();
  const release=store.release.bind(store), close=store.close.bind(store);
  let unblock, notifyClosed;
  const blocked=new Promise(resolve=>{unblock=resolve;});
  const storageClosed=new Promise(resolve=>{notifyClosed=resolve;});
  let closed=false;
  store.release=async ticket=>{await blocked;await release(ticket);};
  store.close=async()=>{
    assert.equal((await store.status('test-user')).dailyUsed,0);
    closed=true;
    await close();
    notifyClosed();
  };
  const app=createApp({quotaStore:store,resolveUser:async()=>({id:'test-user',name:'Test'}),apiKey:'fake',fetchImpl:async()=>new Response('',{status:500})});
  await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
  try {
    const response=await post(`http://127.0.0.1:${app.address().port}`,'/api/chat',{messages:[{role:'user',content:'Reklamım neden satış getirmiyor?'}]});
    assert.equal(response.status,502);
    app.closeAllConnections();
    await new Promise(resolve=>app.close(resolve));
    assert.equal(closed,false);
    unblock();
    await storageClosed;
    assert.equal(closed,true);
  } finally {unblock();if(!closed) await close();}
});
